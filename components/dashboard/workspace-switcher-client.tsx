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
      <DropdownMenuTrigger className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-6 shrink-0 rounded-md border border-brand/40 bg-brand text-brand-foreground">
          <AvatarFallback className="text-[10px] font-bold">
            {getWorkspaceInitials(currentWorkspace?.name || "My Workspace")}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sm font-semibold text-foreground group-data-[collapsed=true]/sidebar:hidden">
          {currentWorkspace?.name || "Personal Workspace"}
        </span>
        <IconSelector
          stroke={1.8}
          className="ml-auto size-3 shrink-0 text-muted-foreground group-hover:text-foreground group-data-[collapsed=true]/sidebar:hidden"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="bottom"
        className="w-56 rounded-2xl border border-border bg-card p-1.5 shadow-modal"
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

/** Matches the header switcher footprint so the sidebar does not shift. */
export function WorkspaceSwitcherSkeleton() {
  return (
    <div className="flex w-full items-center gap-2 overflow-hidden rounded-lg px-1.5 py-1">
      <div className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
      <div className="h-3 w-24 animate-pulse rounded bg-muted group-data-[collapsed=true]/sidebar:hidden" />
    </div>
  );
}
