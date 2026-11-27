/**
 * Short-link resolution and rotation for outbound DMs.
 *
 * Creates genuinely short (8-character) URLs because Instagram does not
 * linkify the long signed tokens the old `/go` route used. Codes are stable per
 * (scope, recipient, destination), so retries cannot create duplicates and a
 * follower keeps seeing the same destination.
 */

import { createHmac } from "crypto";

import { cleanEnv, getVaultSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import {
  selectTargetIndex,
  type LinkRotationMode,
} from "@/lib/link-rotation";

const CACHE_TTL_SECONDS = 5 * 60;
const CODE_LENGTH = 8;

interface TrackedLinkRow {
  id: string;
  workspace_id: string;
  automation_id: string | null;
  rotator_id: string | null;
  target_id: string | null;
  contact_id: string | null;
  short_code: string;
  destination_url: string;
  label: string | null;
  post_id: string | null;
  keyword: string | null;
  sequence_step: number | null;
  active: boolean;
}

interface RotatorRow {
  id: string;
  workspace_id: string;
  mode: LinkRotationMode;
}
interface TargetRow {
  id: string;
  destination_url: string;
  enabled: boolean;
  position: number;
}

export interface ResolvedLink {
  /** The URL to put in the DM (short and clickable). */
  url: string;
  destination: string;
  shortCode: string | null;
  targetId: string | null;
}

export function shortLinkBase(): string {
  const custom = cleanEnv("SHORT_LINK_DOMAIN");
  if (custom) return custom.replace(/\/+$/, "");
  return `${cleanEnv("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, "")}/go`;
}

function makeCode(scope: string, recipientId: string, suffix = ""): string {
  const digest = createHmac("sha256", getVaultSecret())
    .update(`${scope}:${recipientId}:${suffix}`)
    .digest("base64url");
  return digest.replace(/[^A-Za-z0-9]/g, "").slice(0, CODE_LENGTH);
}

async function cacheGet<T>(key: string): Promise<T | null> {
  if (!hasUpstashRedis()) return null;
  try {
    return await getRedis().get<T>(key);
  } catch {
    return null;
  }
}

async function cacheSet<T>(key: string, value: T): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().set(key, value, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Cache is an optimisation.
  }
}

async function loadTrackedLink(code: string): Promise<TrackedLinkRow | null> {
  const cached = await cacheGet<TrackedLinkRow>(`shortlink:${code}`);
  if (cached?.destination_url) return cached;
  if (!hasAdminDb()) return null;
  const { data } = await getAdminDb()
    .from("tracked_links")
    .select("*")
    .eq("short_code", code)
    .eq("active", true)
    .maybeSingle();
  const row = (data as TrackedLinkRow | null) ?? null;
  if (row) await cacheSet(`shortlink:${row.short_code}`, row);
  return row;
}

async function loadRotator(
  workspaceId: string,
  rotatorId: string
): Promise<{ rotator: RotatorRow; targets: TargetRow[] } | null> {
  if (!hasAdminDb()) return null;
  const cacheKey = `rotator:${rotatorId}`;
  const cached = await cacheGet<{ rotator: RotatorRow; targets: TargetRow[] }>(cacheKey);
  if (cached?.rotator && cached.targets) return cached;

  const { data: rotator } = await getAdminDb()
    .from("link_rotators")
    .select("id, workspace_id, mode")
    .eq("id", rotatorId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!rotator) return null;
  const { data: targets } = await getAdminDb()
    .from("link_rotator_targets")
    .select("id, destination_url, enabled, position")
    .eq("rotator_id", rotatorId)
    .order("position", { ascending: true });
  const value = {
    rotator: rotator as RotatorRow,
    targets: (targets ?? []) as TargetRow[],
  };
  await cacheSet(cacheKey, value);
  return value;
}

async function getOrCreateLink(input: {
  workspaceId: string;
  automationId?: string | null;
  rotatorId: string | null;
  targetId: string | null;
  contactId: string | null;
  recipientId: string;
  destination: string;
  label: string | null;
  postId?: string | null;
  keyword?: string | null;
  sequenceStep?: number | null;
}): Promise<string> {
  const scope = input.rotatorId
    ? `rotator:${input.rotatorId}:${input.targetId ?? ""}`
    : `auto:${input.automationId ?? "workspace"}`;
  const code = makeCode(scope, input.recipientId);
  const existing = await loadTrackedLink(code);
  if (existing?.destination_url === input.destination) return existing.short_code;

  if (hasAdminDb()) {
    await getAdminDb()
      .from("tracked_links")
      .upsert(
        {
          workspace_id: input.workspaceId,
          automation_id: input.automationId ?? null,
          rotator_id: input.rotatorId ?? null,
          target_id: input.targetId ?? null,
          contact_id: input.contactId ?? null,
          short_code: code,
          destination_url: input.destination,
          label: input.label,
          post_id: input.postId ?? null,
          keyword: input.keyword ?? null,
          sequence_step: input.sequenceStep ?? null,
          active: true,
        },
        { onConflict: "short_code", ignoreDuplicates: true }
      );
    const row = await loadTrackedLink(code);
    if (row) return row.short_code;
  }
  // Without a database we still return a stable short code for local dev.
  return code;
}

