"use client";

import React from "react";
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
  IconSelector,
  IconCheck,
  IconAddressBook,
  IconGauge,
  IconSparkles,
  IconShieldCheck,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppSidebarProps {
  isAdmin?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function getNavSections(isAdmin: boolean) {
  return [
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
      ...(isAdmin
        ? [{ label: "Platform Capacity", href: "/dashboard/admin/alerts", icon: IconGauge }]
        : []),
    ],
  },
  ];
}

function getWorkspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AppSidebar({
  isAdmin = false,
  collapsed,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace();

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-card text-card-foreground border-r border-border/80 select-none antialiased">
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
        {getNavSections(isAdmin).map((section) => (
          <div key={section.label} className="space-y-1">
            {!collapsed && (
              <p className="px-2.5 text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
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
            </div>
          </div>
        ))}
      </div>

      {/* ── Workspace Switcher Footer (Miro Style) ── */}
      <div className="p-3 border-t border-[#e0e2e8] dark:border-border/80">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#f7f8fa] dark:hover:bg-muted/60 transition-colors text-left outline-none group border border-transparent hover:border-[#e0e2e8]">
            <div className="flex items-center gap-2.5 truncate">
              <Avatar className="size-7 rounded-lg bg-[#fff8e0] text-[#746019] border border-[#ffd02f]/40 dark:bg-[#746019]/30 dark:text-[#ffd02f]">
                <AvatarFallback className="text-[10px] font-bold">
                  {getWorkspaceInitials(currentWorkspace?.name || "My Workspace")}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="truncate">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {currentWorkspace?.name || "Personal Workspace"}
                  </p>
                  <p className="text-[10px] text-[#6b6f7e] dark:text-[#9aa0ad] truncate capitalize font-medium">
                    {currentWorkspace?.role?.toLowerCase() || "Owner"}
                  </p>
                </div>
              )}
            </div>
            {!collapsed && (
              <IconSelector stroke={1.8} className="size-3.5 text-muted-foreground shrink-0 ml-1 group-hover:text-foreground" />
            )}
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            side="top"
            className="w-56 rounded-2xl border border-[#e0e2e8] dark:border-border shadow-modal p-1.5 bg-card"
          >
            <DropdownMenuLabel className="text-[10px] font-semibold text-[#6b6f7e] px-2 py-1 uppercase tracking-wider">
              Workspaces ({workspaces.length})
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1" />

            {workspaces.map((ws) => {
              const isSelected = ws.id === currentWorkspace?.id;
              return (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Avatar className="size-5 rounded-md">
                      <AvatarFallback className="text-[9px] font-bold">
                        {getWorkspaceInitials(ws.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{ws.name}</span>
                  </div>
                  {isSelected && <IconCheck stroke={2.5} className="size-3.5 text-[#00b473] shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
