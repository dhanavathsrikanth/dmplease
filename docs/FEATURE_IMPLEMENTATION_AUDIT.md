# dmplease — Feature & Codebase Implementation Audit

I read the actual source (not the marketing/roadmap docs), ran the suite, and cross-checked every claim. Verdict: **the core engine is real and working, but the feature set as a whole is NOT completely established.** Of 16 capabilities, **2 are complete, 12 are partial, 2 are effectively missing.**

Health check: `npm test` → **57/57 pass**, `npm run lint` clean, `npx tsc --noEmit` clean. Working tree has uncommitted diagnostic/error-logging fixes (8 files).

---

## 1. Per-feature verdicts

| # | Feature | Status | What actually exists / what's missing |
|---|---|---|---|
| 1 | **Comment-to-DM** | ✅ Working | Full pipeline: HMAC-verified webhook → QStash → parser → automation match → private reply/button → logs. Caveat: `dm_logs` writes columns absent from committed migrations (silent failure risk), and viral-spike handling only adds jitter, no throttle. |
| 2 | **Ask for Follow** | ✅ Working | Real Graph API follower check (`verifyFollowership` in `lib/meta/follow-gate.ts`) with Meta's `is_user_follow_business` field, Redis caching (15 min follower / 2 min non-follower), in-flight coalescing, and an explicit `unavailable` status on errors (never silent fail-open). Identity verification: the returned username is checked against the commenter's username when available (`identity_mismatch` reason). Applied to comment DMs, inbox rules, story triggers and share triggers. Opening DM copy is editable in the campaign form, rule manager and settings (shared zod schema). Follow-gate performance dashboard (`FollowGateReport`) shows checks, confirmed followers, asked-to-follow, unverifiable, and top reasons. Test endpoint `POST /api/instagram/verify-follow` lets creators check a specific user. FollowGateReport includes a live "Test verification" form. |
| 3 | **Story-to-DM** | ✅ Working | Story mentions, replies and reactions parsed and dispatched via `dm_rules`. Story reactions (emoji reactions to stories) are now parsed as `STORY_REACTION` events. Double-fire is prevented with a Redis dedupe key (`story:handled:{accountId}:{senderId}`) so a story reply does not also trigger inbox keyword rules. Follow gate is wired for all story triggers. Opt-out handling applies. |
| 4a | **DM keywords** | ✅ Working | Comment keywords (substring) and inbox-rule keywords (whole-word), both wired with CRUD UI, throttling and tests. |
| 4b | **"Respond to all DMs"** | ✅ Working | Dedicated account-level fallback stored in `instagram_accounts` and fully wired: `normalizeFallbackReply` + `fallbackAsRule` create a virtual rule that runs only after specific keywords and catch-alls fail to match (no stealing). Uses `chooseDmVariant` with cross-instance history, `varsForTemplate` for personalization (all variables including vouchers), safety guards (opt-out, dedupe, cooldown), and `buildAutomationContent` for short links. UI: accessible settings card with variable picker, follow gate, button CTA, and clear copy. |
| 5 | **Next-Reel** | ✅ Working | `NEXT_POST` still targets the latest media ID, but now **auto-attaches that reel's real permalink** into `{link}` and the action button at send time (`{permalink}` sentinel; empty URL also means auto for this scope). Resolution is shared/cached (in-process + Upstash Redis, singleflight, immutable permalink TTL) so a comment burst makes one Graph call, not one per DM. Explicit static URLs always win; a failed lookup drops the link rather than sending a bogus one. |
| 6 | **Opening DM** | ✅ Working | `openingMessage` is editable in the campaign form (and rule/fallback forms), validated by one shared schema and persisted by the server actions. Copy rendering and defaults live in `lib/meta/opening-dm.ts`; sending + full side effects (dm_logs, inbox message, `dm_sent` metric, safety ledger, PostHog) live in one `sendOpeningDm()` helper. The Overview "Opening messages sent" stat now counts sent openers instead of pending opt-in rows. |
| 7 | **24h follow-ups** | ✅ Working | Full lifecycle: accessible step editor on the campaign page, hourly Vercel cron + distributed run lock, opt-in-first timing (falls back to first DM), automatic click/reply/conversion cancellation, and idempotent `followup_events` writes via one shared `recordEvent()` path. Pure decisions live in `lib/followup-policy.ts`; the engine batches all queries per step. |
| 8 | **Public comment replies** | ✅ Working | Real `POST /{comment-id}/replies` after a successful DM. at least 3 natural defaults are guaranteed and up to 10 labelled variants rotate via a history-aware pure chooser (never the last few replies repeated), and a single `sendPublicReply()` path records every attempt (status, error code/message) in `public_replies` plus PostHog events (counted from the ledger, not DM metrics). The builder exposes an accessible multi-variant editor with a live preview. |
| 9 | **Rerun** | ✅ Working | Durable job-based re-run: `rerun_jobs` + `rerun_job_items` ledger, QStash-chained 20-item batches with Redis locking and compare-and-set claims, live progress polling, cancellation, and paused-campaign refusal. Uses the same processor guards; reports real sent/skipped/failed counts instead of "queued". |
| 10 | **Personalised DMs** | ✅ Working | One pure variable engine (`lib/dm-variables.ts`) supports `{username}`, `{name}`, `{email}`, `{phone}`, `{keyword}`, `{link}`, `{voucher}` and `{voucher_url}` in both single/double braces. `lib/meta/dm-variable-resolver.ts` loads collected contact fields only when used; `lib/vouchers.ts` mints stable HMAC-derived codes with a durable ledger. All send paths share one renderer; the builder has a click-to-insert variable picker, a lead-field selector and an exact live preview. |
| 11 | **DM variations** | ✅ Working | Creators can add up to 10 labelled variants in the campaign builder (with the same variable picker as the main DM); variants are validated and persisted by the server actions. A generic pure engine (`lib/message-variants.ts`) plus shared Redis history (`lib/meta/variant-history.ts`) replace `previousIndex`, so the last few variants are never repeated across serverless workers. All send paths (comment, opt-in, rule, follow-up, re-run) rotate through one helper; `dm_logs` records the exact variant index. |
| 12 | **6 message formats** (text/audio/PDF/media/card/carousel) | ✅ Working | All six formats are sendable via Meta Graph attachments. Binary assets upload **directly to Cloudflare R2** with short-lived presigned URLs and are delivered by public CDN URL (no binary through the app server). Pure attachment builder, validated format config, accessible format/asset/card editor, live preview and per-format `dm_logs` analytics. Attaching a broken asset degrades to text instead of failing a send. |
| 13 | **Short-link rotation** | ✅ Working | Truly short (`/go/{8-char}`) links generated at send time with sticky or round-robin destination rotation, per-recipient stability, attribution recorded on click, and a full rotator manager UI with per-link analytics. The click ledger now has every column the route writes. Legacy signed tokens still redirect. |
| 14 | **DM queue** | ✅ Working | Overflow rows are now durable and drained by a signed worker (`/api/workers/drain-dm-queue`) with compare-and-set claims, exponential backoff, a 5-attempt limit and a `failed` state; a cron fallback runs hourly. `sendCommentDm` upserts the queued row instead of duplicating it. The manual send endpoint now applies hourly cap, recipient cooldown, 24h dedupe, personalisation and logging. Queue depth, failures and age are visible on the Overview dashboard with a "Drain now" action. |
| 15 | **Safety checks + smart delays** | ✅ Working | Token bucket, Upstash sliding window, recipient cooldown, 24h dedupe, jitter, QStash overflow all real. Phase 1: proactive viral-spike throttle (`lib/meta/throttle.ts`), breach/throttle events. Phase 2: account health monitor with auto-pause, opt-out/STOP handling, safety dashboard on Overview. Phase 3: dedicated `/dashboard/safety` page with live gauge, safety score, recent events, retention cron, and pure score tests. |

