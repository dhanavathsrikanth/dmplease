import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptToken,
  encryptToken,
  isLegacyPlaintext,
  readStoredTokenForMigration,
} from "@/lib/meta/vault";

const VAULT_SECRET = "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("decryptToken strictness", () => {
  it("rejects a plaintext Meta token", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    expect(() => decryptToken("EAAexampleplaintexttoken")).toThrow(
      "Stored token is not a vault ciphertext"
    );
  });

  it("rejects a plaintext IG token", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    expect(() => decryptToken("IGexampleplaintexttoken")).toThrow(
      "Stored token is not a vault ciphertext"
    );
  });

  it("decrypts a real ciphertext", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    const ciphertext = encryptToken("EAAreal-secret-token");
    expect(ciphertext).toContain(":");
    expect(decryptToken(ciphertext)).toBe("EAAreal-secret-token");
  });
});

describe("readStoredTokenForMigration", () => {
  it("returns legacy plaintext unchanged", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    expect(readStoredTokenForMigration("EAAlegacyplaintext")).toBe(
      "EAAlegacyplaintext"
    );
  });

  it("decrypts a ciphertext", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    const ciphertext = encryptToken("EAAmigrated-token");
    expect(readStoredTokenForMigration(ciphertext)).toBe("EAAmigrated-token");
  });

  it("still rejects a non-Meta plaintext value", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TOKEN_VAULT_SECRET", VAULT_SECRET);

    expect(() => readStoredTokenForMigration("not-a-token")).toThrow(
      "Stored token is not a vault ciphertext"
    );
  });
});

describe("isLegacyPlaintext", () => {
  it("is true for EAA and IG plaintext", () => {
    expect(isLegacyPlaintext("EAAabc")).toBe(true);
    expect(isLegacyPlaintext("IGabc")).toBe(true);
  });

  it("is false for ciphertext and unrelated values", () => {
    expect(isLegacyPlaintext("aa:bb:cc")).toBe(false);
    expect(isLegacyPlaintext("not-a-token")).toBe(false);
  });
});
