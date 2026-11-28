import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

/**
 * Atomic send claim.
 *
 * The 24h `dm_logs` check is read-before-send, so two overlapping deliveries
 * can both pass it. This claim is a single `INSERT ... ON CONFLICT` in
 * Postgres: the first writer wins and the second sees an unexpired row. The
 * TTL covers the processing window; the `dm_logs` row remains the long-lived
 * 24h guard.
 */

/** Long enough to cover a slow Meta call and a retry overlap. */
const CLAIM_TTL_SECONDS = 10 * 60;

export interface DmSendClaimInput {
  workspaceId: string;
  automationId: string;
  instagramAccountId: string | null;
  recipientId: string;
}

export async function claimDmSend(input: DmSendClaimInput): Promise<boolean> {
  if (!hasAdminDb()) return true;
  try {
    const { data, error } = await getAdminDb().rpc("claim_dm_send", {
      p_workspace_id: input.workspaceId,
      p_automation_id: input.automationId,
      p_instagram_account_id: input.instagramAccountId,
      p_recipient_id: input.recipientId,
      p_ttl_seconds: CLAIM_TTL_SECONDS,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    // During a rolling deploy the RPC may not exist yet. Do not block every
    // send; the durable webhook claim is still the primary guard.
    if (code === "42883" || code === "42P01") {
      console.warn(
        "[dm-send-claim] Claim RPC missing; apply the migration. Continuing."
      );
      return true;
    }
    // A real database error means we cannot prove this send is unique. Fail
    // closed rather than risk a duplicate private reply.
    console.warn("[dm-send-claim] Claim unavailable, skipping send:", error);
    return false;
  }
}

export async function releaseDmSend(input: {
  automationId: string;
  recipientId: string;
}): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    await getAdminDb().rpc("release_dm_send", {
      p_automation_id: input.automationId,
      p_recipient_id: input.recipientId,
    });
  } catch (error) {
    console.warn("[dm-send-claim] Could not release claim:", error);
  }
}
