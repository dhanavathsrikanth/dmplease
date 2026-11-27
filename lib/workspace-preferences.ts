import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEK_START,
  normalizeTimeZone,
  normalizeWeekStart,
} from "@/lib/timezone";

export interface WorkspacePreferences {
  timezone: string;
  weekStartsOn: number;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  timezone: DEFAULT_TIMEZONE,
  weekStartsOn: DEFAULT_WEEK_START,
};

/** Loads the workspace clock used by every analytics surface. */
export async function getWorkspacePreferences(
  workspaceId: string
): Promise<WorkspacePreferences> {
  if (!hasAdminDb()) return { ...DEFAULT_WORKSPACE_PREFERENCES };
  try {
    const { data } = await getAdminDb()
      .from("workspaces")
      .select("timezone, week_starts_on")
      .eq("id", workspaceId)
      .maybeSingle();
    return {
      timezone: normalizeTimeZone(data?.timezone),
      weekStartsOn: normalizeWeekStart(data?.week_starts_on),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFERENCES };
  }
}

const TIMEZONE_CACHE_TTL_MS = 60_000;
const timezoneCache = new Map<string, { value: string; expiresAt: number }>();

/**
 * Hot-path variant for metric recording. Caches the timezone for a minute so a
 * burst of webhook events does not issue one query per event.
 */
export async function getWorkspaceTimeZone(workspaceId: string): Promise<string> {
  const cached = timezoneCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const preferences = await getWorkspacePreferences(workspaceId);
  timezoneCache.set(workspaceId, {
    value: preferences.timezone,
    expiresAt: Date.now() + TIMEZONE_CACHE_TTL_MS,
  });
  return preferences.timezone;
}
