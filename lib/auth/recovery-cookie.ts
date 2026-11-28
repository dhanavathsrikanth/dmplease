/**
 * Cookie plumbing for the password-recovery grant.
 *
 * Kept separate from `recovery-grant.ts` so the token logic stays pure and
 * unit-testable without a Next.js request context.
 */

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import {
  RECOVERY_GRANT_TTL_SECONDS,
  createRecoveryGrant,
  verifyRecoveryGrant,
  type RecoveryGrant,
} from "./recovery-grant";

export { recoveryGrantMatches } from "./recovery-grant";

export const RECOVERY_COOKIE_NAME = "dmplease-recovery";

/**
 * Scope the cookie to the recovery page. The browser then never sends it to
 * dashboard, API or marketing routes, which limits the blast radius if it is
 * ever leaked.
 */
export const RECOVERY_COOKIE_PATH = "/auth/update-password";

export function recoveryCookieOptions(isHttps: boolean) {
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax" as const,
    path: RECOVERY_COOKIE_PATH,
    maxAge: RECOVERY_GRANT_TTL_SECONDS,
  };
}

/** Attaches a fresh grant to an outgoing route-handler response. */
export function attachRecoveryGrant(
  response: NextResponse,
  userId: string,
  isHttps: boolean
): void {
  response.cookies.set(
    RECOVERY_COOKIE_NAME,
    createRecoveryGrant(userId),
    recoveryCookieOptions(isHttps)
  );
}

/** Reads and verifies the grant from the incoming request. */
export async function readRecoveryGrant(): Promise<RecoveryGrant | null> {
  const store = await cookies();
  return verifyRecoveryGrant(store.get(RECOVERY_COOKIE_NAME)?.value);
}

/** Removes the grant after it has been used (or when it is invalid). */
export async function clearRecoveryGrant(): Promise<void> {
  const store = await cookies();
  store.delete({ name: RECOVERY_COOKIE_NAME, path: RECOVERY_COOKIE_PATH });
}
