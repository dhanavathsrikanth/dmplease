import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAdminDb } from "@/lib/db-admin";

const cancelSchema = z.object({ action: z.literal("cancel") });

async function authorize(jobId: string, userId: string) {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("rerun_jobs")
    .select("id, workspace_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { error: "Job not found" as const, status: 404 };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", job.workspace_id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!workspace) {
    return { error: "Not authorized" as const, status: 403 };
  }
  return { workspaceId: String(job.workspace_id) };
}

/** Progress for one job. Polled by the re-run dialog. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await authorize(jobId, user.id);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const db = getAdminDb();
  const { data: job } = await db
    .from("rerun_jobs")
    .select(
      "id, status, days, total, sent, skipped, failed, error_message, created_at, finished_at"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { count: pending } = await db
    .from("rerun_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "pending");
  const { data: recentErrors } = await db
    .from("rerun_job_items")
    .select("error_message")
    .eq("job_id", jobId)
    .not("error_message", "is", null)
    .order("processed_at", { ascending: false })
    .limit(3);

  return NextResponse.json({
    ...job,
    pending: pending ?? 0,
    errors: (recentErrors ?? []).map((row) => String(row.error_message)).filter(Boolean),
  });
}

/** Cancel a queued or running job. The worker checks status on every batch. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await authorize(jobId, user.id);
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!cancelSchema.safeParse(body).success) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const db = getAdminDb();
  const { data: updated } = await db
    .from("rerun_jobs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      error_message: "Cancelled by the creator",
    })
    .eq("id", jobId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();

  return NextResponse.json({ success: true, cancelled: Boolean(updated) });
}
