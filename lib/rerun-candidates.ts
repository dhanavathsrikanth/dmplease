/**
 * Candidate selection for campaign re-runs.
 *
 * Pure filtering rules live next to the query so preview (dry run) and job
 * creation use exactly the same eligibility logic. Both use the admin client
 * after the caller has verified workspace ownership.
 *
 * Duplicate suppression is deliberately conservative: anyone who already
 * received this automation in the last 30 days is excluded, not just the last
 * 24 hours. A re-run must never feel like spam.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AutomationLike } from "@/lib/meta/webhook-processor";
import { resolveLatestMedia } from "@/lib/meta/reel-link-resolver";

export interface RerunCandidate {
  accountGraphId: string;
  commentId: string;
  mediaId: string;
  commentText: string;
  commenterId: string;
  commenterUsername: string | null;
}

export interface RerunCandidateResult {
  candidates: RerunCandidate[];
  sample: string[];
  /** Comments that matched the keyword/post scope before duplicate filtering. */
  total: number;
  /** Excluded because this automation already messaged them recently. */
  alreadyContacted: number;
  /** Excluded because the contact opted out. */
  optedOut: number;
  /** Excluded because the account is paused or its token is invalid. */
  accountUnavailable: number;
}

/** Substring keyword match, identical to the live comment path. */
export function matchesRerunKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => {
    const clean = keyword.toLowerCase().trim();
    return clean.length > 0 && normalized.includes(clean);
  });
}

/** Duplicate-suppression window: never shorter than 30 days. */
export function duplicateWindowDays(days: number): number {
  return Math.max(30, Math.max(1, Math.floor(days)));
}

interface FindInput {
  workspaceId: string;
  automation: AutomationLike;
  days: number;
  limit: number;
  accessToken?: string | null;
}

export async function findRerunCandidates(
  db: SupabaseClient,
  { workspaceId, automation, days, limit, accessToken }: FindInput
): Promise<RerunCandidateResult> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const duplicateCutoff = new Date(
    Date.now() - duplicateWindowDays(days) * 86400000
  ).toISOString();
  const keywords = automation.triggerKeywords ?? [];

  const { data: accountRows } = await db
    .from("instagram_accounts")
    .select("id, instagram_id, safety_paused, token_status")
    .eq("workspace_id", workspaceId);
  const graphIdByDbId = new Map<string, string>();
  const unavailableAccountIds = new Set<string>();
  for (const account of accountRows ?? []) {
    const dbId = String(account.id);
    graphIdByDbId.set(dbId, String(account.instagram_id));
    if (
      Boolean(account.safety_paused) ||
      String(account.token_status ?? "") === "invalid"
    ) {
      unavailableAccountIds.add(dbId);
    }
  }

  const { data: eventRows, error } = await db
    .from("comment_events")
    .select(
      "workspace_id, instagram_account_id, external_id, media_id, commenter_id, commenter_username, text"
    )
    .eq("workspace_id", workspaceId)
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const seenRecipients = new Set<string>();
  const eligible: RerunCandidate[] = [];
  let accountUnavailable = 0;

  // For NEXT_POST we only need one "latest media" lookup, not one per comment.
  let latestMediaId: string | null = null;
  if (automation.postScope === "NEXT_POST" && accessToken) {
    const firstMediaId = (eventRows ?? []).find((row) => row.media_id)?.media_id;
    const latest = await resolveLatestMedia(
      accessToken,
      firstMediaId ? String(firstMediaId) : null
    );
    latestMediaId = latest.mediaId;
  }

  for (const event of eventRows ?? []) {
    const commenterId = event.commenter_id ? String(event.commenter_id) : null;
    if (!commenterId || seenRecipients.has(commenterId)) continue;

    const accountDbId = event.instagram_account_id
      ? String(event.instagram_account_id)
      : "";
    const accountGraphId = graphIdByDbId.get(accountDbId);
    if (!accountGraphId) continue;
    if (unavailableAccountIds.has(accountDbId)) {
      accountUnavailable++;
      continue;
    }

    const mediaId = event.media_id ? String(event.media_id) : "";
    if (automation.postScope === "SPECIFIC_POST" && mediaId !== automation.postId) {
      continue;
    }
    if (
      automation.postScope === "NEXT_POST" &&
      latestMediaId &&
      mediaId !== latestMediaId
    ) {
      continue;
    }
    const text = event.text ? String(event.text) : "";
    if (!matchesRerunKeywords(text, keywords)) continue;

    seenRecipients.add(commenterId);
    eligible.push({
      accountGraphId,
      commentId: String(event.external_id),
      mediaId,
      commentText: text,
      commenterId,
      commenterUsername: event.commenter_username
        ? String(event.commenter_username)
        : null,
    });
  }

  const total = eligible.length;

  // Duplicate suppression must consider every eligible recipient, not just the
  // newest `limit` of them. Otherwise, once the newest window has been
  // contacted, the re-run reports zero candidates and older eligible
  // commenters can never be reached. Query in chunks to stay well under
  // PostgREST's URL length limits.
  const alreadyContacted = new Set<string>();
  const optedOut = new Set<string>();
  const recipientIds = eligible.map((candidate) => candidate.commenterId);
  const CHUNK_SIZE = 500;
  for (let start = 0; start < recipientIds.length; start += CHUNK_SIZE) {
    const chunk = recipientIds.slice(start, start + CHUNK_SIZE);
    const [priorLogsRes, contactsRes] = await Promise.all([
      db
        .from("dm_logs")
        .select("recipient_id")
        .eq("workspace_id", workspaceId)
        .eq("automation_id", automation.id)
        .eq("status", "SENT")
        .gte("sent_at", duplicateCutoff)
        .in("recipient_id", chunk),
      db
        .from("contacts")
        .select("instagram_id, opted_out_at")
        .eq("workspace_id", workspaceId)
        .in("instagram_id", chunk),
    ]);
    for (const log of priorLogsRes.data ?? []) {
      if (log.recipient_id) alreadyContacted.add(String(log.recipient_id));
    }
    for (const contact of contactsRes.data ?? []) {
      if (contact.opted_out_at && contact.instagram_id) {
        optedOut.add(String(contact.instagram_id));
      }
    }
  }

  // Filter first, then slice: the limit applies to deliverable candidates.
  const remaining = eligible.filter(
    (candidate) =>
      !alreadyContacted.has(candidate.commenterId) &&
      !optedOut.has(candidate.commenterId)
  );
  const candidates = remaining.slice(0, limit);
  const sample = candidates
    .slice(0, 5)
    .map((candidate) => candidate.commenterUsername || candidate.commenterId);

  // Counts describe the whole eligible set, not just the returned window.
  let alreadyContactedCount = 0;
  let optedOutCount = 0;
  for (const candidate of eligible) {
    if (alreadyContacted.has(candidate.commenterId)) alreadyContactedCount++;
    if (optedOut.has(candidate.commenterId)) optedOutCount++;
  }

  return {
    candidates,
    sample,
    total,
    alreadyContacted: alreadyContactedCount,
    optedOut: optedOutCount,
    accountUnavailable,
  };
}
