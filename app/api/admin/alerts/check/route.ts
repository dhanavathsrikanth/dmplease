import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { getCurrentUser } from "@/lib/profile";
import { isAdminEmail, runCapacityCheck } from "@/lib/alerts/capacity";
import { withCronLock } from "@/lib/redis-lock";
import { captureServerEvent } from "@/lib/posthog-server";

function hasCronToken(request: NextRequest): boolean {
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

async function isAdminSession(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    return isAdminEmail(user?.email);
  } catch {
    return false;
  }
}

async function handle(request: NextRequest, forceBrief: boolean) {
  if (!hasCronToken(request) && !(await isAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withCronLock("lock:cron:capacity-alerts", 45, async () =>
    runCapacityCheck({ forceBrief })
  );
  if (run.locked) {
    return NextResponse.json(
      { status: "skipped_locked", message: "Capacity check already in progress" },
      { status: 202 }
    );
  }
  const result = run.value!;
  if (result.created > 0) {
    captureServerEvent({
      event: "capacity_alert_created",
      properties: {
        count: result.created,
        accounts: result.metrics.accounts,
        events_24h: result.metrics.events24h,
        failures_24h: result.metrics.failures24h,
      },
      anonymous: true,
    });
  }
  return NextResponse.json({ success: result.errors.length === 0, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request, false);
}

export async function POST(request: NextRequest) {
  let forceBrief = false;
  try {
    const body = (await request.json()) as { forceBrief?: boolean };
    forceBrief = body.forceBrief === true;
  } catch {
    // Empty body is fine — treat as a normal check.
  }
  return handle(request, forceBrief);
}
