import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  verifyWebhookSignature,
  verifyWebhookVerifyToken,
  hasWebhookSigningSecret,
} from "@/lib/meta/webhook";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("webhook signature verification", () => {
  it("accepts a correctly signed payload", () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "");
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const signature = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature)).toBe(true);
  });

  it("rejects tampered payloads", () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");
    const body = '{"object":"instagram","entry":[]}';
    const signature = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(`${body} `, signature)).toBe(false);
  });

  it("fails closed when no app secret is configured", () => {
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "");
    expect(hasWebhookSigningSecret()).toBe(false);
    expect(verifyWebhookSignature("{}", "sha256=" + "a".repeat(64))).toBe(false);
  });

  it("rejects malformed signatures before comparison", () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");
    expect(verifyWebhookSignature("{}", null)).toBe(false);
    expect(verifyWebhookSignature("{}", "nonsense")).toBe(false);
  });
});

describe("webhook handshake token", () => {
  it("compares the verify token in constant time", () => {
    vi.stubEnv("META_VERIFY_TOKEN", "correct-token");
    expect(verifyWebhookVerifyToken("correct-token")).toBe(true);
    expect(verifyWebhookVerifyToken("wrong-token")).toBe(false);
    expect(verifyWebhookVerifyToken(null)).toBe(false);
  });
});
