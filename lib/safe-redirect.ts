/**
 * Validates a post-authentication redirect target.
 *
 * Only a single-slash-rooted path on the configured origin is allowed.
 * Protocol-relative values ("//evil.example"), backslash-normalized values
 * ("/\\evil.example"), and absolute URLs are rejected. The returned value is
 * always a path on `origin`, so it can be passed to `new URL(path, origin)`
 * without changing the origin.
 */
export function safeNextPath(
  raw: string | null | undefined,
  origin: string,
  fallback = "/onboarding"
): string {
  if (!raw) return fallback;

  // Normalize a trailing slash so an origin like "https://app.example.com/"
  // compares equal to the URL parser's origin form.
  const base = origin.replace(/\/+$/, "");

  // A rooted path must start with exactly one '/'. A second '/' (or a
  // backslash, which the WHATWG URL parser normalizes to '/') makes the value
  // a network-path reference that replaces the origin.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return fallback;
  }

  try {
    const resolved = new URL(raw, base);
    if (resolved.origin !== base) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
