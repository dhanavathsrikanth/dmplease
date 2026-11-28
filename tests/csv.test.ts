import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";

describe("csvCell", () => {
  it("quotes and escapes ordinary values", () => {
    expect(csvCell("hello")).toBe(`"hello"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  });

  it("neutralizes spreadsheet formula prefixes", () => {
    expect(csvCell('=HYPERLINK("https://evil.example")')).toBe(
      `"'=HYPERLINK(""https://evil.example"")"`
    );
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell("\tcmd")).toBe(`"'\tcmd"`);
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`);
    expect(csvCell("\ncmd")).toBe(`"'\ncmd"`);
  });

  it("does not alter values that do not start with a formula character", () => {
    expect(csvCell("normal@example.com")).toBe(`"normal@example.com"`);
    expect(csvCell("a=b")).toBe(`"a=b"`);
  });

  it("handles null, undefined, and objects", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell({ a: 1 })).toBe(`"{""a"":1}"`);
  });
});