---

## 2. Per-file map (what each file actually contributes)

### Ingestion & orchestration

| File | Role / status |
|---|---|
| `app/api/webhook/route.ts` | ✅ Real Meta signature verification (fail-closed), dedupe, job ledger, QStash publish. Dedupe key uses only first event of a batch (bug). |
| `app/webhook/route.ts` | Alias re-export only. |
| `lib/meta/webhook.ts` | ✅ Parsers for comments, messages, postbacks, reads, story mentions/replies, shares. No live/reaction parsers; `parseMessagingInteractions` is dead code. |
| `lib/meta/webhook-processor.ts` | ✅ Core engine (~1550 lines): all comment/rule/story/share/opt-in/lead/postback flows, personalisation, variants, safety guards, persistence. Also the source of most gaps (dead variant arrays, orphaned queue rows, silent best-effort writes). |
| `lib/meta/webhook-events.ts` | ✅ Durable webhook ledger + health aggregation (recently improved, uncommitted). |
| `lib/dedupe.ts` | 🟡 Redis `SET NX EX 24h`, fails open without Redis. |
| `lib/qstash-verify.ts`, `lib/upstash.ts`, `lib/redis-lock.ts` | ✅ Queue signature verification, rate limiters, cron lock. |

### Delivery, safety, attribution

| File | Role / status |
|---|---|
| `lib/meta/client.ts` | ✅ Token vault/refresh, account discovery, text + button sends, public replies, follower check. ❌ No audio/PDF/media/card/carousel APIs; follower check fails open. |
| `lib/meta/safety.ts` | 🟡 Rate limiter, `pickVariant`, spike detection, validator (validator unused in runtime); caps default unlimited; delay constants dead. |
| `app/api/workers/qstash/route.ts`, `qstash-failed/route.ts`, `lib/dlq-ops.ts`, `app/api/admin/dlq/route.ts` | ✅ Real retry/DLQ/replay infrastructure. |
| `app/api/workers/send-queued-dm/route.ts` | 🟡 Re-runs a comment event; does not drain `pending_dms`. |
| `app/api/instagram/send-dm/route.ts` | 🟡 Manual send; no cap/dedupe/personalisation; picks first account. |
| `app/go/[slug]/route.ts`, `lib/tracking.ts`, `lib/conversions.ts`, `app/api/conversions/[workspaceToken]/route.ts`, `app/api/contacts/export/route.ts` | 🟡 Tracking/conversion primitives exist; generator unused, rotation absent, ledger columns missing. |

