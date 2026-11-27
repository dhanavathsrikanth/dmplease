/**
 * Durable DM queue for hourly-cap overflow.
 *
 * Overflow rows live in `pending_dms` with `kind = 'queued'`. A worker claims
 * them, re-runs the full comment pipeline (all safety guards included) and
 * removes them on success. Failed sends are retried with backoff; exhausted
 * rows are marked failed and surfaced in diagnostics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WebhookCommentEvent } from "@/lib/meta/webhook";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getQstash, hasQstash } from "@/lib/upstash";
import { withCronLock } from "@/lib/redis-lock";
import { toAutomationLike } from "@/lib/meta/webhook-processor";
import { processCommentEventForAutomation } from "@/lib/meta/webhook-processor";


const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface QueueSummary {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
  errors: string[];
}

export interface QueueStats {
  pending: number;
  failed: number;
  oldestPendingAt: string | null;
}

function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempts - 1));
}

/** Upserts a queued overflow row; idempotent per (automation, recipient, comment). */
export async function enqueueQueuedDm(input: {
  workspaceId: string;
  automationId: string;
  instagramAccountId: string | null;
  recipientId: string;
  commentId: string;
  message: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
}): Promise<void> {
  if (!hasAdminDb()) return;
  const db = getAdminDb();
  await db.from("pending_dms").upsert(
    {
      workspace_id: input.workspaceId,
      kind: "queued",
      automation_id: input.automationId,
      instagram_account_id: input.instagramAccountId,
      recipient_id: input.recipientId,
      comment_id: input.commentId,
      message: input.message,
      button_text: input.buttonText ?? null,
      button_url: input.buttonUrl ?? null,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      attempts: 0,
      last_error: null,
    },
    { onConflict: "automation_id,recipient_id,comment_id", ignoreDuplicates: false }
  );
}

export async function getQueueStats(
  workspaceIds: string[]
): Promise<QueueStats> {
  if (!hasAdminDb() || workspaceIds.length === 0) {
    return { pending: 0, failed: 0, oldestPendingAt: null };
  }
  const db = getAdminDb();
  const [pendingRes, failedRes, oldestRes] = await Promise.all([
    db
      .from("pending_dms")
      .select("id", { count: "exact", head: true })
      .in("workspace_id", workspaceIds)
      .eq("kind", "queued")
      .eq("status", "pending"),
    db
      .from("pending_dms")
      .select("id", { count: "exact", head: true })
      .in("workspace_id", workspaceIds)
      .eq("kind", "queued")
      .eq("status", "failed"),
    db
      .from("pending_dms")
      .select("created_at")
      .in("workspace_id", workspaceIds)
      .eq("kind", "queued")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  return {
    pending: pendingRes.count ?? 0,
    failed: failedRes.count ?? 0,
    oldestPendingAt: oldestRes.data?.[0]?.created_at
      ? String(oldestRes.data[0].created_at)
      : null,
  };
}

export async function runDmQueueDrain(
  db: SupabaseClient = getAdminDb()
): Promise<QueueSummary> {
  const summary: QueueSummary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    errors: [],
  };
  if (!hasAdminDb()) return summary;

  const locked = await withCronLock("dmplease:dmqueue:drain", 55, async () => {
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("pending_dms")
      .select(
        "id, workspace_id, automation_id, instagram_account_id, recipient_id, comment_id, attempts"
      )
      .eq("kind", "queued")
      .eq("status", "pending")
      .lte("next_attempt_at", now)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    for (const row of rows ?? []) {
      const claim = await db
        .from("pending_dms")
        .update({
          status: "processing",
          attempts: (row.attempts ?? 0) + 1,
          last_attempt_at: now,
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claim.data) continue; // Another worker claimed it.

      const attempts = (row.attempts ?? 0) + 1;
      summary.processed++;

      const { data: commentEvent } = await db
        .from("comment_events")
        .select("instagram_account_id, external_id, media_id, commenter_id, commenter_username, text")
        .eq("workspace_id", row.workspace_id)
        .eq("external_id", row.comment_id)
        .maybeSingle();
      const { data: automationRow } = await db
        .from("automations")
        .select("*")
        .eq("id", row.automation_id)
        .maybeSingle();
      const { data: accountRow } = commentEvent?.instagram_account_id
        ? await db
            .from("instagram_accounts")
            .select("instagram_id, access_token")
            .eq("id", commentEvent.instagram_account_id)
            .maybeSingle()
        : { data: null };

      if (!automationRow || !commentEvent || !accountRow?.access_token) {
        await db
          .from("pending_dms")
          .update({
            status: "failed",
            last_error: "Missing automation, comment or account",
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        summary.failed++;
        summary.errors.push(`Queued DM ${row.id} failed: missing data`);
        continue;
      }
      const auto = toAutomationLike(automationRow as Parameters<typeof toAutomationLike>[0]);
      const event: WebhookCommentEvent = {
        instagramAccountId: String(accountRow.instagram_id),
        commentId: String(commentEvent.external_id),
        commentText: String(commentEvent.text ?? ""),
        commenterId: String(commentEvent.commenter_id),
        commenterName: commentEvent.commenter_username
          ? String(commentEvent.commenter_username)
          : undefined,
        mediaId: String(commentEvent.media_id ?? ""),
      };

      try {
        const outcome = await processCommentEventForAutomation(event, auto, attempts);
        if (outcome.sent) {
          await db.from("pending_dms").delete().eq("id", row.id);
          summary.sent++;
        } else if (outcome.error) {
          throw outcome.error;
        } else {
          // Skipped (already contacted etc.) — drop the queue row.
          await db.from("pending_dms").delete().eq("id", row.id);
          summary.skipped++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        summary.failed++;
        summary.errors.push(`Queued DM ${row.id} failed: ${message.slice(0, 160)}`);
        if (attempts >= MAX_ATTEMPTS) {
          await db
            .from("pending_dms")
            .update({
              status: "failed",
              last_error: message.slice(0, 500),
              last_attempt_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        } else {
          await db
            .from("pending_dms")
            .update({
              status: "pending",
              last_error: message.slice(0, 500),
              last_attempt_at: new Date().toISOString(),
              next_attempt_at: new Date(
                Date.now() + backoffMs(attempts)
              ).toISOString(),
            })
            .eq("id", row.id);
        }
      }
    }

    const { count } = await db
      .from("pending_dms")
      .select("id", { count: "exact", head: true })
      .eq("kind", "queued")
      .eq("status", "pending");
    summary.remaining = count ?? 0;
    return summary;
  });

  if (locked.locked) return { ...summary, errors: ["Run skipped — another worker holds the lock."] };
  return locked.value ?? summary;
}

export async function publishDmQueueContinuation(origin: string): Promise<void> {
  if (!hasQstash()) return;
  const base = origin.replace(/\/$/, "");
  await getQstash().publishJSON({
    url: `${base}/api/workers/drain-dm-queue`,
    body: {},
    delay: 10,
    retries: 3,
    label: ["dm-queue"],
    failureCallback: `${base}/api/workers/qstash-failed`,
  });
}
