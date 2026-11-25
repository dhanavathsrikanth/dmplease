import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { getWorkspaceAnalytics } from "@/lib/analytics";

/** Creator-scoped analytics: daily rollups merged with today's Redis deltas. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creatorId = request.nextUrl.searchParams.get("creatorId")?.trim();
  if (!creatorId) {
    return NextResponse.json({ error: "creatorId is required" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  const ownedIds = (profile?.ownedWorkspaces ?? []).map((workspace) => workspace.id);
  if (!ownedIds.includes(creatorId)) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const rawDays = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : 30;

  const data = await getWorkspaceAnalytics(creatorId, days);
  return NextResponse.json({ creatorId, ...data });
}
