import { redirect } from "next/navigation";
import { getDashboardShellData } from "@/lib/dashboard-shell-data";
import { WorkspaceSwitcher } from "./workspace-switcher-client";

/**
 * Streamed slot for the sidebar footer.
 *
 * Reading the session here (instead of in `app/dashboard/layout.tsx`) keeps the
 * sidebar itself in the static shell, so it paints on the first frame of a
 * client navigation while this data streams in.
 */
export async function WorkspaceSwitcherSlot() {
  const data = await getDashboardShellData();
  if (!data) {
    redirect("/auth/login?next=/dashboard");
  }

  return (
    <WorkspaceSwitcher
      workspaces={data.workspaces}
      activeWorkspaceId={data.activeWorkspaceId}
    />
  );
}
