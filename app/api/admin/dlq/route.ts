import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { getCurrentUser } from "@/lib/profile";
import { isAdminEmail } from "@/lib/alerts/capacity";
import {
  deleteDeadLetter,
  listDeadLetters,
  replayDeadLetter,
} from "@/lib/dlq-ops";

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

async function authorized(request: NextRequest): Promise<boolean> {
  if (hasCronToken(request)) return true;
  try {
    const user = await getCurrentUser();
    return isAdminEmail(user?.email);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const messages = await listDeadLetters(20);
  return NextResponse.json({ success: true, messages });
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; dlqId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.dlqId || !["replay", "delete"].includes(body.action ?? "")) {
    return NextResponse.json(
      { error: "Provide action ('replay' | 'delete') and dlqId" },
      { status: 400 }
    );
  }

  try {
    if (body.action === "replay") await replayDeadLetter(body.dlqId);
    else await deleteDeadLetter(body.dlqId);
    return NextResponse.json({ success: true, action: body.action, dlqId: body.dlqId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DLQ action failed" },
      { status: 500 }
    );
  }
}
