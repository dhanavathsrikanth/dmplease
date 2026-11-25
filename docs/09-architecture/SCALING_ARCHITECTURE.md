# dmplease — Scaling Architecture & Migration Plan

> **Purpose:** Define the architecture that keeps dmplease correct, secure and economical from today's scale to **25,000 creators and beyond**, without rewriting the product.
>
> **Status:** Design document. Phases 0–1 are partially implemented; phases 2–3 are planned.
> **Last updated:** 2026-11-26

---

## 1. Executive summary

dmplease today runs on:

- **Next.js 16 on Vercel** (App Router, Turbopack, Cache Components)
- **Supabase** (Postgres + Auth + RLS), read via the anon/publishable key, written via a service-role HTTPS client
- **Upstash Redis + QStash** (global rate limiting, event dedupe, durable webhook queue, retries, DLQ, cron schedules)
- **PostHog** (connected as an MCP tool; **not yet instrumented in the app**)
- **Cloudflare R2** (planned for media; not yet implemented)

The current design already solves the three failures that were breaking production:

1. Vercel cannot reach Supabase Postgres TCP ports → all backend writes use HTTPS.
2. Webhooks were dropped on timeout → QStash queue with retries + dead-letter handling.
3. Rate limits were per serverless instance → shared Redis counters.

The remaining blockers to exponential scale are:

| Blocker | Severity | Phase |
|---|---|---|
| Service-role key bypasses all RLS (blast radius) | High | 1 |
| Supabase REST one-call-per-write becomes the bottleneck at 100k+ events/day | High | 2 |
| Analytics DB rows grow unbounded without partitioning | Medium | 1–2 |
| PostHog not instrumented; no product-level observability | Medium | 1 |
| Media served through the app instead of object storage | Medium | 2 |
| No read replica for analytics dashboards | Medium | 2 |

**Strategic decision:** keep Supabase as the system of record, and move the **high-volume execution layer** (ingest, queue, per-account rate limiting, media) to **Cloudflare** as volume grows. At 25,000 creators this is roughly **6–10× cheaper** for the execution layer than scaling QStash + Redis on Vercel.

---

## 2. Hard constraints

These are not negotiable and drive every decision:

1. **Vercel serverless cannot reach Supabase Postgres ports 5432/6543.** Direct Prisma connections fail with `P1001`. Backend writes must use HTTPS (REST/RPC) unless the runtime changes.
2. **Meta rate limits are per Instagram Business Account.** A limiter that lives in one serverless instance is not a limiter. State must be shared and keyed by account ID.
3. **Meta requires a webhook response within ~20 seconds.** No business work happens in the request path; the request only verifies, dedupes and enqueues.
4. **Tenant boundary = workspace.** Every user-facing read is RLS-scoped to `workspace_id`.
5. **Cost must stay roughly linear with events, not with headcount.** No per-seat pricing surprises.

---

## 3. Load model

| Metric | Today | 25,000 creators (planning target) |
|---|---:|---:|
| Connected accounts | 1 | 25,000 |
| Meaningful events/day | ~1,000 (synthetic tests) | ~1,000,000 |
| Events/month | ~30,000 | ~30,000,000 |
| Redis commands/month | <100k | ~300,000,000 |
| Postgres metric rows/month | <100 | ~750,000 (25k creators × ~1 target/day) |
| Concurrent webhook bursts | low | viral spikes of 500+ comments per reel |

Planning assumption: ~40 meaningful events per creator per day. If real usage is 10× higher, phase 2 gates move earlier — the architecture does not change.

---

## 4. Target architecture

