import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthStateSecret, getOAuthStateSecrets } from "@/lib/config";

/**
 * The dev-only constant is intentionally not exported from lib/config.ts, so
 * the tests pin its literal value. If it ever changes, these assertions fail
 * loudly rather than silently accepting a public secret in production.
 */
const DEV_ONLY_SECRET = "dmplease-local-development-only-change-me";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOAuthStateSecrets", () => {
  it("returns only the configured secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "prod-state-secret");
    vi.stubEnv("OAUTH_STATE_SECRET_PREVIOUS", "prod-state-secret-old");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    const secrets = getOAuthStateSecrets();

    expect(secrets).toEqual(["prod-state-secret", "prod-state-secret-old"]);
    expect(secrets).not.toContain(DEV_ONLY_SECRET);
  });

  it("returns only the current secret when no previous secret is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "prod-state-secret");
    vi.stubEnv("OAUTH_STATE_SECRET_PREVIOUS", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    expect(getOAuthStateSecrets()).toEqual(["prod-state-secret"]);
  });

  it("falls back to the dev-only secret in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("OAUTH_STATE_SECRET_PREVIOUS", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    const secrets = getOAuthStateSecrets();

    expect(secrets).toEqual([DEV_ONLY_SECRET]);
  });

  it("throws in production when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("OAUTH_STATE_SECRET_PREVIOUS", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    expect(() => getOAuthStateSecrets()).toThrow(/OAUTH_STATE_SECRET/);
  });
});

describe("getOAuthStateSecret", () => {
  it("requires a dedicated OAUTH_STATE_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "v".repeat(64));

    expect(() => getOAuthStateSecret()).toThrow(
      "OAUTH_STATE_SECRET must be configured in production."
    );
  });

  it("does not fall back to TOKEN_VAULT_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "v".repeat(64));

    let thrown: unknown;
    try {
      getOAuthStateSecret();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("v".repeat(64));
  });

  it("prefers OAUTH_STATE_SECRET over TOKEN_VAULT_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "dedicated-state-secret");
    vi.stubEnv("TOKEN_VAULT_SECRET", "v".repeat(64));

    expect(getOAuthStateSecret()).toBe("dedicated-state-secret");
  });

  it("falls back to TOKEN_VAULT_SECRET in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "v".repeat(64));

    expect(getOAuthStateSecret()).toBe("v".repeat(64));
  });

  it("falls back to the dev-only secret in test", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    expect(getOAuthStateSecret()).toBe(DEV_ONLY_SECRET);
  });
});
