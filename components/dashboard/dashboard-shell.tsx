"use client";

import React, { useState } from "react";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { TopBar } from "@/components/dashboard/top-bar";
import { DashboardSidebarProvider } from "@/components/dashboard/sidebar-context";

interface DashboardShellProps {
  children: React.ReactNode;
  /** Streamed slot: workspace list + active workspace. */
  workspaceSwitcher: React.ReactNode;
  /** Streamed slot: Instagram connection status. */
  instagramPill: React.ReactNode;
  /** Streamed slot: admin-only navigation entry. */
  adminNavItem?: React.ReactNode;
}

export function DashboardShell({
  children,
  workspaceSwitcher,
  instagramPill,
  adminNavItem,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div
      className="min-h-screen bg-background flex flex-col md:flex-row w-full"
      style={
        {
          "--sidebar-width": collapsed ? "3.5rem" : "15rem",
        } as React.CSSProperties
      }
    >
      {/* Sidebar */}
      <AppSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed(true)}
        workspaceSwitcher={workspaceSwitcher}
        adminNavItem={adminNavItem}
      />

      {/* Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onToggleCollapse={() => setCollapsed(!collapsed)}
          onOpenMobile={() => setMobileOpen(true)}
          instagramPill={instagramPill}
        />

        <main className="flex-1 p-4 pb-0 sm:p-6 sm:pb-0 lg:p-8 lg:pb-0 max-w-7xl w-full mx-auto">
          <DashboardSidebarProvider value={{ collapsed, setCollapsed }}>
            {children}
          </DashboardSidebarProvider>
        </main>
      </div>
    </div>
  );
}
