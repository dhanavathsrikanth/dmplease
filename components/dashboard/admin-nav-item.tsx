import { getDashboardShellData } from "@/lib/dashboard-shell-data";
import { AdminNavLink } from "./admin-nav-link";

/**
 * Streamed slot for the admin-only sidebar entry. Renders nothing for
 * non-admins, so the rest of the navigation never waits on the session read.
 */
export async function AdminNavItemSlot() {
  const data = await getDashboardShellData();
  if (!data?.isAdmin) {
    return null;
  }

  return <AdminNavLink />;
}
