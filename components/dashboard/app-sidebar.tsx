"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconDeviceAnalytics,
  IconMessages,
  IconSpeakerphone,
  IconRobot,
  IconTimeline,
  IconAdjustmentsHorizontal,
  IconActivityHeartbeat,
  IconAddressBook,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Streamed slot: workspace switcher in the sidebar footer. */
  workspaceSwitcher: React.ReactNode;
  /** Streamed slot: admin-only nav entry. */
  adminNavItem?: React.ReactNode;
}

const NAV_SECTIONS = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: IconLayoutDashboard },
      { label: "Analytics", href: "/dashboard/overview", icon: IconDeviceAnalytics },
      { label: "Safety", href: "/dashboard/safety", icon: IconShieldCheck },
      { label: "Inbox", href: "/dashboard/inbox", icon: IconMessages },
      { label: "Contacts", href: "/dashboard/contacts", icon: IconAddressBook },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Campaigns", href: "/dashboard/campaigns", icon: IconSpeakerphone },
      { label: "Auto-replies", href: "/dashboard/inbox-automations", icon: IconRobot },
      { label: "Story to DM", href: "/dashboard/story-automations", icon: IconSparkles },
      { label: "Activity Log", href: "/dashboard/logs", icon: IconTimeline },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Settings", href: "/dashboard/settings", icon: IconAdjustmentsHorizontal },
      { label: "System Health", href: "/dashboard/diagnostics", icon: IconActivityHeartbeat },
    ],
  },
];

interface NavSectionsProps {
  collapsed: boolean;
  /**
   * `null` renders the static shell version (no active link). The active
   * version is rendered by `ActiveNavSections` once the pathname is available.
   */
  activeHref: string | null;
  onCloseMobile: () => void;
  adminNavItem?: React.ReactNode;
}

function NavSections({
  collapsed,
  activeHref,
  onCloseMobile,
  adminNavItem,
}: NavSectionsProps) {
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="space-y-1">
          {!collapsed && (
            <p className="px-2.5 text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isActive =
                activeHref !== null &&
                (activeHref === item.href ||
                  (item.href !== "/dashboard" && activeHref.startsWith(item.href)));
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onCloseMobile}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-full text-xs font-medium transition-all group relative",
                    isActive
                      ? "bg-[#1c1c1e] text-white font-semibold shadow-xs liquid-sheen dark:bg-white dark:text-[#1c1c1e]"
                      : "text-[#555a6a] dark:text-muted-foreground hover:text-foreground hover:bg-[#f7f8fa] dark:hover:bg-muted/50"
                  )}
                >
                  <Icon
                    stroke={1.8}
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      isActive
                        ? "text-[#ffd02f] dark:text-[#1c1c1e]"
                        : "text-[#6b6f7e] dark:text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
            {section.label === "Platform" && adminNavItem}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * `usePathname` is URL data: on a route with a dynamic param it cannot resolve
 * during prerendering, so it must sit behind its own Suspense boundary. The
 * fallback is the same navigation without an active highlight, which keeps all
 * sidebar links in the static shell.
 */
function ActiveNavSections(props: Omit<NavSectionsProps, "activeHref">) {
  const pathname = usePathname();
  return <NavSections {...props} activeHref={pathname} />;
}

export function AppSidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  workspaceSwitcher,
  adminNavItem,
}: AppSidebarProps) {
  const sidebarContent = (
    <div
      data-collapsed={collapsed}
      className="group/sidebar flex h-full flex-col justify-between bg-card text-card-foreground border-r border-border/80 select-none antialiased overflow-x-hidden"
    >
      {/* ── Miro Chrome Brand Header ── */}
      <div className="h-14 flex items-center px-4 border-b border-[#e0e2e8] dark:border-border/80">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 group overflow-hidden w-full"
        >
          <div className="size-8 rounded-lg bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
            dm
          </div>
          {!collapsed && (
            <div className="flex items-center gap-2 truncate">
              <span className="font-semibold text-sm tracking-tight text-foreground truncate flex items-center">
                dmplease
                <span className="inline-block size-1.5 rounded-full bg-[#ffd02f] ml-1.5" />
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#fff8e0] text-[#746019] font-semibold border border-[#ffd02f]/40 dark:bg-[#746019]/30 dark:text-[#ffd02f]">
                CANVAS
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* ── Navigation Sections ── */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        <Suspense
          fallback={
            <NavSections
              collapsed={collapsed}
              activeHref={null}
              onCloseMobile={onCloseMobile}
              adminNavItem={adminNavItem}
            />
          }
        >
          <ActiveNavSections
            collapsed={collapsed}
            onCloseMobile={onCloseMobile}
            adminNavItem={adminNavItem}
          />
        </Suspense>
      </div>

      {/* ── Workspace Switcher Footer (Miro Style) ── */}
      <div className="p-3 border-t border-[#e0e2e8] dark:border-border/80">
        {workspaceSwitcher}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={cn(
          "hidden md:block shrink-0 sticky top-0 h-dvh transition-[width] duration-200 z-30",
          collapsed ? "w-14" : "w-60"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-background/80 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 w-60 z-50 md:hidden transition-transform duration-300 shadow-2xl",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}
