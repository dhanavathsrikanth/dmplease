import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { toAutomationLike, sendOptinDm } from "@/lib/meta/webhook-processor";

/**
 * Recovery endpoint: delivers an already-confirmed opt-in guide when the
 * original postback could not be completed because of a deploy-time bug.
 * Cron-secret protected and limited to a single automation/recipient pair.
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

  let body: { automationId?: string; recipientId?: string };
  try {
    body = (await request.json()) as {
      automationId?: string;
      recipientId?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.automationId || !body.recipientId) {
    return NextResponse.json(
      { error: "automationId and recipientId are required" },
      { status: 400 }
    );
  }

  const { data: autoRow } = await getAdminDb()
    .from("automations")
    .select("*")
    .eq("id", body.automationId)
    .maybeSingle();
  if (!autoRow) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  const { data: account } = await getAdminDb()
    .from("instagram_accounts")
    .select("id, instagram_id, workspace_id, access_token")
    .eq("workspace_id", autoRow.workspace_id)
    .limit(1)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  let token: string;
  try {
    token = decryptToken(String(account.access_token));
  } catch {
    return NextResponse.json({ error: "Token unavailable" }, { status: 503 });
  }

  const auto = toAutomationLike(autoRow as Parameters<typeof toAutomationLike>[0]);
  const outcome = await sendOptinDm({
    token,
    accountId: String(account.instagram_id),
    accountDbId: String(account.id),
    workspaceId: auto.workspaceId,
    recipientId: body.recipientId,
    auto,
    contactId: null,
  });

  return NextResponse.json({
    success: outcome.sent,
    error: outcome.error ?? null,
  });
}
