import { Receiver } from "@upstash/qstash";
import { getQstashSigningKeys } from "@/lib/upstash";

/**
 * Verifies a QStash delivery inside the handler (not at module evaluation),
 * so builds work even when signing keys only exist in the deployed runtime.
 * Returns the verified raw body, or null when the signature is missing/invalid.
 */
export async function verifyQstashRequest(
  request: Request
): Promise<string | null> {
  const signature = request.headers.get("upstash-signature");
  const { current, next } = getQstashSigningKeys();

  if (!signature || !current || !next) return null;

  const body = await request.text();
  try {
    await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({
      signature,
      body,
      url: request.url,
    });
    return body;
  } catch (error) {
    console.warn("[qstash] Signature verification failed:", error);
    return null;
  }
}
