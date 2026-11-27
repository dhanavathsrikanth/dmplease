# Proposal — Account Safety Engine (LinkPlease parity + honest transparency)

> **Status:** proposal — not yet implemented. Companion to `FEATURE_IMPLEMENTATION_AUDIT.md`.
> **Goal:** match LinkPlease's marketed "Safety Engine" with measured, honest
> numbers and exceed it with the transparency LinkPlease's mockup does not have.

---

## 1. What LinkPlease's Safety Engine claims to do

From the homepage (`/#safety`) and pricing FAQ, LinkPlease's safety layer is:

1. **Smart rate-limiting** — "Messages are intelligently paced so you never hit Meta limits."
2. **Viral spike regulation** — "We automatically throttle delivery during viral spikes to stay safe."
3. **AI message rotation** — "AI-generated variants ensure you never send identical replies." (Super plan)
4. **Official Graph API** — "100% official Meta API integration. No password sharing, ever." (Meta Verified Tech Provider)
5. **IG Shield — AI account protection** — "Adds AI-powered safeguards for accounts operating at higher volume." (Max plan, $899/mo)
6. **Live dashboard** — a "LinkPlease Safety Engine — Live" mockup showing:
   - "Sending at a steady, human pace"
   - "Trigger → Smart-wait queue → AI variant → Graph API → Delivered"
   - 12 in queue, 100% delivered, 0 limit breaches
   - "Sends per minute vs Meta rate limit" demand gauge

FAQ answers:
- *Is LinkPlease safe?* — "100% official Meta Graph API", Meta Verified Tech Provider.
- *What happens if a post goes viral?* — "LinkPlease detects the surge and paces delivery instead of sending thousands of DMs at once."
- *How does the AI protection actually work?* — (accordion, not expanded in HTML)

Plan gating: the basic safety engine is on **every** plan including Free. "AI protection" (IG Shield) is Max-plan only.

## 2. Our current state (honest parity)

| Capability | Our state | LinkPlease claim | Gap |
|---|---|---|---|
| Official Graph API, no password sharing | ✅ Yes | ✅ Yes | None |
| Meta Tech Provider badge | ⚠️ Not applied | ✅ Yes | Business action, not code |
| Token bucket hourly cap | ✅ `acquireSendSlot` | ✅ "Smart rate-limiting" | None |
| Recipient cooldown (10 min/post) | ✅ `checkRecipientCooldown` | ✅ | None |
| 24h dedupe | ✅ dm_logs check | ✅ | None |
| Jitter | ✅ `randomizedDelay(50,350)` | ✅ "human-like pauses" | None |
| Variant rotation | ✅ `chooseVariant` + history | ✅ "AI message rotation" | Ours is deterministic rotation, not AI-generated |
| Viral spike detection | ✅ `isViralSpike` | ✅ "Viral spike regulation" | **We only add jitter (500–2000ms), no real throttle** |
| Smart-wait queue | ✅ QStash + `pending_dms` | ✅ "Smart-wait queue" | None (now durable) |
| Live safety dashboard | ⚠️ One "Safety sends (24h)" number | ✅ Live dashboard mockup | **No dashboard at all** |
| Account health monitoring | ❌ None | ⚠️ "IG Shield" (paid) | **Missing** |
| Block/spam/opt-out handling | ❌ None | ❌ None | Opportunity |
| Safety score / risk indicator | ❌ None | ❌ None | Opportunity |
| Fail-open paths | ⚠️ Follower check, dedupe, cooldown fail open | ⚠️ Unknown | Ours needs tightening |

## 3. Design proposal — make it real and honest

Principle: **measure, don't mock.** LinkPlease's dashboard numbers are marketing. Ours should be computed from `safety_events`, `dm_logs`, `queue` state and Meta rate-limit headers, and the creator should be able to see *why* a send was delayed.

### 3.1 Proactive viral-spike throttle (fix the gap)

Current: `isViralSpike` → `jitter(500, 2000)` (a one-time pause). During a spike this does nothing to the *rate*.

Proposed: a per-account throttle controller:

```
lib/meta/throttle.ts (new)
  - recordCommentVelocity(accountId, count)  // sliding window in Redis
  - throttleLevel(accountId): "normal" | "elevated" | "critical"
  - acquireThrottleSlot(accountId): { allowed, delayMs, reason }
```

- Redis key `throttle:velocity:{accountId}` = sliding window of comment counts (1 min).
- Thresholds: 25 comments/min = elevated (add 2–5s jitter, halve send rate), 100/min = critical (queue everything, send 1 per 10s).
- `sendCommentDm` calls `acquireThrottleSlot` *before* `acquireSendSlot`; if throttled, park in the DM queue (already durable) with `next_attempt_at = now + delay`.
- Expose the current level in the dashboard.

### 3.2 Real live safety dashboard

A new component/page (or a section on Overview) showing, per workspace/account:

- **Sends per minute vs Meta limit** — from `safety_events` + `dm_logs` (Redis counters for the current minute; durable flush).
- **Queue depth** — pending rows in `pending_dms` (already have `getQueueStats`).
- **Delivery rate (24h)** — `SENT / (SENT + FAILED)` from `dm_logs`.
- **Limit breaches (24h)** — count of `safety_events` where `kind = 'rate_limit_breach'` (recorded when `acquireSendSlot` returns false).
- **Throttle events (24h)** — count of `safety_events` `kind = 'viral_throttle'`.
- **Last successful send** and **consecutive failures** (account health).
- **Token health** — already tracked by `markTokenInvalid`; surface it.

Data source: a new `/api/dashboard/safety` route that aggregates Redis counters (current minute) + DB (24h). Redis counters keyed `safety:minute:{accountId}:{YYYYMMDDHHmm}` with 2-min TTL.

