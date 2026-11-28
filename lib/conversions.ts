import { createHmac, timingSafeEqual } from "crypto";
import { getPurposeSecret } from "@/lib/config";

/** Workspace tokens are valid for one year from issue. */
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** A SHA-256 HMAC rendered as hex is always exactly 64 characters. */
const SIGNATURE_RE = /^[0-9a-f]{64}$/i;

const TOKEN_PURPOSE = "conversions-token";

interface WorkspaceTokenPayload {
  w?: unknown;
  v?: unknown;
  iat?: unknown;
  exp?: unknown;
}

export interface ParsedWorkspaceToken {
  workspaceId: string;
  version: number;
}

function sign(body: string): string {
  return createHmac("sha256", getPurposeSecret(TOKEN_PURPOSE))
    .update(body)
    .digest("hex");
}

/**
 * A signed, copyable token that lets an external checkout send conversion
 * events without exposing a Supabase key or requiring a user session.
 *
 * The payload carries the workspace id, the token version (bumped when the
 * owner rotates the token), the issue time, and the expiry. Rotating the
 * version invalidates every previously issued token for that workspace.
 */
export function createWorkspaceToken(workspaceId: string, version = 1): string {
  const now = Date.now();
  const body = Buffer.from(
    JSON.stringify({
      w: workspaceId,
      v: version,
      iat: now,
      exp: now + TOKEN_TTL_MS,
    })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseWorkspaceToken(
  token: string
): ParsedWorkspaceToken | null {
  const [body, signature, extra] = token.split(".");
  // Require the full 64-character hex digest. Buffer.from(hex) silently drops
  // a trailing nibble, so a length check is what stops "valid signature + one
  // extra hex character" from validating.
  if (!body || !signature || extra || !SIGNATURE_RE.test(signature)) {
    return null;
  }

  const supplied = Buffer.from(signature, "hex");
  const expected = Buffer.from(sign(body), "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as WorkspaceTokenPayload;

    if (typeof parsed.w !== "string" || parsed.w.length === 0) return null;

    // Legacy tokens predate versioning and expiry. They are accepted as
    // version 0 so the route can reject them unless the workspace is still on
    // version 0.
    if (parsed.v === undefined && parsed.exp === undefined) {
      return { workspaceId: parsed.w, version: 0 };
    }

    if (
      typeof parsed.v !== "number" ||
      !Number.isInteger(parsed.v) ||
      parsed.v < 0
    ) {
      return null;
    }
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) {
      return null;
    }
    if (parsed.exp <= Date.now()) return null;

    return { workspaceId: parsed.w, version: parsed.v };
  } catch {
    return null;
  }
}
