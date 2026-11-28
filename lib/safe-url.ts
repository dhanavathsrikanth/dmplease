/** True only for absolute http(s) URLs. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns the URL when it is http(s), otherwise null. */
export function safeRedirectTarget(value: string): string | null {
  return isHttpUrl(value) ? value : null;
}

/**
 * Validates an OAuth consent redirect target before the browser navigates to
 * it. Returns null for anything that is not an absolute http(s) URL, so a
 * malicious or malformed `redirect_url` can never become a `javascript:` or
 * `data:` navigation.
 */
export function safeConsentRedirect(value: unknown): string | null {
  return typeof value === "string" && isHttpUrl(value) ? value : null;
}
