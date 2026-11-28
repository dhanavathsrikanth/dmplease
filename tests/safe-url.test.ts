import { describe, expect, it } from "vitest";

import { isHttpUrl, safeRedirectTarget } from "@/lib/safe-url";

describe("isHttpUrl", () => {
  it("accepts absolute http and https URLs", () => {
    expect(isHttpUrl("https://example.com/offer")).toBe(true);
    expect(isHttpUrl("http://example.com/offer?utm_source=dmplease")).toBe(true);
  });

  it("rejects executable and non-web schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("ftp://example.com/file")).toBe(false);
  });

  it("rejects relative paths and malformed values", () => {
    expect(isHttpUrl("/dashboard")).toBe(false);
    expect(isHttpUrl("example.com/offer")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("safeRedirectTarget", () => {
  it("returns http(s) URLs unchanged", () => {
    expect(safeRedirectTarget("https://example.com/offer")).toBe(
      "https://example.com/offer"
    );
  });

  it("returns null for anything else", () => {
    expect(safeRedirectTarget("javascript:alert(1)")).toBeNull();
    expect(safeRedirectTarget("data:text/html,hi")).toBeNull();
    expect(safeRedirectTarget("/relative")).toBeNull();
  });
});
