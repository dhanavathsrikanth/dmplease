import { createHmac, timingSafeEqual } from "crypto";
import { getVaultSecret } from "@/lib/config";

/**
 * A signed, copyable token that lets an external checkout send conversion
 * events without exposing a Supabase key or requiring a user session.
 */
export function createWorkspaceToken(workspaceId: string): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId })).toString("base64url");
  const signature = createHmac("sha256", getVaultSecret()).update(body).digest("hex");
  return `${body}.${signature}`;
}

export function parseWorkspaceToken(token: string): string | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !/^[0-9a-f]+$/i.test(signature)) return null;
  const supplied = Buffer.from(signature, "hex");
  const expected = createHmac("sha256", getVaultSecret()).update(body).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      w?: string;
    };
    return typeof parsed.w === "string" && parsed.w.length > 0 ? parsed.w : null;
  } catch {
    return null;
  }
}
