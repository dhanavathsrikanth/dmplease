/** Builds the display-only active-workspace preference cookie. */
export function workspaceCookie(workspaceId: string, secure: boolean): string {
  return `active_workspace_id=${workspaceId}; path=/; max-age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
