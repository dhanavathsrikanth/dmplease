import { verifyQstashRequest } from "@/lib/qstash-verify";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { cleanEnv } from "@/lib/upstash";
import { runRerunBatch } from "@/lib/rerun-runner";

export const maxDuration = 60;

/**
 * QStash worker for a re-run job. Each invocation processes one small batch
 * and re-publishes itself if work remains, so no run is capped by a single
 * function's time budget. Non-2xx makes QStash retry; exhausted jobs land in
 * the shared DLQ.
 */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let jobId: string | null = null;
  try {
    const body = JSON.parse(raw) as { jobId?: string };
    jobId = body?.jobId ? String(body.jobId) : null;
  } catch {
    return Response.json({ error: "Invalid worker payload" }, { status: 400 });
  }
  if (!jobId) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }
  if (!hasAdminDb()) {
    return Response.json({ error: "Database unavailable" }, { status: 503 });
  }

  const origin = (
    cleanEnv("NEXT_PUBLIC_SITE_URL") || cleanEnv("APP_URL") || new URL(request.url).origin
  ).replace(/\/$/, "");

  try {
    const result = await runRerunBatch(getAdminDb(), jobId, origin);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("[rerun-worker] Batch failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Batch failed" },
      { status: 500 }
    );
  }
}
