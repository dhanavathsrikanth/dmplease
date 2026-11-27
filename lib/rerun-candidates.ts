/**
 * Candidate selection for campaign re-runs.
 *
 * Pure filtering rules live next to the query so preview (dry run) and job
 * creation use exactly the same eligibility logic. Both use the admin client
 * after the caller has verified workspace ownership.
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
  const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
  const keywords = automation.triggerKeywords ?? [];

  const { data: accountRows } = await db
    .from("instagram_accounts")
    .select("id, instagram_id")
    .eq("workspace_id", workspaceId);
  const graphIdByDbId = new Map<string, string>();
  for (const account of accountRows ?? []) {
    graphIdByDbId.set(String(account.id), String(account.instagram_id));
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

  const limited = eligible.slice(0, limit);
  const recipientIds = limited.map((candidate) => candidate.commenterId);
  const alreadyContacted = new Set<string>();
  if (recipientIds.length > 0) {
    const { data: priorLogs } = await db
      .from("dm_logs")
      .select("recipient_id")
      .eq("workspace_id", workspaceId)
      .eq("automation_id", automation.id)
      .gte("sent_at", twentyFourHoursAgo)
      .in("recipient_id", recipientIds);
    for (const log of priorLogs ?? []) {
      if (log.recipient_id) alreadyContacted.add(String(log.recipient_id));
    }
  }

  const candidates = limited.filter(
    (candidate) => !alreadyContacted.has(candidate.commenterId)
  );
  const sample = candidates
    .slice(0, 5)
    .map((candidate) => candidate.commenterUsername || candidate.commenterId);

  return { candidates, sample };
}
