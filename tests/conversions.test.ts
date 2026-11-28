import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { createWorkspaceToken, parseWorkspaceToken } from "@/lib/conversions";
import { getPurposeSecret } from "@/lib/config";

const workspaceId = "e0c181fd-bd1b-4a19-9aff-ecda8d600889";

/** Builds a token with an arbitrary payload, signed with the real key. */
function forge(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getPurposeSecret("conversions-token"))
    .update(body)
    .digest("hex");
  return `${body}.${signature}`;
}

describe("conversion workspace tokens", () => {
  it("round-trips a workspace id and version", () => {
    const token = createWorkspaceToken(workspaceId);
    expect(parseWorkspaceToken(token)).toEqual({
      workspaceId,
      version: 1,
    });
  });

  it("round-trips an explicit version", () => {
    const token = createWorkspaceToken(workspaceId, 7);
    expect(parseWorkspaceToken(token)).toEqual({
      workspaceId,
      version: 7,
    });
  });

  it("rejects tampered tokens", () => {
    const token = createWorkspaceToken(workspaceId);
    expect(parseWorkspaceToken(`${token.slice(0, -1)}0`)).toBeNull();
    expect(parseWorkspaceToken("not-a-token")).toBeNull();
  });

  it("rejects a signature with an extra hex character", () => {
    const token = createWorkspaceToken(workspaceId);
    // Buffer.from(hex) drops a trailing nibble, so without an exact-length
    // check this would still validate.
    expect(parseWorkspaceToken(`${token}0`)).toBeNull();
    expect(parseWorkspaceToken(`${token}a`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const now = Date.now();
    const expired = forge({
      w: workspaceId,
      v: 1,
      iat: now - 2_000,
      exp: now - 1_000,
    });
    expect(parseWorkspaceToken(expired)).toBeNull();
  });

  it("accepts legacy tokens without a version or expiry as version 0", () => {
    const legacy = forge({ w: workspaceId });
    expect(parseWorkspaceToken(legacy)).toEqual({
      workspaceId,
      version: 0,
    });
  });

  it("rejects a versioned token that has no expiry", () => {
    expect(parseWorkspaceToken(forge({ w: workspaceId, v: 1 }))).toBeNull();
  });
});
