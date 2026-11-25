For a LinkPlease / Zorcha alternative with **30,000 monthly active users**, creator link-in-bio pages are read on every profile/link visit and keyword trigger rules are evaluated on every incoming Instagram comment or DM. Caching both in **Upstash Redis** keeps page loads and webhook rule matching fast while slashing database reads.

The cleanest pattern combines:

1. **Cache-aside reads (`getOrSet`)** with explicit TTLs (`ex`) so stale data cannot linger forever even if a delete fails.
2. **A short stampede-prevention lock** (or clean invalidation helper) on dashboard writes (`invalidateCreatorCache`) so updating a link, bio theme, or keyword trigger in your Next.js dashboard immediately evicts the stale cache entries.

---

### 1. Data Shapes & Cache Keys (`lib/creator-cache.ts`)

Keep cached objects compact (only what the public page or webhook matcher actually needs) and namespace keys clearly per creator handle (`handle`) and Instagram account ID (`creatorIgId`).

```typescript
import { redis } from "./redis";

export interface LinkItem {
  id: string;
  label: string;
  url: string;
  thumbnailUrl?: string;
}

export interface CreatorBioConfig {
  creatorId: string;
  creatorIgId: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: "light" | "dark" | "minimal";
  links: LinkItem[];
  updatedAt: string;
}

export interface KeywordTriggerRule {
  id: string;
  mediaId?: string | null; // null/undefined = applies to all posts/reels, or specific post ID
  keywords: string[];     // normalized lowercase keywords, e.g. ["link", "price", "guide"]
  matchMode: "exact" | "contains";
  dmText: string;
  linkUrl?: string;
  followupText?: string;
  followupDelaySeconds?: number;
  isActive: boolean;
}

export const CACHE_KEYS = {
  bioByHandle: (handle: string) => `bio:handle:${handle.toLowerCase()}`,
  triggersByCreatorIgId: (creatorIgId: string) =>
    `triggers:ig:${creatorIgId}`,
  // Optional reverse lookup so dashboard edits by creatorId/handle can evict triggers too
  igIdByCreatorId: (creatorId: string) => `map:creator_ig:${creatorId}`,
};

const BIO_TTL_SECONDS = 3600;      // 1 hour fallback TTL
const TRIGGERS_TTL_SECONDS = 3600; // 1 hour fallback TTL

```

---

### 2. Cache-Aside Readers & Invalidation Helper (`lib/creator-cache.ts`)

Add these functions to `lib/creator-cache.ts`. Notice how `invalidateCreatorCache` clears both the public link-in-bio cache and the keyword trigger cache whenever a creator saves changes in the dashboard.

```typescript
// Replace these with your database queries (Postgres / Prisma / Drizzle)
async function fetchBioConfigFromDb(
  handle: string
): Promise<CreatorBioConfig | null> {
  return null;
}

async function fetchKeywordTriggersFromDb(
  creatorIgId: string
): Promise<KeywordTriggerRule[]> {
  return [];
}

/**
 * Reads creator link-in-bio config from Redis; populates on miss.
 */
export async function getCachedBioConfig(
  handle: string
): Promise<CreatorBioConfig | null> {
  const normalizedHandle = handle.trim().toLowerCase();
  const key = CACHE_KEYS.bioByHandle(normalizedHandle);

  const cached = await redis.get<CreatorBioConfig>(key);
  if (cached) {
    return cached;
  }

  const fresh = await fetchBioConfigFromDb(normalizedHandle);
  if (!fresh) {
    return null;
  }

  // Keep handle -> creatorIgId mapping handy for fast invalidation
  await Promise.all([
    redis.set(key, fresh, { ex: BIO_TTL_SECONDS }),
    redis.set(CACHE_KEYS.igIdByCreatorId(fresh.creatorId), fresh.creatorIgId, {
      ex: BIO_TTL_SECONDS * 24,
    }),
  ]);

  return fresh;
}

/**
 * Reads active keyword trigger rules for an Instagram account from Redis; populates on miss.
 */
export async function getCachedKeywordTriggers(
  creatorIgId: string
): Promise<KeywordTriggerRule[]> {
  const key = CACHE_KEYS.triggersByCreatorIgId(creatorIgId);

  const cached = await redis.get<KeywordTriggerRule[]>(key);
  if (cached) {
    return cached;
  }

  const fresh = await fetchKeywordTriggersFromDb(creatorIgId);
  await redis.set(key, fresh, { ex: TRIGGERS_TTL_SECONDS });

  return fresh;
}

/**
 * Invalidates cached link-in-bio and keyword trigger entries after a dashboard update.
 */
export async function invalidateCreatorCache(params: {
  handle?: string;
  creatorIgId?: string;
  creatorId?: string;
}) {
  const keysToDelete: string[] = [];

  if (params.handle) {
    keysToDelete.push(CACHE_KEYS.bioByHandle(params.handle));
  }

  let resolvedIgId = params.creatorIgId;
  if (!resolvedIgId && params.creatorId) {
    const mapped = await redis.get<string>(
      CACHE_KEYS.igIdByCreatorId(params.creatorId)
    );
    if (mapped) {
      resolvedIgId = mapped;
    }
  }

  if (resolvedIgId) {
    keysToDelete.push(CACHE_KEYS.triggersByCreatorIgId(resolvedIgId));
  }

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}

```

