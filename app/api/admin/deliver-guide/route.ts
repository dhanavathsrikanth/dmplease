import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { checkDeliveryGuards } from "@/lib/meta/delivery-guards";
import { toAutomationLike, sendOptinDm } from "@/lib/meta/webhook-processor";

/**
 * Recovery endpoint: delivers an already-confirmed opt-in guide when the
 * original postback could not be completed because of a deploy-time bug.
 *
 * Admin-secret protected and limited to a single automation/recipient pair.
 * It applies the same live-path guards as the webhook processor, so a manual
 * call cannot bypass opt-out, dedupe, cooldown or rate limits.
 */
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

  const db = getAdminDb();
  const { data: autoRow } = await db
    .from("automations")
    .select("*")
    .eq("id", body.automationId)
    .maybeSingle();
  if (!autoRow) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  // Guard 1: a paused campaign must never send, even through recovery.
  if ((autoRow as { active?: boolean | null }).active !== true) {
    return NextResponse.json({
      success: false,
      skipped: "Automation is paused",
    });
  }

  const { data: account } = await db
    .from("instagram_accounts")
    .select("id, instagram_id, workspace_id, access_token")
    .eq("workspace_id", autoRow.workspace_id)
    .limit(1)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // The recipient must be known to this workspace: either an existing contact
  // or someone who commented on one of its posts. This stops the endpoint from
  // being used to DM arbitrary Instagram ids.
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("workspace_id", autoRow.workspace_id)
    .eq("instagram_id", body.recipientId)
    .maybeSingle();
  const contactId = contact?.id ? String(contact.id) : null;
  if (!contactId) {
    const { data: commenter } = await db
      .from("comment_events")
      .select("id")
      .eq("workspace_id", autoRow.workspace_id)
      .eq("commenter_id", body.recipientId)
      .limit(1)
      .maybeSingle();
    if (!commenter) {
      return NextResponse.json(
        { success: false, error: "Unknown recipient" },
        { status: 400 }
      );
    }
  }

  let token: string;
  try {
    token = decryptToken(String(account.access_token));
  } catch {
    return NextResponse.json({ error: "Token unavailable" }, { status: 503 });
  }

  const auto = toAutomationLike(autoRow as Parameters<typeof toAutomationLike>[0]);

  // Prefer the automation's configured post; otherwise fall back to the most
  // recent comment media for this recipient. Empty string when neither exists,
  // so the cooldown key stays stable across calls.
  let mediaId = auto.postId ?? "";
  if (!mediaId) {
    const { data: latestComment } = await db
      .from("comment_events")
      .select("media_id")
      .eq("workspace_id", auto.workspaceId)
      .eq("commenter_id", body.recipientId)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    mediaId = latestComment?.media_id ? String(latestComment.media_id) : "";
  }

  const guard = await checkDeliveryGuards({
    workspaceId: auto.workspaceId,
    recipientId: body.recipientId,
    accountId: String(account.instagram_id),
    accountDbId: String(account.id),
    mediaId,
    token,
    auto,
    active: true,
    contactId,
    commentId: null,
    keyword: "OPTIN",
  });
  if (!guard.allowed) {
    return NextResponse.json({
      success: false,
      skipped: guard.skipped ?? "Delivery blocked by safety guards",
    });
  }

  const outcome = await sendOptinDm({
    token,
    accountId: String(account.instagram_id),
    accountDbId: String(account.id),
    workspaceId: auto.workspaceId,
    recipientId: body.recipientId,
    auto,
    contactId,
    postId: mediaId || null,
  });

  return NextResponse.json({
    success: outcome.sent,
    skipped: outcome.skipped,
    error: outcome.error ?? null,
  });
}
