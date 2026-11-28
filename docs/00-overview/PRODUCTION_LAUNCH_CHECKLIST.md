 Give me a concise production launch checklist for a LinkPlease / Zorcha alternative on Next.js, Upstash Redis, QStash, and Cloudflare R2.

Here is a concise production launch checklist for a LinkPlease / Zorcha alternative built on Next.js, Upstash Redis, QStash, and Cloudflare R2 (with PostgreSQL for durable records and daily metrics).

---

> ⚠️ **First, complete [EXTERNAL_ACTIONS_BEFORE_LAUNCH.md](./EXTERNAL_ACTIONS_BEFORE_LAUNCH.md).** It tracks the dashboard/console actions that cannot be done in code — including **subscribing the Meta app to `message_reactions` and `story_insights` webhook fields**, without which Story-to-DM reactions and aggregate story-insight events will never be delivered.

### 1. Security & Instagram Webhook Readiness

* **Verify X-Hub-Signature-256 on raw bytes:** Read the raw body before JSON.parse and compare the HMAC-SHA256 digest with crypto.timingSafeEqual using META_APP_SECRET, returning 401 on invalid signatures.
* **Implement GET webhook handshake:** Validate hub.mode=subscribe and hub.verify_token against META_VERIFY_TOKEN, returning hub.challenge with HTTP 200.
* **Acknowledge webhooks fast:** Return 200 OK immediately after signature check, deduplication, and enqueueing so Meta does not retry healthy deliveries.
* **Encrypt & proactively refresh IG tokens:** Store long-lived tokens encrypted at rest (AES-256-GCM with TOKEN_ENCRYPTION_KEY) and refresh tokens within ~15 days of expiry (when at least 24h old) behind a short Redis lock.

---

### 2. Upstash Redis & QStash Reliability

* **Deduplicate webhook events:** Use atomic SET ... NX EX on event IDs (comment_id / mid) so Meta retry bursts never send duplicate DMs.
* **Enforce per-creator & per-recipient rate limits:** Protect Instagram API limits per creator account and prevent spamming the same follower on repeated comments, queuing overflow DMs with a QStash delay instead of dropping leads.
* **Verify QStash signatures on every worker & cron:** Wrap worker and cron routes in verifySignatureAppRouter using both QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY.
* **Handle follow-up cancellations & 24h messaging window:** Cancel scheduled follow-up QStash messages (qstash.messages.cancel) and update Redis state when a follower clicks a tracked link or replies—and keep follow-up delays inside Meta's 24-hour messaging window.
* **Configure failureCallback & DLQ workflows:** Attach failureCallback to DM jobs, return 500 on transient errors and 200 on permanent failures, and make workers idempotent before replaying DLQ messages.
* **Set Redis TTLs, budget caps & cron schedule:** Ensure cache/rate-limit/dedupe keys have EX TTLs, configure a Pay-as-You-Go monthly budget cap, and upsert the recurring QStash schedule for /api/cron/flush-metrics.

---

### 3. Cloudflare R2 & Analytics Pipeline

* **Use custom domain + edge caching + presigned uploads:** Serve creator avatars, link thumbnails, and lead magnets via a custom domain on R2 ($0 egress) with direct browser presigned uploads so serverless functions never bottleneck on file sizes.
* **Invalidate cache on dashboard edits:** Evict cached link-in-bio configs and keyword trigger rules in Redis (and revalidate Next.js routes) whenever a creator updates settings.
* **Verify atomic metrics flushing & DB rollups:** Confirm /api/cron/flush-metrics resets Redis counters atomically (getset), upserts into daily_creator_metrics (ON CONFLICT ... DO UPDATE), restores deltas on DB failure, and merges historical DB rows with today's Redis counters in /api/analytics.

---

### 4. Pre-Launch Smoke Tests

* **End-to-end DM flow:** Send a test comment/DM payload -> confirm signature check, deduplication, rate-limit queueing, QStash worker dispatch, and DB/Redis metric increments.
* **Follow-up cancellation:** Trigger a scheduled follow-up -> click the tracked link (or simulate a reply) -> confirm the follow-up is cancelled/skipped.
* **Failure & DLQ recovery:** Force a transient 500 in a test worker -> confirm QStash retries, hits failureCallback, lands in DLQ, and replays cleanly once fixed.

