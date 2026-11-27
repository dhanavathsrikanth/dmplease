/**
 * 24h follow-up engine.
 *
 * Design rules:
 *  - pure decisions live in `followup-policy.ts`; this module only supplies
 *    facts and performs side effects;
 *  - all queries are bounded and batched per step, never per recipient;
 *  - a distributed cron lock prevents overlapping invocations;
 *  - every outcome is written idempotently to `followup_events`, so retries
 *    and duplicate schedules cannot send the same step twice;
 *  - a click, a reply, an opt-out or a conversion stops the sequence.
 */

import { timingSafeEqual } from "crypto";

import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getCronSecret } from "@/lib/config";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessage } from "@/lib/meta/client";
import { buildAutomationContent } from "@/lib/meta/dm-content";
import { inHoldout } from "@/lib/followups-holdout";
import {
  cancellationReason,
  isFollowupDue,
  resolveAnchor,
  type FollowupAnchor,
} from "@/lib/followup-policy";
import { FOLLOWUP_LIMITS, type FollowupAction } from "@/lib/followup-constants";
import { withCronLock } from "@/lib/redis-lock";
import { recordMetricEvent } from "@/lib/metrics";

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

export interface FollowupSummary {
  processed: number;
  sent: number;
  heldOut: number;
  skippedConverted: number;
  skippedOptedOut: number;
  cancelled: number;
  failed: number;
  errors: string[];
}

function emptySummary(): FollowupSummary {
  return {
    processed: 0,
    sent: 0,
    heldOut: 0,
    skippedConverted: 0,
    skippedOptedOut: 0,
    cancelled: 0,
    failed: 0,
    errors: [],
  };
}

type AdminDb = ReturnType<typeof getAdminDb>;

interface FollowupStepRow {
  id: string;
  workspace_id: string;
  automation_id: string;
  step: number;
  delay_minutes: number;
  message: string;
  holdout_percent: number;
}

interface BaselineLog {
  recipient_id: string;
  recipient_username: string | null;
  sent_at: string | null;
  post_id: string | null;
}

interface ContactRow {
  id: string;
  instagram_id: string;
  username: string | null;
  opted_in_at: string | null;
  opted_out_at: string | null;
}

/** Single idempotent write path for every follow-up outcome. */
async function recordEvent(
  db: AdminDb,
  step: FollowupStepRow,
  contactId: string | null,
  recipientId: string,
  action: FollowupAction
): Promise<void> {
  await db.from("followup_events").upsert(
    {
      workspace_id: step.workspace_id,
      automation_id: step.automation_id,
      contact_id: contactId,
      recipient_id: recipientId,
      step: Number(step.step),
      action,
    },
    { onConflict: "automation_id,recipient_id,step,action", ignoreDuplicates: true }
  );
}

/** Contacts for a batch of IGSIDs, in one query. */
async function loadContacts(
  db: AdminDb,
  workspaceId: string,
  recipientIds: string[]
): Promise<Map<string, ContactRow>> {
  const { data } = await db
    .from("contacts")
    .select("id, instagram_id, username, opted_in_at, opted_out_at")
    .eq("workspace_id", workspaceId)
    .in("instagram_id", recipientIds);
  return new Map(
    ((data ?? []) as ContactRow[]).map((row) => [String(row.instagram_id), row])
  );
}

/** Conversion IDs are deduped here — duplicate webhooks cannot count twice. */
async function loadConvertedContactIds(
  db: AdminDb,
  workspaceId: string,
  contactIds: string[]
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();
  const { data } = await db
    .from("conversions")
    .select("contact_id")
    .eq("workspace_id", workspaceId)
    .in("contact_id", contactIds);
  return new Set((data ?? []).map((row) => String(row.contact_id)));
}

