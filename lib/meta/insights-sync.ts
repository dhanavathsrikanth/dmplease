import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import { fetchAccountInsights } from "@/lib/meta/insights";
import { hasDatabaseUrl } from "@/lib/config";

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
  if (!hasDatabaseUrl() || workspaceIds.length === 0) return summary;

  let accounts: Array<{
    id: string;
    workspace_id: string;
    instagram_id: string;
    access_token: string | null;
  }>;

  try {
    accounts = await prisma.$queryRaw<
      Array<{
        id: string;
        workspace_id: string;
        instagram_id: string;
        access_token: string | null;
      }>
    >`
      SELECT id::text, workspace_id::text, instagram_id, access_token
      FROM instagram_accounts
      WHERE workspace_id = ANY(${workspaceIds}::uuid[]) AND access_token IS NOT NULL
    `;
  } catch (error) {
    summary.errors.push(
      `Could not load accounts: ${error instanceof Error ? error.message : "unknown"}`
    );
    return summary;
  }

  for (const account of accounts) {
    summary.accounts++;
    try {
      const token = decryptToken(account.access_token!);
      const result = await fetchAccountInsights(token, account.instagram_id);
      if (!result.success) {
        summary.errors.push(`${account.instagram_id}: ${result.error ?? "insights unavailable"}`);
        continue;
      }

      for (const point of result.points) {
        await prisma.$executeRaw`
          INSERT INTO insight_snapshots (workspace_id, instagram_account_id, day, metric, value)
          VALUES (
            ${account.workspace_id}::uuid, ${account.id}::uuid,
            ${point.day}::date, ${point.metric}, ${BigInt(Math.round(point.value))}
          )
          ON CONFLICT (instagram_account_id, day, metric)
          DO UPDATE SET value = EXCLUDED.value, recorded_at = now()
        `;
        summary.points++;
      }
    } catch (error) {
      summary.errors.push(
        `${account.instagram_id}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  return summary;
}