---

### 3. Invalidating Cache on Dashboard Updates (Next.js Server Action / Route)

Call `invalidateCreatorCache(...)` right after your database update succeeds so the next visitor load or incoming comment immediately fetches fresh data from your database and re-caches it.

```typescript
// app/actions/update-creator-settings.ts
"use server";

import { revalidatePath } from "next/cache";
import { invalidateCreatorCache } from "@/lib/creator-cache";

interface UpdateSettingsInput {
  creatorId: string;
  creatorIgId: string;
  handle: string;
  bio: string;
  theme: "light" | "dark" | "minimal";
}

// Replace with your real DB mutation
async function persistCreatorSettingsToDb(_input: UpdateSettingsInput) {
  // UPDATE creators SET bio = ..., theme = ... WHERE id = ...
}

export async function updateCreatorSettings(input: UpdateSettingsInput) {
  await persistCreatorSettingsToDb(input);

  // 1. Evict Upstash Redis cache keys
  await invalidateCreatorCache({
    creatorId: input.creatorId,
    creatorIgId: input.creatorIgId,
    handle: input.handle,
  });

  // 2. Also revalidate Next.js route/page cache if using static/ISR rendering
  revalidatePath(`/${input.handle}`);

  return { ok: true };
}

```

---

### 4. Matching Keyword Triggers in Your Webhook Pipeline

When an Instagram comment or DM arrives, pull the cached triggers for `creatorIgId` and match normalized text (`text.trim().toLowerCase()`) against active rules scoped to that specific post (`mediaId`) or global rules (`!rule.mediaId`).

```typescript
// lib/match-trigger.ts
import { getCachedKeywordTriggers, type KeywordTriggerRule } from "./creator-cache";

export function findMatchingTrigger(
  triggers: KeywordTriggerRule[],
  params: { commentOrMessageText: string; mediaId?: string }
): KeywordTriggerRule | null {
  const normalizedInput = params.commentOrMessageText.trim().toLowerCase();
  if (!normalizedInput) return null;

  // Prefer post-specific triggers first, then global account triggers
  const candidates = triggers
    .filter((rule) => rule.isActive)
    .filter((rule) => !rule.mediaId || rule.mediaId === params.mediaId)
    .sort((a, b) => (b.mediaId ? 1 : 0) - (a.mediaId ? 1 : 0));

  for (const rule of candidates) {
    const matched = rule.keywords.some((kw) => {
      const target = kw.trim().toLowerCase();
      if (!target) return false;
      if (rule.matchMode === "exact") {
        return normalizedInput === target;
      }
      // Word/phrase check so "link" matches "send me the link!" cleanly
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|\\b|\\s)${escaped}(\\b|\\s|$)`, "i").test(
        normalizedInput
      );
    });

    if (matched) {
      return rule;
    }
  }

  return null;
}

export async function resolveAutomationForEvent(params: {
  creatorIgId: string;
  commentOrMessageText: string;
  mediaId?: string;
}) {
  const triggers = await getCachedKeywordTriggers(params.creatorIgId);
  return findMatchingTrigger(triggers, {
    commentOrMessageText: params.commentOrMessageText,
    mediaId: params.mediaId,
  });
}

```

---

### Key Tips for 30,000 Active Users

* **Delete Rather Than Blindly Overwrite on Race Conditions:** Calling `redis.del(...)` on update ensures concurrent reads/writes don't overwrite a newer dashboard save with slightly older data—the next read cleanly loads the latest database row.
* **Keep Trigger Arrays Lean:** Store only active rules and concise fields in `triggers:ig:${creatorIgId}` so each `redis.get` fetches a tiny JSON payload quickly and stays well under Redis storage limits.
* **Avoid Caching "Not Found" Forever:** If a handle doesn't exist in your database, either don't cache it or use a very short TTL (like `30` to `60` seconds) so newly claimed handles appear right away."
