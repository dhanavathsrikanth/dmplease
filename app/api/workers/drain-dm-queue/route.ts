import { verifyQstashRequest } from "@/lib/qstash-verify";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { cleanEnv } from "@/lib/upstash";
import { runDmQueueDrain, publishDmQueueContinuation } from "@/lib/dm-queue";

export const maxDuration = 60;

export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) return Response.json({ error: "Invalid signature" }, { status: 401 });
  if (!hasAdminDb()) return Response.json({ error: "Database unavailable" }, { status: 503 });

  const origin = (
    cleanEnv("NEXT_PUBLIC_SITE_URL") || cleanEnv("APP_URL") || new URL(request.url).origin
  ).replace(/\/$/, "");

  try {
    const result = await runDmQueueDrain(getAdminDb());
    if (result.remaining > 0) await publishDmQueueContinuation(origin);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("[drain-dm-queue] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Drain failed" },
      { status: 500 }
    );
  }
}
