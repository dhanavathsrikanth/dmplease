import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import {
  fetchAccountInsights,
  fetchGrantedScopes,
  fetchMediaInsights,
  fetchRecentMedia,
  hasInsightsScope,
  type InsightPoint,
  type MediaItem,
} from "@/lib/meta/insights";

export interface SyncSummary {
  accounts: number;
  points: number;
  media: number;
  needsAccess: number;
  errors: string[];
}

interface AccountRow {
  id: string;
  workspace_id: string;
  instagram_id: string;
  access_token: string | null;
  granted_scopes: string[] | null;
}

interface SnapshotRow {
  workspace_id: string;
  instagram_account_id: string;
  day: string;
  metric: string;
  value: number;
  media_id: string;
  scope: "account" | "media";
  product_type: string | null;
  permalink: string | null;
  caption: string | null;
}

function accountSnapshots(
  account: AccountRow,
  points: InsightPoint[]
): SnapshotRow[] {
  return points.map((point) => ({
    workspace_id: account.workspace_id,
    instagram_account_id: account.id,
    day: point.day,
    metric: point.metric,
    value: Math.round(point.value),
    media_id: "",
    scope: "account",
    product_type: null,
    permalink: null,
    caption: null,
  }));
}

function mediaSnapshots(
  account: AccountRow,
  media: MediaItem,
  points: InsightPoint[]
): SnapshotRow[] {
  return points.map((point) => ({
    workspace_id: account.workspace_id,
    instagram_account_id: account.id,
    day: point.day,
    metric: point.metric,
    value: Math.round(point.value),
    media_id: media.id,
    scope: "media",
    product_type: media.productType,
    permalink: media.permalink,
    caption: media.caption,
  }));
}

async function persistSnapshots(rows: SnapshotRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getAdminDb();
  // Chunk to stay well under Supabase's payload limits.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db
      .from("insight_snapshots")
      .upsert(chunk, { onConflict: "instagram_account_id,day,metric,media_id" });
    if (error) throw error;
  }
}

async function updateAccountStatus(
  accountId: string,
  status: "ok" | "needs_access" | "error",
  error: string | null
): Promise<void> {
  const db = getAdminDb();
  await db
    .from("instagram_accounts")
    .update({
      insights_status: status,
      insights_error: error,
      insights_last_synced_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

/** Fetches and stores daily account + per-media insights for the workspaces. */
export async function refreshInsightsForWorkspaces(
  workspaceIds: string[]
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    accounts: 0,
    points: 0,
    media: 0,
    needsAccess: 0,
    errors: [],
  };
  if (!hasAdminDb() || workspaceIds.length === 0) return summary;

  const db = getAdminDb();
  const { data: accounts, error } = await db
    .from("instagram_accounts")
    .select("id, workspace_id, instagram_id, access_token, granted_scopes")
    .in("workspace_id", workspaceIds)
    .not("access_token", "is", null);

  if (error) {
    summary.errors.push(`Could not load accounts: ${error.message}`);
    return summary;
  }

  for (const raw of (accounts ?? []) as AccountRow[]) {
    summary.accounts++;
    try {
      if (!raw.access_token) continue;
      const token = decryptToken(raw.access_token);

      // 1. Resolve scopes once and cache them on the account.
      let scopes = raw.granted_scopes ?? [];
      if (scopes.length === 0) {
        const fetched = await fetchGrantedScopes(token);
        if (fetched) {
          scopes = fetched;
          await db
            .from("instagram_accounts")
            .update({ granted_scopes: fetched })
            .eq("id", raw.id);
        }
      }

      // 2. Never call Insights without the permission.
      if (scopes.length > 0 && !hasInsightsScope(scopes)) {
        summary.needsAccess++;
        await updateAccountStatus(
          raw.id,
          "needs_access",
          "instagram_manage_insights was not granted. Reconnect the account and approve Insights access."
        );
        continue;
      }

      // 3. Account-level daily snapshots.
      const accountResult = await fetchAccountInsights(token, raw.instagram_id);
      if (!accountResult.success) {
        if (accountResult.needsAccess) {
          summary.needsAccess++;
          await updateAccountStatus(
            raw.id,
            "needs_access",
            accountResult.error ?? "Insights permission missing"
          );
        } else {
          summary.errors.push(
            `${raw.instagram_id}: ${accountResult.error ?? "insights unavailable"}`
          );
          await updateAccountStatus(
            raw.id,
            "error",
            accountResult.error ?? "insights unavailable"
          );
        }
        continue;
      }

      const accountRows = accountSnapshots(raw, accountResult.points);
      await persistSnapshots(accountRows);
      summary.points += accountRows.length;

      // 4. Per-media snapshots (posts, reels, stories).
      const mediaResult = await fetchRecentMedia(token, raw.instagram_id);
      if (mediaResult.success) {
        for (const media of mediaResult.media) {
          const mediaInsights = await fetchMediaInsights(
            token,
            media.id,
            media.productType
          );
          if (!mediaInsights.success) {
            if (mediaInsights.needsAccess) {
              summary.needsAccess++;
              break;
            }
            continue;
          }
          const rows = mediaSnapshots(raw, media, mediaInsights.points);
          await persistSnapshots(rows);
          summary.points += rows.length;
          summary.media++;
        }
      } else if (mediaResult.needsAccess) {
        summary.needsAccess++;
      } else if (mediaResult.error) {
        summary.errors.push(`${raw.instagram_id} media: ${mediaResult.error}`);
      }

      await updateAccountStatus(raw.id, "ok", null);
    } catch (error) {
      summary.errors.push(
        `${raw.instagram_id}: ${error instanceof Error ? error.message : "unknown"}`
      );
      await updateAccountStatus(
        raw.id,
        "error",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  return summary;
}
