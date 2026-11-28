import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { WorkspaceSwitcherSlot } from "@/components/dashboard/workspace-switcher";
import { WorkspaceSwitcherSkeleton } from "@/components/dashboard/workspace-switcher-client";
import { InstagramPillSlot, InstagramPillSkeleton } from "@/components/dashboard/instagram-pill";
import { AdminNavItemSlot } from "@/components/dashboard/admin-nav-item";

/**
 * Dashboard chrome is rendered synchronously so it lands in the static App
 * Shell for every dashboard route.
 *
 * Session data (auth, profile, workspace list, Instagram account) used to be
 * awaited at this level. That made the entire route one dynamic hole: the
 * prebuilt shell was only the full-screen spinner, so every sidebar click
 * painted a blank page and then waited on several serial Supabase/Prisma calls.
 * Each consumer now reads its data behind its own Suspense boundary, so the
 * sidebar and top bar paint immediately and only the small data slots stream.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell
      workspaceSwitcher={
        <Suspense fallback={<WorkspaceSwitcherSkeleton />}>
          <WorkspaceSwitcherSlot />
        </Suspense>
      }
      instagramPill={
        <Suspense fallback={<InstagramPillSkeleton />}>
          <InstagramPillSlot />
        </Suspense>
      }
      adminNavItem={
        <Suspense fallback={null}>
          <AdminNavItemSlot />
        </Suspense>
      }
    >
      {children}
    </DashboardShell>
  );
}