```
                         ┌──────────────────────────────┐
Meta webhooks ──────────► │ Ingest (Vercel → Cloudflare) │
                         │ HMAC verify + Redis NX       │  ~20ms
                         │ dedupe → queue publish       │
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │ Queue (QStash → CF Queues)    │
                         │ per-account flow control      │
                         │ retries + DLQ + schedules     │
                         └──────────────┬───────────────┘
                                        │ signed POST
                         ┌──────────────▼───────────────┐
                         │ Worker (Next.js → CF Worker)  │
                         │ shared limiter (Redis → DO)   │
                         │ recipient cooldown            │
                         │ idempotent by event ID        │
                         │ transient/permanent split     │
                         └───────┬──────────────┬────────┘
                                 │              │
                 ┌───────────────▼──┐   ┌───────▼──────────────────┐
                 │ Meta Graph API   │   │ Supabase RPC (scoped)    │
                 │ send DM/replies  │   │ limited role; no broad   │
                 └──────────────────┘   │ service-key table access │
                                        └───────┬──────────────────┘
                                                │
              ┌─────────────────────────────────▼──────────────────┐
              │ Supabase Postgres (system of record)                │
              │ workspaces, automations, rules, contacts             │
              │ conversations, messages, dm_logs, safety_events      │
              │ daily_creator_metrics (partition by month at scale)  │
              │ RLS for user reads; RPC-only for backend writes      │
              └──────┬──────────────────────────┬───────────────────┘
                     │                          │
      ┌──────────────▼──────────┐   ┌───────────▼────────────────┐
      │ Read replica / warehouse│   │ Redis hot counters         │
      │ analytics dashboards    │   │ flush every minute         │
      └─────────────────────────┘   └────────────────────────────┘

Cross-cutting: PostHog (selective events/errors) · R2 (media) · Vercel/QStash cron
```

The **ingest → queue → worker** contract never changes. Only the runtime and data stores scale out.

---

## 5. Vendor decisions

| Layer | Vendor | Why | Cost at 25k creators |
|---|---|---|---:|
| Ingest + queue + worker | **Cloudflare** Workers + Queues | $0.40/M queue operations, $5/mo Workers + $0.30/M extra requests | ~$50/mo |
| Per-account rate limiting / locks | **Cloudflare Durable Objects** (phase 2) | One object per account; in-memory state; no per-command bill | usage-based, low |
| Short-term rate limiting / dedupe | **Upstash Redis** (phase 0–1) | Already integrated; HTTP-based; free 500k commands/mo | $0–$10/mo fixed |
| Durable queue (phase 0–1) | **Upstash QStash** | HTTP push queue, retries, DLQ, schedules; already integrated | ~$300/mo at 30M msgs |
| Database + Auth | **Supabase** | 25k MAU fits Pro quota (100k); RLS + workspaces give tenancy | ~$25–300/mo |
| Analytics rollups | Supabase Postgres + read replica | Existing Redis→Postgres flush; no warehouse needed yet | included |
| Product observability | **PostHog** | 1M events/mo free; pay per event thereafter | ~$0–50/mo if selective |
| Media / link-in-bio assets | **Cloudflare R2** | $0 egress, presigned uploads | near $0 |
| Admin email | **Resend** (after domain purchase) | 3,000 emails/mo free | $0 |

