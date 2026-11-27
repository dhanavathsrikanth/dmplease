# External actions before production launch

> **Purpose:** everything in this file is a **human action in a dashboard or console**. Code, database migrations and tests are already merged and deployed. Keep this file open during the launch review and tick each box.
>
> **Last security review:** 2026-11-27. The database hardening in `supabase/migrations/20261127_security_hardening.sql` has been applied to production (cross-tenant metrics view locked down, anonymous RPC execution revoked). See §9 for the verification record.

---

## 0. Launch blockers — do these first

- [ ] **Meta:** subscribe the app to `message_reactions` and `story_insights` (plus the other fields in §1). Without these, Story-to-DM reactions and story analytics never arrive.
- [ ] **Meta:** put the app in **Live** mode and confirm **Advanced Access** for `instagram_business_manage_messages` and `instagram_business_manage_comments`.
- [ ] **Supabase:** enable **Leaked password protection** (Authentication → Policies). This is the only remaining security warning that cannot be fixed in SQL.
- [ ] **Vercel:** add the missing environment variables for the features you intend to sell: Cloudflare R2 (rich DM attachments), Resend (email alerts), and PostHog source maps. See §3.
- [ ] **Run the production smoke test in §7** and confirm every step.

---

## 1. Meta app — webhook fields and permissions

### 1.1 Webhook field subscriptions (REQUIRED for Story-to-DM)

- [ ] In **Meta App Dashboard → Webhooks → Instagram → Configure fields**, enable at minimum:
  - `comments`
  - `messages`
  - `message_reactions` — powers the **Reaction to your DM** trigger
  - `story_mentions` (and `mentions` where offered)
  - `story_insights` — powers aggregate story replies/taps in analytics
  - `postbacks`
  - `read`
  - `shares`
- [ ] Field availability depends on your API setup (Instagram Login vs Facebook Login vs Unified Login) and access level. `message_reactions` and `story_insights` may require Advanced Access.
- [ ] After enabling, send a test story reply, a test DM reaction, and let a story expire. Confirm the events appear in `/dashboard/diagnostics` (or in the `webhook_events` table).

### 1.2 Callback URL and verify token

- [ ] Callback URL: `https://<your-domain>/api/webhook` (the `/webhook` alias also works).
- [ ] `META_VERIFY_TOKEN` in Vercel must equal the verify token entered in the Meta dashboard.
- [ ] `META_APP_SECRET` in Vercel must equal the app secret, so `X-Hub-Signature-256` verification passes (it fails closed).
- [ ] Confirm the `GET` handshake returns the challenge:
  ```bash
  curl "https://<your-domain>/api/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123"
  # expected: 123
  ```

### 1.3 Permissions and app mode

- [ ] `instagram_business_manage_messages` — required for DMs, postbacks and `message_reactions`.
- [ ] `instagram_business_manage_comments` — required for comment triggers.
- [ ] App must be in **Live** mode. Test users alone do not receive production webhooks.
- [ ] The connected Instagram account must be a **Business or Creator** account linked to a Facebook Page.

### 1.4 Platform limits (not a bug)

- [ ] Meta does **not** expose individual "who reacted to my story" data. The product uses `message_reactions` (a reaction to a DM) for per-user triggers and `story_insights` for aggregate story engagement. See `docs/02-webhooks/STORY_TO_DM.md`.

---

## 2. Supabase — database and auth

### 2.1 Auth settings (human action)

- [ ] **Enable Leaked Password Protection:** Supabase Dashboard → **Authentication → Policies → Password security** → enable "Check against HaveIBeenPwned.org".
  - This is the only remaining security advisor warning that cannot be changed with SQL.
  - Verify afterwards in **Advisors → Security** that `auth_leaked_password_protection` is gone.

### 2.2 Migrations

- [x] Production migrations applied (45 migrations, latest `workspace_timezone_20261127`).
- [x] Security hardening applied: `20261127_security_hardening.sql`.
- [ ] Re-run **all** migrations against any staging/secondary Supabase project before promoting it.
- [ ] Confirm `dm_rules.trigger_type` accepts `MESSAGE_REACTION` and RLS policies exist for `follow_checks` / `follow_prompts`.
- [ ] Apply RLS to any new table added after this checklist was written.

