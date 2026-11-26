import { describe, expect, it } from "vitest";
import { createWorkspaceToken, parseWorkspaceToken } from "@/lib/conversions";

describe("conversion workspace tokens", () => {
  const workspaceId = "e0c181fd-bd1b-4a19-9aff-ecda8d600889";

  it("round-trips a workspace id", () => {
    const token = createWorkspaceToken(workspaceId);
    expect(parseWorkspaceToken(token)).toBe(workspaceId);
  });

  it("rejects tampered tokens", () => {
    const token = createWorkspaceToken(workspaceId);
    expect(parseWorkspaceToken(`${token.slice(0, -1)}0`)).toBeNull();
    expect(parseWorkspaceToken("not-a-token")).toBeNull();
  });
});