export async function resolveCampaignLink(input: {
  workspaceId: string;
  automationId: string;
  recipientId: string;
  contactId?: string | null;
  destination: string;
  shortLinksEnabled?: boolean;
  linkRotatorId?: string | null;
  postId?: string | null;
  keyword?: string | null;
  sequenceStep?: number | null;
  /** Always create a tracked link (used for the campaign button CTA). */
  forceTrack?: boolean;
}): Promise<ResolvedLink> {
  if ((!input.shortLinksEnabled && !input.forceTrack) || !hasAdminDb()) {
    return {
      url: input.destination,
      destination: input.destination,
      shortCode: null,
      targetId: null,
    };
  }

  let destination = input.destination;
  let label: string | null = null;
  let targetId: string | null = null;

  if (input.linkRotatorId) {
    const loaded = await loadRotator(input.workspaceId, input.linkRotatorId);
    if (loaded) {
      let counter = 0;
      if (loaded.rotator.mode === "round_robin" && hasUpstashRedis()) {
        try {
          counter = (await getRedis().incr(`linkrot:${loaded.rotator.id}`)) - 1;
        } catch {
          counter = 0;
        }
      }
      const index = selectTargetIndex({
        targets: loaded.targets,
        mode: loaded.rotator.mode,
        scopeKey: loaded.rotator.id,
        recipientId: input.recipientId,
        counter,
      });
      const target = index >= 0 ? loaded.targets.filter((t) => t.enabled)[index] : null;
      if (target) {
        destination = target.destination_url;
        label = `Rotated link ${index + 1}`;
        targetId = target.id;
      }
    }
  }

  const code = await getOrCreateLink({
    workspaceId: input.workspaceId,
    automationId: input.automationId,
    rotatorId: input.linkRotatorId ?? null,
    targetId,
    contactId: input.contactId ?? null,
    recipientId: input.recipientId,
    destination,
    label,
    postId: input.postId,
    keyword: input.keyword,
    sequenceStep: input.sequenceStep,
  });

  return {
    url: `${shortLinkBase()}/${code}`,
    destination,
    shortCode: code,
    targetId,
  };
}

export async function findTrackedLink(
  code: string
): Promise<TrackedLinkRow | null> {
  return loadTrackedLink(code);
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface ClickRecord {
  workspace_id: string;
  automation_id: string | null;
  contact_id: string | null;
  token: string;
  referrer: string | null;
  post_id: string | null;
  keyword: string | null;
  sequence_step: number | null;
  destination_host: string | null;
  clicked_at: string;
  is_bot: boolean;
  event_id: string;
  user_agent: string | null;
}

const CLICK_BUFFER_KEY = "link_clicks:buffer";

/**
 * Records a click. Returns true when it is durably stored. If the database
 * write fails, the event is pushed to a Redis buffer so the cron flusher can
 * replay it — a click is never silently lost.
 */
export async function recordTrackedLinkClick(input: {
  link: TrackedLinkRow;
  referrer: string | null;
  userAgent: string;
  eventId: string;
}): Promise<boolean> {
  const row: ClickRecord = {
    workspace_id: input.link.workspace_id,
    automation_id: input.link.automation_id,
    contact_id: input.link.contact_id,
    token: input.link.short_code,
    referrer: input.referrer,
    post_id: input.link.post_id,
    keyword: input.link.keyword,
    sequence_step: input.link.sequence_step,
    destination_host: safeHostname(input.link.destination_url),
    clicked_at: new Date().toISOString(),
    is_bot: /bot|crawler|spider|facebookexternalhit|preview/i.test(
      input.userAgent
    ),
    event_id: input.eventId,
    user_agent: input.userAgent.slice(0, 500) || null,
  };

  if (hasAdminDb()) {
    try {
      const { error } = await getAdminDb()
        .from("link_clicks")
        .upsert(row, { onConflict: "event_id", ignoreDuplicates: true });
      if (!error) return true;
      console.warn("[tracking] Click insert failed, buffering:", error.message);
    } catch (error) {
      console.warn("[tracking] Click insert threw, buffering:", error);
    }
  }

  if (hasUpstashRedis()) {
    try {
      await getRedis().lpush(CLICK_BUFFER_KEY, JSON.stringify(row));
      return true;
    } catch (error) {
      console.warn("[tracking] Could not buffer click:", error);
    }
  }
  return false;
}

/** Drains the Redis click buffer into `link_clicks`. Returns the flushed count. */
export async function flushBufferedClicks(limit = 500): Promise<number> {
  if (!hasAdminDb() || !hasUpstashRedis()) return 0;
  const db = getAdminDb();
  let flushed = 0;
  for (let i = 0; i < limit; i++) {
    let raw: string | null = null;
    try {
      raw = await getRedis().rpop<string>(CLICK_BUFFER_KEY);
    } catch {
      break;
    }
    if (!raw) break;
    try {
      const row = (typeof raw === "string" ? JSON.parse(raw) : raw) as ClickRecord;
      const { error } = await db
        .from("link_clicks")
        .upsert(row, { onConflict: "event_id", ignoreDuplicates: true });
      if (error) {
        // Put it back and stop; the next run will retry.
        await getRedis().rpush(CLICK_BUFFER_KEY, raw);
        break;
      }
      flushed++;
    } catch (error) {
      console.warn("[tracking] Could not flush buffered click:", error);
    }
  }
  return flushed;
}
