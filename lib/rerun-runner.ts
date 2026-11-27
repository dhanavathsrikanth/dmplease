/**
 * Durable re-run batch runner.
 *
 * Each batch is small, claimed under a Redis lock, and processed with the same
 * guards as a live comment. The job ledger is updated after each batch and a
 * follow-up QStash message continues the work, so a 200-person re-run is never
 * truncated by a serverless function's time budget.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getQstash, getQstashWorkerUrl, hasQstash } from "@/lib/upstash";
import { withCronLock } from "@/lib/redis-lock";
import {
  processCommentEventForAutomation,
  toAutomationLike,
} from "@/lib/meta/webhook-processor";
import type { WebhookCommentEvent } from "@/lib/meta/webhook";

export const RERUN_BATCH_SIZE = 20;

export interface RerunJobRow {
  id: string;
  workspace_id: string;
  automation_id: string;
  status: string;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  started_at: string | null;
}

interface RerunItemRow {
  id: string;
  account_graph_id: string;
  comment_id: string;
  media_id: string | null;
  comment_text: string | null;
  commenter_id: string;
  commenter_username: string | null;
  attempts: number;
}

export interface RerunBatchResult {
  jobId: string;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  remaining: number;
  status: string;
  locked?: boolean;
}

async function publishContinuation(jobId: string, origin: string): Promise<void> {
  if (!hasQstash()) return;
  const base = origin.replace(/\/$/, "");
  await getQstash().publishJSON({
    url: `${base}/api/workers/rerun`,
    body: { jobId },
    delay: 5,
    retries: 3,
    label: ["rerun"],
    failureCallback: `${base}/api/workers/qstash-failed`,
  });
}

export async function runRerunBatch(
  db: SupabaseClient,
  jobId: string,
  origin?: string
): Promise<RerunBatchResult> {
  const base =
    origin || (hasQstash() ? new URL(getQstashWorkerUrl()).origin : "");
  const guard = await withCronLock(
    `dmplease:rerun:${jobId}`,
    55,
    () => processBatch(db, jobId)
  );

  if (guard.locked) {
    const { data: job } = await db
      .from("rerun_jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle();
    return {
      jobId,
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      status: String(job?.status ?? "unknown"),
      locked: true,
    };
  }

  const result = guard.value!;
  if (result.status === "running" && result.remaining > 0 && base) {
    await publishContinuation(jobId, base);
  }
  return result;
}

async function processBatch(
  db: SupabaseClient,
  jobId: string
): Promise<RerunBatchResult> {
  const result: RerunBatchResult = {
    jobId,
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    status: "queued",
  };

  const { data: jobData } = await db
    .from("rerun_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  const job = jobData as RerunJobRow | null;
  if (!job) {
    result.status = "missing";
    return result;
  }
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    result.status = job.status;
    return result;
  }

  const { data: automationRow } = await db
    .from("automations")
    .select("*")
    .eq("id", job.automation_id)
    .maybeSingle();
  if (!automationRow) {
    await finishJob(db, job, "failed", "Campaign no longer exists");
    result.status = "failed";
    return result;
  }
  const auto = toAutomationLike(automationRow as Parameters<typeof toAutomationLike>[0]);
  if (!auto) {
    await finishJob(db, job, "failed", "Campaign could not be loaded");
    result.status = "failed";
    return result;
  }
  if (!(automationRow as { active?: boolean }).active) {
    await finishJob(db, job, "cancelled", "Campaign was paused during the re-run");
    result.status = "cancelled";
    return result;
  }

  await db
    .from("rerun_jobs")
    .update({ status: "running", started_at: job.started_at ?? new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued");

  const { data: pending } = await db
    .from("rerun_job_items")
    .select(
      "id, account_graph_id, comment_id, media_id, comment_text, commenter_id, commenter_username, attempts"
    )
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(RERUN_BATCH_SIZE);

  for (const raw of (pending ?? []) as RerunItemRow[]) {
    // Compare-and-set claim: a duplicate QStash delivery cannot send twice.
    const { data: claimed } = await db
      .from("rerun_job_items")
      .update({ status: "processing", attempts: raw.attempts + 1 })
      .eq("id", raw.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const event: WebhookCommentEvent = {
      instagramAccountId: raw.account_graph_id,
      commentId: raw.comment_id,
      commentText: raw.comment_text ?? "",
      commenterId: raw.commenter_id,
      commenterName: raw.commenter_username ?? undefined,
      mediaId: raw.media_id ?? "",
    };

    let status: "sent" | "skipped" | "failed" = "failed";
    let detail = "";
    try {
      const outcome = await processCommentEventForAutomation(event, auto);
      if (outcome.sent) status = "sent";
      else {
        status = "skipped";
        detail = String(outcome.skipped ?? "Not eligible");
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : "Unknown error";
    }

    await db
      .from("rerun_job_items")
      .update({
        status,
        error_message: detail.slice(0, 500) || null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", raw.id);

    result.processed++;
    if (status === "sent") result.sent++;
    else if (status === "skipped") result.skipped++;
    else result.failed++;
  }

  const { count: remaining } = await db
    .from("rerun_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "pending");
  result.remaining = remaining ?? 0;

  await db
    .from("rerun_jobs")
    .update({
      sent: job.sent + result.sent,
      skipped: job.skipped + result.skipped,
      failed: job.failed + result.failed,
      ...(result.remaining > 0
        ? {}
        : { status: "completed", finished_at: new Date().toISOString() }),
    })
    .eq("id", jobId);

  result.status = result.remaining > 0 ? "running" : "completed";
  return result;
}

async function finishJob(
  db: SupabaseClient,
  job: RerunJobRow,
  status: "failed" | "cancelled",
  message: string
): Promise<void> {
  await db
    .from("rerun_jobs")
    .update({
      status,
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