Sources: [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Upstash QStash](https://upstash.com/pricing/qstash), [Upstash Redis](https://upstash.com/pricing/redis), [Supabase MAU limits](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users), [PostHog pricing](https://posthog.com/product-analytics/pricing).

### PostHog cost warning

PostHog bills per event (1M free, then ~$0.00005/event dropping with volume). Capturing all 30M webhook events/month would cost roughly **$900/mo**. Capture **summary events only**:

- `campaign_created`, `automation_toggled`, `rule_created`
- `dm_batch_sent` (one event per worker run, with counts in properties)
- `rate_limit_hit`, `dlq_message_created`, `oauth_connected`, `oauth_failed`

Never capture raw comment text, recipient IDs or token data.

---

## 6. Migration phases

### Phase 0 — Harden what exists (current → 1,000 creators)

Goal: remove security and observability debt without changing behaviour.

| # | Task | Files / action | Acceptance criteria |
|---|---|---|---|
| 0.1 | Scoped Postgres RPCs + limited role | Replace `getAdminDb()` writes with validated `SECURITY DEFINER` RPCs; grant execute only to a worker role | No backend path uses a key that can read arbitrary tables |
| 0.2 | JWT secret or custom signing key | Retrieve from Supabase dashboard; mint JWT for `dmplease_worker` | Worker authenticates as limited role; RLS still applies |
| 0.3 | PostHog instrumentation | Add capture calls in webhook route, worker, cron | Events visible in PostHog with no PII |
| 0.4 | Monthly partitioning plan | Document threshold (10M rows) and `PARTITION BY RANGE (day)` DDL | Reviewed before rollup table exceeds 10M rows |
| 0.5 | Budget caps | Upstash Redis budget, QStash budget | Alerts configured before paid usage spikes |

### Phase 1 — Scale within current vendors (1,000 → 5,000 creators)

| # | Task | Files / action | Acceptance criteria |
|---|---|---|---|
| 1.1 | Supabase read replica for analytics | Point `lib/analytics.ts` reads at replica | Dashboard reads do not touch primary |
| 1.2 | QStash flow control per account | Add `flowControl: { key: accountId, parallelism, rate }` in `app/api/webhook/route.ts` | Bursts per account are smoothed; other accounts unaffected |
| 1.3 | Analytics rollup partitioning | Apply monthly partitions | Queries prune old partitions |
| 1.4 | Alert thresholds in admin page | Add Redis commands/day, QStash messages/day | Admins see cost/volume before budget exhaustion |

### Phase 2 — Cloudflare execution layer (5,000 → 25,000 creators)

| # | Task | Action | Acceptance criteria |
|---|---|---|---|
| 2.1 | Cloudflare Worker ingest | Port HMAC verify + Redis dedupe + queue publish to a Worker | Response <50ms; Vercel route kept as fallback |
| 2.2 | Cloudflare Queues | Replace QStash publish/consume with `env.QUEUE.send()` and a queue consumer | Retries + DLQ equivalent to QStash |
| 2.3 | Durable Objects per account | `DmAccount` object holds rate-limit window and lock state | One global counter per account; no Redis command bill |
| 2.4 | R2 media | Presigned PUT URLs; serve via custom domain | No media bytes through Next.js |
| 2.5 | Direct Postgres from worker | Cloudflare Hyperdrive or Neon HTTP driver | Removes REST round trip per write |
| 2.6 | Cutover | Route traffic gradually 1% → 10% → 100% | Error rate and latency unchanged or better |

### Phase 3 — Beyond 25,000 creators

| # | Task | Trigger |
|---|---|---|
| 3.1 | Append-only event log (Kafka/Redpanda/Cloudflare Pipelines) | >10M events/day |
| 3.2 | CQRS read models | Dashboard queries exceed replica capacity |
| 3.3 | Per-tenant sharding | Single Postgres primary exceeds write capacity |
| 3.4 | Warehouse for analytics (ClickHouse/Tinybird) | Raw event analytics needed beyond daily rollups |

Do **not** start phase 3 until phase 2 is stable for at least a month.

---

## 7. Security plan

### Current problem

`lib/db-admin.ts` uses `SUPABASE_SERVICE_ROLE_KEY` for all backend writes. One leak = full database access.

### Target

1. Create Postgres role `dmplease_worker` with:
   - `USAGE` on schema `public`
   - `EXECUTE` only on the explicit RPC list
   - **no** direct `SELECT/INSERT/UPDATE/DELETE` on tables
2. Create one RPC per backend operation:
   - `claim_webhook_event`, `finish_webhook_event`
   - `upsert_contact`, `insert_message`, `insert_dm_log`
   - `record_safety_event`, `create_pending_dm`, `consume_pending_dm`
   - `increment_daily_metrics` (already exists)
3. Mint a JWT with `role: dmplease_worker`, signed with the project JWT secret.
4. Replace `getAdminDb()` with a client authenticated as that role.
5. Keep user-facing reads on the normal Supabase client with RLS.

### Acceptance criteria

- No code path uses the service-role key except a one-time admin bootstrap script.
- Attempting a direct `select * from contacts` with the worker JWT returns permission denied.
- All 38+ tests still pass.

---

## 8. Data plan

### Keep on Supabase Postgres

- `profiles`, `workspaces`, `workspace_members`
- `automations`, `dm_rules`, `comment_events`
- `instagram_accounts`, `contacts`, `conversations`, `messages`, `dm_logs`
- `pending_dms`, `safety_events`, `link_clicks`
- `webhook_events`, `insight_snapshots`, `admin_alerts`
- `daily_creator_metrics`

### Partitioning trigger

When `daily_creator_metrics` passes **10 million rows**:

```sql
-- Conceptual; apply via a reviewed migration.
CREATE TABLE daily_creator_metrics_partitioned (... )
PARTITION BY RANGE (day);
-- monthly partitions, pg_cron or app-side creation
```

### Retention

| Table | Retention |
|---|---|
| `dm_logs`, `messages`, `comment_events` | 90 days (append-only raw events) |
| `daily_creator_metrics` | indefinite (small rows) |
| `webhook_events` | 30 days |
| `safety_events` | 90 days |

---

## 9. Observability plan

1. **PostHog**: summary events only (see §5).
2. **Admin capacity page** (`/dashboard/admin/alerts`): current envelope metrics, thresholds, alert history, DLQ panel.
3. **QStash DLQ**: failure callback writes `admin_alerts` row; admins replay/delete from the panel.
4. **Vercel/Cloudflare logs**: structured JSON with `eventId`, `accountId`, `outcome`, `durationMs` — never tokens or recipient PII.
5. **Budget alerts**: Upstash and Cloudflare spend limits configured before phase 2.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cloudflare migration breaks Meta webhook verification | Keep Vercel route live; shadow-compare responses for 7 days |
| Durable Object hot spots for viral accounts | Per-account flow control + QStash/Queues batching |
| PostHog cost explosion | Capture summary events only; billing limit set in PostHog |
| Supabase read replica lag | Dashboard shows "updated Xs ago"; flush runs against primary |
| Service-role replacement misses a write path | Grep every `getAdminDb()` call; add a lint rule if possible |
| QStash → Cloudflare Queues DLQ semantics differ | Build an adapter that normalises both into `admin_alerts` |
| Vendor lock-in | Keep the ingest→queue→worker contract vendor-neutral; payload shape stays `{eventId, payload}` |

---

## 11. Definition of done (scale readiness)

- [ ] No backend write uses the service-role key.
- [ ] 25,000 simulated workspaces can be represented without schema changes.
- [ ] One account can receive a 500-comment burst with zero dropped events and zero Meta 429s.
- [ ] Analytics dashboard loads in <500ms with 90 days of rollups.
- [ ] QStash/Queues monthly cost < $100 at 30M events/month.
- [ ] DLQ replay restores a failed job without duplicate DMs (verified by duplicate guard).
- [ ] PostHog monthly spend < $100 with selective capture.
- [ ] Rollback to Vercel ingest takes <5 minutes.

---

## 12. Non-goals

- **No full rewrite.** The Next.js dashboard stays; only execution primitives move.
- **No custom auth.** Supabase Auth + RLS + workspaces remain the tenancy model.
- **No event streaming vendor before phase 3.** QStash/Queues are enough until ~10M events/day.
- **No per-seat pricing.** All chosen vendors bill by usage.
- **No link-in-bio / R2 media until phase 2.** They are Tier 2 product scope, not scaling blockers.

---

## 13. Immediate next actions

1. Retrieve the Supabase JWT secret (or configure a custom signing key) and implement phase 0.1–0.2.
2. Add the five PostHog summary events (phase 0.3).
3. Set Upstash Redis and QStash budget caps (phase 0.5).
4. Enable a Supabase read replica and repoint `lib/analytics.ts` (phase 1.1).
5. Prototype the Cloudflare Worker ingest with a shadow traffic flag (phase 2.1).

Each action is independently shippable and does not require a pause in product development.