/** Latest human click per contact after `since` — one query for the batch. */
async function loadLatestClicks(
  db: AdminDb,
  workspaceId: string,
  contactIds: string[],
  since: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (contactIds.length === 0) return result;
  const { data } = await db
    .from("link_clicks")
    .select("contact_id, clicked_at")
    .eq("workspace_id", workspaceId)
    .in("contact_id", contactIds)
    .eq("is_bot", false)
    .gte("clicked_at", since)
    .order("clicked_at", { ascending: false });
  for (const row of data ?? []) {
    const contactId = row.contact_id ? String(row.contact_id) : null;
    if (!contactId || !row.clicked_at || result.has(contactId)) continue;
    result.set(contactId, String(row.clicked_at));
  }
  return result;
}

/** Latest inbound reply per contact after `since` — two bounded queries. */
async function loadLatestReplies(
  db: AdminDb,
  workspaceId: string,
  contactIds: string[],
  since: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (contactIds.length === 0) return result;

  const { data: conversations } = await db
    .from("conversations")
    .select("id, contact_id")
    .eq("workspace_id", workspaceId)
    .in("contact_id", contactIds);
  const conversationToContact = new Map(
    (conversations ?? []).map((row) => [String(row.id), String(row.contact_id)])
  );
  if (conversationToContact.size === 0) return result;

  const { data: replies } = await db
    .from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", [...conversationToContact.keys()])
    .eq("direction", "inbound")
    .eq("sender_type", "contact")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  for (const row of replies ?? []) {
    const contactId = conversationToContact.get(String(row.conversation_id));
    if (!contactId || !row.created_at || result.has(contactId)) continue;
    result.set(contactId, String(row.created_at));
  }
  return result;
}

