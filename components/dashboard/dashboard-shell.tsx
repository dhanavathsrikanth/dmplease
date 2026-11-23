"use client";

import React, { useState } from "react";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { WorkspaceProvider, WorkspaceItem } from "@/lib/workspace-context";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaces: WorkspaceItem[];
  activeWorkspaceId?: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
  userEmail?: string | null;
}

export function DashboardShell({
  children,
  workspaces,
  activeWorkspaceId,
  instagramUsername,
  instagramAccountCount,
  userEmail,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <WorkspaceProvider
      initialWorkspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      instagramUsername={instagramUsername}
      instagramAccountCount={instagramAccountCount}
    >
      <div className="min-h-screen bg-background flex flex-col md:flex-row w-full">
        {/* Sidebar */}
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        {/* Content Column */}
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            onToggleCollapse={() => setCollapsed(!collapsed)}
            onOpenMobile={() => setMobileOpen(true)}
            userEmail={userEmail}
          />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
