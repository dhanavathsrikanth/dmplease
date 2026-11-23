"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface WorkspaceItem {
  id: string;
  name: string;
  role: string;
}

interface WorkspaceContextType {
  currentWorkspace: WorkspaceItem | null;
  workspaces: WorkspaceItem[];
  switchWorkspace: (workspaceId: string) => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({
  children,
  initialWorkspaces,
  activeWorkspaceId,
  instagramUsername,
  instagramAccountCount,
}: {
  children: React.ReactNode;
  initialWorkspaces: WorkspaceItem[];
  activeWorkspaceId?: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}) {
  const [workspaces] = useState<WorkspaceItem[]>(initialWorkspaces);
  const [currentId, setCurrentId] = useState<string>(
    activeWorkspaceId || initialWorkspaces[0]?.id || ""
  );

  const currentWorkspace =
    workspaces.find((w) => w.id === currentId) || workspaces[0] || null;

  const switchWorkspace = (workspaceId: string) => {
    setCurrentId(workspaceId);
    // Store in cookie / localStorage for persistence
    if (typeof document !== "undefined") {
      document.cookie = `active_workspace_id=${workspaceId}; path=/; max-age=31536000`;
    }
  };

  return (
    <WorkspaceContext.Provider
      value={{
        currentWorkspace,
        workspaces,
        switchWorkspace,
        instagramUsername,
        instagramAccountCount,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
