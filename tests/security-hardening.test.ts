import { afterEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash, createHmac, randomBytes } from "crypto";
import {
  getLegacyVaultSecrets,
  getOAuthStateSecret,
  getOAuthStateSecrets,
} from "@/lib/config";
import { signOAuthState, verifyOAuthState } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/vault";
import { isVerifiedAdmin } from "@/lib/alerts/capacity";

const DEV_ONLY_SECRET = "dmplease-local-development-only-change-me";

/**
 * In-memory stand-in for the oauth_state_nonces table so the state tests do not
 * need a database. The real store is exercised by tests/oauth-state-nonce.test.ts.
 */
const nonceStore = vi.hoisted(() => new Set<string>());

vi.mock("@/lib/db-admin", () => ({
  hasAdminDb: () => true,
  getAdminDb: () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "store_oauth_state_nonce") {
        nonceStore.add(String(params.p_nonce));
        return { data: null, error: null };
      }
      if (name === "consume_oauth_state_nonce") {
        return { data: nonceStore.delete(String(params.p_nonce)), error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  }),
}));

/**
 * A stand-in for the key older installs used before TOKEN_VAULT_SECRET was
 * required. The real constant was removed from lib/config.ts, so the tests pin
 * a local value to prove it is no longer accepted implicitly.
 */
const OLD_KEY =
  "a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291";

function forgeState(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${signature}`;
}

function encryptWithSecret(plain: string, secret: string): string {
  const key = /^[0-9a-f]{64}$/i.test(secret)
    ? Buffer.from(secret, "hex")
    : createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth state secrets", () => {
  it("does not accept the hardcoded legacy or dev constants", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "a".repeat(64));

    const secrets = getOAuthStateSecrets();

    expect(secrets).toEqual(["a".repeat(64)]);
    expect(secrets).not.toContain(OLD_KEY);
    expect(secrets).not.toContain(DEV_ONLY_SECRET);
  });

  it("accepts an explicitly configured previous secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "a".repeat(64));
    vi.stubEnv("OAUTH_STATE_SECRET_PREVIOUS", "b".repeat(64));

    expect(getOAuthStateSecrets()).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("rejects states forged with the public legacy or dev constants", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "a".repeat(64));
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    const payload = {
      userId: "victim-user-id",
      nextUrl: "/dashboard/settings",
      provider: "facebook",
      expiresAt: Date.now() + 600_000,
      nonce: "x",
    };

    expect(await verifyOAuthState(forgeState(payload, OLD_KEY))).toBeNull();
    expect(await verifyOAuthState(forgeState(payload, DEV_ONLY_SECRET))).toBeNull();
  });

  it("accepts a state signed with the configured secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "a".repeat(64));

    const state = await signOAuthState("user-1", "/dashboard/settings", "facebook");
    expect((await verifyOAuthState(state))?.userId).toBe("user-1");
  });

  it("fails closed outside development/test when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("OAUTH_STATE_SECRET", "");
    vi.stubEnv("TOKEN_VAULT_SECRET", "");

    expect(() => getOAuthStateSecret()).toThrow(/must be configured/i);
  });
});

describe("legacy vault secrets", () => {
  it("does not accept the hardcoded key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_LEGACY_SECRET", "");

    expect(getLegacyVaultSecrets()).toEqual([]);
  });

  it("accepts an explicitly configured legacy key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_LEGACY_SECRET", "c".repeat(64));

    expect(getLegacyVaultSecrets()).toEqual(["c".repeat(64)]);
  });

  it("rejects a legacy-key ciphertext in production when no legacy key is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", "a".repeat(64));
    vi.stubEnv("TOKEN_VAULT_LEGACY_SECRET", "");

    const ciphertext = encryptWithSecret("dummy-token", OLD_KEY);

    expect(() => decryptToken(ciphertext)).toThrow(/Unable to decrypt/);
  });

  it("decrypts a legacy-key ciphertext when the legacy key is explicitly configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", "a".repeat(64));
    vi.stubEnv("TOKEN_VAULT_LEGACY_SECRET", OLD_KEY);

    const ciphertext = encryptWithSecret("dummy-token", OLD_KEY);

    expect(decryptToken(ciphertext)).toBe("dummy-token");
  });
});

describe("isVerifiedAdmin", () => {
  it("requires a confirmed email", () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");

    expect(
      isVerifiedAdmin({ email: "admin@example.com", email_confirmed_at: null })
    ).toBe(false);
    expect(
      isVerifiedAdmin({
        email: "admin@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      })
    ).toBe(true);
    expect(
      isVerifiedAdmin({
        email: "other@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      })
    ).toBe(false);
  });
});
