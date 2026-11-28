/**
 * Central runtime configuration.
 *
 * Rule: production must never run with baked-in secrets. Development may use a
 * clearly-labelled local fallback so the app still boots on a fresh checkout.
 * All environment reads that affect security go through this module.
 */

import { createHmac } from "crypto";

const DEV_ONLY_SECRET = "dmplease-local-development-only-change-me";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Reads an env value and strips BOM/zero-width characters that can be copied
 * into Vercel env vars. We have seen a leading U+FEFF break new URL() and
 * Meta app-token validation in production, so every URL/secret read should go
 * through this helper.
 */
export function cleanEnv(name: string): string {
  return (process.env[name] || "")
    .replace(/[\uFEFF\u200B-\u200D]/g, "")
    .trim();
}

/**
 * Returns a configured secret, or a development-only fallback.
 * Throws in production when the variable is missing.
 */
export function requireSecret(name: string, devFallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;

  if (isProduction()) {
    throw new Error(
      `${name} is not configured. Add it to your deployment environment variables.`
    );
  }

  if (devFallback) {
    console.warn(
      `[config] ${name} is not set. Using a development-only fallback. Do not deploy with this value.`
    );
    return devFallback;
  }

  throw new Error(`${name} is not configured.`);
}

/** Checks that a secret exists without throwing. Used by the health page. */
export function hasSecret(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Database URLs are considered valid only when they parse as a postgres URL
 * and are not the Supabase starter placeholder.
 */
export function hasDatabaseUrl(): boolean {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || raw.includes("[YOUR-PASSWORD]")) return false;

  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === "postgres:" || parsed.protocol === "postgresql:"
    );
  } catch {
    return false;
  }
}

/** Direct (non-pooled) database URL used by Prisma migrations and long jobs. */
export function hasDirectDatabaseUrl(): boolean {
  const raw = process.env.DIRECT_URL?.trim();
  if (!raw || raw.includes("[YOUR-PASSWORD]")) return false;
  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === "postgres:" || parsed.protocol === "postgresql:"
    );
  } catch {
    return false;
  }
}

export function getVaultSecret(): string {
  return requireSecret("TOKEN_VAULT_SECRET", DEV_ONLY_SECRET);
}

/**
 * Derives a purpose-specific key from the vault secret.
 *
 * The vault secret is the root key for several unrelated HMACs (workspace
 * tokens, tracked links, short codes). Deriving a separate key per purpose
 * means a signature minted for one purpose can never be replayed against
 * another, and rotating a single purpose does not require re-encrypting the
 * vault. The vault encryption key itself is unchanged.
 */
export function getPurposeSecret(purpose: string): string {
  return createHmac("sha256", getVaultSecret())
    .update(`dmplease:${purpose}`)
    .digest("hex");
}

/**
 * Keys accepted when decrypting tokens written by older versions.
 *
 * There is no hardcoded fallback in any environment: a legacy key must be
 * supplied explicitly through TOKEN_VAULT_LEGACY_SECRET.
 */
export function getLegacyVaultSecrets(): string[] {
  const configured = process.env.TOKEN_VAULT_LEGACY_SECRET?.trim();
  return configured ? [configured] : [];
}

/**
 * HMAC key for OAuth state values.
 *
 * Production requires a dedicated OAUTH_STATE_SECRET: the vault key must never
 * double as the state-signing key, so a vault compromise cannot forge state.
 * Local development and tests fall back to TOKEN_VAULT_SECRET, then the
 * clearly-labelled dev constant.
 */
export function getOAuthStateSecret(): string {
  const dedicated = process.env.OAUTH_STATE_SECRET?.trim();
  if (dedicated) return dedicated;

  if (isProduction()) {
    throw new Error("OAUTH_STATE_SECRET must be configured in production.");
  }

  // Only local development and tests may use a fallback. Any other runtime
  // (staging, preview) fails closed rather than signing state with a public
  // constant.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error("OAUTH_STATE_SECRET must be configured in production.");
  }

  const vault = process.env.TOKEN_VAULT_SECRET?.trim();
  if (vault) return vault;

  return DEV_ONLY_SECRET;
}

/** All keys accepted when validating in-flight OAuth state values. */
export function getOAuthStateSecrets(): string[] {
  const current = getOAuthStateSecret();
  const previous = process.env.OAUTH_STATE_SECRET_PREVIOUS?.trim();
  return previous && previous !== current ? [current, previous] : [current];
}

/**
 * Signing key for the short-lived password-recovery grant.
 *
 * A dedicated key is preferred so rotating OAuth state does not invalidate
 * in-flight recovery links. Falls back to the OAuth state key, which requires
 * OAUTH_STATE_SECRET in production.
 */
export function getRecoveryGrantSecret(): string {
  const dedicated = cleanEnv("RECOVERY_GRANT_SECRET");
  if (dedicated) return dedicated;
  return getOAuthStateSecret();
}

/**
 * Meta app secret accepted for webhook signature verification.
 *
 * Only the app that owns the webhook endpoint may sign its payloads, so at most
 * one secret is ever returned. META_APP_SECRET is authoritative; the legacy
 * INSTAGRAM_APP_SECRET / FACEBOOK_APP_SECRET names are read only when it is
 * unset. Treating them as independent identities would let a second app's
 * secret sign payloads for this endpoint.
 */
export function getWebhookSecrets(): string[] {
  const primary = cleanEnv("META_APP_SECRET");
  if (primary) return [primary];

  const alias =
    cleanEnv("INSTAGRAM_APP_SECRET") || cleanEnv("FACEBOOK_APP_SECRET");
  return alias ? [alias] : [];
}

export function getWebhookVerifyToken(): string {
  const dedicated = process.env.META_VERIFY_TOKEN?.trim();
  if (dedicated) return dedicated;
  const alternate = process.env.WEBHOOK_VERIFY_TOKEN?.trim();
  if (alternate) return alternate;
  return requireSecret("META_VERIFY_TOKEN", DEV_ONLY_SECRET);
}

export function getCronSecret(): string {
  return requireSecret("CRON_SECRET");
}

/**
 * Secret for privileged admin actions (manual delivery, webhook replay, DLQ
 * operations, profile sync, schedule setup).
 *
 * This is deliberately separate from CRON_SECRET: a leaked cron token must not
 * grant arbitrary DM sending or webhook replay. Production fails closed when
 * the dedicated secret is missing; local development falls back to the cron
 * secret so a fresh checkout still boots.
 */
export function getAdminApiSecret(): string {
  const dedicated = process.env.ADMIN_API_SECRET?.trim();
  if (dedicated) return dedicated;
  if (isProduction()) {
    throw new Error("ADMIN_API_SECRET must be configured in production.");
  }
  return getCronSecret();
}
