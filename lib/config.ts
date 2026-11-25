/**
 * Central runtime configuration.
 *
 * Rule: production must never run with baked-in secrets. Development may use a
 * clearly-labelled local fallback so the app still boots on a fresh checkout.
 * All environment reads that affect security go through this module.
 */

const DEV_ONLY_SECRET = "dmplease-local-development-only-change-me";

/** The key that older installs used when TOKEN_VAULT_SECRET was not configured. */
export const LEGACY_VAULT_SECRET =
  "a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
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
 * Keys accepted when decrypting tokens written by older versions.
 * The legacy constant is never used to encrypt new tokens.
 */
export function getLegacyVaultSecrets(): string[] {
  const configured = process.env.TOKEN_VAULT_LEGACY_SECRET?.trim();
  return configured && configured !== LEGACY_VAULT_SECRET
    ? [configured, LEGACY_VAULT_SECRET]
    : [LEGACY_VAULT_SECRET];
}

export function getOAuthStateSecret(): string {
  const dedicated = process.env.OAUTH_STATE_SECRET?.trim();
  if (dedicated) return dedicated;
  const vault = process.env.TOKEN_VAULT_SECRET?.trim();
  if (vault) return vault;
  return requireSecret("OAUTH_STATE_SECRET", DEV_ONLY_SECRET);
}

/** All keys accepted when validating in-flight OAuth state values. */
export function getOAuthStateSecrets(): string[] {
  const current = getOAuthStateSecret();
  const extras = [process.env.TOKEN_VAULT_SECRET, LEGACY_VAULT_SECRET, DEV_ONLY_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value !== current));
  return [current, ...new Set(extras)];
}

/** Meta app secrets accepted for webhook signature verification. */
export function getWebhookSecrets(): string[] {
  return [
    process.env.META_APP_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
    process.env.FACEBOOK_APP_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
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
