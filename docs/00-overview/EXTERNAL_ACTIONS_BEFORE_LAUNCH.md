# External actions before production launch

> Things that **cannot** be done in this repository. Code, migrations and tests are already merged and deployed; these are dashboard/console actions a human must complete or verify. Keep this file open during the launch review.

---

## 1. Meta app — webhook field subscriptions (REQUIRED for Story-to-DM)

- [ ] **Subscribe your Meta app to the `message_reactions` and `story_insights` webhook fields — without those, reaction and aggregate-insight events won't be delivered.**
  - In **Meta App Dashboard → Webhooks → Instagram → Configure fields**, enable at minimum: `comments`, `messages`, `message_reactions`, `story_mentions` (and `mentions` where offered), `story_insights`, `postbacks`, `read`, `shares`.
  - Field availability depends on your API setup (Instagram Login vs Facebook Login vs Unified Login) and access level. `message_reactions` powers the **Reaction to your DM** trigger; `story_insights` powers aggregate story replies/taps in analytics.
  - After enabling, send a test story reply, a test DM reaction, and let a story expire; confirm the events appear in the webhook ledger at `/dashboard/diagnostics` (or in `webhook_events`).

- [ ] **Confirm the callback URL and verify token match the deployment**
  - Callback: `https://<your-domain>/api/webhook` (and `/webhook` alias).
  - Verify token must equal `META_VERIFY_TOKEN` in Vercel. `GET` handshake must return the challenge.
  - App secret must equal `META_APP_SECRET` so `X-Hub-Signature-256` verification passes (fail-closed).

- [ ] **Confirm app permissions / Advanced Access**
  - `instagram_business_manage_messages` is required for DMs, postbacks and `message_reactions`.
  - `instagram_business_manage_comments` for comment triggers; story fields may require Advanced Access.
  - App must be in **Live** mode; test users alone will not receive production webhooks.

- [ ] **Reminder about platform limits (not a bug)**
  - Meta does **not** expose individual "who reacted to my story" data. The product uses `message_reactions` (a reaction to a DM) for per-user triggers and `story_insights` for aggregate story engagement. See `docs/02-webhooks/STORY_TO_DM.md`.

---

## 2. Supabase — database state

- [x] Migrations applied to the production project (verify in `supabase/migrations/`):
  - `20261126_follow_gate.sql` — gate columns + `follow_checks`.
  - `20261126_follow_prompts.sql` — in-chat prompts + growth ledger.
  - `20261126_story_to_dm.sql` — `MESSAGE_REACTION` trigger constraint + insight index.
- [ ] Re-run the three migrations against any **staging/secondary** Supabase project before promoting it.
- [ ] Confirm `dm_rules.trigger_type` accepts `MESSAGE_REACTION` and RLS policies exist for `follow_checks` / `follow_prompts`.
- [ ] Apply RLS to any new table added after this checklist was written.

---

## 3. Vercel / environment

- [ ] All required secrets set in production: `TOKEN_VAULT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `CRON_SECRET`, `DATABASE_URL`, `DIRECT_URL`, Supabase service role key, `UPSTASH_REDIS_REST_URL/TOKEN`, `QSTASH_TOKEN` + both signing keys, `QSTASH_WORKER_URL`, `NEXT_PUBLIC_SITE_URL`, `APP_URL`.
- [ ] `/api/health` returns **ready** in production (it checks presence of the eight critical env vars).
- [ ] **Follow-up cron is not scheduled** in `vercel.json` yet. Register `/api/cron/followups` (or trigger the QStash hourly schedule at `/api/admin/followup-schedule`) before promising 24-hour follow-ups.

---

## 4. Third-party dashboards

- [ ] Upstash Redis: confirm budget cap is set and TTL keys expire (dedupe 24h, rate windows 1h, follow-gate cache 15m).
- [ ] QStash: confirm the DLQ/failure callback endpoint is reachable and alerts route to a monitored inbox.
- [ ] PostHog: confirm events arrive (`follow_gate_checked`, `follow_gate_opening_sent`, `follow_prompt_sent`, `follow_growth_attributed`).
- [ ] Email alerts: `ADMIN_ALERT_EMAILS`, `RESEND_API_KEY`, `ALERT_FROM_EMAIL` configured so token-invalid/critical alerts are not in-app only.

---

## 5. Final smoke test in production

1. Comment a keyword → private reply + DM delivered (or gate opener if enabled).
2. Tap the gate button → follower verified → content delivered; confirm `follow_checks` row and dashboard card update.
3. Send a follow prompt from the Inbox → confirm growth analytics count only previously-unfollowed people.
4. Reply to a story → exactly **one** story rule fires (no duplicate DM-keyword reply).
5. React to a bot-sent DM → `MESSAGE_REACTION` rule fires (requires the webhook field above).
6. Let a story expire → `story_insights` metrics appear in analytics.
7. Force a transient failure → QStash retries, DLQ alert fires, replay works.

---

**Rule of thumb:** if the code is merged but this file has unchecked boxes, the feature is not launch-ready.
