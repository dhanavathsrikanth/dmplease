import { describe, expect, it } from "vitest";

import { safeConsentRedirect } from "@/lib/safe-url";

describe("safeConsentRedirect", () => {
  it("returns absolute http(s) redirect targets unchanged", () => {
    expect(safeConsentRedirect("https://client.example.com/callback?code=abc")).toBe(
      "https://client.example.com/callback?code=abc"
    );
    expect(safeConsentRedirect("http://localhost:3000/callback")).toBe(
      "http://localhost:3000/callback"
    );
  });

  it("rejects script and data schemes", () => {
    expect(safeConsentRedirect("javascript:alert(document.cookie)")).toBeNull();
    expect(
      safeConsentRedirect("data:text/html,<script>alert(1)</script>")
    ).toBeNull();
    expect(safeConsentRedirect("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects non-web schemes and relative paths", () => {
    expect(safeConsentRedirect("ftp://client.example.com/callback")).toBeNull();
    expect(safeConsentRedirect("/dashboard")).toBeNull();
    expect(safeConsentRedirect("client.example.com/callback")).toBeNull();
  });

  it("rejects empty and non-string values", () => {
    expect(safeConsentRedirect("")).toBeNull();
    expect(safeConsentRedirect(null)).toBeNull();
    expect(safeConsentRedirect(undefined)).toBeNull();
    expect(safeConsentRedirect(42)).toBeNull();
    expect(safeConsentRedirect({ href: "https://example.com" })).toBeNull();
  });
});
