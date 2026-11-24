import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { WorkspaceItem } from "@/lib/workspace-context";

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
  let connectedUsername: string | null = null;

  // First check Instagram account specifically for the active workspace
  if (activeWorkspace) {
    const { data: activeAccounts } = await supabase
      .from("instagram_accounts")
      .select("username")
      .eq("workspace_id", activeWorkspace.id)
      .limit(1);

    if (activeAccounts && activeAccounts.length > 0) {
      connectedUsername = activeAccounts[0].username;
    }
  }

  // Fallback across any user workspace if not found
  if (!connectedUsername) {
    const allIds = workspaces.map((w) => w.id);
    if (allIds.length > 0) {
      const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select("username")
        .in("workspace_id", allIds)
        .limit(1);

      if (accounts && accounts.length > 0) {
        connectedUsername = accounts[0].username;
      }
    }
  }

  const instagramUsername = connectedUsername;
  const instagramAccountCount = instagramUsername ? 1 : 0;

  return (
    <DashboardShell
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspace?.id}
      instagramUsername={instagramUsername}
      instagramAccountCount={instagramAccountCount}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
