import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";

import { getCronSecret } from "@/lib/config";
import { flushBufferedClicks } from "@/lib/meta/link-resolver";
import { withCronLock } from "@/lib/redis-lock";

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return false;
  }
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Replays clicks that could not be written to the database at redirect time.
 * Runs every few minutes so a transient Supabase error never loses attribution.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connection();

  const run = await withCronLock("lock:cron:flush-link-clicks", 30, async () => {
    const flushed = await flushBufferedClicks();
    return NextResponse.json({ success: true, flushed });
  });

  if (run.locked) {
    return NextResponse.json(
      { status: "skipped_locked", message: "Click flush already in progress" },
      { status: 202 }
    );
  }
  return run.value!;
}