### 3.3 Account health monitor

```
lib/meta/account-health.ts (new)
  - recordSendOutcome(accountId, outcome: 'sent'|'failed'|'throttled'|'rate_limited')
  - getAccountHealth(accountId): { status, consecutiveFailures, lastSendAt, lastError, tokenStatus }
  - shouldPause(accountId): boolean  // e.g. 5 consecutive failures → auto-pause
```

- Store in Redis with a 24h TTL; durable snapshot in `instagram_accounts` (add `consecutive_failures`, `last_send_at`, `last_error` columns).
- Auto-pause: if 5 consecutive failures → set `automations.active = false` for that workspace's automations? Too aggressive. Instead: set a `paused_reason` on the account and show a banner; creator decides. Actually better: keep sending paused at the account level (a `safety_paused` flag) with a clear "Resume" button. Never silently disable automations.
- Alert: when `consecutiveFailures >= 3`, create an `admin_alerts` row (already have the table) and capture PostHog event.

### 3.4 Opt-out / STOP handling

Meta requires honoring "STOP" / "unsubscribe" requests. Add:
- A keyword rule in `selectInboundRule` / `processDirectRule` that detects opt-out keywords (`stop`, `unsubscribe`, `stop all`, `cancel`) in inbound DMs.
- On match: set `contacts.opted_out_at`, write `followup_events` `opted_out` for all pending follow-ups, skip all future DMs (check `opted_out_at` in `ensureContact`/send paths), and reply with a confirmation ("You've been unsubscribed. Reply START to re-subscribe.").
- Re-subscribe on `start`/`subscribe`.

This is a compliance requirement, not a nice-to-have, and LinkPlease does not market it publicly — an opportunity.

### 3.5 Honest "AI protection" (IG Shield equivalent)

LinkPlease's IG Shield is a paid, opaque feature. We should ship a transparent version:
- **Pre-send validator** (already exists as `validateAutomationInput`, but unused at runtime). Wire it into campaign creation/update so loops, duplicates, >3 links are rejected with field-level errors.
- **Rate-limit breach counter** per account, surfaced in the dashboard.
- **Send-time guards** already in place: hourly cap, recipient cooldown, 24h dedupe, viral spike, variant rotation.
- **No silent fail-open**: follower check, dedupe and cooldown currently fail open. Make them fail-closed where safe (e.g., dedupe failure → treat as already contacted, cooldown failure → allow but log). Document the policy per guard.

### 3.6 Safety dashboard UI

A new section on `/dashboard/overview` (or a dedicated `/dashboard/safety` page) with:
- Live gauge: "Sends per minute: 12 / 60 (Meta limit)".
- Queue depth + oldest queued age.
- 24h delivery rate, breaches, throttle events.
- Account health card with token status, consecutive failures, last send.
- "Pause safety" / "Resume" button (sets `safety_paused`).
- Recent safety events list (from `safety_events`).

Accessibility: real `<label>`/`aria-live` for live counters, `role="status"` for updates, keyboard operable, no color-only meaning (use text + icon).

## 4. Scalability considerations

| Concern | Approach |
|---|---|
| Redis counters per minute | TTL 2 min, auto-expire; no cleanup job. |
| `safety_events` volume | Already indexed; add a 30-day retention cron. |
| Per-account state | Redis primary, DB snapshot on change (not every send). |
| Throttle during spikes | Queue in `pending_dms` with `next_attempt_at` (already durable). |
| Cross-instance consistency | Redis is the source of truth; in-process caches are fallbacks only. |
| Fail-open vs fail-closed | Document per guard; default to fail-closed for dedupe, fail-open for cooldown (Meta's API is the final authority). |

## 5. Phased plan

- **Phase 1 (1–2 weeks):** Proactive throttle (`lib/meta/throttle.ts`), breach counting in `safety_events`, wire `validateAutomationInput` into campaign creation, tighten fail-open paths. No new schema except `safety_events.kind` values.
- **Phase 2 (2–3 weeks):** Account health monitor + auto-pause banner, opt-out/STOP handling, RLS-verified safety dashboard on Overview.
- **Phase 3 (3–4 weeks):** Dedicated `/dashboard/safety` page with live gauge, queue depth, recent events; safety score (composite); retention cron; tests.

## 6. What we should NOT do

- Claim "AI protection" as a paid feature without real AI — LinkPlease's IG Shield is opaque marketing. Our transparent, measured version is the differentiator.
- Block sends silently. Every throttle or pause must be visible and reversible by the creator.
- Add a new paid tier just for safety. Safety is the core product, not an upsell.

## 7. Recommendation

Start with Phase 1: it closes the one real gap (viral spikes only add jitter) and gives us breach counting, which every later phase depends on. The dashboard (Phase 2) is what turns this into the "honest safety" positioning we already claim in the audit doc.

---

## 8. Cross-check against our existing safety code

Already implemented (do not re-build):
- `lib/meta/safety.ts`: `checkRateLimit`, `acquireSendSlot`, `checkRecipientCooldown`, `isViralSpike`, `pickVariant`/`chooseVariant`, `randomizedDelay`, `validateAutomationInput`, `isWithinWindow`.
- `lib/meta/webhook-processor.ts`: `recordSafety()`, `markTokenInvalid()`, `jitter()`, `withRetry()`.
- `lib/dm-queue.ts`: durable overflow with backoff.
- `safety_events` table + diagnostics page showing safety sends (24h).

To build: `lib/meta/throttle.ts`, `lib/meta/account-health.ts`, opt-out handling in `processDirectRule`, safety dashboard UI, retention cron.