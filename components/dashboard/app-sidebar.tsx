"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  BarChart3,
  MessageSquare,
  Megaphone,
  Bot,
  History,
  Settings,
  Activity,
  ChevronsUpDown,
  Check,
} from "lucide-react";
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
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const navSections = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
      { label: "Overview", href: "/dashboard/overview", icon: BarChart3 },
      { label: "Inbox", href: "/dashboard/inbox", icon: MessageSquare },
    ],
  },
  {
    label: "Automation",
    items: [
      { label: "Campaigns", href: "/dashboard/campaigns", icon: Megaphone },
      { label: "Inbox Automations", href: "/dashboard/inbox-automations", icon: Bot },
      { label: "DM Logs", href: "/dashboard/logs", icon: History },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
      { label: "Diagnostics", href: "/dashboard/diagnostics", icon: Activity },
    ],
  },
];

function getWorkspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AppSidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace();

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-card text-card-foreground border-r border-border/80 select-none">
      {/* ── Brand Header ── */}
      <div className="h-14 flex items-center px-4 border-b border-border/80">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 group overflow-hidden w-full"
        >
          <div className="size-8 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center font-bold text-xs shrink-0 shadow-sm group-hover:scale-105 transition-transform">
            dm
          </div>
          {!collapsed && (
            <div className="flex items-center gap-1.5 truncate">
              <span className="font-bold text-base tracking-tight text-foreground truncate">
                dmplease
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-lime-500/10 text-lime-700 dark:text-lime-400 font-semibold border border-lime-500/20">
                PRO
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* ── Navigation Sections ── */}
      <div className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
        {navSections.map((section) => (
          <div key={section.label} className="space-y-1">
            {!collapsed && (
              <p className="px-3 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-2">
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
                      "flex items-center gap-3 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all group",
                      isActive
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-950 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-transform group-hover:scale-110",
                        isActive
                          ? "text-white dark:text-neutral-950"
                          : "text-muted-foreground group-hover:text-foreground"
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

      {/* ── Workspace Switcher Footer ── */}
      <div className="p-3 border-t border-border/80">
        <DropdownMenu>
          <DropdownMenuTrigger className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-muted/70 transition-colors text-left outline-none group">
            <div className="flex items-center gap-2.5 truncate">
              <Avatar className="size-8 rounded-lg bg-neutral-900/10 dark:bg-neutral-100/10 text-foreground">
                <AvatarFallback className="text-xs font-bold">
                  {getWorkspaceInitials(currentWorkspace?.name || "My Workspace")}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="truncate">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {currentWorkspace?.name || "Personal Workspace"}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate capitalize">
                    {currentWorkspace?.role?.toLowerCase() || "Owner"}
                  </p>
                </div>
              )}
            </div>
            {!collapsed && (
              <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0 ml-1 group-hover:text-foreground" />
            )}
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            side="top"
            className="w-56 rounded-xl border border-border shadow-lg p-1.5"
          >
            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-semibold px-2 py-1">
              Workspaces ({workspaces.length})
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1" />

            {workspaces.map((ws) => {
              const isSelected = ws.id === currentWorkspace?.id;
              return (
                <DropdownMenuItem
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer text-xs font-medium"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Avatar className="size-6 rounded-md">
                      <AvatarFallback className="text-[10px] font-bold">
                        {getWorkspaceInitials(ws.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{ws.name}</span>
                  </div>
                  {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
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
          collapsed ? "w-16" : "w-64"
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
          "fixed inset-y-0 left-0 w-64 z-50 md:hidden transition-transform duration-300 shadow-2xl",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}