### 2.3 Verify the security fix (read-only)

Run these from a machine with the public anon key. Both must return **401 permission denied**:

```bash
# 1. Cross-tenant metrics view must no longer be readable by anon
curl -i "https://<project>.supabase.co/rest/v1/v_daily_creator_metrics_rates?select=*&limit=1" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
# expected: HTTP 401, "permission denied for view v_daily_creator_metrics_rates"

# 2. Anonymous metric poisoning must be blocked
curl -i -X POST "https://<project>.supabase.co/rest/v1/rpc/increment_daily_metrics" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" -d '{"p_rows":[]}'
# expected: HTTP 401, "permission denied for function increment_daily_metrics"
```

- [ ] Both commands return **401**.
- [ ] Signed-in dashboard analytics still load (the view is now `security_invoker`, so RLS applies per user).

---

## 3. Vercel — environment variables

### 3.1 Already present in Production (verified 2026-11-27)

`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_CONFIG_ID`, `TOKEN_VAULT_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_WORKER_URL`, `QSTASH_URL`, `NEXT_PUBLIC_SITE_URL`, `APP_URL`, `ADMIN_ALERT_EMAILS`, `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`.

### 3.2 Missing — add only if you are selling the feature

- [ ] **Cloudflare R2 (rich DM attachments: audio, PDF, image, video).** Without these, `/api/assets/sign` returns `503` and the UI reports `configured:false`.
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME`
  - `R2_PUBLIC_CDN_URL` (custom domain or `r2.dev` URL)
- [ ] **Email alerts (token-invalid / capacity notices).** Without these, alerts are stored in-app only.
  - `RESEND_API_KEY`
  - `ALERT_FROM_EMAIL` (verified sender, e.g. `dmplease Alerts <alerts@yourdomain.com>`)
  - `ADMIN_ALERT_EMAILS` is already set; confirm it contains a monitored inbox.
- [ ] **PostHog source maps (symbolicated error tracking).** Without these, errors are captured but stack traces stay minified.
  - `POSTHOG_API_KEY` (personal API key, sensitive)
  - `POSTHOG_PROJECT_ID` (`152538`)
  - `POSTHOG_HOST` (EU host)
- [ ] **Optional:** `SHORT_LINK_DOMAIN` for branded tracked links, `OAUTH_STATE_SECRET` to separate OAuth state signing from the token vault.

### 3.3 Health and deployment

- [ ] `/api/health` returns **ready** in production (it checks the nine critical env vars).
- [ ] The latest production deployment is **Ready** and points at the current `main` commit.
- [ ] Vercel crons are enabled: `/api/cron/refresh-tokens`, `/api/cron/insights`, `/api/admin/alerts/check`, `/api/cron/safety-retention`, `/api/cron/safety-digest`.

> Note: `/api/health` does **not** check R2, Resend or PostHog source maps. A green health check does not mean those features are configured.

---

## 4. Upstash — Redis and QStash

- [ ] **Redis budget cap:** set a monthly cap in the Upstash console so a runaway loop cannot produce a surprise bill.
- [ ] **TTLs:** confirm dedupe keys expire in 24h, rate-limit windows in 1h, and follow-gate cache in 15m.
- [ ] **QStash schedules:** confirm all four exist and are not paused (verified 2026-11-27, all last runs `SUCCESS`):

  | Job | Schedule | Destination |
  |---|---|---|
  | Metrics flush | `* * * * *` | `/api/cron/flush-metrics` |
  | Follow-ups | `0 * * * *` | `/api/cron/followups` |
  | DM queue drain | `17 * * * *` | `/api/cron/drain-dm-queue` |
  | Link-click flush | `*/5 * * * *` | `/api/cron/flush-link-clicks` |

- [ ] **DLQ / failure callback:** confirm `/api/workers/qstash-failed` is reachable and alerts route to a monitored inbox.
- [ ] **Cron secret header:** the three cron-secret-protected schedules must forward `Authorization: Bearer <CRON_SECRET>` (the `Upstash-Forward-Authorization` header). `flush-metrics` uses QStash signature verification instead.

---

## 5. PostHog

- [ ] Confirm product events arrive: `campaign_published`, `dm_batch_processed`, `follow_gate_checked`, `follow_gate_opening_sent`, `follow_prompt_sent`, `follow_growth_attributed`, `daily_metrics_flushed`.
- [ ] After adding the source-map variables in §3.2, redeploy and confirm the build log reports a successful upload.
- [ ] Trigger a test error and confirm the stack trace resolves to source in **Error tracking**.

---

## 6. Email alerts

- [ ] `ADMIN_ALERT_EMAILS`, `RESEND_API_KEY` and `ALERT_FROM_EMAIL` are all set.
- [ ] Send a test alert (or force a token-invalid event) and confirm it arrives in the monitored inbox.
- [ ] Confirm the Resend sender domain is verified.

---

## 7. Final production smoke test

Run these against the live deployment, in order:

1. [ ] **Comment → DM:** comment a configured keyword on the configured post → private reply + DM delivered (or gate opener if the follow gate is enabled).
2. [ ] **Follow gate:** tap the gate button → follower verified → content delivered; confirm a `follow_checks` row and the dashboard card update.
3. [ ] **Follow prompt:** send a follow prompt from the Inbox → confirm growth analytics count only previously-unfollowed people.
4. [ ] **Story reply:** reply to a story → exactly **one** story rule fires (no duplicate DM-keyword reply).
5. [ ] **DM reaction:** react to a bot-sent DM → `MESSAGE_REACTION` rule fires (requires the webhook field in §1.1).
6. [ ] **Story expiry:** let a story expire → `story_insights` metrics appear in analytics.
7. [ ] **Failure / DLQ:** force a transient failure → QStash retries, the failure callback fires, the message lands in the DLQ, and replay works once fixed.
8. [ ] **Analytics:** confirm `daily_creator_metrics` gets today's row with `dm_sent >= 1` after a successful DM.
9. [ ] **No retries on permanent errors:** an error-190 token failure must not produce QStash retries; `/api/admin/dlq` stays empty.

> **Rule of thumb:** if the code is merged but this file has unchecked boxes, the feature is not launch-ready.

---

## 8. Recommended (not launch-blocking)

- [ ] **Add CI:** there is no `.github/workflows`. Add a workflow that runs `npm ci`, `npm run lint`, `npm test` and `npm run build` on every push/PR.
- [ ] **Pin dependencies:** `next`, `@supabase/ssr` and `@supabase/supabase-js` are `"latest"`. Pin exact versions (and align `eslint-config-next` with the Next major) so a deploy cannot silently pick up a breaking release.
- [ ] **Remove the Prisma fallback:** `getCurrentProfile()` still tries Prisma first on every dashboard request, fails on port 6543, then falls back to Supabase REST. Removing the Prisma path removes latency and log noise.
- [ ] **Database performance:** review the 29 unindexed foreign keys, 2 duplicate indexes and 16 multiple-permissive-policy warnings in Supabase Advisors → Performance before high-volume campaigns.
- [ ] **Accepted risk:** `public.is_workspace_member(uuid)` remains executable by `authenticated` because RLS policies need it. It only returns a boolean for the caller's own membership, so the exposure is low.

---

## 9. Security verification record (2026-11-27)

| Finding | Severity | Status | Verification |
|---|---|---|---|
| `v_daily_creator_metrics_rates` readable by `anon` (cross-tenant metrics leak) | Critical | **Fixed** | anon request now returns `401 permission denied`; view is `security_invoker=true` and only `authenticated` has `SELECT` |
| `increment_daily_metrics(jsonb)` executable by `anon` (metric poisoning) | Critical | **Fixed** | anon RPC now returns `401 permission denied`; only `service_role` has `EXECUTE` |
| `handle_new_user()` executable by `anon` / `authenticated` | Medium | **Fixed** | `EXECUTE` limited to `service_role` + `supabase_auth_admin`; `search_path` pinned |
| `is_workspace_member(uuid)` executable by `anon` | Low | **Fixed** | `EXECUTE` limited to `authenticated` + `service_role` |
| Leaked password protection disabled | Medium | **Human action** | Enable in Supabase Dashboard → Authentication → Policies |
| `admin_alerts` / `webhook_events` RLS with no policy | Info | **Accepted** | Deny-all for `anon`/`authenticated`; only the service role writes |

Migration: `supabase/migrations/20261127_security_hardening.sql`.
