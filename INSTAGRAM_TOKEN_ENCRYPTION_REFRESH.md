 Long-lived Instagram User Access Tokens last up to **60 days** and can be refreshed via `GET [https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=](https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=)...`—provided the token is **at least 24 hours old** and **has not yet expired**.

In a Next.js DM automation app, storing raw tokens in your database is risky, and refreshing blindly on every single DM wastes API calls (or fails if a token is under 24 hours old). The cleanest production pattern is:

1. **Encrypt tokens at rest** using **AES-256-GCM** with an authentication tag (`iv:authTag:ciphertext`) and a 32-byte key from `TOKEN_ENCRYPTION_KEY`.
2. **Proactively refresh tokens** when they are within a safe renewal window (for example, less than **15 days** left before `expiresAt`) and at least **24 hours** old—using a short Redis lock so concurrent DM workers don't race to refresh the same token simultaneously.

---

### 1. Environment Variables

Generate a 32-byte (64-hex-character) encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

```

```env
TOKEN_ENCRYPTION_KEY=your_64_char_hex_key_here
IG_GRAPH_VERSION=v27.0

```

---

### 2. AES-256-GCM Encryption & Decryption (`lib/token-crypto.ts`)

AES-256-GCM provides both confidentiality and integrity verification (if ciphertext or IV is tampered with, decryption throws instead of silently returning corrupted data).

```typescript
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended 96-bit IV for GCM

function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plaintext access token into `iv:authTag:ciphertext` (base64url).
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Decrypts a token stored in `iv:authTag:ciphertext` format.
 */
export function decryptToken(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivB64, authTagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(authTagB64, "base64url");
  const ciphertext = Buffer.from(dataB64, "base64url");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

```

---

### 3. Token Refresh & Safe Lookup Before Sending DMs (`lib/ig-token.ts`)

Before dispatching a DM, decrypt the current token and check whether it should be refreshed:

* **Already expired:** Return an error prompting the creator to reconnect their Instagram account.
* **Eligible for refresh:** Refresh when `expiresAt` is within **15 days** (`15 * 86400 * 1000` ms) *and* the token has existed for at least **24 hours** (`tokenIssuedAt` at least 24h ago).
* **Concurrency guard:** Use a Redis `SET ... NX EX 30` lock per `creatorIgId` so if 50 DMs fire at once when a token enters its refresh window, only one worker calls Meta's refresh endpoint and updates the database.

```typescript
import { redis } from "./redis";
import { decryptToken, encryptToken } from "./token-crypto";

export interface StoredCreatorTokenRecord {
  creatorIgId: string;
  encryptedAccessToken: string;
  tokenIssuedAt: string; // ISO timestamp when current token was obtained/refreshed
  expiresAt: string;     // ISO timestamp when current token expires
}

// Replace these two functions with your actual database queries (Postgres / Prisma / Drizzle)
async function loadTokenRecord(
  creatorIgId: string
): Promise<StoredCreatorTokenRecord | null> {
  return null;
}

async function saveRefreshedTokenRecord(params: {
  creatorIgId: string;
  encryptedAccessToken: string;
  tokenIssuedAt: string;
  expiresAt: string;
}): Promise<void> {
  // Persist encrypted token and updated timestamps to your database
}

async function callInstagramRefreshEndpoint(
  currentPlaintextToken: string
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const version = process.env.IG_GRAPH_VERSION || "v27.0";
  const url = new URL(`https://graph.instagram.com/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentPlaintextToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(
      `IG token refresh failed (${res.status}): ${JSON.stringify(data?.error ?? data)}`
    );
  }

  return {
    accessToken: data.access_token as string,
    expiresInSeconds: Number(data.expires_in) || 5184000, // ~60 days
  };
}

/**
 * Returns a valid plaintext Instagram token for sending a DM,
 * refreshing it proactively if it is near expiration and at least 24h old.
 */
export async function getValidInstagramAccessToken(
  creatorIgId: string
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_found" | "expired" | "refresh_failed"; error?: unknown }
> {
  const record = await loadTokenRecord(creatorIgId);
  if (!record) {
    return { ok: false, reason: "not_found" };
  }

  const now = Date.now();
  const expiresAtMs = new Date(record.expiresAt).getTime();
  const issuedAtMs = new Date(record.tokenIssuedAt).getTime();

  // Token has already expired; user must re-authenticate
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
    return { ok: false, reason: "expired" };
  }

  let currentToken = decryptToken(record.encryptedAccessToken);

  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  const isWithinRefreshWindow =
    Number.isFinite(expiresAtMs) && expiresAtMs - now <= fifteenDaysMs;
  const isAtLeast24hOld =
    !Number.isFinite(issuedAtMs) || now - issuedAtMs >= twentyFourHoursMs;

  if (isWithinRefreshWindow && isAtLeast24hOld) {
    const lockKey = `lock:ig:refresh:${creatorIgId}`;
    const acquiredLock = await redis.set(lockKey, "1", { nx: true, ex: 30 });

    if (acquiredLock === "OK") {
      try {
        const refreshed = await callInstagramRefreshEndpoint(currentToken);
        const newIssuedAt = new Date(now).toISOString();
        const newExpiresAt = new Date(
          now + refreshed.expiresInSeconds * 1000
        ).toISOString();

        await saveRefreshedTokenRecord({
          creatorIgId,
          encryptedAccessToken: encryptToken(refreshed.accessToken),
          tokenIssuedAt: newIssuedAt,
          expiresAt: newExpiresAt,
        });

        currentToken = refreshed.accessToken;
      } catch (err) {
        // If refresh fails transiently while the existing token is still valid,
        // still attempt the DM with the non-expired token rather than dropping it.
        console.warn("Proactive IG token refresh failed, using existing token:", {
          creatorIgId,
          err,
        });
      } finally {
        await redis.del(lockKey);
      }
    }
  }

  return { ok: true, accessToken: currentToken };
}

```

---

### 4. Using It Inside Your DM Worker (`app/api/workers/send-dm/route.ts`)

Plug `getValidInstagramAccessToken` right before calling `[https://graph.instagram.com/.../messages](https://graph.instagram.com/.../messages)`:

```typescript
import { getValidInstagramAccessToken } from "@/lib/ig-token";

// Inside your worker handler:
const tokenResult = await getValidInstagramAccessToken(creatorIgId);

if (!tokenResult.ok) {
  // If expired or missing, mark creator connection as needing reconnect and return 200
  // so QStash doesn't retry an account that requires re-login.
  return NextResponse.json(
    { status: "skipped_token_unavailable", reason: tokenResult.reason },
    { status: 200 }
  );
}

// Use `tokenResult.accessToken` in the Authorization: Bearer header for the Graph API call

```

---

### Operational Tips for Scale

* **Also Run a Daily Scheduled Check:** Relying only on DM send time works well for active creators, but adding a daily QStash schedule to refresh tokens expiring within 15 days keeps quiet creators' tokens alive too.
* **Key Rotation Support:** If you ever rotate `TOKEN_ENCRYPTION_KEY`, store a version prefix (e.g., `v1:iv:tag:cipher`) in `encryptToken` so `decryptToken` can check `v1` vs `v2` keys seamlessly during migration."
