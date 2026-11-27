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
* When the domain is ready, follow **§10 of [EXTERNAL_ACTIONS_BEFORE_LAUNCH.md](./EXTERNAL_ACTIONS_BEFORE_LAUNCH.md)** in order: create the Turnstile widget, add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to **Vercel → Environment Variables**, redeploy, then enable CAPTCHA in Supabase with the secret key."
