import { NextRequest, NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/followups";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention windows documented in docs/09-architecture/SCALING_ARCHITECTURE.md.
 * Keeping these tables bounded is what keeps the platform healthy as event
 * volume grows; an unbounded webhook ledger is both a privacy and a capacity
 * problem.
 */
const RETENTION = [
  // `safety_events` is the audit trail; docs/09-architecture/SCALING_ARCHITECTURE.md
  // documents a 90-day window for it, so the job must match that value.
  { table: "safety_events", column: "created_at", days: 90 },
  { table: "webhook_events", column: "received_at", days: 30 },
  { table: "comment_events", column: "received_at", days: 90 },
  { table: "messages", column: "created_at", days: 90 },
  { table: "dm_logs", column: "sent_at", days: 90 },
  // Expired send claims are dead weight; `days: 0` deletes rows whose
  // `expires_at` has already passed.
  { table: "dm_send_claims", column: "expires_at", days: 0 },
  // Replay guards and cron locks are only useful until they expire.
  { table: "qstash_replay_guard", column: "expires_at", days: 0 },
  { table: "cron_locks", column: "expires_at", days: 0 },
  { table: "oauth_state_nonces", column: "expires_at", days: 0 },
] as const;

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const deleted: Record<string, number> = {};
  const errors: string[] = [];

  for (const rule of RETENTION) {
    const cutoff = new Date(Date.now() - rule.days * DAY_MS).toISOString();
    const { error, count } = await getAdminDb()
      .from(rule.table)
      .delete({ count: "exact" })
      .lt(rule.column, cutoff);
    if (error) {
      errors.push(`${rule.table}: ${error.message}`);
    } else {
      deleted[rule.table] = count ?? 0;
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { success: false, deleted, errors },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, deleted });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
