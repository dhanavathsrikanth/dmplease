import * as crypto from "crypto";
import { getLegacyVaultSecrets, getVaultSecret } from "@/lib/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV standard for GCM

function keyFromSecret(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

interface EncryptedParts {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function parseEncrypted(value: string): EncryptedParts {
  const parts = value.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token payload format");
  }
  const [ivHex, tagHex, ciphertextHex] = parts;
  if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(tagHex) || !/^[0-9a-f]+$/i.test(ciphertextHex)) {
    throw new Error("Invalid encrypted token payload encoding");
  }

  return {
    iv: Buffer.from(ivHex, "hex"),
    tag: Buffer.from(tagHex, "hex"),
    ciphertext: Buffer.from(ciphertextHex, "hex"),
  };
}

function decryptWithKey(parts: EncryptedParts, key: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, parts.iv);
  decipher.setAuthTag(parts.tag);
  let decrypted = decipher.update(parts.ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypts an Instagram User / Page access token using AES-256-GCM.
 * Output format: `iv_hex:tag_hex:ciphertext_hex`.
 *
 * Requires TOKEN_VAULT_SECRET in production. There is no encryption fallback.
 */
export function encryptToken(token: string): string {
  const key = keyFromSecret(getVaultSecret());
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a stored AES-256-GCM encrypted token.
 *
 * Legacy keys are accepted for decryption only, so existing accounts survive
 * a key rotation. `needsReEncryption()` tells callers when to rewrite a token.
 */
export function decryptToken(encryptedString: string): string {
  // Legacy plaintext tokens (EAA… / IG…) are tolerated with a loud warning.
  // They should be rewritten with encryptToken() on next refresh.
  if (!encryptedString.includes(":") && /^(EAA|IG)/.test(encryptedString)) {
    console.warn(
      "[vault] Stored token is plaintext. Re-encrypt it with TOKEN_VAULT_SECRET."
    );
    return encryptedString;
  }

  const parts = parseEncrypted(encryptedString);
  const keys = [keyFromSecret(getVaultSecret()), ...getLegacyVaultSecrets().map(keyFromSecret)];

  for (const key of keys) {
    try {
      return decryptWithKey(parts, key);
    } catch {
      // Try the next key.
    }
  }

  throw new Error(
    "Unable to decrypt token with any configured vault key. Check TOKEN_VAULT_SECRET."
  );
}

/** True when a stored token is not encrypted with the current vault key. */
export function needsReEncryption(stored: string): boolean {
  if (!stored.includes(":") && /^(EAA|IG)/.test(stored)) return true;
  try {
    decryptWithKey(parseEncrypted(stored), keyFromSecret(getVaultSecret()));
    return false;
  } catch {
    return true;
  }
}
