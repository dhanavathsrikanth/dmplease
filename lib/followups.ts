import { timingSafeEqual } from "crypto";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getCronSecret } from "@/lib/config";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessage } from "@/lib/meta/client";
import { formatDmText, linkForMessage } from "@/lib/meta/webhook-processor";
import { inHoldout } from "@/lib/followups-holdout";

export function isCronAuthorized(header: string): boolean {
  try {
    const expected = `Bearer ${getCronSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface FollowupSummary {
  processed: number;
  sent: number;
  heldOut: number;
  skippedConverted: number;
  failed: number;
  errors: string[];
}

/** Sends due follow-ups. Never call from a request path without cron auth. */
export async function runFollowups(): Promise<FollowupSummary> {
  const summary: FollowupSummary = {
    processed: 0,
    sent: 0,
    heldOut: 0,
    skippedConverted: 0,
    failed: 0,
    errors: [],
  };
  if (!hasAdminDb()) return summary;
  const db = getAdminDb();

  const { data: steps } = await db
    .from("followup_steps")
    .select("id, workspace_id, automation_id, step, delay_minutes, message, holdout_percent")
    .eq("enabled", true)
    .limit(100);
  if (!steps?.length) return summary;

  for (const step of steps) {
    const { data: automation } = await db
      .from("automations")
      .select("id, workspace_id, dm_message, button_url, trigger_keywords, active")
      .eq("id", step.automation_id)
      .maybeSingle();
    if (!automation?.active) continue;

    const { data: account } = await db
      .from("instagram_accounts")
      .select("instagram_id, access_token")
      .eq("workspace_id", step.workspace_id)
      .limit(1)
      .maybeSingle();
    if (!account?.access_token) continue;

    let token: string;
    try {
      token = decryptToken(String(account.access_token));
    } catch {
      summary.errors.push(`Token unavailable for automation ${step.automation_id}`);
      continue;
    }

    const cutoff = new Date(
      Date.now() - Number(step.delay_minutes) * 60 * 1000
    ).toISOString();

    const { data: due } = await db
      .from("dm_logs")
      .select("recipient_id, recipient_username, sent_at")
      .eq("workspace_id", step.workspace_id)
      .eq("automation_id", step.automation_id)
      .eq("sequence_step", 1)
      .eq("status", "SENT")
      .lte("sent_at", cutoff)
      .limit(50);

    for (const log of due ?? []) {
      const recipientId = String(log.recipient_id);
      summary.processed++;

      const { data: existing } = await db
        .from("followup_events")
        .select("action")
        .eq("automation_id", step.automation_id)
        .eq("recipient_id", recipientId)
        .eq("step", step.step)
        .in("action", ["sent", "held_out"])
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      const { data: contact } = await db
        .from("contacts")
        .select("id, username")
        .eq("workspace_id", step.workspace_id)
        .eq("instagram_id", recipientId)
        .maybeSingle();

      if (contact?.id) {
        const { data: conversion } = await db
          .from("conversions")
          .select("id")
          .eq("workspace_id", step.workspace_id)
          .eq("contact_id", contact.id)
          .limit(1)
          .maybeSingle();
        if (conversion) {
          summary.skippedConverted++;
          await db.from("followup_events").upsert(
            {
              workspace_id: step.workspace_id,
              automation_id: step.automation_id,
              contact_id: contact.id,
              recipient_id: recipientId,
              step: step.step,
              action: "converted",
            },
            { onConflict: "automation_id,recipient_id,step,action", ignoreDuplicates: true }
          );
          continue;
        }
      }

      if (inHoldout(recipientId, Number(step.step), Number(step.holdout_percent))) {
        summary.heldOut++;
        await db.from("followup_events").upsert(
          {
            workspace_id: step.workspace_id,
            automation_id: step.automation_id,
            contact_id: contact?.id ?? null,
            recipient_id: recipientId,
            step: step.step,
            action: "held_out",
          },
          { onConflict: "automation_id,recipient_id,step,action", ignoreDuplicates: true }
        );
        continue;
      }

      const text = formatDmText(String(step.message), {
        username: String(contact?.username || log.recipient_username || "there"),
        link: linkForMessage(
          String(automation.button_url ?? ""),
          String(automation.id)
        ),
        keyword: String((automation.trigger_keywords as string[] | null)?.[0] ?? "FOLLOWUP"),
      });

      const result = await sendDirectMessage(
        token,
        String(account.instagram_id),
        recipientId,
        text
      );
      if (result?.error) {
        summary.failed++;
        summary.errors.push(
          `Follow-up ${step.step} failed for ${recipientId}: ${JSON.stringify(result.error).slice(0, 160)}`
        );
        continue;
      }

      await db.from("dm_logs").insert({
        workspace_id: step.workspace_id,
        automation_id: step.automation_id,
        recipient_id: recipientId,
        recipient_username: String(contact?.username || log.recipient_username || "instagram_user"),
        trigger_keyword: `FOLLOWUP${step.step}`,
        dm_message: text,
        status: "SENT",
        keyword: `FOLLOWUP${step.step}`,
        sequence_step: Number(step.step) + 1,
        variant: "followup",
      });
      await db.from("followup_events").upsert(
        {
          workspace_id: step.workspace_id,
          automation_id: step.automation_id,
          contact_id: contact?.id ?? null,
          recipient_id: recipientId,
          step: step.step,
          action: "sent",
        },
        { onConflict: "automation_id,recipient_id,step,action", ignoreDuplicates: true }
      );
      summary.sent++;
    }
  }

  return summary;
}
