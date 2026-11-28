import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWebhookSecrets,
  hasDatabaseUrl,
  hasSecret,
  requireSecret,
} from "@/lib/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime configuration", () => {
  it("accepts a valid postgres URL", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/dmplease");
    expect(hasDatabaseUrl()).toBe(true);
  });

  it("rejects missing and placeholder database URLs", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(hasDatabaseUrl()).toBe(false);
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:[YOUR-PASSWORD]@host:6543/postgres");
    expect(hasDatabaseUrl()).toBe(false);
    vi.stubEnv("DATABASE_URL", "not-a-url");
    expect(hasDatabaseUrl()).toBe(false);
  });

  it("reports configured secrets without exposing them", () => {
    vi.stubEnv("META_APP_SECRET", "top-secret");
    expect(hasSecret("META_APP_SECRET")).toBe(true);
    expect(hasSecret("CRON_SECRET")).toBe(false);
  });

  it("throws for a missing secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    expect(() => requireSecret("CRON_SECRET")).toThrow(/CRON_SECRET/);
  });

  it("allows a labelled fallback outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CRON_SECRET", "");
    expect(requireSecret("CRON_SECRET", "dev-only")).toBe("dev-only");
  });
});

describe("getWebhookSecrets", () => {
  it("prefers META_APP_SECRET over the legacy aliases", () => {
    vi.stubEnv("META_APP_SECRET", "meta-secret");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "instagram-secret");
    vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-secret");

    expect(getWebhookSecrets()).toEqual(["meta-secret"]);
  });

  it("uses INSTAGRAM_APP_SECRET only when META_APP_SECRET is unset", () => {
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "instagram-secret");
    vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-secret");

    expect(getWebhookSecrets()).toEqual(["instagram-secret"]);
  });

  it("uses FACEBOOK_APP_SECRET only when the other names are unset", () => {
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-secret");

    expect(getWebhookSecrets()).toEqual(["facebook-secret"]);
  });

  it("returns at most one secret even when every name is configured", () => {
    vi.stubEnv("META_APP_SECRET", "meta-secret");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "instagram-secret");
    vi.stubEnv("FACEBOOK_APP_SECRET", "facebook-secret");

    expect(getWebhookSecrets()).toHaveLength(1);
  });

  it("returns no secret when nothing is configured", () => {
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "");

    expect(getWebhookSecrets()).toEqual([]);
  });
});
