# dmplease — Product Analytics (beyond GA4)

> **Purpose:** Define what we measure that Google Analytics / GA4 fundamentally cannot, why it matters, and how each signal maps to a product decision.
>
> **PostHog project:** `Default project` (ID `152538`), EU Cloud — `https://eu.i.posthog.com`
> **Status:** Instrumented and verified live on production on 2026-11-26.
> **Last updated:** 2026-11-26

---

## 1. Why GA4 is not enough for dmplease

GA4 is a **browser-session** analytics tool. dmplease's core product value happens **outside the browser**:

| Product reality | GA4 | PostHog |
|---|---|---|
| A follower comments `GUIDE` on Instagram, we send a DM | No JS, no page, no event | Server event `dm_batch_processed` |
| Meta rate-limits an account; QStash retries then dead-letters | Invisible | `dlq_message_created`, `webhook_worker_crashed` |
| An Instagram token expires and refresh fails | Invisible | `token_refresh_completed` with `failed` count |
| A tracked bio link is clicked in a DM (server redirect) | Invisible to page tracking | Aggregate `daily_metrics_flushed` |
| A creator signs up, connects Instagram, then publishes a rule across 3 sessions | Sessions break identity | `identify()` links all steps into one person |
| Which onboarding step creators abandon | Can see pageviews, not in-product steps | Funnel + session replay + dead-click detection |
| Latency of the DM pipeline | Not measured | p95 of `duration_ms` |

**Rule of thumb:** GA4 answers *"how did people find the site?"*. PostHog answers *"did the product actually work, and where do creators get stuck?"*.

---

## 2. Configuration

### Environment variables (Vercel Production + `.env.local` + `.env.example`)