---

### 5. Deferred until a domain is available

* **Cloudflare Turnstile CAPTCHA:** the code is ready, but Turnstile requires a domain name when creating the widget. Until you have a domain, keep CAPTCHA **disabled** in Supabase (Authentication → Attack Protection → CAPTCHA); the forms render no widget when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset.
* When the domain is ready, follow **§10 of [EXTERNAL_ACTIONS_BEFORE_LAUNCH.md](./EXTERNAL_ACTIONS_BEFORE_LAUNCH.md)** in order: create the Turnstile widget, add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to **Vercel → Environment Variables**, redeploy, then enable CAPTCHA in Supabase with the secret key.

---

### 6. Deployment notes — 2026-11-28 hardening

The live Supabase project (`fgvcizjuhakjdklezgpe`) already has these migrations
applied. The full record is in
[`docs/supabase-live-migrations-2026-11-28.md`](../supabase-live-migrations-2026-11-28.md).

#### 6.1 Migrations (applied)

- [x] `supabase/migrations/20261128_rerun_hardening.sql` — owner-only `rerun_jobs` UPDATE policy, `is_workspace_owner`, `enforce_rerun_job_workspace` trigger.
- [x] `supabase/migrations/20261128_cron_locks.sql` — `cron_locks` table + `acquire_cron_lock` / `release_cron_lock`.
- [x] `supabase/migrations/20261128_qstash_replay.sql` — `qstash_replay_guard` + `claim_qstash_signature`.
- [x] `supabase/migrations/20261128_pending_dms_queue_hardening.sql` — `enqueue_queued_dm`, account guard, queue check constraint.
- [x] `supabase/migrations/20261128_webhook_claim_lease.sql` — `lease_expires_at`, `claim_webhook_payload`.
- [x] `supabase/migrations/20261128_webhook_dedupe_analytics.sql` — webhook analytics columns, `webhook_health`, `dm_send_claims`.
- [x] `supabase/migrations/20261127_pending_dms_workspace_guard.sql`, `20261127_rerun_claim_timestamp.sql`, `20261127_webhook_events_retention_index.sql`.
- [x] `supabase/migrations/20261128_reference_binding.sql` — `followup_steps.automation_id`, `dm_logs.automation_id`, `conversations.contact_id`, and `messages.conversation_id` bound to the row's workspace (0 pre-existing violations).
- [x] `supabase/migrations/20261128_conversion_token_version.sql` — `workspaces.conversion_token_version` for token rotation.
- [x] `supabase/migrations/20261128_workspace_members_insert.sql` — owner-only INSERT policy on `workspace_members`.
- [x] `supabase/migrations/20261128_oauth_state_nonces.sql` — single-use OAuth state nonces.
- [x] `supabase/migrations/20261128_pending_dms_claim.sql` — `pending_dms.claimed_at` atomic claim marker.
- [x] `pending_dms_queued_requires_automation` validated (`convalidated = true`; 0 legacy rows with a null `automation_id`).

#### 6.2 Environment

- [ ] **Set `ADMIN_API_SECRET` in Vercel Production** to a value **different from `CRON_SECRET`**.
  - `deliver-guide`, `webhook-replay`, `dlq`, `sync-profile`, and `followup-schedule` require it.
  - Production fails closed (401) without it.
  - Scheduled crons (`/api/cron/*`, `/api/admin/alerts/check`) keep using `CRON_SECRET`.

#### 6.3 Operator scripts

- [ ] Any script or dashboard that calls `deliver-guide`, `webhook-replay`, `dlq`, `sync-profile`, or `followup-schedule` must switch from the cron bearer to `ADMIN_API_SECRET`.
- [ ] The follow-up QStash schedule still injects `CRON_SECRET` into its `/api/cron/followups` destination header; that is correct and should not be changed.

#### 6.4 Redis outage behavior

