import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { isVerifiedAdmin } from "@/lib/alerts/capacity";

export interface DashboardWorkspace {
  id: string;
  name: string;
  role: string;
}

export interface DashboardShellData {
  workspaces: DashboardWorkspace[];
  activeWorkspaceId: string | null;
  instagramUsername: string | null;
  isAdmin: boolean;
}

/**
 * Loads the small amount of session data the dashboard chrome needs.
 *
 * This is deliberately separate from `app/dashboard/layout.tsx`: awaiting it in
 * the layout made the whole route a dynamic hole, so every dashboard route's
 * App Shell was just the full-screen spinner. The layout now renders the
 * sidebar and top bar statically and each consumer reads this behind its own
 * Suspense boundary, where the data streams in without blocking navigation.
 *
 * Wrapped in React `cache` so the workspace switcher and the Instagram pill
 * share one set of queries per request.
 */
async function loadDashboardShellData(): Promise<DashboardShellData | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const profile = await getCurrentProfile();

  const workspaces: DashboardWorkspace[] =
    profile?.ownedWorkspaces && profile.ownedWorkspaces.length > 0
      ? profile.ownedWorkspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          role: "OWNER",
        }))
      : [
          {
            id: user.id,
            name: `${profile?.fullName || user.email?.split("@")[0] || "My"}'s Workspace`,
            role: "OWNER",
          },
        ];

  const cookieStore = await cookies();
  const activeCookieId = cookieStore.get("active_workspace_id")?.value;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeCookieId) ||
    workspaces[0] ||
    null;

  const supabase = await createClient();
  const allWorkspaceIds = workspaces.map((workspace) => workspace.id);

  // Check the active workspace and the fallback across all workspaces in one
  // batch — a serial second query adds latency to every full page load.
  const [activeAccountsRes, allAccountsRes] = await Promise.all([
    activeWorkspace
      ? supabase
          .from("instagram_accounts")
          .select("username")
          .eq("workspace_id", activeWorkspace.id)
          .limit(1)
      : null,
    allWorkspaceIds.length > 0
      ? supabase
          .from("instagram_accounts")
          .select("username")
          .in("workspace_id", allWorkspaceIds)
          .limit(1)
      : null,
  ]);

  const instagramUsername =
    activeAccountsRes?.data?.[0]?.username ??
    allAccountsRes?.data?.[0]?.username ??
    null;

  return {
    workspaces,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    instagramUsername,
    isAdmin: isVerifiedAdmin(user),
  };
}

export const getDashboardShellData = cache(loadDashboardShellData);
