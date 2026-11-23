import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV standard for GCM

function getVaultKey(): Buffer {
  const secret =
    process.env.TOKEN_VAULT_SECRET ||
    "a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291";

  if (secret.length === 64) {
    return Buffer.from(secret, "hex");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts an Instagram User / Page access token using AES-256-GCM.
 * Output format: `iv_hex:tag_hex:ciphertext_hex`
 */
export function encryptToken(token: string): string {
  const key = getVaultKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a stored AES-256-GCM encrypted token.
 */
export function decryptToken(encryptedString: string): string {
  // If the token is already unencrypted (e.g. plain EAAP... token), return as-is
  if (!encryptedString.includes(":") && encryptedString.startsWith("EAA")) {
    return encryptedString;
  }

  const key = getVaultKey();
  const parts = encryptedString.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token payload format");
  }

  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertextHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
