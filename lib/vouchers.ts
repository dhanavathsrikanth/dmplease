/**
 * Per-person voucher codes.
 *
 * Codes are derived from an HMAC of (scope, recipient), which makes them:
 *  - stable: the same person always gets the same code, even across retries;
 *  - unique-looking: an 8-character, unambiguous alphabet;
 *  - cheap: no lottery/DB retry loop needed, one idempotent upsert per person.
 *
 * The database row is the durable audit trail used by the UI and analytics.
 */

import { createHmac } from "crypto";

import { getVaultSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { linkForMessage } from "@/lib/meta/dm-template";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export function makeVoucherCode(
  scopeKey: string,
  recipientId: string,
  prefix = ""
): string {
  const digest = createHmac("sha256", getVaultSecret())
    .update(`${scopeKey}:${recipientId}`)
    .digest();
  let body = "";
  for (let index = 0; index < CODE_LENGTH; index++) {
    body += CODE_ALPHABET[digest[index] % CODE_ALPHABET.length];
  }
  const cleanPrefix = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return cleanPrefix ? `${cleanPrefix}-${body}` : body;
}

export interface VoucherResult {
  code: string;
  /** Destination URL with the code attached for one-click attribution. */
  voucherUrl: string | null;
}

export async function resolveVoucher(input: {
  workspaceId: string;
  scopeKey: string;
  recipientId: string;
  prefix?: string | null;
  link?: string | null;
}): Promise<VoucherResult> {
  const code = makeVoucherCode(
    input.scopeKey,
    input.recipientId,
    input.prefix ?? ""
  );

  if (hasAdminDb()) {
    await getAdminDb()
      .from("dm_vouchers")
      .upsert(
        {
          workspace_id: input.workspaceId,
          scope_key: input.scopeKey,
          recipient_id: input.recipientId,
          code,
        },
        { onConflict: "scope_key,recipient_id", ignoreDuplicates: true }
      );
  }

  const trackedLink = input.link
    ? linkForMessage(input.link, input.scopeKey)
    : "";
  let voucherUrl: string | null = null;
  if (trackedLink) {
    try {
      const url = new URL(trackedLink);
      url.searchParams.set("voucher", code);
      voucherUrl = url.toString();
    } catch {
      voucherUrl = null;
    }
  }

  return { code, voucherUrl };
}
