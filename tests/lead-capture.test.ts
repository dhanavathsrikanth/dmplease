import { describe, expect, it } from "vitest";

import {
  DEFAULT_COLLECT_CONFIG,
  isSkipKeyword,
  normalizeCollectConfig,
  parseCollectField,
  renderCollectPrompt,
  validateLeadValue,
} from "@/lib/lead-capture";

describe("parseCollectField", () => {
  it("parses built-in fields", () => {
    expect(parseCollectField("email")).toMatchObject({ kind: "email", key: null });
    expect(parseCollectField("phone")).toMatchObject({ kind: "phone" });
    expect(parseCollectField("name")).toMatchObject({ kind: "name" });
  });

  it("parses custom properties", () => {
    expect(parseCollectField("custom:company")).toMatchObject({
      kind: "custom",
      key: "company",
    });
  });

  it("returns null for none or empty", () => {
    expect(parseCollectField("none")).toBeNull();
    expect(parseCollectField("")).toBeNull();
    expect(parseCollectField(null)).toBeNull();
  });
});

describe("validateLeadValue", () => {
  it("accepts and normalizes emails", () => {
    expect(validateLeadValue("email", "  Alex@Example.COM ")).toMatchObject({
      valid: true,
      normalized: "alex@example.com",
    });
  });

  it("rejects invalid emails", () => {
    expect(validateLeadValue("email", "not-an-email").valid).toBe(false);
    expect(validateLeadValue("email", "a@b").valid).toBe(false);
  });

  it("accepts and normalizes phone numbers", () => {
    expect(validateLeadValue("phone", "+91 98765-43210")).toMatchObject({
      valid: true,
      normalized: "+919876543210",
    });
  });

  it("rejects invalid phone numbers", () => {
    expect(validateLeadValue("phone", "123").valid).toBe(false);
    expect(validateLeadValue("phone", "call me").valid).toBe(false);
  });

  it("accepts names and rejects symbols", () => {
    expect(validateLeadValue("name", "Alex O'Neil").valid).toBe(true);
    expect(validateLeadValue("name", "!!!").valid).toBe(false);
  });

  it("accepts custom values up to 200 characters", () => {
    expect(validateLeadValue("custom", "Acme Inc").valid).toBe(true);
    expect(validateLeadValue("custom", "x".repeat(201)).valid).toBe(false);
  });
});

describe("isSkipKeyword", () => {
  it("matches exact and prefixed skip keywords", () => {
    expect(isSkipKeyword("skip")).toBe(true);
    expect(isSkipKeyword("SKIP please")).toBe(true);
    expect(isSkipKeyword("no thanks!")).toBe(true);
    expect(isSkipKeyword("later")).toBe(true);
  });

  it("does not match normal replies", () => {
    expect(isSkipKeyword("alex@example.com")).toBe(false);
    expect(isSkipKeyword("skipping rope")).toBe(false);
  });
});

describe("renderCollectPrompt", () => {
  it("names the field and the skip keyword", () => {
    const field = parseCollectField("email")!;
    const prompt = renderCollectPrompt(field, DEFAULT_COLLECT_CONFIG);
    expect(prompt).toContain("email address");
    expect(prompt).toContain("SKIP");
  });

  it("uses the custom key for custom fields", () => {
    const field = parseCollectField("custom:company")!;
    expect(renderCollectPrompt(field)).toContain("company");
  });
});

describe("normalizeCollectConfig", () => {
  it("fills defaults and clamps attempts", () => {
    const config = normalizeCollectConfig({ maxAttempts: 99 });
    expect(config.maxAttempts).toBe(10);
    expect(config.retryMessage).toBe(DEFAULT_COLLECT_CONFIG.retryMessage);
    expect(config.skipKeywords.length).toBeGreaterThan(0);
  });

  it("keeps custom copy", () => {
    const config = normalizeCollectConfig({
      retryMessage: "Try again",
      skipMessage: "Skipped",
      successMessage: "Saved",
      skipKeywords: ["pass"],
      maxAttempts: 2,
    });
    expect(config).toMatchObject({
      retryMessage: "Try again",
      skipMessage: "Skipped",
      successMessage: "Saved",
      skipKeywords: ["pass"],
      maxAttempts: 2,
    });
  });
});
