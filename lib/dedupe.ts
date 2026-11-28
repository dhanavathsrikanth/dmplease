import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import type { WebhookPayload } from "@/lib/meta/webhook";

/**
 * Durable, lease-based webhook claim.
 *
 * The dedupe key is the hash of the whole verified payload, so its scope
 * matches the processing scope (every entry/change in the batch). The claim
 * carries a lease: a retry can re-claim when the previous attempt failed or
 * its lease expired, so a crash after the claim no longer drops the batch.
 */

/** Long enough for a slow batch, short enough that a crash recovers quickly. */
export const WEBHOOK_CLAIM_LEASE_SECONDS = 5 * 60;

export type WebhookClaimStatus =
  | "claimed"
  | "duplicate"
  | "in_progress"
  | "unavailable";

export interface WebhookClaimInput {
  dedupeKey: string;
  payload: WebhookPayload;
  object: string;
  instagramAccountId: string | null;
  eventKind: string | null;
  externalEventId: string | null;
}

export interface WebhookClaimResult {
  status: WebhookClaimStatus;
  /** The ledger row id, present when the claim was written to Postgres. */
  eventId: string | null;
  /** Where the claim was recorded. `none` means no atomic store was available. */
  store: "db" | "redis" | "none";
}

async function resolveWorkspaceId(
  instagramAccountId: string | null
): Promise<string | null> {
  if (!instagramAccountId) return null;
  try {
    const { data } = await getAdminDb()
      .from("instagram_accounts")
      .select("workspace_id")
      .eq("instagram_id", instagramAccountId)
      .limit(1)
      .maybeSingle();
    return (data?.workspace_id as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function claimWebhookEvent(
  input: WebhookClaimInput
): Promise<WebhookClaimResult> {
  // 1. Durable claim in Postgres. The RPC inserts a new row or re-claims a
  //    FAILED/expired one, and returns the row id plus the outcome.
  if (hasAdminDb()) {
    try {
      const db = getAdminDb();
      const workspaceId = await resolveWorkspaceId(input.instagramAccountId);
      const { data, error } = await db.rpc("claim_webhook_payload", {
        p_dedupe_key: input.dedupeKey,
        p_object: input.object,
        p_instagram_account_id: input.instagramAccountId,
        p_workspace_id: workspaceId,
        p_event_kind: input.eventKind,
        p_external_event_id: input.externalEventId,
        p_payload: input.payload,
        p_lease_seconds: WEBHOOK_CLAIM_LEASE_SECONDS,
      });
      if (error) throw error;

      const result = (data ?? {}) as { status?: string; id?: string };
      if (
        result.status === "claimed" ||
        result.status === "duplicate" ||
        result.status === "in_progress"
      ) {
        return {
          status: result.status,
          eventId: result.id ?? null,
          store: "db",
        };
      }
      throw new Error(`Unexpected claim status: ${String(result.status)}`);
    } catch (error) {
      console.warn("[dedupe] DB claim failed, trying Redis:", error);
    }
  }

  // 2. Redis fallback for deployments without a database. The TTL matches the
  //    lease so a crashed attempt can be retried.
  if (hasUpstashRedis()) {
    try {
      // The account id is part of the key so two tenants that happen to
      // produce the same payload hash cannot collide on one another's claim.
      const result = await getRedis().set(
        `dedupe:ig:event:${input.instagramAccountId ?? "unknown"}:${input.dedupeKey}`,
        "1",
        { nx: true, ex: WEBHOOK_CLAIM_LEASE_SECONDS }
      );
      return {
        status: result === "OK" ? "claimed" : "duplicate",
        eventId: null,
        store: "redis",
      };
    } catch (error) {
      console.warn("[dedupe] Redis claim failed:", error);
    }
  }

  // 3. Fail closed. Without an atomic claim we cannot guarantee a single send,
  //    so the route returns 503 and Meta retries later.
  return { status: "unavailable", eventId: null, store: "none" };
}
