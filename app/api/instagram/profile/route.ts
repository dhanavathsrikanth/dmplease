import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Overrides the verified badge when Meta does not expose the Page signal. */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { isVerifiedManual?: unknown };
  try {
    body = (await request.json()) as { isVerifiedManual?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.isVerifiedManual !== "boolean") {
    return NextResponse.json(
      { error: "isVerifiedManual must be a boolean" },
      { status: 400 }
    );
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id);
  const workspaceIds = (workspaces ?? []).map((w) => String(w.id));
  if (workspaceIds.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { error } = await supabase
    .from("instagram_accounts")
    .update({
      is_verified_manual: body.isVerifiedManual,
      updated_at: new Date().toISOString(),
    })
    .in("workspace_id", workspaceIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
