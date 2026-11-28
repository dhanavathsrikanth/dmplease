"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconSelector } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workspaceCookie } from "@/lib/workspace-cookie";
import type { DashboardWorkspace } from "@/lib/dashboard-shell-data";

function getWorkspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface WorkspaceSwitcherProps {
  workspaces: DashboardWorkspace[];
  activeWorkspaceId: string | null;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  // The click sets the id optimistically; a later `router.refresh()` re-renders
  // the server slot with the persisted active id.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentId =
    selectedId || activeWorkspaceId || workspaces[0]?.id || "";
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentId) ||
    workspaces[0] ||
    null;

  const switchWorkspace = (workspaceId: string) => {
    setSelectedId(workspaceId);
    if (typeof document !== "undefined") {
      const secure =
        typeof window !== "undefined" && window.location.protocol === "https:";
      document.cookie = workspaceCookie(workspaceId, secure);
    }
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[#f7f8fa] dark:hover:bg-muted/60 transition-colors text-left outline-none group border border-transparent hover:border-[#e0e2e8]">
        <div className="flex items-center gap-2.5 truncate">
          <Avatar className="size-7 rounded-lg bg-[#fff8e0] text-[#746019] border border-[#ffd02f]/40 dark:bg-[#746019]/30 dark:text-[#ffd02f]">
            <AvatarFallback className="text-[10px] font-bold">
              {getWorkspaceInitials(currentWorkspace?.name || "My Workspace")}
            </AvatarFallback>
          </Avatar>
          <div className="truncate group-data-[collapsed=true]/sidebar:hidden">
            <p className="text-xs font-semibold text-foreground truncate">
              {currentWorkspace?.name || "Personal Workspace"}
            </p>
            <p className="text-[10px] text-[#6b6f7e] dark:text-[#9aa0ad] truncate capitalize font-medium">
              {currentWorkspace?.role?.toLowerCase() || "Owner"}
            </p>
          </div>
        </div>
        <IconSelector
          stroke={1.8}
          className="size-3.5 text-muted-foreground shrink-0 ml-1 group-hover:text-foreground group-data-[collapsed=true]/sidebar:hidden"
        />
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

        {workspaces.map((workspace) => {
          const isSelected = workspace.id === currentId;
          return (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => switchWorkspace(workspace.id)}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium"
            >
              <div className="flex items-center gap-2 truncate">
                <Avatar className="size-5 rounded-md">
                  <AvatarFallback className="text-[9px] font-bold">
                    {getWorkspaceInitials(workspace.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{workspace.name}</span>
              </div>
              {isSelected && (
                <IconCheck
                  stroke={2.5}
                  className={cn("size-3.5 text-[#00b473] shrink-0")}
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Matches the footer switcher footprint so the sidebar does not shift. */
export function WorkspaceSwitcherSkeleton() {
  return (
    <div className="w-full flex items-center justify-between p-2 rounded-xl border border-transparent overflow-hidden">
      <div className="flex items-center gap-2.5 truncate">
        <div className="size-7 rounded-lg bg-muted animate-pulse shrink-0" />
        <div className="space-y-1.5 group-data-[collapsed=true]/sidebar:hidden">
          <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          <div className="h-2.5 w-14 rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}
