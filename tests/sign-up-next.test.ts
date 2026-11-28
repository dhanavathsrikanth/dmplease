import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-redirect";

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8"
  );
}

/**
 * The auth forms are client components, so these tests pin the wiring at the
 * source level: the `next` query parameter must be normalized once with
 * safeNextPath and every downstream consumer (immediate redirect, confirmation
 * email, OAuth redirectTo, cross-links) must use that sanitized value.
 */
describe("sign-up next parameter", () => {
  const source = readSource("components/sign-up-form.tsx");

  it("imports and applies safeNextPath to the raw next target", () => {
    expect(source).toContain(
      'import { safeNextPath } from "@/lib/safe-redirect"'
    );
    expect(source).toMatch(
      /const callbackUrl = safeNextPath\(\s*nextTarget,\s*"https:\/\/app\.local"\s*\)/
    );
  });

  it("uses the sanitized value for the immediate redirect and email link", () => {
    expect(source).toContain("window.location.href = callbackUrl");
    expect(source).toContain("router.push(callbackUrl)");
    expect(source).toContain(
      "`${origin}/auth/confirm?next=${encodeURIComponent(callbackUrl)}`"
    );
  });

  it("passes the sanitized value to OAuth and the sign-in cross-link", () => {
    expect(source).toContain("callbackUrl={callbackUrl}");
    expect(source).toContain(
      "`/auth/login?next=${encodeURIComponent(callbackUrl)}`"
    );
    expect(source).not.toContain("encodeURIComponent(nextTarget)");
  });

  it("rejects an off-site target with the same call the form makes", () => {
    expect(safeNextPath("//evil.example", "https://app.local")).toBe(
      "/onboarding"
    );
    expect(safeNextPath("https://evil.example", "https://app.local")).toBe(
      "/onboarding"
    );
    expect(safeNextPath("/dashboard", "https://app.local")).toBe("/dashboard");
  });
});

describe("other next consumers", () => {
  it("login form sanitizes before building its redirects", () => {
    const source = readSource("components/login-form.tsx");
    expect(source).toContain(
      'import { safeNextPath } from "@/lib/safe-redirect"'
    );
    expect(source).toMatch(/const callbackUrl = safeNextPath\(nextTarget,/);
    expect(source).toContain("callbackUrl={callbackUrl}");
  });

  it("OAuth buttons sanitize the redirectTo target", () => {
    const source = readSource("components/auth/oauth-buttons.tsx");
    expect(source).toContain(
      'import { safeNextPath } from "@/lib/safe-redirect"'
    );
    expect(source).toContain("safeNextPath(callbackUrl");
  });

  it("the session proxy sanitizes the next parameter", () => {
    const source = readSource("lib/supabase/proxy.ts");
    expect(source).toContain(
      'import { safeNextPath } from "../safe-redirect"'
    );
    expect(source).toContain("safeNextPath(nextParam, request.nextUrl.origin");
  });

  it("the OAuth code redirect on the landing page sanitizes next", () => {
    const source = readSource("app/page.tsx");
    expect(source).toContain(
      'import { safeNextPath } from "@/lib/safe-redirect"'
    );
    expect(source).toContain("safeNextPath(resolvedParams.next");
  });
});