```
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_...   # public project token (safe for client)
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

### Client (`instrumentation-client.ts`)

- `posthog.init()` with `defaults: "2026-08-30"`, `capture_exceptions: true`
- Autocapture, pageviews, web vitals, session replay (inputs masked) are on by default
- `tracing_headers` links browser sessions to server events on `dmplease.vercel.app`, `localhost`, `127.0.0.1`

### Identity (`components/theme-switcher.tsx` → `PostHogAuth`)

- `posthog.identify(user.id, { email })` on auth state change
- `posthog.reset()` on sign-out
- Server events that belong to a creator pass `distinctId: user.id`

### Server (`lib/posthog-server.ts`)

- `captureServerEvent({ event, properties, distinctId?, anonymous? })`
- Creates a `posthog-node` client with `flushAt: 1, flushInterval: 0`
- Flushes in `after()` so serverless invocations never drop queued events
- Missing config is a no-op in production and a loud warning in development
- **Analytics can never break the request it observes** (all capture calls are guarded)

---

## 3. Event taxonomy

### 3.1 Creator lifecycle (client, identified)

| Event | Where | Key properties | Decision it enables |
|---|---|---|---|
| `user_signed_up` | `components/sign-up-form.tsx` | `method`, `user_id` | Signup volume and channel quality |
| `user_signed_in` | `components/login-form.tsx` | `method`, `user_id` | Returning creator activity |
| `onboarding_completed` | `components/onboarding/onboarding-wizard.tsx` | — | Onboarding drop-off |
| `instagram_accounts_connected` | `components/settings/bulk-connect.tsx` | account count | Bulk connect adoption |
| `instagram_account_disconnected` | `components/settings/disconnect-button.tsx` | — | Re-connect prompts |
| `campaign_published` | `components/campaigns/campaign-builder.tsx` | — | First automation activation |
| `campaign_status_changed` | `components/campaigns/campaigns-list.tsx` | status | Pause/resume behaviour |
| `campaign_rerun_queued` | `components/campaigns/campaigns-list.tsx` | — | Re-run feature usage |
| `campaign_deleted` | `components/campaigns/campaigns-list.tsx` | — | Churn signal |
| `inbox_rule_created` / `_updated` / `_deleted` / `_status_changed` | `components/inbox-rules/rule-manager.tsx` | rule id/type | AI FAQ / rule engagement |
| `inbox_reply_sent` | `components/inbox/inbox-interactive-chat.tsx` | — | Human-in-the-loop usage |

### 3.2 Server-side outcomes (the GA4-blind set)

| Event | Where | Key properties | Decision it enables |
|---|---|---|---|
| `instagram_account_connected` | `app/api/auth/meta/callback/route.ts` | `provider`, `accounts_connected`, `workspaces_created`, `distinctId = userId` | OAuth success rate; links to activation funnel |
| `dm_batch_processed` | `app/api/workers/qstash/route.ts` | `sent`, `skipped`, `failed`, `transient_failures`, `permanent_failures`, `duration_ms` | **Core product loop**: did comments become DMs? |
| `webhook_worker_crashed` | `app/api/workers/qstash/route.ts` | `error_name`, `duration_ms` | Worker reliability regressions |
| `queue_publish_failed` | `app/api/webhook/route.ts` | `error_name`, `has_event_id` | Queue saturation / config errors |
| `dlq_message_created` | `app/api/workers/qstash-failed/route.ts` | `source: qstash` | Permanently lost automations |
| `token_refresh_completed` | `app/api/cron/refresh-tokens/route.ts` | `processed`, `refreshed`, `failed` | Expiring tokens before creators notice |
| `capacity_alert_created` | `app/api/admin/alerts/check/route.ts` | `count`, `accounts`, `events_24h`, `failures_24h` | Capacity planning |
| `daily_metrics_flushed` | `app/api/cron/flush-metrics/route.ts` | `bio_clicks`, `dms_sent`, `dm_link_clicks`, `dm_replies`, `creator_rows` | Follower engagement, GA4 cannot see server redirects |

All server events are **anonymous and aggregate** except `instagram_account_connected`, which carries the creator's user ID. No comment text, recipient IDs, tokens or emails are ever captured server-side.

### 3.3 Automatic (no code)

- `$pageview`, `$autocapture` (clicks, form submits), `$web_vitals`, `$exception`
- Session replay with all inputs masked
- Dead-click and rage-click detection
- Console log capture

---

## 4. Saved dashboards and insights

### Dashboard A — [Delivery & Reliability (server-side)](https://eu.posthog.com/project/152538/dashboard/1151947)

| Insight | Link | What it answers |
|---|---|---|
| DM batches processed | [LKKOGCuD](https://eu.posthog.com/project/152538/insights/LKKOGCuD) | Is the comment→DM loop running at all? |
| DM delivery success rate | [UfWgJEVN](https://eu.posthog.com/project/152538/insights/UfWgJEVN) | What share of attempted DMs actually sent? |
| Worker failures and DLQ | [U8Y3vl4y](https://eu.posthog.com/project/152538/insights/U8Y3vl4y) | Where are automations silently lost? |
| Worker processing latency (p95) | [YYpaFwXp](https://eu.posthog.com/project/152538/insights/YYpaFwXp) | Is the pipeline getting slower? |
| Token refresh health | [AQjYIzMc](https://eu.posthog.com/project/152538/insights/AQjYIzMc) | Are Instagram connections expiring? |
| Follower engagement from daily rollups | [NBzQP7sD](https://eu.posthog.com/project/152538/insights/NBzQP7sD) | Bio clicks, DMs, link clicks, replies |

### Dashboard B — [Analytics basics (wizard)](https://eu.posthog.com/project/152538/dashboard/1151788)

| Insight | What it answers |
|---|---|
| [Creator activation funnel](https://eu.posthog.com/project/152538/insights/d7re1AkB) | sign-up → connect Instagram → onboarding → publish campaign |
| Campaign activation funnel (wizard) | Existing funnel from initial wizard setup |
| Campaign operations over time | Publishing and rerun cadence |
| Inbox automation activity | Rule usage trend |
| Instagram account connections | Connect trend |
| Onboarding completions | Onboarding trend |

**Chart displays chosen:** line charts for change over time; the activation funnel uses the default step display. A "conversion over time" funnel and a "time to convert" funnel also fit that query if you want to see the trend or the delay between steps.

---

## 5. From analytics to product improvements

| Signal | Threshold to act | Product change |
|---|---|---|
| Activation funnel step 2 → 3 drops | < 60% connect→onboarding | Shorten OAuth scope list; add inline reconnect help |
| DM delivery success rate drops | < 95% for a day | Check Meta API errors in `dm_logs`; adjust safety rules |
| `queue_publish_failed` > 0 | Any occurrence | Check QStash region/token; escalate to admin alert |
| `dlq_message_created` > 0 | Any occurrence | Inspect DLQ panel; replay after fixing root cause |
| Token refresh failed > 0 | Any occurrence | Notify creator in-app to reconnect |
| p95 duration rising | > 5 s for 3 days | Profile worker; add per-account flow control |
| Follower engagement flat while signups rise | Engagement/user falls | Improve keyword matching, rule defaults, onboarding copy |
| Dead clicks / rage clicks on a page | Cluster on one control | Fix the control; use session replay to see why |

---

## 6. Cost controls

PostHog bills per event (1M/month free, then ~$0.00005/event). At 30M webhook events/month, capturing everything would cost ~$900/mo. We avoid this by:

1. **No per-webhook capture.** One `dm_batch_processed` per worker run, with counts in properties.
2. **No per-link-click capture.** Counters live in Redis → daily Postgres rollups; PostHog gets one aggregate event per flush.
3. **No PII in properties.** Keeps data cheap to store and safe to share.
4. **Autocapture stays on** because it drives session replay and dead-click detection, which are high-value and bounded by browser sessions rather than webhook volume.

Target: **< $100/mo** at 25,000 creators.

---

## 7. Verification performed

- Vercel Production env vars confirmed present.
- Real browser session opened on production: `eu.i.posthog.com/e/` and `/i/v0/e/` returned 200; `/flags/` returned 200; no console errors.
- SQL confirmed events landed: `$pageview`, `$set`, `$identify`, `token_refresh_completed`, `pipeline_test_direct`.
- All six server-side insights execute without errors (currently zero because no real DMs have run since instrumentation).
- `npm run lint`, `npx tsc --noEmit`, `npm test` (42 tests) and `npm run build` all pass.
- Deployed to `https://dmplease.vercel.app` — commit `f82c1fd`.

---

## 8. Next steps (not yet implemented)

1. **Feature flags** for gradual rollout of risky rule changes (PostHog flags are available but unused).
2. **In-app surveys** (NPS / "why did you disconnect?") triggered from `instagram_account_disconnected`.
3. **Retention and stickiness insights** once there are 30 days of creator activity.
4. **Alerts** on `dlq_message_created > 1/day` and `dm delivery success rate < 0.95` — waiting for real baseline data before setting numbers.
5. **Reverse proxy** (`/ingest`) so tracking blockers cannot silently drop client events. Recommended by PostHog; useful if event volume looks lower than actual traffic.
