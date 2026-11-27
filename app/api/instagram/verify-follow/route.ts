import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { verifyFollowership } from "@/lib/meta/follow-gate";
import { describeFollowGateReason } from "@/lib/follow-gate-constants";

const schema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  accountId: z.string().uuid().optional(),
  userIgsid: z.string().trim().min(1, "A recipient IGSID is required."),
  expectedUsername: z.string().trim().max(150).optional(),
});

/**
 * POST /api/instagram/verify-follow
 *
 * Lets a creator test whether a specific person follows their account, using
 * Meta's User Profile API. Returns the verification status, method, reason
 * and a plain-English explanation — so creators can understand the gate
 * before enabling it on a campaign.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", input.workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
  }

  let accountQuery = supabase
    .from("instagram_accounts")
    .select("id, instagram_id, access_token, username")
    .eq("workspace_id", input.workspaceId);
  if (input.accountId) accountQuery = accountQuery.eq("id", input.accountId);
  const { data: accounts } = await accountQuery.limit(1);
  const account = accounts?.[0];
  if (!account?.access_token) {
    return NextResponse.json(
      { error: "No connected Instagram account" },
      { status: 400 }
    );
  }

  let token: string;
  try {
    token = decryptToken(account.access_token);
  } catch {
    token = account.access_token;
  }

  const verification = await verifyFollowership(
    token,
    account.instagram_id,
    input.userIgsid,
    input.expectedUsername ?? null
  );

  return NextResponse.json({
    status: verification.status,
    method: verification.method,
    reason: verification.reason ?? null,
    username: verification.username ?? null,
    explanation: describeFollowGateReason(verification.reason),
    checkedAt: verification.checkedAt,
    fromCache: verification.fromCache ?? false,
  });
}
