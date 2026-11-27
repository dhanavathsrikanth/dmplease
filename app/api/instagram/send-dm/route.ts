import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessage } from "@/lib/meta/client";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { formatDmText } from "@/lib/meta/dm-template";
import {
  acquireSendSlot,
  checkRecipientCooldown,
} from "@/lib/meta/safety";
import { ensureContact } from "@/lib/meta/webhook-processor";
import { recordSendOutcome } from "@/lib/meta/account-health";
import { recordMetricEvent } from "@/lib/metrics";
import { getWorkspaceTimeZone } from "@/lib/workspace-preferences";

/**
 * POST /api/instagram/send-dm
 * Body: { recipientId; recipientUsername?; message; url? }
 *
 * Manual DMs now go through the same safety guards as automated ones:
 * hourly cap, recipient cooldown, 24h dedupe and logging. The previous
 * implementation bypassed all of them, which could violate Meta's limits.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { recipientId, recipientUsername, message, url } = body as {
      recipientId: string;
      recipientUsername?: string;
      message: string;
      url?: string;
    };

    if (!recipientId || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: "recipientId and message are required" },
        { status: 400 }
      );
    }

    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);
    const workspaceId = workspaces?.[0]?.id;
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: "No workspace found" },
        { status: 400 }
      );
    }

    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, instagram_id, access_token, username")
      .eq("workspace_id", workspaceId)
      .limit(1);
    const account = accounts?.[0];
    if (!account?.access_token) {
      return NextResponse.json(
        { success: false, error: "No connected Instagram account" },
        { status: 400 }
      );
    }

    let token: string;
    try {
      token = decryptToken(account.access_token);
    } catch {
      token = account.access_token;
    }

    // Safety: hourly cap and recipient cooldown apply to manual sends too.
    const capResult = await acquireSendSlot(`${account.instagram_id}:manual`, 30);
    if (!capResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Manual DM limit reached. Try again later.",
          retryAfterMs: capResult.retryAfterMs,
        },
        { status: 429 }
      );
    }

    const cooldownOk = await checkRecipientCooldown(
      account.instagram_id,
      "manual",
      recipientId
    );
    if (!cooldownOk) {
      return NextResponse.json(
        { success: false, error: "Recipient cooldown (10 minutes)." },
        { status: 429 }
      );
    }

    // 24h dedupe: never re-DM the same person twice in a day.
    if (hasAdminDb()) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await getAdminDb()
        .from("dm_logs")
        .select("id")
        .eq("automation_id", null)
        .eq("recipient_id", recipientId)
        .eq("status", "SENT")
        .gte("sent_at", since)
        .limit(1)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { success: false, error: "Already messaged this person in the last 24 hours." },
          { status: 409 }
        );
      }
    }

    const contactId = await ensureContact(
      workspaceId,
      recipientId,
      recipientUsername,
      "manual"
    );
    const username = recipientUsername || "there";
    const text = formatDmText(message.trim(), {
      username,
      link: url?.trim() || "",
      keyword: "MANUAL",
    });

    const result = await sendDirectMessage(
      token,
      account.instagram_id,
      recipientId,
      text
    );
    const success = !result?.error;

    if (hasAdminDb()) {
      const contact = contactId
        ? await getAdminDb()
            .from("contacts")
            .select("id")
            .eq("id", contactId)
            .maybeSingle()
        : null;
      const conversationId = contact?.data?.id
        ? await (async () => {
            const { data } = await getAdminDb()
              .from("conversations")
              .upsert(
                {
                  workspace_id: workspaceId,
                  contact_id: contact?.data?.id,
                  instagram_account_id: account.id,
                  status: "open",
                  last_message_at: new Date().toISOString(),
                },
                { onConflict: "contact_id,instagram_account_id" }
              )
              .select("id")
              .single();
            return (data as { id?: string } | null)?.id
              ? String((data as { id: string }).id)
              : null;
          })()
        : null;
      if (conversationId) {
        await getAdminDb().from("messages").insert({
          workspace_id: workspaceId,
          conversation_id: conversationId,
          external_id: result?.message_id ?? null,
          direction: "outbound",
          sender_type: "agent",
          content_type: "text",
          content: { text },
          delivery_status: success ? "sent" : "failed",
        });
      }
      await getAdminDb().from("dm_logs").insert({
        workspace_id: workspaceId,
        instagram_account_id: account.id,
        automation_id: null,
        recipient_id: recipientId,
        recipient_username: recipientUsername || "instagram_user",
        trigger_keyword: "MANUAL",
        dm_message: text,
        status: success ? "SENT" : "FAILED",
        keyword: "MANUAL",
        sequence_step: 0,
        variant: "manual",
      });
    }

    if (success) {
      await recordMetricEvent({
        kind: "dm_sent",
        creatorId: workspaceId,
        targetId: "manual",
        timeZone: await getWorkspaceTimeZone(workspaceId),
      });
    }
    await recordSendOutcome({
      accountId: account.id,
      outcome: success ? "sent" : "failed",
      error: success ? null : result?.error?.message || "Meta rejected the message",
    });

    if (!success) {
      return NextResponse.json(
        { success: false, error: result?.error?.message || "Meta API rejected the message" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, messageId: result.message_id });
  } catch (err: unknown) {
    console.error("[send-dm] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
