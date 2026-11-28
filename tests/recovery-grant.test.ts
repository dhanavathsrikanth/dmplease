import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_GRANT_TTL_SECONDS,
  createRecoveryGrant,
  recoveryGrantMatches,
  verifyRecoveryGrant,
} from "@/lib/auth/recovery-grant";

const USER_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recovery grant", () => {
  it("round-trips a grant for the same user", () => {
    const token = createRecoveryGrant(USER_ID);
    const grant = verifyRecoveryGrant(token);

    expect(grant?.sub).toBe(USER_ID);
    expect(grant?.exp).toBeGreaterThan(Date.now());
    expect(recoveryGrantMatches(grant, USER_ID)).toBe(true);
  });

  it("does not match a different user", () => {
    const grant = verifyRecoveryGrant(createRecoveryGrant(USER_ID));

    expect(recoveryGrantMatches(grant, "another-user")).toBe(false);
    expect(recoveryGrantMatches(grant, null)).toBe(false);
    expect(recoveryGrantMatches(null, USER_ID)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createRecoveryGrant(USER_ID);
    const [body, signature] = token.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: "attacker", exp: Date.now() + 60_000 })
    ).toString("base64url");

    expect(verifyRecoveryGrant(`${forgedBody}.${signature}`)).toBeNull();
    expect(verifyRecoveryGrant(`${body}.${signature}x`)).toBeNull();
  });

  it("rejects an expired grant", () => {
    const issuedAt = Date.now() - (RECOVERY_GRANT_TTL_SECONDS + 1) * 1000;
    const token = createRecoveryGrant(USER_ID, issuedAt);

    expect(verifyRecoveryGrant(token)).toBeNull();
  });

  it("rejects malformed and empty values", () => {
    expect(verifyRecoveryGrant(null)).toBeNull();
    expect(verifyRecoveryGrant(undefined)).toBeNull();
    expect(verifyRecoveryGrant("")).toBeNull();
    expect(verifyRecoveryGrant("no-separator")).toBeNull();
    expect(verifyRecoveryGrant(".signature")).toBeNull();
    expect(verifyRecoveryGrant("body.")).toBeNull();
    expect(verifyRecoveryGrant("not-json.signature")).toBeNull();
  });

  it("rejects a grant signed with a different secret", () => {
    vi.stubEnv("RECOVERY_GRANT_SECRET", "a".repeat(64));
    const token = createRecoveryGrant(USER_ID);

    vi.stubEnv("RECOVERY_GRANT_SECRET", "b".repeat(64));
    expect(verifyRecoveryGrant(token)).toBeNull();
  });

  it("fails closed outside development when no signing key exists", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RECOVERY_GRANT_SECRET", "");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    expect(() => createRecoveryGrant(USER_ID)).toThrow(/must be configured/i);
    expect(verifyRecoveryGrant("body.signature")).toBeNull();
  });
});