async function processStep(
  db: AdminDb,
  step: FollowupStepRow,
  summary: FollowupSummary
): Promise<void> {
  const { data: automation } = await db
    .from("automations")
    .select(
      "id, workspace_id, dm_message, button_url, trigger_keywords, post_scope, active"
    )
    .eq("id", step.automation_id)
    .maybeSingle();
  if (!automation?.active) return;

  const { data: account } = await db
    .from("instagram_accounts")
    .select("instagram_id, access_token")
    .eq("workspace_id", step.workspace_id)
    .limit(1)
    .maybeSingle();
  if (!account?.access_token) return;

  let token: string;
  try {
    token = decryptToken(String(account.access_token));
  } catch {
    summary.errors.push(`Token unavailable for automation ${step.automation_id}`);
    return;
  }

  const delayMinutes = Number(step.delay_minutes);
  // Slack covers an opt-in recorded after the first DM. The policy still
  // enforces the exact due time for each recipient.
  const slackMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000 - slackMs).toISOString();

  const { data: due } = await db
    .from("dm_logs")
    .select("recipient_id, recipient_username, sent_at, post_id")
    .eq("workspace_id", step.workspace_id)
    .eq("automation_id", step.automation_id)
    .eq("sequence_step", 1)
    .eq("status", "SENT")
    .lte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(50);

  const logs = (due ?? []) as BaselineLog[];
  if (logs.length === 0) return;
  const recipientIds = logs.map((log) => String(log.recipient_id));

  const { data: priorEvents } = await db
    .from("followup_events")
    .select("recipient_id")
    .eq("automation_id", step.automation_id)
    .eq("step", Number(step.step))
    .in("recipient_id", recipientIds);
  const alreadyHandled = new Set(
    (priorEvents ?? []).map((row) => String(row.recipient_id))
  );

  const contacts = await loadContacts(db, step.workspace_id, recipientIds);
  const contactIds = [...contacts.values()].map((row) => String(row.id));
  const convertedIds = await loadConvertedContactIds(
    db,
    step.workspace_id,
    contactIds
  );
  const clicks = await loadLatestClicks(db, step.workspace_id, contactIds, cutoff);
  const replies = await loadLatestReplies(db, step.workspace_id, contactIds, cutoff);

  const keyword = String(
    (automation.trigger_keywords as string[] | null)?.[0] ?? "FOLLOWUP"
  );

  for (const log of logs) {
    const recipientId = String(log.recipient_id);
    if (alreadyHandled.has(recipientId)) continue;
    summary.processed++;

    const contact = contacts.get(recipientId) ?? null;
    const anchor: FollowupAnchor = resolveAnchor({
      optedInAt: contact?.opted_in_at ?? null,
      firstDmAt: log.sent_at ?? null,
    });
    if (!isFollowupDue(anchor, delayMinutes)) continue;

    if (contact && convertedIds.has(String(contact.id))) {
      summary.skippedConverted++;
      await recordEvent(db, step, String(contact.id), recipientId, "converted");
      continue;
    }

    if (contact?.opted_out_at) {
      summary.skippedOptedOut++;
      await recordEvent(db, step, String(contact.id), recipientId, "opted_out");
      continue;
    }

    const cancel = cancellationReason(
      {
        clickedAt: contact ? clicks.get(String(contact.id)) : null,
        repliedAt: contact ? replies.get(String(contact.id)) : null,
      },
      anchor
    );
    if (cancel) {
      summary.cancelled++;
      await recordEvent(db, step, contact?.id ? String(contact.id) : null, recipientId, "cancelled");
      continue;
    }

    if (inHoldout(recipientId, Number(step.step), Number(step.holdout_percent))) {
      summary.heldOut++;
      await recordEvent(db, step, contact?.id ? String(contact.id) : null, recipientId, "held_out");
      continue;
    }

    // Same content pipeline as the first DM: {link} and the auto-attached reel
    // permalink behave identically in a follow-up.
    const content = await buildAutomationContent({
      auto: {
        id: String(automation.id),
        postScope: automation.post_scope as string | null,
        buttonUrl: automation.button_url as string | null,
        dmMessage: String(step.message),
      },
      token,
      accountId: String(account.instagram_id),
      mediaId: log.post_id,
      keyword,
      username: contact?.username ?? log.recipient_username ?? undefined,
      workspaceId: step.workspace_id,
      contactId: contact?.id ? String(contact.id) : null,
      recipientId,
    });

    const result = await sendDirectMessage(
      token,
      String(account.instagram_id),
      recipientId,
      content.text
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
      recipient_username: String(
        contact?.username || log.recipient_username || "instagram_user"
      ),
      trigger_keyword: `FOLLOWUP${step.step}`,
      dm_message: content.text,
      status: "SENT",
      post_id: log.post_id ?? null,
      keyword: `FOLLOWUP${step.step}`,
      sequence_step: Number(step.step) + 1,
      variant: "followup",
    });
    await recordEvent(db, step, contact?.id ? String(contact.id) : null, recipientId, "sent");
    await recordMetricEvent({
      kind: "dm_sent",
      creatorId: step.workspace_id,
      targetId: String(automation.id),
    });
    summary.sent++;
  }
}

/** Sends due follow-ups. Never call from a request path without cron auth. */
export async function runFollowups(): Promise<FollowupSummary> {
  const run = await withCronLock(
    "dmplease:followups:run",
    55,
    runFollowupsUnlocked
  );
  // An overlapping invocation simply reports an empty run — no duplicates.
  return run.value ?? emptySummary();
}

/** Exported for an authenticated admin trigger and for tests. */
export async function runFollowupsUnlocked(): Promise<FollowupSummary> {
  const summary = emptySummary();
  if (!hasAdminDb()) return summary;
  const db = getAdminDb();

  const { data: steps } = await db
    .from("followup_steps")
    .select(
      "id, workspace_id, automation_id, step, delay_minutes, message, holdout_percent"
    )
    .eq("enabled", true)
    .order("step", { ascending: true })
    .limit(FOLLOWUP_LIMITS.maxSteps * 50);
  if (!steps?.length) return summary;

  for (const step of steps as FollowupStepRow[]) {
    await processStep(db, step, summary);
  }
  return summary;
}
