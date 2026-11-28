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
  IconLayoutSidebar,
  IconArrowUpRight,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapse?: () => void;
  /** Streamed slot: workspace switcher in the sidebar header. */
  workspaceSwitcher: React.ReactNode;
  /** Streamed slot: admin-only nav entry. */
  adminNavItem?: React.ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ stroke?: number; className?: string }>;
  badge?: string;
}

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      { label: "Home", href: "/dashboard", icon: IconLayoutDashboard },
      { label: "Analytics", href: "/dashboard/overview", icon: IconDeviceAnalytics },
      { label: "Safety", href: "/dashboard/safety", icon: IconShieldCheck },
      { label: "Inbox", href: "/dashboard/inbox", icon: IconMessages },
      { label: "Contacts", href: "/dashboard/contacts", icon: IconAddressBook },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Automations", href: "/dashboard/campaigns", icon: IconSpeakerphone },
      { label: "Auto-replies", href: "/dashboard/inbox-automations", icon: IconRobot },
      {
        label: "Story to DM",
        href: "/dashboard/story-automations",
        icon: IconSparkles,
        badge: "NEW",
      },
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
      {NAV_SECTIONS.map((section, sectionIndex) => (
        <div key={section.label} className="space-y-1">
          {sectionIndex > 0 && (
            <div className="mx-1 my-3 h-px bg-border" aria-hidden="true" />
          )}
          {!collapsed && (
            <p className="px-3.5 pb-1 text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
          )}
          <div className="space-y-1">
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
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative flex h-10 w-full items-center gap-2.5 rounded-xl px-3.5 text-sm font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "bg-[linear-gradient(272.1deg,rgba(255,255,255,0.85)_-1.82%,rgba(255,255,255,0.45)_107.89%)] text-brand-soft-foreground shadow-xs dark:bg-white/10 dark:text-brand"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon
                    stroke={1.8}
                    className={cn(
                      "size-[18px] shrink-0 transition-colors",
                      isActive
                        ? "text-brand-soft-foreground dark:text-brand"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.badge && (
                    <span className="ml-auto rounded-md bg-brand px-1.5 py-0.5 text-[9px] font-extrabold tracking-widest text-brand-foreground">
                      {item.badge}
                    </span>
                  )}
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
  onToggleCollapse,
  workspaceSwitcher,
  adminNavItem,
}: AppSidebarProps) {
  const sidebarContent = (
    <div
      data-collapsed={collapsed}
      className="group/sidebar flex h-full flex-col justify-between bg-card text-card-foreground border-r border-border/80 select-none antialiased overflow-x-hidden"
    >
      {/* ── Workspace header (Zorcha-style) ── */}
      <div className="flex h-14 items-center gap-1.5 border-b border-border px-3">
        <div className="min-w-0 flex-1">{workspaceSwitcher}</div>
        {!collapsed && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Hide sidebar"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconLayoutSidebar
              className="size-[18px]"
              stroke={1.8}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* ── Navigation sections ── */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
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

      {/* ── Upgrade CTA (Zorcha-style) ── */}
      <div className="border-t border-border p-3">
        <Link
          href="/dashboard/settings"
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-[13px] border border-border bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-[background-color,box-shadow,transform] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <IconArrowUpRight
            className="size-4 shrink-0"
            stroke={2}
            aria-hidden="true"
          />
          {!collapsed && <span className="truncate">Upgrade Plan</span>}
        </Link>
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
