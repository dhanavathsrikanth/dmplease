import { createHash } from "crypto";
import { Receiver } from "@upstash/qstash";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getQstashSigningKeys, getRedis, hasUpstashRedis } from "@/lib/upstash";

/** QStash signatures stay valid for five minutes; claim for the same window. */
const REPLAY_TTL_SECONDS = 300;

/**
 * Claims a verified signature exactly once.
 *
 * Redis is the fast path. When it is unavailable or errors, the durable
 * Postgres guard takes over. If neither store can record the claim we fail
 * closed, because an unrecorded signature could be replayed.
 */
async function claimSignature(signature: string): Promise<boolean> {
  const hash = createHash("sha256").update(signature).digest("hex");

  if (hasUpstashRedis()) {
    try {
      const result = await getRedis().set(
        `qstash:replay:${hash}`,
        "1",
        { nx: true, ex: REPLAY_TTL_SECONDS }
      );
      // A non-"OK" result means the key already existed: a replay.
      return result === "OK";
    } catch (error) {
      console.warn("[qstash] Redis replay claim failed, trying DB:", error);
    }
  }

  if (hasAdminDb()) {
    try {
      const { data, error } = await getAdminDb().rpc("claim_qstash_signature", {
        p_signature_hash: hash,
        p_ttl_seconds: REPLAY_TTL_SECONDS,
      });
      if (error) throw error;
      return data === true;
    } catch (error) {
      console.warn("[qstash] DB replay claim failed:", error);
    }
  }

  return false;
}

/**
 * Verifies a QStash delivery inside the handler (not at module evaluation),
 * so builds work even when signing keys only exist in the deployed runtime.
 * Returns the verified raw body, or null when the signature is missing,
 * invalid, or a replay of an already-claimed signature.
 */
export async function verifyQstashRequest(
  request: Request
): Promise<string | null> {
  const signature = request.headers.get("upstash-signature");
  const { current, next } = getQstashSigningKeys();

  if (!signature || !current || !next) return null;

  const body = await request.text();
  try {
    await new Receiver({
      currentSigningKey: current,
      nextSigningKey: next,
      // Never let an unrelated QSTASH_DEV environment variable downgrade
      // verification to the package's public development keys.
      devMode: false,
    }).verify({
      signature,
      body,
      url: request.url,
    });
  } catch (error) {
    console.warn("[qstash] Signature verification failed:", error);
    return null;
  }

  // The signature is authentic. Claim it once so a captured request cannot be
  // replayed while the signature is still inside its validity window.
  const claimed = await claimSignature(signature);
  if (!claimed) {
    console.warn("[qstash] Rejected replayed signature");
    return null;
  }

  return body;
}
