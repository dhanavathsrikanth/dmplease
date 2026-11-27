import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAdminDb } from "@/lib/db-admin";
import { toAutomationLike } from "@/lib/meta/webhook-processor";
import { decryptToken } from "@/lib/meta/vault";
import { findRerunCandidates } from "@/lib/rerun-candidates";
import {
  cleanEnv,
  getQstash,
  hasQstash,
} from "@/lib/upstash";
import { captureServerEvent } from "@/lib/posthog-server";

export const maxDuration = 30;

export const rerunSchema = z.object({
  campaignId: z.string().uuid("Invalid campaign."),
  days: z.coerce.number().int().min(1).max(90).default(7),
  dryRun: z.boolean().default(false),
});

const MAX_CANDIDATES = 500;

/**
 * POST /api/campaigns/rerun
 *
 * Dry run → exact eligible count. Real run → creates a durable job and returns
 * its ID immediately. Delivery happens in small QStash-chained batches via
 * /api/workers/rerun, so nothing is reported as sent before it actually is.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = rerunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { campaignId, days, dryRun } = parsed.data;

  const { data: owned } = await supabase
    .from("automations")
    .select("id, workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", owned.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) {
    return NextResponse.json(
      { error: "Campaign not found or access denied" },
      { status: 403 }
    );
  }

  const db = getAdminDb();
  const { data: automationRow } = await db
    .from("automations")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!automationRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!(automationRow as { active?: boolean }).active) {
    return NextResponse.json(
      {
        error:
          "This campaign is paused. Resume it before re-running so no paused automation sends DMs.",
      },
      { status: 409 }
    );
  }
  const auto = toAutomationLike(automationRow as Parameters<typeof toAutomationLike>[0]);

  const { data: accountRow } = await db
    .from("instagram_accounts")
    .select("access_token")
    .eq("workspace_id", owned.workspace_id)
    .limit(1)
    .maybeSingle();
  let accessToken: string | null = null;
  if (accountRow?.access_token) {
    try {
      accessToken = decryptToken(String(accountRow.access_token));
    } catch {
      accessToken = null;
    }
  }

  let found;
  try {
    found = await findRerunCandidates(db, {
      workspaceId: owned.workspace_id,
      automation: auto,
      days,
      limit: MAX_CANDIDATES,
      accessToken,
    });
  } catch (error) {
    console.error("[rerun] Candidate lookup failed:", error);
    return NextResponse.json(
      { error: "Could not load recent comments." },
      { status: 500 }
    );
  }

  if (dryRun) {
    return NextResponse.json({
      count: found.candidates.length,
      sample: found.sample,
      days,
    });
  }

  if (found.candidates.length === 0) {
    return NextResponse.json({
      success: true,
      jobId: null,
      count: 0,
      message: "No eligible comments found for this window.",
    });
  }

  const { data: job, error: jobError } = await db
    .from("rerun_jobs")
    .insert({
      workspace_id: owned.workspace_id,
      automation_id: campaignId,
      created_by: user.id,
      status: "queued",
      days,
      total: found.candidates.length,
    })
    .select("id")
    .single();
  if (jobError || !job) {
    console.error("[rerun] Could not create job:", jobError?.message);
    return NextResponse.json(
      { error: "Could not start the re-run. Please try again." },
      { status: 500 }
    );
  }
  const jobId = String(job.id);

  for (let index = 0; index < found.candidates.length; index += 100) {
    const chunk = found.candidates.slice(index, index + 100).map((candidate) => ({
      job_id: jobId,
      workspace_id: owned.workspace_id,
      automation_id: campaignId,
      account_graph_id: candidate.accountGraphId,
      comment_id: candidate.commentId,
      media_id: candidate.mediaId || null,
      comment_text: candidate.commentText || null,
      commenter_id: candidate.commenterId,
      commenter_username: candidate.commenterUsername,
      status: "pending",
    }));
    const { error: itemError } = await db.from("rerun_job_items").upsert(chunk, {
      onConflict: "job_id,comment_id",
      ignoreDuplicates: true,
    });
    if (itemError) {
      await db
        .from("rerun_jobs")
        .update({ status: "failed", error_message: "Could not queue work items" })
        .eq("id", jobId);
      console.error("[rerun] Could not insert job items:", itemError.message);
      return NextResponse.json(
        { error: "Could not start the re-run. Please try again." },
        { status: 500 }
      );
    }
  }

  const origin = (
    cleanEnv("NEXT_PUBLIC_SITE_URL") ||
    cleanEnv("APP_URL") ||
    request.nextUrl.origin
  ).replace(/\/$/, "");

  if (hasQstash()) {
    try {
      await getQstash().publishJSON({
        url: `${origin}/api/workers/rerun`,
        body: { jobId },
        label: ["rerun"],
        retries: 3,
        failureCallback: `${origin}/api/workers/qstash-failed`,
        deduplicationId: `rerun-start-${jobId}`,
      });
    } catch (error) {
      console.error("[rerun] Queue publish failed:", error);
      await db
        .from("rerun_jobs")
        .update({
          status: "failed",
          error_message: "Delivery queue unavailable; no DMs were sent.",
        })
        .eq("id", jobId);
      return NextResponse.json(
        { error: "Delivery queue is unavailable. Nothing was sent." },
        { status: 503 }
      );
    }
  } else {
    // Local/dev fallback: process one small batch without a durable queue.
    const { runRerunBatch } = await import("@/lib/rerun-runner");
    const batch = await runRerunBatch(db, jobId, origin);
    if (batch.remaining > 0) {
      await db
        .from("rerun_jobs")
        .update({
          status: "completed",
          error_message: `Processed ${batch.processed} of ${found.candidates.length} locally (no queue configured). Start another re-run for the rest.`,
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  }

  captureServerEvent({
    event: "campaign_rerun_started",
    properties: {
      automation_id: campaignId,
      job_id: jobId,
      total: found.candidates.length,
      days,
    },
    anonymous: true,
  });

  return NextResponse.json({
    success: true,
    jobId,
    status: "queued",
    count: found.candidates.length,
  });
}