- [ ] Confirm the team knows that during a Redis outage crons now **skip** (`locked: true`) rather than run concurrently. This is the intended fail-closed behavior; the Postgres `cron_locks` fallback keeps mutual exclusion when Redis is down, and if both stores are unavailable the run is skipped.
- [ ] Confirm the retention cron prunes `dm_send_claims`, `qstash_replay_guard`, and `cron_locks` by `expires_at`.

#### 6.5 Meta egress and logging

- [ ] **Allow POST to `graph.facebook.com`.** The OAuth code exchange and long-lived token exchange now send `client_secret` in a POST body. An egress proxy/WAF that only allows GET will break Facebook login and token refresh.
- [ ] **Disable or redact request logging for `graph.instagram.com`.** Meta's Instagram long-lived token endpoint only accepts GET with `client_secret` in the query string. Ensure proxy, CDN, APM and platform request logs do not capture that URL.
- [ ] **Run the webhook re-subscribe backfill after deploy:**
  ```bash
  curl -X POST "https://<your-domain>/api/admin/resubscribe-webhooks" \
    -H "Authorization: Bearer <ADMIN_API_SECRET>" \
    -H "Content-Type: application/json" \
    -d '{"limit": 50}'
  ```
  Repeat until `scanned` is 0. This corrects any `webhook_subscribed = true` rows written before the connect route stored the real Meta result.

#### 6.6 OAuth origin and vault rotation

- [ ] **Set `APP_URL` or `NEXT_PUBLIC_SITE_URL` to the exact public origin registered in the Meta app's Valid OAuth Redirect URIs.** The callback and connect routes no longer derive the origin from `x-forwarded-host`/`x-forwarded-proto`; without a configured origin, OAuth fails closed with an `/auth/error` redirect. The registered redirect URI must be `<origin>/api/auth/meta/callback`.
- [ ] **Set a dedicated `OAUTH_STATE_SECRET` in production**, different from `TOKEN_VAULT_SECRET`. The app now fails closed without it; the vault key is no longer accepted as the OAuth-state HMAC key.
- [ ] **If any tokens were encrypted under the old hardcoded vault key**, set `TOKEN_VAULT_LEGACY_SECRET` to that old key so the refresh cron can decrypt and re-encrypt them. Remove `TOKEN_VAULT_LEGACY_SECRET` once the refresh cron reports no remaining legacy rows. There is no hardcoded fallback in any environment.
- [ ] **Legacy plaintext tokens are rejected by `decryptToken`.** The refresh cron still migrates `EAA…`/`IG…` plaintext rows through `readStoredTokenForMigration`; any non-cron caller now requires a vault ciphertext.

#### 6.7 Conversion token rotation

- [ ] **Existing conversion tokens are invalidated by this deploy.** The signing key is now purpose-derived and the migration defaults `workspaces.conversion_token_version` to 1, while old tokens parse as version 0. Owners must copy the new token from **Settings → Conversion token** and update their checkout/pixel.
- [ ] **Use the "Rotate token" button** in Settings to revoke a leaked token immediately; it increments `conversion_token_version`, and the ingest route rejects every token with an older version.
- [ ] **Conversion tokens now expire after one year.** Rotate before expiry or the checkout will start receiving 401s.

#### 6.8 Webhook, auth, and diagnostics hardening

- [ ] **`META_APP_SECRET` must be the secret of the app that owns the webhook subscription.** Webhook verification now accepts at most one secret; the `INSTAGRAM_APP_SECRET`/`FACEBOOK_APP_SECRET` aliases are used only when `META_APP_SECRET` is unset.
- [ ] **Turnstile and Supabase CAPTCHA must agree.** If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, configure the matching secret in Supabase → Authentication → Attack Protection → CAPTCHA. If it is unset, disable Supabase CAPTCHA for that environment; otherwise auth requests are rejected for a missing token.
- [ ] **Password changes revoke other sessions.** The change-password action calls `signOut({ scope: "others" })`; confirm Supabase's reauthentication setting is enabled as the authoritative layer.
- [ ] **Diagnostics configuration checks are admin-only.** Non-admins see operational checks plus a "Managed by admin" card; the Meta latency probe is cached for 5 minutes.
- [ ] **The click buffer is capped at 10,000 entries** and `safety_events` retention is 90 days, matching the architecture doc.
