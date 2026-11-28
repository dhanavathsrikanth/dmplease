import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanEnv, getQstash } from "@/lib/upstash";
import { getAdminApiSecret, getCronSecret } from "@/lib/config";

/**
 * The schedule itself is a cron job, so the QStash destination keeps the cron
 * secret. Creating or replacing the schedule is a privileged admin action and
 * therefore requires the separate admin secret.
 */
function isAdminAuthorized(header: string): boolean {
  try {
    const expected = `Bearer ${getAdminApiSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Idempotently schedules the hourly follow-up sender. */
export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin =
    cleanEnv("APP_URL") || cleanEnv("NEXT_PUBLIC_SITE_URL") || null;
  if (!origin) {
    return NextResponse.json({ error: "APP_URL is not configured" }, { status: 503 });
  }

  try {
    const schedule = await getQstash().schedules.create({
      scheduleId: "followups-hourly",
      destination: `${origin.replace(/\/$/, "")}/api/cron/followups`,
      cron: "0 * * * *",
      retries: 3,
      headers: {
        Authorization: `Bearer ${getCronSecret()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "qstash_schedule", job: "followups" }),
    });
    return NextResponse.json({ success: true, scheduleId: schedule.scheduleId ?? "followups-hourly" });
  } catch (error) {
    console.error("[followup-schedule] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create schedule" },
      { status: 500 }
    );
  }
}
