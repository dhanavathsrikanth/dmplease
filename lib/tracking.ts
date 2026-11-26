import { createHmac, timingSafeEqual } from "crypto";
import { getVaultSecret } from "@/lib/config";

export interface TrackedLinkPayload {
  workspaceId: string;
  automationId?: string;
  contactId?: string;
  url: string;
  postId?: string;
  keyword?: string;
  sequenceStep?: number;
}

/** Creates a signed, tamper-proof short-link token for a campaign button URL. */
export function createTrackedLink(payload: TrackedLinkPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getVaultSecret()).update(body).digest("hex");
  return `${body}.${signature}`;
}

/** Validates and decodes a short-link token. Returns null when tampered with. */
export function parseTrackedLink(token: string): TrackedLinkPayload | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !/^[0-9a-f]+$/i.test(signature)) return null;

  const supplied = Buffer.from(signature, "hex");
  const expected = createHmac("sha256", getVaultSecret()).update(body).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TrackedLinkPayload;
    if (!parsed.workspaceId || !/^https?:\/\//i.test(parsed.url)) return null;
    return parsed;
  } catch {
    return null;
  }
}
