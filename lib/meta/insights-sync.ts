import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { fetchAccountInsights } from "@/lib/meta/insights";

export interface SyncSummary {
  accounts: number;
  points: number;
  errors: string[];
}

/** Fetches and stores daily account insights for the given workspaces. */
export async function refreshInsightsForWorkspaces(
  workspaceIds: string[]
): Promise<SyncSummary> {
  const summary: SyncSummary = { accounts: 0, points: 0, errors: [] };
  if (!hasAdminDb() || workspaceIds.length === 0) return summary;

  const db = getAdminDb();
  const { data: accounts, error } = await db
    .from("instagram_accounts")
    .select("id, workspace_id, instagram_id, access_token")
    .in("workspace_id", workspaceIds)
    .not("access_token", "is", null);

  if (error) {
    summary.errors.push(`Could not load accounts: ${error.message}`);
    return summary;
  }

  for (const account of accounts ?? []) {
    summary.accounts++;
    try {
      if (!account.access_token) continue;
      const token = decryptToken(account.access_token);
      const result = await fetchAccountInsights(token, account.instagram_id);
      if (!result.success) {
        summary.errors.push(`${account.instagram_id}: ${result.error ?? "insights unavailable"}`);
        continue;
      }

      const { error: upsertError } = await db.from("insight_snapshots").upsert(
        result.points.map((point) => ({
          workspace_id: account.workspace_id,
          instagram_account_id: account.id,
          day: point.day,
          metric: point.metric,
          value: Math.round(point.value),
        })),
        { onConflict: "instagram_account_id,day,metric" }
      );
      if (upsertError) throw upsertError;
      summary.points += result.points.length;
    } catch (error) {
      summary.errors.push(
        `${account.instagram_id}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  return summary;
}
