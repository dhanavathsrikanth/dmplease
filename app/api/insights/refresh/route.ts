import { NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { refreshInsightsForWorkspaces } from "@/lib/meta/insights-sync";

/** Dashboard button: refresh Insights for the signed-in creator's accounts. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getCurrentProfile();
  const workspaceIds = (profile?.ownedWorkspaces ?? []).map((workspace) => workspace.id);
  const summary = await refreshInsightsForWorkspaces(workspaceIds);

  return NextResponse.json({
    success: summary.errors.length === 0,
    synced: summary.points,
    accounts: summary.accounts,
    errors: summary.errors,
  });
}
