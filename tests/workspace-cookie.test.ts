import { describe, expect, it } from "vitest";
import { workspaceCookie } from "@/lib/workspace-cookie";

describe("workspaceCookie", () => {
  it("marks the cookie Secure over https", () => {
    expect(workspaceCookie("ws-1", true)).toContain("Secure");
  });

  it("omits Secure over plain http", () => {
    expect(workspaceCookie("ws-1", false)).not.toContain("Secure");
  });

  it("keeps the shared attributes in both modes", () => {
    for (const secure of [true, false]) {
      const cookie = workspaceCookie("ws-1", secure);
      expect(cookie).toContain("path=/");
      expect(cookie).toContain("max-age=31536000");
      expect(cookie).toContain("SameSite=Lax");
    }
  });

  it("embeds the workspace id", () => {
    expect(workspaceCookie("ws-1", true)).toContain("active_workspace_id=ws-1");
    expect(workspaceCookie("ws-2", false)).toContain("active_workspace_id=ws-2");
  });
});
