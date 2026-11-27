import { describe, expect, it } from "vitest";

import { matchesRerunKeywords } from "@/lib/rerun-candidates";

describe("re-run keyword matching", () => {
  it("matches every comment when no keywords are configured", () => {
    expect(matchesRerunKeywords("anything at all", [])).toBe(true);
  });

  it("matches keywords case-insensitively as substrings", () => {
    expect(matchesRerunKeywords("I want the GUIDE please", ["guide"])).toBe(true);
    expect(matchesRerunKeywords("send the vip link", ["Guide", "VIP"])).toBe(true);
  });

  it("rejects non-matching comments", () => {
    expect(matchesRerunKeywords("just saying hi", ["GUIDE"])).toBe(false);
  });

  it("ignores blank keywords", () => {
    expect(matchesRerunKeywords("hello", ["  "])).toBe(false);
  });
});
