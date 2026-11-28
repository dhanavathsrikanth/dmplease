import { NextRequest, NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/followups";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { WEBHOOK_CLAIM_LEASE_SECONDS } from "@/lib/dedupe";
import {
  processWebhookPayload,
  type ProcessingResult,
} from "@/lib/meta/webhook-processor";
import {
  markWebhookFinished,
  markWebhookProcessing,
} from "@/lib/meta/webhook-events";
import { withCronLock } from "@/lib/redis-lock";
import type { WebhookPayload } from "@/lib/meta/webhook";

export const maxDuration = 60;

/** Keep the sweep small so one run stays inside the function budget. */
const BATCH_SIZE = 5;

function failureResult(message: string): ProcessingResult {
  return {
    events: [],
    sent: 0,
    failed: 1,
    skipped: 0,
    avgLatencyMs: null,
    errors: [message],
    transientFailures: 1,
    permanentFailures: 0,
  };
}

/**
 * Recovery sweep for webhook batches whose worker died after claiming them.
 *
 * The claim carries a lease. A row still PENDING/PROCESSING after its lease
 * expired means the original worker never finished. Re-claiming it atomically
 * lets the batch be processed instead of being dropped as a duplicate.
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const locked = await withCronLock("dmplease:webhook:recover", 55, async () => {
    const db = getAdminDb();
    const now = new Date().toISOString();
    // Two explicit queries instead of an `or` filter: a timestamp value
    // contains dots, and separate predicates avoid PostgREST parsing ambiguity.
    const [{ data: stale }, { data: retryable }] = await Promise.all([
      db
        .from("webhook_events")
        .select(
          "id, dedupe_key, object, instagram_account_id, workspace_id, event_kind, external_event_id, payload"
        )
        .in("status", ["PENDING", "PROCESSING"])
        .not("dedupe_key", "is", null)
        .lt("lease_expires_at", now)
        .order("received_at", { ascending: true })
        .limit(BATCH_SIZE),
      db
        .from("webhook_events")
        .select(
          "id, dedupe_key, object, instagram_account_id, workspace_id, event_kind, external_event_id, payload"
        )
        .eq("status", "FAILED")
        .not("dedupe_key", "is", null)
        .lt("attempts", 3)
        .order("received_at", { ascending: true })
        .limit(BATCH_SIZE),
    ]);
    const rows = [...(stale ?? []), ...(retryable ?? [])].slice(0, BATCH_SIZE);

    let recovered = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const payload = row.payload as WebhookPayload;
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.entry)) {
        await markWebhookFinished(
          row.id,
          failureResult("Stored payload is invalid"),
          Date.now()
        );
        failed++;
        continue;
      }

      // Re-claim atomically: a live worker may have extended the lease between
      // the select and this call.
      const { data: claim, error } = await db.rpc("claim_webhook_payload", {
        p_dedupe_key: row.dedupe_key,
        p_object: row.object,
        p_instagram_account_id: row.instagram_account_id,
        p_workspace_id: row.workspace_id,
        p_event_kind: row.event_kind,
        p_external_event_id: row.external_event_id,
        p_payload: payload,
        p_lease_seconds: WEBHOOK_CLAIM_LEASE_SECONDS,
      });
      if (error) {
        failed++;
        continue;
      }
      const status = (claim as { status?: string } | null)?.status;
      if (status !== "claimed") {
        skipped++;
        continue;
      }

      const startedAt = Date.now();
      try {
        await markWebhookProcessing(row.id, "replay");
        const result = await processWebhookPayload(payload);
        await markWebhookFinished(row.id, result, startedAt);
        recovered++;
      } catch (error) {
        await markWebhookFinished(
          row.id,
          failureResult(
            error instanceof Error ? error.message : "Recovery failed"
          ),
          startedAt
        );
        failed++;
      }
    }

    return { scanned: rows.length, recovered, failed, skipped };
  });

  if (locked.locked) {
    return NextResponse.json({ status: "skipped_locked" }, { status: 202 });
  }
  return NextResponse.json({ success: true, ...locked.value });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
