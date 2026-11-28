import { afterEach, describe, expect, it, vi } from "vitest";

import { isVerifiedAdmin } from "@/lib/alerts/capacity";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isVerifiedAdmin", () => {
  it("rejects an allowlisted email that is not confirmed", () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");

    expect(
      isVerifiedAdmin({ email: "admin@example.com", email_confirmed_at: null })
    ).toBe(false);
  });

  it("accepts a confirmed allowlisted email", () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");

    expect(
      isVerifiedAdmin({
        email: "admin@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      })
    ).toBe(true);
  });

  it("rejects a confirmed email that is not allowlisted", () => {
    vi.stubEnv("ADMIN_ALERT_EMAILS", "admin@example.com");

    expect(
      isVerifiedAdmin({
        email: "someone@example.com",
        email_confirmed_at: "2026-01-01T00:00:00Z",
      })
    ).toBe(false);
  });
});
