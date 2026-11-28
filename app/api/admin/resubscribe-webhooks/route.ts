import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getAdminApiSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * One-off backfill: re-subscribes existing Instagram accounts to Meta webhooks
 * and corrects `webhook_subscribed` to match the real subscription result.
 *
 * Bounded (limit 1..100) and idempotent, so it can be run repeatedly until the
 * reported `failed` count reaches zero.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Admin DB unavailable" }, { status: 503 });
  }

  let limit = DEFAULT_LIMIT;
  try {
    const body = (await request.json()) as { limit?: unknown };
    if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(body.limit)));
    }
  } catch {
    // Empty or invalid body: fall back to the default batch size.
  }

  const db = getAdminDb();
  const { data: rows, error } = await db
    .from("instagram_accounts")
    .select("id, instagram_id, access_token, webhook_subscribed")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let subscribed = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    let token: string;
    try {
      token = decryptToken(String(row.access_token));
    } catch (error) {
      console.warn(
        `[resubscribe-webhooks] Could not decrypt token for ${row.id}:`,
        error
      );
      // Move the row to the back of the queue and record that it is not
      // subscribed, so one undecryptable token cannot block every later batch.
      await db
        .from("instagram_accounts")
        .update({
          webhook_subscribed: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    let success = false;
    try {
      const result = await subscribeInstagramAccountToWebhooks(
        String(row.instagram_id),
        token
      );
      success = result.success === true;
    } catch (error) {
      console.warn(
        `[resubscribe-webhooks] Subscription failed for ${row.id}:`,
        error
      );
      success = false;
    }

    const { error: updateError } = await db
      .from("instagram_accounts")
      .update({
        webhook_subscribed: success,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) {
      console.warn(
        `[resubscribe-webhooks] Could not update ${row.id}:`,
        updateError.message
      );
    }

    if (success) subscribed += 1;
    else failed += 1;
  }

  return NextResponse.json({
    success: true,
    scanned: rows?.length ?? 0,
    subscribed,
    failed,
  });
}
