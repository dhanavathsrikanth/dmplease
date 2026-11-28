import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { WorkspaceItem } from "@/lib/workspace-context";
import { isVerifiedAdmin } from "@/lib/alerts/capacity";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="size-8 rounded-lg bg-neutral-900 dark:bg-white animate-pulse" />
        </div>
      }
    >
      <AuthenticatedDashboardShell>{children}</AuthenticatedDashboardShell>
    </Suspense>
  );
}

async function AuthenticatedDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login?next=/dashboard");
  }

  const profile = await getCurrentProfile();

  const workspaces: WorkspaceItem[] =
    profile?.ownedWorkspaces && profile.ownedWorkspaces.length > 0
      ? profile.ownedWorkspaces.map((w) => ({
          id: w.id,
          name: w.name,
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
    workspaces.find((w) => w.id === activeCookieId) || workspaces[0];

  const supabase = await createClient();
  const allWorkspaceIds = workspaces.map((w) => w.id);

  // Check the active workspace and the fallback across all workspaces in one
  // batch — a serial second query added latency to every full page load.
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
  const instagramAccountCount = instagramUsername ? 1 : 0;

  return (
    <DashboardShell
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace?.id}
      instagramUsername={instagramUsername}
      instagramAccountCount={instagramAccountCount}
      userEmail={user.email}
      isAdmin={isVerifiedAdmin(user)}
    >
      {children}
    </DashboardShell>
  );
}
