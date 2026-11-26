import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { processWebhookPayload } from "@/lib/meta/webhook-processor";
import { markWebhookFinished, markWebhookProcessing } from "@/lib/meta/webhook-events";

/**
 * Replays a stored webhook event through the real processor. Intended for
 * recovering events that failed because of a deploy-time bug. Protected by the
 * cron secret; payload shape is validated before processing.
 */
function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getCronSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Admin DB unavailable" }, { status: 503 });
  }

  let body: { eventId?: string };
  try {
    body = (await request.json()) as { eventId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const { data: row, error } = await getAdminDb()
    .from("webhook_events")
    .select("id, payload")
    .eq("id", body.eventId)
    .maybeSingle();
  if (error || !row?.payload) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const payload = row.payload as Parameters<typeof processWebhookPayload>[0];
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entry)) {
    return NextResponse.json({ error: "Stored payload is invalid" }, { status: 400 });
  }

  const startedAt = Date.now();
  await markWebhookProcessing(row.id);
  const result = await processWebhookPayload(payload);
  await markWebhookFinished(row.id, result, startedAt);

  return NextResponse.json({
    success: result.failed === 0,
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
    outcomes: result.events.map((event) => ({
      kind: event.kind,
      outcome: event.outcome,
      detail: event.detail,
    })),
  });
}
