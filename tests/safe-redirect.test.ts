import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

const ORIGIN = "https://app.example.com";

describe("safeNextPath", () => {
  it("keeps a rooted same-origin path", () => {
    expect(safeNextPath("/dashboard", ORIGIN)).toBe("/dashboard");
    expect(safeNextPath("/dashboard?tab=1#top", ORIGIN)).toBe(
      "/dashboard?tab=1#top"
    );
  });

  it("rejects protocol-relative values", () => {
    expect(safeNextPath("//evil.example", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("///evil.example", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("//evil.example/path", ORIGIN)).toBe("/onboarding");
  });

  it("rejects backslash-normalized values", () => {
    expect(safeNextPath("/\\evil.example", ORIGIN)).toBe("/onboarding");
  });

  it("rejects control characters that the URL parser strips", () => {
    expect(safeNextPath("/\t/evil.example", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("/\n/evil.example", ORIGIN)).toBe("/onboarding");
  });

  it("normalizes a trailing-slash origin", () => {
    expect(safeNextPath("/dashboard", `${ORIGIN}/`)).toBe("/dashboard");
  });

  it("rejects absolute URLs and executable schemes", () => {
    expect(safeNextPath("https://evil.example", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("javascript:alert(1)", ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("data:text/html,hi", ORIGIN)).toBe("/onboarding");
  });

  it("falls back for empty values", () => {
    expect(safeNextPath(null, ORIGIN)).toBe("/onboarding");
    expect(safeNextPath(undefined, ORIGIN)).toBe("/onboarding");
    expect(safeNextPath("", ORIGIN)).toBe("/onboarding");
  });

  it("honors a custom fallback", () => {
    expect(safeNextPath("//evil.example", ORIGIN, "/dashboard")).toBe(
      "/dashboard"
    );
  });
});
