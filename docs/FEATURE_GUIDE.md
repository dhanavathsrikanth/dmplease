# Feature Guide — Next-Reel & Opening DM

> **Status:** implemented and verified (2026-11-26).
> This is the source of truth for what these features do and why. For the wider
> capability verdict, see [Feature Implementation Audit](FEATURE_IMPLEMENTATION_AUDIT.md).
>
> - [Part 1 — Next-Reel: auto-attached reel permalink](#1-what-problem-it-solves)
> - [Part 2 — Opening DM: copy, delivery and observability](#12-what-problem-it-solves-1)
> - [Part 3 — 24h follow-ups: steps, timing and cancellation](#19-what-problem-it-solves-2)
> - [Part 4 — Public comment replies: variants and failure logging](#27-what-problem-it-solves-3)
> - [Part 5 — Re-run: durable jobs and live progress](#34-what-problem-it-solves-4)
> - [Part 6 — Personalised DMs: variables, contact fields and vouchers](#40-what-problem-it-solves-5)
> - [Part 7 — DM variations: rotation without repeats](#46-what-problem-it-solves-6)
> - [Part 8 — Six DM formats on Cloudflare R2](#52-what-problem-it-solves-7)
> - [Part 9 — Short-link rotation: sticky destinations and click attribution](#58-what-problem-it-solves-8)
> - [Part 10 — DM queue: durable overflow and safe manual sends](#65-what-problem-it-solves-9)
> - [Part 11 — Safety engine: measured, not mocked](#71-what-problem-it-solves-10)
> - [Part 12 — Safety polish: digest, explanations, badge](#77-what-problem-it-solves-11)

---

## 1. What problem it solves

A campaign has three post scopes: `ANY_POST`, `SPECIFIC_POST` and `NEXT_POST`.
`NEXT_POST` means "run this automation on my *next* upload" — a creator picks it
before the reel exists, so there is no URL to paste into the DM at setup time.

Before this work, `NEXT_POST` was **only a targeting filter**: the webhook
compared the comment's media ID with the latest media ID from Meta. The media
picker did fetch `permalink`, but only for the UI preview — no DM ever received
it. The pill in the campaign builder said **"Auto-attaches"**, but that was
UI-only copy.

It also fetched "latest media" from Meta once *per automation per comment*
(a per-request `Map` cache), which does not scale during a viral spike.

**Now:** the triggering reel's real permalink is resolved at send time and
injected into the DM (`{link}`) and the action button, through a shared,
multi-layer cache.

---

## 2. Behavior at a glance

| Scope | Destination URL in builder | What the DM contains |
| --- | --- | --- |
| `NEXT_POST` | Set to `{permalink}` automatically ("Auto — new reel permalink") | The triggering reel's real permalink, in `{link}` and the button. |
| `NEXT_POST` | Left empty (legacy campaigns) | Same auto behavior — empty means "attach the reel" for this scope. |
| `NEXT_POST` | Explicit static URL ("Use custom URL") | That static URL. No resolver call. |
| `SPECIFIC_POST` / `ANY_POST` | Static URL as before | Static URL as before. `{permalink}` still works as an explicit opt-in. |

Key rules:

- **Targeting is unchanged**: `NEXT_POST` still fires only on the latest published
  reel. It does not fire for older posts.
- **A new upload matches immediately.** A comment on an unrecognised media ID
  triggers one bounded refresh instead of waiting out the 5-minute cache TTL.
- **Explicit static URLs always win.** Nothing changes for existing campaigns
  that already have a real URL stored.
- **Fail closed on content**: if Meta cannot return a permalink, the link/button
  are omitted. The sentinel is never sent as a URL or postback payload.
- **Attribution is preserved**: the attached URL carries `utm_source=dmplease`,
  `utm_medium=instagram_dm`, `utm_campaign=<first 8 chars of automation id>`.
- **Instagram linkification**: `formatDmText()` puts the URL on its own line so
  it renders as a clickable link rather than plain text.

---

## 3. Creator-facing flow (campaign builder)

1. In **Step 1 — Target Content Scope**, choose **Next Post**.
2. The builder switches the destination URL to a locked display:
   `Auto — new reel permalink`, with a **Use custom URL** button to override.
3. An info card explains that no URL is needed: when someone comments on the
   next upload, dmplease resolves that reel's permalink and attaches it.
4. The phone preview shows an Instagram reel placeholder and the caption
   "Starts with your next upload — its link is attached automatically".
5. On publish, the stored `button_url` is the sentinel `{permalink}`.
   No database migration is required — it uses the existing column.

Editing an existing campaign reads `button_url` back, so the auto state survives
edit/save cycles (see `app/dashboard/campaigns/[id]/edit/page.tsx`).

---

## 4. Runtime data flow

When a comment webhook arrives:

```
webhook → processWebhookPayload
  → processCommentEventForAutomation
      → matchesPostScope(auto, event, token)
          → resolveLatestMedia(token, event.mediaId)   [cached]
          → latestId === event.mediaId ? continue : skip
      → follow gate (optional)
      → sendCommentDm
          → buildAutomationContent(...)                [cached link]
              → usesReelPermalink(auto)?
                  → resolveReelPermalink(token, event.mediaId)
              → linkForMessage(...) + formatDmText(...)
          → sendPrivateReply / sendPrivateReplyWithButton
          → public reply (reuses the same template vars)
          → dm_logs / safety_events / inbox records
```

The follow-gate "Ask for Follow" path uses the same content builder when the
opt-in is released (`sendOptinDm`), so a commenter who follows first still gets
the reel permalink. The opening "follow me" DM deliberately uses no link —
showing a setup-time sentinel there would be meaningless.

---

## 5. Architecture / file map

| File | Role |
| --- | --- |
| `lib/reel-link.ts` | Client-safe shared vocabulary: `AUTO_REEL_LINK = "{permalink}"`, `isAutoReelLink()`, `usesReelPermalink()`. Safe to import into the builder. |
| `lib/meta/reel-link-resolver.ts` | Server-side cached resolution for latest media and per-media permalinks. |
| `lib/meta/dm-content.ts` | Single place that builds final DM text, template vars and button URL. |
| `lib/meta/dm-template.ts` | Pure helpers (`personalizeMessage`, `linkForMessage`, `formatDmText`). Re-exported from the processor for compatibility. |
| `lib/meta/client.ts` | Added `getMediaPermalink(accessToken, mediaId)` — a single-object Graph fetch (`fields=permalink`) on the correct host (`instagramApiBase`). |
| `lib/meta/webhook-processor.ts` | Wires scope matching and both comment/opt-in send paths to the new modules. |
| `lib/validation/campaign.ts` | Accepts the `{permalink}` sentinel in `button_url`. |
| `components/campaigns/campaign-builder.tsx` | NEXT_POST UI: sentinel, locked URL display, info card, preview URL. |
| `components/campaigns/phone-preview.tsx` | Accurate NEXT_POST preview copy. |

Why this split matters at scale: link resolution is **one service**, not copy-
pasted into each send path. Every caller (live comment, retry, follow-up
release, retro re-run) gets identical link behavior, and cache policy can be
tuned in one file.

---

## 6. Cache design

| Concern | Value |
| --- | --- |
| Layers | in-process Map → Upstash Redis → Meta Graph API |
| Latest media TTL | 5 minutes (`LATEST_TTL_SECONDS`) |
| Permalink TTL | 7 days (`PERMALINK_TTL_SECONDS`) — immutable once published |
| Failure TTL | 30 seconds (`FAILURE_TTL_SECONDS`) — short-circuits repeated failures during a spike |
| New-upload refresh | A mismatching `hintMediaId` forces one refresh per 30 seconds (`MISMATCH_REFRESH_MS`) |
| Concurrency | `singleflight` map coalesces simultaneous misses per isolate |
| Key safety | Access token is FNV-1a hashed before use in a cache key; raw secrets never enter Redis keys |
| Cache failures | Redis errors are swallowed — the cache is an optimisation, never a dependency |

Effect: a viral burst of comments on one new reel makes **one** latest-media
Graph call and **one** permalink Graph call (per cache key), not one per DM.

---

## 7. Failure handling and edge cases

- **Meta returns no permalink** → `linkSource: "unavailable"`, link/button dropped,
  DM still sent with the rest of the message. A PostHog event records the result.
- **Meta returns error 190 (invalid token)** → existing `markTokenInvalid()`
  path still applies; no special-case here.
- **Redis unavailable** → in-process cache + direct Graph call; behavior unchanged.
- **Old campaign with `NEXT_POST` and no URL** → treated as auto-attach.
- **Old campaign with a static URL** → unaffected.
- **Sentinel leak prevention** → `applyFollowGate()` and the generic pending
  release strip the sentinel from opening/legacy DMs.
- **Hourly-cap overflow / queued DMs** → the queued job re-runs the comment
  event, so it resolves the permalink through the same path.

---

## 8. Observability

- PostHog event `reel_link_resolved` with `result` (`auto` | `unavailable`),
  `automation_id`, `media_id`.
- `console.warn("[reel-link] ...")` on resolver errors.
- Existing `dm_sent` metrics, `dm_logs` and inbox records still capture the
  final message text (including the resolved URL).

---

## 9. Tests and verification

Commands and last result:

```bash
npm test          # 18 files, 103 tests — all pass
npm run lint      # clean
npx tsc --noEmit  # clean
```

New/updated coverage:

- `tests/reel-link-resolver.test.ts` — sequential caching, concurrent
  singleflight, permalink caching, failure short-circuit, new-upload refresh.
- `tests/dm-content.test.ts` — empty URL vs sentinel, static URL preserved,
  failure drops the link, specific-post campaigns unchanged.
- `tests/campaign-validation.test.ts` — `{permalink}` accepted.
- `tests/webhook-processor.test.ts` — NEXT_POST matching with cached latest media.

---

## 10. Maintenance notes

- To change cache policy, edit the constants at the top of
  `lib/meta/reel-link-resolver.ts`.
- To change the sentinel, update `AUTO_REEL_LINK` in `lib/reel-link.ts` **and**
  the validation message/test fixtures. Stored campaigns keep the old token,
  so a migration would be needed for a production rename — prefer keeping it.
- To add auto-attach to another scope (e.g. story rules), call
  `buildAutomationContent()` from that send path with the correct `mediaId`.
- `clearReelLinkCache()` exists for tests; call it between cases that need a
  cold cache.
- Non-goal: this feature does not shorten URLs. Long `/go/` tokens are not
  linkified by Instagram, so real URLs with short UTM params are intentional.

---

## 11. Part 1 takeaway

**Next Post now really does auto-attach the reel:** the real permalink is
resolved once, cached across the whole fleet, and injected into the DM and
button at send time — with explicit static URLs and failure fallbacks handled
safely.

---

# Part 2 — Opening DM (Ask for Follow)

## 12. What problem it solves

The Opening DM is the first message a non-follower receives: "follow me, then
tap below", with an `OPTIN:<pendingId>` button. After the tap (or a DM reply) and
a successful follow check, the real guide DM is released.

The runtime flow already worked, but the feature was not properly established:

- The copy was editable in the campaign builder, but there was **no single
  source of truth** for its defaults, placeholders and length limits — the same
  logic was duplicated across campaign, rule and fallback paths.
- The opener was **not recorded as a sent DM**: no `dm_logs` row, no inbox
  message, no `dm_sent` metric. The dashboard counted *pending opt-in rows*
  (created before the Meta call, deleted on failure), so "Opening messages
  sent" could overstate reality.
- `loadPendingGateConfig()` fell back to `pending.message` — which is the
  **guide DM**, not the opener — when stored copy was missing.

## 13. Behavior

| Situation | Result |
| --- | --- |
| Confirmed follower | No opener — the guide DM is delivered immediately. |
| Confirmed non-follower | Opening DM with `OPTIN:` button; guide DM withheld until verified. |
| Meta check unavailable + `hold` (default) | Opening DM; follow policy never silently fails open. |
| Meta check unavailable + `deliver` | `follow_gate_exception` safety event; guide DM delivered. |
| Meta error 190 | Account flagged for reconnection; pending record removed. |
| Send fails (other) | Pending record removed; no false "sent" record. |
| Stored copy empty / legacy row | Shared default copy and button label are used. |
| Re-tap / DM reply | Same shared `releasePendingOptin()` path releases the guide DM. |

`{username}`, `{keyword}` and `{link}` are supported in the opener, with safe
defaults (`there`, `this`, empty). For `NEXT_POST` campaigns the `{link}` value
is intentionally empty in the opener — the real reel permalink is attached to
the guide DM, not to a "follow me" CTA.

## 14. Architecture / file map

| File | Role |
| --- | --- |
| `lib/meta/opening-dm.ts` | Pure copy module: `normalizeOpeningTemplate()`, `buildOpeningText()`, `renderOpeningDm()`. Reuses `formatDmText()` so link handling matches the guide DM. |
| `lib/meta/follow-gate.ts` | Follow verification, config normalisation, policy decision. Re-exports `buildOpeningText` for compatibility. |
| `lib/validation/follow-gate.ts` | One zod schema for the 500-char opener and 20-char button label, used by campaign, rule and fallback actions. |
| `lib/meta/webhook-processor.ts` | `sendOpeningDm()` owns dispatch, retry, token errors **and all side effects**; `applyFollowGate()` only decides whether to ask. |
| `components/campaigns/follow-gate-settings.tsx` | Reusable editor for message, button label and hold/deliver policy; shows a live phone preview. |
| `app/dashboard/overview/page.tsx` | "Opening messages sent" now counts `dm_logs` rows with `trigger_keyword = OPENING` and `status = SENT`. |

Why this split matters: one renderer means the opener can never drift from the
guide DM's placeholder/link rules; one sender means every opener is logged and
measured identically, whether it came from a comment, an inbox rule, a story
reply or a share.

## 15. Side effects of a successful opening DM

1. `safety_events` row — `kind = "follow_gate_opening"`.
2. `dm_sent` metric — target is the automation, rule or pending ID.
3. PostHog `follow_gate_opening_sent` with the verification reason.
4. Inbound-conversation `messages` row (outbound, bot, sent).
5. `dm_logs` row — `trigger_keyword = OPENING`, `keyword = OPENING`,
   `sequence_step = 0`, `variant = "opening"`, `status = SENT`, and the source
   `post_id` when the opener was triggered by a comment.

## 16. Tests and verification

- `tests/opening-dm.test.ts` — defaults, override, truncation, interpolation,
  safe fallbacks, clickable links.
- `tests/campaign-validation.test.ts` — shared length limit is enforced.
- `tests/follow-gate.test.ts` — verification/gate behavior unchanged by the
  copy-module move (`buildOpeningText` re-export keeps the existing API).

Run `npm test`, `npm run lint` and `npx tsc --noEmit` after any change here.

## 17. Maintenance notes

- Change default copy or length limits in `lib/follow-gate-constants.ts`; both
  the UI and validation pick them up automatically.
- To add another opener variable, extend `buildOpeningText()` and the docs —
  do not add ad-hoc replacements in the processor.
- Never send the `{permalink}` sentinel as the opener's `{link}`; strip it the
  way `applyFollowGate()` does.
- The guide DM remains the only place the auto-attached reel URL appears for
  `NEXT_POST` campaigns.

## 18. Part 2 takeaway

**Opening DM is fully wired:** creators can edit it in the UI, one schema and
one renderer govern its copy, one sender records every real send, and analytics
count delivered openers instead of pending records.

---

# Part 3 — 24h follow-ups

## 19. What problem it solves

The follow-up engine existed but could not be used end-to-end: nothing in the
UI could create a step, no cron was registered, the 24h clock started at the
first DM instead of the opt-in, a click/reply did not stop the sequence, and
conversion outcomes were not deduplicated through one path.

## 20. Behavior

| Situation | Result |
| --- | --- |
| Step due, no engagement | DM sent, `followup_events` records `sent`. |
| Opt-in confirmed 24h ago | Follow-up due — **opt-in is the clock**, first DM is the fallback. |
| Recipient clicked a tracked link after the anchor | `cancelled`, no DM. |
| Recipient replied after the anchor | `cancelled`, no DM. |
| Conversion recorded for the contact | `converted`, no DM — duplicate conversion webhooks cannot count twice. |
| In holdout bucket | `held_out`, no DM — stable hash keeps the same follower in the same bucket. |
| Send fails | No `sent` event, so a later cron run retries it. |
| Two cron runs overlap | Distributed lock (`withCronLock`) makes the second a no-op; unique event keys add a second layer. |

## 21. Architecture / file map

| File | Role |
| --- | --- |
| `lib/followup-constants.ts` | Client-safe limits and defaults (max 3 steps, 60 min–7 days, 1000-char message). |
| `lib/followup-policy.ts` | Pure decisions: anchor selection, due check, cancellation reason, step numbering. |
| `lib/validation/followup.ts` | One zod schema used by the editor's server action, so invalid steps never reach the engine. |
| `lib/followups.ts` | Bounded, batched engine. One `recordEvent()` path for all outcomes; content reused from `buildAutomationContent()`. |
| `components/campaigns/followup-steps-editor.tsx` | Accessible editor: labelled fields, fieldsets/legends, `aria-describedby`, alerts, kill switches, holdout slider. |
| `app/dashboard/campaigns/actions.ts` | `saveFollowupSteps()` — ownership check + validation + upsert/remove in one transaction of operations. |
| `vercel.json` | `7 * * * *` hourly cron for `/api/cron/followups`. |
| `supabase/migrations/20261126_followups_cancellation.sql` | Adds `cancelled` to the action constraint and indexes for due/engagement queries. |

### Scaling rules baked in

- An hourly cron wraps the whole run in a 55-second Redis lock.
- Steps are capped at 3 × 50 rows; each step processes at most 50 baseline DMs per run.
- Per step, contacts, conversions, clicks and replies are loaded with **one query each** (two for replies) and joined in memory — no query per recipient.
- All writes use upsert with `ignoreDuplicates`, so retries and overlapping schedules are harmless.

## 22. UI and accessibility

The editor lives on the campaign edit page under **24h follow-ups** and is linked from the campaign builder. Each step is a `<fieldset>` with a `<legend>`; inputs use real `<label htmlFor>` associations, the holdout slider has descriptive help text, validation errors use `role="alert"`, success uses `role="status"`, and every control is keyboard operable. A plain-language summary explains that the sequence stops on click, reply or conversion.

## 23. Tests and verification

- `tests/followup-policy.test.ts` — opt-in baseline, due check, cancellation ordering, invalid timestamps, step numbering.
- `tests/followups.test.ts` — deterministic holdout buckets and 0%/100% behavior (unchanged).

Run `npm test`, `npm run lint` and `npx tsc --noEmit` after any change here.

## 24. Maintenance notes

- Change limits/defaults in `lib/followup-constants.ts`; UI, validation and engine stay in sync.
- Never add a send path that bypasses `recordEvent()` — that is the dedupe boundary.
- If a new cancellation signal is needed, add it to `cancellationReason()` and to the migration's action constraint, not as an ad-hoc check in the engine.
- The QStash schedule at `/api/admin/followup-schedule` remains an alternative trigger; both hit the same locked cron route.

## 25. Part 3 takeaway

**24h follow-ups are usable and safe at scale:** creators can add steps in an accessible UI, the clock starts at opt-in, engagement cancels the sequence, and idempotent writes plus bounded batched queries keep the hourly job predictable.

---

# Part 4 — Public comment replies

## 27. What problem it solves

The Graph call itself worked, but two things undermined it in production:

- The result of `POST /{comment-id}/replies` was **discarded** — a failed public reply left no row, no metric and no diagnostic, even though the DM succeeded.
- The backend supports up to 10 rotating variants, but the builder stored exactly **one string**, and the field had no accessible label (placeholder only). Creators could not use rotation at all, and screen-reader users had no field name.

## 28. Behavior

| Situation | Result |
| --- | --- |
| DM delivered, public reply enabled | One variant is chosen and posted under the comment. |
| Several variants configured | Chosen randomly per send; blank/duplicate entries are removed first. |
| No variants configured | At least 3 natural defaults are used ("Sent you a DM! 📩", "Just sent it over to your inbox 👇", "Done — it's in your DM, {username}! ✅", plus more). |
| One variant configured | Two natural defaults are added automatically so the thread never shows one repeated line. |
| Same reply recently used | Excluded from the next pick. Redis remembers the last 3 per automation across instances, so two comments on different workers cannot get the same reply back-to-back. |
| Public reply fails | `public_replies` row with `status = failed`, error code/message, warning log and `public_reply_failed` event. The DM is still counted as sent. |
| Public reply succeeds | `public_replies` row with `status = sent` and a `public_reply_sent` PostHog event. Counted from the ledger, not the DM metric (so "DMs sent" stays honest). |
| Follow-up DM sent | No public reply — replies belong to the original comment only. |

Placeholders `{username}`, `{keyword}` and `{link}` use the same renderer as the DM, so the public text cannot drift from the private text.

## 29. Architecture / file map

| File | Role |
| --- | --- |
| `lib/public-replies.ts` | Natural defaults, client-safe pure helpers: `normalizePublicReplies()` (guarantees ≥3 variants), `choosePublicReply()` (excludes recently used), `renderPublicReply()`. |
| `lib/meta/public-reply-rotation.ts` | Recent-variant history in Redis (with in-process fallback) shared across serverless instances. |
| `lib/validation/public-replies.ts` | Shared zod schema (max 10 variants, 500 chars each), reused by campaign validation. |
| `lib/meta/webhook-processor.ts` | `sendPublicReply()` is the only send path: retry, ledger row, metrics, analytics. |
| `components/campaigns/public-reply-settings.tsx` | Accessible multi-variant editor with labels, help text, per-variant insert buttons and variant count. |
| `components/campaigns/phone-preview.tsx` | Shows the first variant and how many more are rotated. |
| `supabase/migrations/20261126_public_replies.sql` | Durable ledger with RLS and status indexes. |

## 30. Accessibility notes

The toggle and every message input have explicit `<label htmlFor>` associations; help text is linked with `aria-describedby`; errors use `role="alert"`; variant removal and placeholder insertion have descriptive `aria-label`s; the remove button is disabled when only one variant remains so the feature cannot be accidentally emptied. All controls are keyboard operable and show visible focus rings from the global theme.

## 31. Tests and verification

- `tests/public-replies.test.ts` — defaults, normalisation, caps, deterministic rotation, personalisation.
- `tests/campaign-validation.test.ts` — over-limit/long variants are rejected.

Run `npm test`, `npm run lint` and `npx tsc --noEmit` after any change here.

## 32. Part 4 takeaway

**Public replies are now honest and varied:** creators start with at least three natural variants, history-aware rotation never repeats the same reply back-to-back, and every send — success or failure — is recorded instead of silently disappearing.

---

# Part 5 — Re-run (durable jobs)

## 34. What problem it solves

The old re-run synchronously queried comments, then looped inside `after()` — a 60-second budget could truncate it, it reported "queued" before anything was sent, it happily re-DMed from paused campaigns, and there was no record of progress or failure.

## 35. Behavior

| Situation | Result |
|---|---|
| Dry run | Exact count of eligible commenters for a 1/7/30-day window, with examples. Nothing is sent. |
| Paused campaign | Rejected with a clear "Resume it first" message; the worker re-checks `active` on every batch and cancels a job if paused mid-run. |
| Real run | Creates a job plus one work item per recipient, publishes one QStash message, and returns a `jobId` immediately. |
| Processing | A worker handles 20 items per invocation, then publishes a continuation message. Batches are locked in Redis and items are claimed with compare-and-set, so duplicate deliveries cannot double-send. |
| Progress | The dialog polls `GET /api/campaigns/rerun/{jobId}` every 2s and shows sent/skipped/failed/pending with a progress bar. |
| Stop | "Stop re-run" calls `PATCH` with `action: cancel`; the worker stops on its next batch. |
| Failure | QStash retries exhausted messages go to the shared DLQ; the job can also be marked `failed` with a reason. |

Eligibility is unchanged in spirit: keyword match, one recipient per commenter, post-scope match (including latest media for NEXT_POST), and a 24-hour "already contacted" guard.

## 36. Architecture / file map

| File | Role |
|---|---|
| `lib/rerun-candidates.ts` | Shared eligibility query used by preview and job creation. |
| `lib/rerun-runner.ts` | Batched, locked, idempotent batch processor with QStash continuation. |
| `app/api/campaigns/rerun/route.ts` | Auth, active check, preview, job + item creation, queue publish. |
| `app/api/workers/rerun/route.ts` | Signed QStash worker for each batch. |
| `app/api/campaigns/rerun/[jobId]/route.ts` | `GET` progress and `PATCH` cancellation. |
| `components/campaigns/rerun-dialog.tsx` | Accessible preview → progress → result flow. |
| `supabase/migrations/20261126_rerun_jobs.sql` | Job ledger, work items, status constraints, RLS. |

## 37. UX and accessibility

The dialog uses labelled radio options for the look-back window (`<fieldset>/<legend>`), `role="status"` while previewing, `role="alert"` for errors, `aria-live="polite"` with a `role="progressbar"` for progress, and a clear "Stop re-run" action while work is in flight. Every state — preview, running, completed, cancelled — is described in plain language. Nothing says "queued DMs" until the DMs are actually sent.

## 38. Tests and verification

- `tests/rerun-candidates.test.ts` — keyword matching rules.
- `npm test`, `npm run lint`, `npx tsc --noEmit` — all clean.

## 39. Part 5 takeaway

**Re-runs are now a durable job, not a background hope:** work is queued in small idempotent batches, progress is real and live, paused campaigns cannot send, and the creator can stop a run at any time.

---

# Part 6 — Personalised DMs

## 40. What problem it solves

Only `{username}`, `{link}` and `{keyword}` worked. `{name}` did not exist, the landing page promised unique vouchers that were never generated, and values collected through lead forms (`display_name`, `email`, `phone`) were never used in a message.

## 41. Available variables

| Token | Source | Behavior |
| --- | --- | --- |
| `{username}` | context | Instagram username, falls back to "there". |
| `{name}` | contact | Collected display name; falls back to the email local part, then username, then "there". |
| `{email}` / `{phone}` | contact | Collected lead fields; empty when not collected. |
| `{keyword}` | context | The trigger keyword. |
| `{link}` | context | Destination URL with attribution params. |
| `{voucher}` | voucher | Stable unique code per person, e.g. `ALEX-7K2M9Q`. |
| `{voucher_url}` | voucher | Tracked link with `?voucher=CODE` for one-click attribution. |

Both `{name}` and `{{name}}` work, case-insensitively. Unknown tokens are left visible so typos are obvious rather than silently blanked.

## 42. Architecture / file map

| File | Role |
|---|---|
| `lib/dm-variables.ts` | Client-safe catalogue, renderer, discovery and fallbacks — one source of truth. |
| `lib/vouchers.ts` | HMAC-derived, stable codes + durable audit rows in `dm_vouchers`. |
| `lib/meta/dm-variable-resolver.ts` | Loads contact fields only when a template uses them; mints vouchers only when needed. |
| `lib/meta/dm-template.ts` | `personalizeMessage` / `formatDmText` delegate to the shared engine. |
| `lib/meta/webhook-processor.ts` | `varsForTemplate()` used by every send path (comment, opt-in, rule, opening, follow-up, re-run). |
| `components/campaigns/dm-variable-picker.tsx` | Accessible click-to-insert chips with descriptions and a warning when contact fields are not collected. |
| `supabase/migrations/20261126_dm_vouchers.sql` | Voucher ledger with RLS. |

### Why it scales

Resolution is demand-driven: no contact query unless `{name|email|phone}` is present, and no voucher/HMAC work unless `{voucher|voucher_url}` is present. Voucher codes are deterministic, so retries and concurrent workers produce the same value without a DB lottery; the upsert is idempotent.

## 43. UX and accessibility

- Variable chips are real buttons with `aria-label` describing what each token does, and `aria-pressed` showing which are already in the message.
- Clicking a chip inserts the token **at the cursor**, not at the end of the text.
- The textarea has a real `<label>` and `aria-describedby` help text.
- A plain-language warning appears if a contact variable is used without a selected lead field.
- The **Collect details** selector explains exactly why it exists and offers "Nothing" as the default.
- The phone preview uses the *production* formatter with sample values, so what you see is what followers get.

## 44. Tests and verification

- `tests/dm-variables.test.ts` — discovery (both brace styles), rendering, fallbacks, unknown tokens, missing-value reporting, legacy compatibility, deterministic vouchers.
- `npm test`, `npm run lint`, `npx tsc --noEmit` — clean.

## 45. Part 6 takeaway

**Personalisation is now real and honest:** every documented token works everywhere messages are sent, collected lead data flows back into the copy, and vouchers are unique, stable and attributable without any extra setup.

---

# Part 7 — DM variations

## 46. What problem it solves

A rotator existed but nothing ever populated the variant array — the campaign builder always sent `[]`. Callers also never passed `previousIndex`, so the same message could land on two consecutive followers.

## 47. Behavior

| Situation | Result |
|---|---|
| No variants configured | The main message is used — identical behavior to before. |
| Variants configured | One is chosen per send; the previous variants are excluded, so consecutive repeats cannot happen. |
| Two events on different workers | Redis-backed history keeps the exclusion list shared, so the guarantee survives serverless scaling. |
| A send fails | The variant is not recorded, so it is not "burned" by a failed delivery. |
| Empty/duplicate/overlong variant | Cleaned before saving; max 10 variants of 1000 characters each. |
| Rule / opt-in / follow-up / re-run | All use the same chooser and history scope (`auto:<id>` or `rule:<id>`). |

## 48. Architecture / file map

| File | Role |
|---|---|
| `lib/message-variants.ts` | Pure normalization + history-aware chooser shared with public replies. |
| `lib/dm-variants.ts` / `lib/validation/dm-variants.ts` | Shared limits and zod schema for campaigns, rules and fallback. |
| `lib/meta/variant-history.ts` | Redis + in-process recent-variant memory, scoped by key. |
| `lib/meta/public-reply-rotation.ts` | Named wrapper so public replies and DM variants never share a bucket. |
| `lib/meta/webhook-processor.ts` | `chooseDmVariant()` / `recordDmVariant()` used by every send path; `dm_logs.variant` records `variant-N`. |
| `components/campaigns/dm-variants-editor.tsx` | Accessible multi-variant editor with the shared variable picker on every variant. |

## 49. UX and accessibility

Variants are labelled fields with their own variable pickers and character counts; add/remove buttons have descriptive `aria-label`s; the limit is shown as "N of 10"; the phone preview shows how many extra variations rotate. The copy explains *why* variants matter ("identical replies are the strongest spam signal") rather than just exposing a setting.

## 50. Tests and verification

- `tests/dm-variants.test.ts` — normalization, caps, exclusion of recent variants, a 20-send simulated thread with no consecutive repeats, single-variant fallback.
- `tests/campaign-validation.test.ts` — over-limit/long variants rejected.

## 51. Part 7 takeaway

**DM variants are now real:** creators can write them, validation keeps them safe, and a shared cross-instance history guarantees a different message next time.

---

# Part 9 — Short-link rotation

## 58. What problem it solves

`/go/[slug]` existed and tracked clicks, but `createTrackedLink()` was only used in tests, DMs sent the raw destination with UTMs, there was no multiple-destination support or rotation logic, no UI, and the click ledger was missing six columns the route already wrote.

## 59. Behavior

| Situation | Result |
|---|---|
| Smart links off | The destination URL is sent directly with UTM params — unchanged behavior. |
| Smart links on, single destination | A genuinely short URL (e.g. `dmpl.co/A1b2C3d4`) is sent; it redirects to the destination with attribution appended. |
| Rotation group configured | Each recipient is assigned a destination using sticky hashing (same person always gets the same link) or round-robin. |
| Click | The short link resolves from Redis/DB, records a click row with full attribution, and redirects with UTMs appended. |
| Legacy DM | Old signed tokens still resolve and redirect. |
| R2/Cloudflare | Not involved — short links are pure data, no binary. |

Short links matter because Instagram does not linkify long tokens in DM text; an 8-character code fits on one line and renders as a real clickable link.

## 60. Architecture / file map

| File | Role |
|---|---|
| `lib/link-rotation.ts` | Pure sticky/round-robin selection and hashing. |
| `lib/meta/link-resolver.ts` | Creates stable short codes, resolves rotators, caches in Redis, records clicks. |
| `app/go/[slug]/route.ts` | Resolves DB short links (Redis-cached) with legacy signed-token fallback. |
| `app/dashboard/campaigns/link-actions.ts` | Create/update/delete rotation groups with ownership checks. |
| `components/campaigns/link-rotation-settings.tsx` | Accessible toggle, rotator selector, inline destination editor and delete. |
| `components/campaigns/link-performance.tsx` | Per-link clicks, unique clickers and last-click date. |
| `supabase/migrations/20261126_short_links.sql` | Rotator, target, tracked-link tables, missing click columns, RLS. |

### Why it scales

Codes are deterministic per (scope, recipient, destination), so retries and concurrent workers never create duplicate rows. Redis caches link resolution for 5 minutes and rotator metadata for 5 minutes. Clicks are recorded with the token and automation id, so dashboards aggregate per destination without extra joins.

## 61. UX and accessibility

The editor explains what a smart link does in one sentence, shows the actual short form (`dmpl.co/A1b2C3d4`), offers two clearly named rotation styles ("Same link per person" vs "Rotate evenly"), and exposes per-link click counts so creators can see which destination actually converts. All controls are keyboard operable with labelled fields.

## 62. Setup

Set `SHORT_LINK_DOMAIN` (e.g. `https://dmpl.co`) for the shortest possible links. Without it, the app origin + `/go` is used.

## 63. Tests and verification

- `tests/link-rotation.test.ts` — deterministic sticky assignment, spread, round-robin cycling, disabled-target skipping, empty result.
- `npm test`, `npm run lint`, `npx tsc --noEmit` — clean.

## 64. Part 9 takeaway

**Short links are real and measurable:** followers get a short, clickable, tracked URL, creators can split destinations across an audience, and every click lands in a ledger with full attribution.

---

# Part 10 — DM queue

## 65. What problem it solves

QStash is the real queue, but `kind="queued"` overflow rows were write-only: parked by `sendCommentDm` and never drained. The manual send endpoint also bypassed every safety guard — no hourly cap, no cooldown, no dedupe — so a creator could violate Meta's limits from the Inbox.

## 66. Behavior

| Situation | Result |
|---|---|
| Hourly cap reached | The DM is parked in `pending_dms` (`kind = 'queued'`) and retried by the worker. |
| Cap still full on retry | Backoff (5 → 10 → 20 → 40 → 60 min) and retry up to 5 times. |
| 5 failures | Row marked `failed` with the last error; visible on the Overview dashboard. |
| Manual DM | Hourly cap (30/hour), recipient cooldown, 24h dedupe, personalisation and logging all apply. |
| Cap reached manually | Returns 429 with `retryAfterMs`; nothing is silently dropped. |
| Worker unavailable | `/api/cron/drain-dm-queue` runs hourly as a fallback. |

## 67. Architecture / file map

| File | Role |
|---|---|
| `lib/dm-queue.ts` | Enqueue, drain, stats. Bounded batches, Redis lock, compare-and-set claims, backoff. |
| `app/api/workers/drain-dm-queue/route.ts` | Signed QStash worker, continuation publish. |
| `app/api/cron/drain-dm-queue/route.ts` | Authenticated cron fallback. |
| `app/api/instagram/send-dm/route.ts` | Manual sends now go through the same safety guards. |
| `components/dashboard/dm-queue-card.tsx` | Queue depth, failures, oldest age and "Drain now". |
| `supabase/migrations/20261126_dm_queue.sql` | Status, attempts, backoff and error columns plus drain indexes. |

## 68. UX and accessibility

The Overview dashboard shows pending count, failed count and the age of the oldest queued DM, with a "Drain now" button that is disabled when the queue is empty. Errors are announced with `role="alert"` and successes with `role="status"`. Creators never have to guess whether an overflowed DM will be delivered.

## 69. Tests and verification

- `npm test`, `npm run lint`, `npx tsc --noEmit` — clean. The queue engine is exercised by the same processor tests (`processCommentEventForAutomation`).

## 70. Part 10 takeaway

**The queue is real and safe:** overflowed DMs are parked, retried with backoff, counted and visible, and manual sends can no longer outrun Meta's limits.

---

# Part 8 — Six DM formats (Cloudflare R2)

## 52. What problem it solves

Only text (plus a button template) was sendable. There was no format column, no selector, no storage and no preview. This part adds audio, PDF, image/video, card and carousel end-to-end, with **Cloudflare R2** as the asset backend.

## 53. Supported formats

| Format | Meta attachment | Asset |
| --- | --- | --- |
| Text | plain text | none |
| Audio | `audio` | AAC/M4A/WAV/MP4, 25 MB |
| PDF | `file` | PDF, 25 MB |
| Media | `image` / `video` | PNG/JPEG/GIF/WebP 8 MB, video 25 MB |
| Card | generic template, 1 element | optional image URL |
| Carousel | generic template, up to 10 elements | optional image URLs |

Companion text is sent in the same message for media/file formats. Templates cannot carry companion text, so it is sent as a preceding DM when configured. If an asset is missing or Meta rejects the attachment, the message degrades to text rather than failing — no lead is lost.

## 54. Cloudflare architecture

| File | Role |
|---|---|
| `lib/cloudflare/r2.ts` | S3-compatible R2 client, presigned PUT URLs (2 min), public CDN URLs, safe object keys under `workspaces/{id}/messages/{format}/…`, scoped deletion. |
| `app/api/assets/sign/route.ts` | `GET` config status, `POST` signed upload ticket with auth + MIME/size validation, `DELETE` scoped asset removal. |
| `lib/message-formats.ts` | Client-safe format catalogue, Meta limits and card normalisation. |
| `lib/meta/message-attachments.ts` | Pure builder producing Graph attachment payloads for every format. |
| `lib/meta/client.ts` | `sendDirectMessageWithAttachment()` and `sendPrivateReplyWithAttachment()` unified send path. |
| `lib/meta/dm-content.ts` | Renders format config with personalisation variables into the final payload. |
| `components/campaigns/message-format-editor.tsx` | Accessible format selector, direct-to-R2 uploader, card/carousel editor, honest "R2 not configured" state. |
| `supabase/migrations/20261126_message_formats.sql` | `automations.message_format`, `message_assets`, `dm_logs.message_format` and format constraint. |

### Why it scales

Binary files never touch the application server: the browser PUTs straight to R2 using a short-lived signed URL, and Meta fetches the immutable, CDN-cached public URL. Object keys are versioned UUIDs with a one-year immutable cache header, so uploads are safe to cache and impossible to overwrite. R2 has no egress fees, so media volume does not increase delivery cost.

## 55. Setup

Add five environment variables (also documented in `.env.example`):
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_CDN_URL`.
Enable a public CDN domain (or r2.dev) on the bucket and configure CORS for `PUT`/`HEAD` from the app origin. The editor shows a clear notice and disables uploads until these are set.

## 56. Tests and verification

- `tests/message-formats.test.ts` — MIME/size validation, all six Graph payloads, variable rendering, card limits, graceful text fallback.
- `npm test` (156 passing), `npm run lint`, `npx tsc --noEmit` — clean.

## 57. Part 8 takeaway

**All six formats are real and Cloudflare-backed:** assets upload directly to R2, Meta receives stable public URLs, and every send is validated, previewed and logged by format without putting binary traffic through the platform.

---

# Part 11 — Safety engine

## 71. What problem it solves

LinkPlease markets a "Safety Engine" with a live dashboard showing 100% delivered and 0 breaches — but those numbers are a mockup. Our safety was already more honest (real token bucket, cooldown, dedupe, jitter, QStash) but it was invisible to creators and never proactively throttled during a spike.

## 72. Behavior

| Situation | Result |
|---|---|
| Normal traffic | Sends go out immediately with small jitter. |
| 25+ comments/min on one account | Elevated level: 3s delay, delivery continues. |
| 100+ comments/min | Critical level: delivery paused, DMs parked in the durable queue for 10s. |
| Hourly cap exceeded | `rate_limit_breach` safety event + queue park. |
| 3 consecutive failures | `safety_degraded` event; account marked degraded. |
| 5 consecutive failures | Auto-pause with `safety_auto_paused` event; creator can resume. |
| Token invalid (Meta 190) | Account marked `token_invalid`; all sends stop until reconnect. |
| Inbound "stop"/"unsubscribe" | `opted_out_at` set; future DMs and follow-ups skipped; confirmation sent. |
| Inbound "start"/"subscribe" | Opt-out cleared, re-subscribed. |
| Unsafe campaign (loops, >3 links, dup keywords) | Rejected at create/update with field-level errors. |

## 73. Architecture / file map

| File | Role |
|---|---|
| `lib/meta/throttle.ts` | Proactive viral-spike throttle (elevated/critical). |
| `lib/meta/account-health.ts` | Consecutive failures, last send, token status, auto-pause. |
| `lib/meta/safety-score.ts` | Pure composite score (0–100) + band + deductions. |
| `lib/meta/webhook-processor.ts` | `recordSafety()` kinds: `rate_limit_breach`, `viral_throttle`, `viral_spike`, `opt_out`. `isOptedOut`/`recordOptOut`. |
| `app/dashboard/safety/page.tsx` | Dedicated dashboard: score, live gauge, queue, account health, recent events. |
| `app/api/cron/safety-retention/route.ts` | 30-day retention for `safety_events`. |
| `components/dashboard/safety-card.tsx` | Per-account health with pause/resume. |
| `supabase/migrations/20261127_safety_phase2.sql` | `opted_out_at`, account health columns, indexes. |

## 74. UI and accessibility

- Safety score is a single number with a colour bar, band label and a list of deductions — no mystery numbers.
- Live gauge shows sends/min vs Meta limit with green/amber/red thresholds.
- Account health shows token status, consecutive failures and last error in plain text.
- Pause/resume is a real button with a clear consequence ("queued DMs wait for resume").
- Recent events list shows kind + timestamp; empty state reassures ("nothing has been throttled").
- All live counters use `aria-live` and text + icon, never colour alone.

## 75. Meta platform limits (source of truth)

The engine is calibrated to Meta's documented ceilings, not guesses. Constants live in `lib/meta/limits.ts`.

| Meta limit | Documented value | How we stay under it |
|---|---|---|
| Private replies to post/reel comments | 750 / hour / Instagram account | Account-level ceiling of 700/hour shared across every automation; overflow is queued. |
| Send API (text, links, reactions, stickers) | 300 / second / account | Randomized pre-send delay + token bucket. |
| Send API (audio/video) | 10 / second / account | Same delay + bucket; media sends are naturally slower. |
| Conversations API (reading threads) | 2 / second / account | Inbox reads are paginated and cached. |
| High-volume inbox block | 72,000 messages sent+received | Proactive throttle + queue depth alerts. |
| Standard messaging window | 24 hours from the person's last message | Automated replies run inside the window; manual replies outside it use the `HUMAN_AGENT` tag (7 days). |

**Permissions used:** `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management`. The Human Agent escalation path is the Inbox: a human reply pauses the bot and, outside 24h, is sent with `messaging_type=MESSAGE_TAG` + `tag=HUMAN_AGENT`.

## 76. Tests and verification

- `tests/safety-score.test.ts` — 100 baseline, deductions, clamping, summary.
- `tests/safety-limits.test.ts` — Meta limit constants, 30-day reply-once memory, spam screening.
- `npm test`, `npm run lint`, `npx tsc --noEmit` — clean.

## 77. Part 11 takeaway

**Safety is now measured, not mocked:** every throttle, breach, opt-out and failure is recorded, scored and visible, with proactive protection during spikes and reversible auto-pause.

---

# Part 12 — Safety polish

## 77. What problem it solves

The engine was complete, but the product layer around it was not: safety events
showed raw machine codes, there was no recurring summary, and the Meta Tech
Provider badge (our single biggest trust gap vs LinkPlease) had no documented
application path.

## 78. Behavior

| Feature | Behavior |
|---|---|
| Plain-English explanations | Every safety event kind (`rate_limit_breach`, `viral_throttle`, `opt_out`, …) renders a human sentence in the dashboard and digest. Unknown kinds fall back to a readable label. |
| Weekly safety digest | `/api/cron/safety-digest` runs Monday 09:00, aggregates 7 days of safety events per workspace, and emails the configured admin list via Resend. |
| Tech Provider badge | `docs/META_TECH_PROVIDER_BADGE.md` lists prerequisites, application steps, demo-video requirements and post-approval code locations. |

## 79. Architecture / file map

| File | Role |
|---|---|
| `lib/safety-event-explanations.ts` | Single source of truth for event-kind copy. |
| `lib/email.ts` | Shared Resend helper used by the digest and capacity alerts. |
| `app/api/cron/safety-digest/route.ts` | Weekly digest cron (auth-protected). |
| `docs/META_TECH_PROVIDER_BADGE.md` | Business-action playbook for the Meta badge. |

## 80. Part 12 takeaway

**Safety is now both honest and legible:** machine codes never reach a creator, a weekly digest arrives by email, and the Meta badge application is a documented, repeatable process.

---

# Part 13 - Meta Insights integration

## 81. What problem it solves

Creators could see DMs sent but not the reach and impressions those DMs were competing against, so "conversion rate" was a guess. T1.5 pulls Meta's own Insights so every campaign can be measured against the audience it actually reached.

## 82. Behavior

| Situation | Result |
|---|---|
| Account has instagram_manage_insights | Daily snapshots of reach, impressions, profile views and website clicks are stored. |
| Recent posts/reels/stories | Per-media snapshots (reach, views, saved, shares, likes, comments, story views) are stored with the media id. |
| Scope missing | No Insights call is made. The account is marked 
eeds_access and the Overview shows a "Reconnect Instagram" state. |
| Meta rejects a metric | The fetcher retries the legacy metric set (impressions instead of iews) before giving up. |
| Conversion rate | utomated DMs / post impressions per campaign, plus an aggregate figure. |
| Daily refresh | /api/cron/insights runs at 03:15 UTC; the Overview button triggers an on-demand refresh. |

## 83. Architecture / file map

| File | Role |
|---|---|
| lib/meta/insights.ts | Account/media fetchers, scope reader, error classifier, legacy-metric fallback. |
| lib/meta/insights-sync.ts | Scope gate, account + per-media persistence, sync status. |
| lib/insights-analytics.ts | Pure aggregation: totals, daily series, per-media, per-campaign conversion. |
| supabase/migrations/20261127_insights_v2.sql | media_id/scope/product_type/permalink/caption, scope + sync-status columns. |
| pp/api/cron/insights/route.ts | Daily refresh (cron-locked). |
| pp/api/insights/refresh/route.ts | On-demand refresh for the signed-in creator. |
| pp/dashboard/overview/page.tsx | Metric cards, 30-day reach trend, per-campaign conversion table, access-needed state. |

## 84. UI and accessibility

- Five metric cards (reach, impressions, profile views, story views, conversion) with text labels and icons, never colour alone.
- Reach trend is a ole="img" chart with an ria-label and per-bar 	itle.
- Per-campaign table uses real <table>, <th scope="col"> and right-aligned numeric columns.
- Missing access is a ole="alert" with two clear actions: reconnect or run diagnostics.
- Last-sync timestamp is shown so stale data is obvious.

## 85. Tests and verification

- 	ests/insights-analytics.test.ts - aggregation, per-media grouping, conversion math, scope detection, error classification.
- 
pm test, 
pm run lint, 
px tsc --noEmit - clean.

## 86. Part 13 takeaway

**Insights are now first-class:** real Meta reach and impressions, per-post and per-campaign conversion, a graceful permission state, and a daily refresh that never calls Meta without the scope.
