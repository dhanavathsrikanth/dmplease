/**
 * Diagnostics visibility rules.
 *
 * Some health checks only exist to report whether a deployment environment
 * variable is present (`META_APP_SECRET`, `META_VERIFY_TOKEN`, `CRON_SECRET`,
 * `TOKEN_VAULT_SECRET`). That is operator information, not user information, so
 * it is shown to verified admins only. Operational checks — database, Meta and
 * delivery — stay visible to everyone.
 */

/** Checks whose value is derived from deployment environment variables. */
export const ADMIN_ONLY_CHECK_IDS = [
  "signature",
  "verify-token",
  "token-vault",
  "cron",
] as const;

export function isAdminOnlyCheck(id: string): boolean {
  return (ADMIN_ONLY_CHECK_IDS as readonly string[]).includes(id);
}

/**
 * Returns the checks a viewer may see.
 *
 * Admins get the full list unchanged. Everyone else gets the operational
 * checks, with `replacement` (a generic "managed by your administrator" card)
 * inserted where the first hidden check used to be so the page keeps its shape.
 */
export function visibleChecks<T extends { id: string }>(
  isAdmin: boolean,
  checks: readonly T[],
  replacement?: T
): T[] {
  if (isAdmin) return [...checks];

  const visible: T[] = [];
  let inserted = false;
  for (const check of checks) {
    if (isAdminOnlyCheck(check.id)) {
      if (replacement && !inserted) {
        visible.push(replacement);
        inserted = true;
      }
      continue;
    }
    visible.push(check);
  }

  if (replacement && !inserted) visible.push(replacement);
  return visible;
}
