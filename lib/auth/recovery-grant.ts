/**
 * Short-lived, signed proof that the current browser completed a password
 * recovery exchange.
 *
 * The recovery landing page must not be usable by an ordinary authenticated
 * session: a session alone is not proof that the user controls the mailbox or
 * that they forgot the password. Supabase's "require current password" project
 * setting is a useful server-side control, but it is a dashboard toggle and it
 * keys on the ambient session, not on how the session was created. This grant
 * makes the recovery path self-contained and independent of that setting.
 *
 * The token is stateless and bound to the user id. It is stored in an
 * httpOnly cookie scoped to the recovery page, so it is never readable from
 * JavaScript and is not sent to the rest of the app.
 */

import { createHmac, timingSafeEqual } from "crypto";

import { getRecoveryGrantSecret } from "@/lib/config";

/** How long a recovery link may be used after the email exchange. */
export const RECOVERY_GRANT_TTL_SECONDS = 10 * 60;

export interface RecoveryGrant {
  /** Supabase user id the grant was issued to. */
  sub: string;
  /** Expiry as an epoch millisecond timestamp. */
  exp: number;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Creates a grant token for a user. Exported for tests and the confirm route. */
export function createRecoveryGrant(userId: string, now = Date.now()): string {
  if (!userId) {
    throw new Error("A user id is required to create a recovery grant.");
  }

  const payload: RecoveryGrant = {
    sub: userId,
    exp: now + RECOVERY_GRANT_TTL_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, getRecoveryGrantSecret())}`;
}

/**
 * Verifies a grant token. Returns null for a missing, malformed, tampered or
 * expired token. Never throws, so callers can treat null as "not authorized".
 */
export function verifyRecoveryGrant(
  token: string | null | undefined,
  now = Date.now()
): RecoveryGrant | null {
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let expected: string;
  try {
    expected = sign(body, getRecoveryGrantSecret());
  } catch {
    // A missing signing key outside development must fail closed.
    return null;
  }

  const provided = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as Partial<RecoveryGrant>;

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    if (payload.exp <= now) {
      return null;
    }

    return { sub: payload.sub, exp: payload.exp };
  } catch {
    return null;
  }
}

/** True when a verified grant belongs to the given user. */
export function recoveryGrantMatches(
  grant: RecoveryGrant | null,
  userId: string | null | undefined
): boolean {
  return Boolean(grant && userId && grant.sub === userId);
}