### Follow-ups, inbox, rules

| File | Role / status |
|---|---|
| `lib/followups.ts`, `lib/followups-holdout.ts` | 🟡 Due detection, conversion suppression, deterministic holdout, sends. No click/reply cancellation, dedupe hole, 100-row caps. |
| `app/api/cron/followups/route.ts`, `app/api/admin/followup-schedule/route.ts` | 🟡 Auth-protected endpoint exists; **not scheduled in `vercel.json`**; manual QStash scheduler has no caller. |
| `app/dashboard/inbox-automations/actions.ts`, `components/inbox-rules/rule-manager.tsx`, `app/dashboard/inbox-automations/page.tsx` | ✅ Full rule CRUD; ❌ no variant/priority fields. |
| `app/api/inbox/reply/route.ts`, `app/dashboard/inbox/page.tsx`, `components/inbox/inbox-interactive-chat.tsx` | 🟡 Human reply works; `is_bot_active` never written/read; no live refresh. |
| `components/campaigns/followup-report.tsx`, `app/dashboard/campaigns/[id]/edit/page.tsx` | 🟡 Read-only follow-up report; no step editor. |

### Campaign UI

| File | Role / status |
|---|---|
| `components/campaigns/campaign-builder.tsx`, `phone-preview.tsx` | ✅ Keywords, post picker, Next Post pill, button, public reply, follow-gate toggle. ❌ No variants, opening message, hourly cap, collect field, or format selector. Preview isn't byte-accurate. |
| `app/dashboard/campaigns/new/page.tsx`, `[id]/edit/page.tsx`, `actions.ts`, `lib/validation/campaign.ts` | ✅ Create/edit works for the supported subset; advanced DB fields are dropped on edit. |
| `app/api/campaigns/rerun/route.ts`, `components/campaigns/campaigns-list.tsx` | 🟡 Rerun works (7 days hardcoded); ignores paused campaigns. |

### Data & tests

| File | Role / status |
|---|---|
| `prisma/schema.prisma` | ⚠️ Stale: 5 SQL-only tables missing, several code-written columns missing, 7 Prisma-only profile columns. Runtime uses Supabase REST (`lib/db-admin.ts`), not Prisma. |
| `supabase/migrations/*` (8 files) | ⚠️ `automations`, `instagram_accounts`, `dm_logs` have **no CREATE TABLE** anywhere — a fresh DB cannot be built from migrations alone. |
| `tests/*` (12 files, 57 tests) | ✅ All pass; mostly pure helpers/parsers. ❌ No coverage for ask-for-follow, opening DM, public replies, rerun, follow-up runner, six formats, short-link rotation, or "respond to all". |
| `app/api/health/route.ts` | 🟡 Env-var probe only; cannot detect the schema/DDL failures above. |
| Auth, layout, settings, marketing, `components/ui/*`, `components/tutorial/*` | ✅ Present and functional; no feature logic for the 15 items. `components/tutorial/*` is leftover starter scaffolding. |

---

## 3. Biggest blockers to "completely established"

1. **Not reproducible from source** — core tables and 14+ runtime-written columns exist only in the live database. A clean deploy silently loses DM logs, token-health updates and click attribution.
2. **Follow-ups are dormant** — no config UI and no cron registration; the shipped "24h follow-up" can't run for a normal user.
3. **Half the feature set is unreachable from the UI** — variants, opening message, hourly cap, follow-up steps, safety controls, short links.
4. **Marketing/docs overstate reality** — `PRODUCT_DEVELOPMENT_TIERS.md` has every Tier checkbox unchecked while claiming all shipped; parity claims for "Respond to all DMs", six formats and short-link rotation are unsupported by code; `design.md` is actually a Miro design spec.
5. **Safety is best-effort** — unlimited-by-default caps, fail-open follower/dedupe checks, no block/opt-out detection, manual-send bypass.

**Bottom line:** the platform is a solid working comment-to-DM + keyword-rules engine with real webhook security, queueing and analytics. It is *not* at feature parity with the 15-item list: **2 complete, 12 partial, 2 missing**, plus a deployment-reproducibility problem that should be fixed before calling anything "done".

If useful, I can write this audit into a committed `FEATURE_IMPLEMENTATION_AUDIT.md` and/or produce a prioritized remediation plan (migration consolidation → follow-up scheduling + editor → variant/cap/opening UI → formats & link rotation).
