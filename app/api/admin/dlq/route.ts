import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiSecret } from "@/lib/config";
import { getCurrentUser } from "@/lib/profile";
import { isVerifiedAdmin } from "@/lib/alerts/capacity";
import {
  deleteDeadLetter,
  listDeadLetters,
  replayDeadLetter,
} from "@/lib/dlq-ops";

function hasAdminToken(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  let secret: string;
  try {
    secret = getAdminApiSecret();
  } catch {
    return false;
  }
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorized(request: NextRequest): Promise<boolean> {
  if (hasAdminToken(request)) return true;
  try {
    const user = await getCurrentUser();
    return isVerifiedAdmin(user);
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
    const message = error instanceof Error ? error.message : "DLQ action failed";
    if (message === "Unknown DLQ message") {
      return NextResponse.json({ error: "Unknown DLQ message" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
