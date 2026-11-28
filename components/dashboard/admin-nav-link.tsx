"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGauge } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * The admin-only nav entry. Split into a client component so it can share the
 * sidebar's active-link styling and the collapsed-sidebar label rule.
 */
export function AdminNavLink() {
  const pathname = usePathname();
  const isActive =
    pathname === "/dashboard/admin/alerts" ||
    pathname.startsWith("/dashboard/admin/alerts/");

  return (
    <Link
      href="/dashboard/admin/alerts"
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-full text-xs font-medium transition-all group relative",
        isActive
          ? "bg-[#1c1c1e] text-white font-semibold shadow-xs liquid-sheen dark:bg-white dark:text-[#1c1c1e]"
          : "text-[#555a6a] dark:text-muted-foreground hover:text-foreground hover:bg-[#f7f8fa] dark:hover:bg-muted/50"
      )}
    >
      <IconGauge
        stroke={1.8}
        className={cn(
          "size-4 shrink-0 transition-colors",
          isActive
            ? "text-[#ffd02f] dark:text-[#1c1c1e]"
            : "text-[#6b6f7e] dark:text-muted-foreground group-hover:text-foreground"
        )}
      />
      <span className="truncate group-data-[collapsed=true]/sidebar:hidden">
        Platform Capacity
      </span>
    </Link>
  );
}
