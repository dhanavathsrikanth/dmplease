"use client";

import React, { createContext, useContext } from "react";

interface DashboardSidebarContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
}

const DashboardSidebarContext =
  createContext<DashboardSidebarContextValue | null>(null);

export function DashboardSidebarProvider({
  value,
  children,
}: {
  value: DashboardSidebarContextValue;
  children: React.ReactNode;
}) {
  return (
    <DashboardSidebarContext.Provider value={value}>
      {children}
    </DashboardSidebarContext.Provider>
  );
}

/**
 * Lets a full-screen editor collapse the dashboard sidebar while it is open,
 * then restore the creator's previous preference when they leave.
 */
export function useDashboardSidebar() {
  return useContext(DashboardSidebarContext);
}
