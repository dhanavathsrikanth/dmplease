import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
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

  const supabase = await createClient();
  const workspaceIds = workspaces.map((w) => w.id);
  let connectedUsername: string | null = null;

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("username")
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      connectedUsername = accounts[0].username;
    }
  }

  const instagramUsername = connectedUsername;
  const instagramAccountCount = instagramUsername ? 1 : 0;

  return (
    <DashboardShell
      workspaces={workspaces}
      activeWorkspaceId={workspaces[0]?.id}
      instagramUsername={instagramUsername}
      instagramAccountCount={instagramAccountCount}
      userEmail={user.email}
    >
      {children}
    </DashboardShell>
  );
}
