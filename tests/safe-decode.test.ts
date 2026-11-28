import { describe, expect, it } from "vitest";
import { safeDecodeURIComponent } from "@/lib/safe-decode";

describe("safeDecodeURIComponent", () => {
  it("returns a lone percent sign unchanged", () => {
    expect(safeDecodeURIComponent("%")).toBe("%");
  });

  it("returns a truncated escape sequence unchanged", () => {
    expect(safeDecodeURIComponent("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("decodes a valid escape sequence", () => {
    expect(safeDecodeURIComponent("hello%20world")).toBe("hello world");
  });

  it("returns a plain value unchanged", () => {
    expect(safeDecodeURIComponent("plain")).toBe("plain");
  });
});
