import { describe, expect, it } from "vitest";

import { duplicateWindowDays, matchesRerunKeywords } from "@/lib/rerun-candidates";

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

describe("re-run duplicate window", () => {
  it("never suppresses for less than 30 days", () => {
    expect(duplicateWindowDays(1)).toBe(30);
    expect(duplicateWindowDays(7)).toBe(30);
    expect(duplicateWindowDays(30)).toBe(30);
  });

  it("honours a longer window", () => {
    expect(duplicateWindowDays(60)).toBe(60);
  });

  it("clamps invalid input", () => {
    expect(duplicateWindowDays(0)).toBe(30);
    expect(duplicateWindowDays(-5)).toBe(30);
  });
});
