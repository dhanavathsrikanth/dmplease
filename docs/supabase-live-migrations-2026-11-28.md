# Live Supabase migration run — 2026-11-28

Project: `fgvcizjuhakjdklezgpe` (`https://fgvcizjuhakjdklezgpe.supabase.co`)

This run applied the pending hardening migrations to the live database and
verified the auth-confirmation state. All statements were applied through the
Supabase MCP (`apply_migration` / `execute_sql`).

## 1. Auth confirmation

### What was checked

| Check | Result |
|---|---|
| `20261127_remove_auto_confirm.sql` applied | **Yes** — ledger entry `20261127142750 remove_auto_confirm_20261127` |
| `public.handle_new_user()` still auto-confirms | **No** — the function no longer writes `email_confirmed_at`; it only creates the profile, workspace and owner membership |
| Confirmation emails observed | **Yes** — 2 of 5 `auth.users` rows have `confirmation_sent_at` set |
| Users pending confirmation | **0** — all 5 rows have `email_confirmed_at` |
| "Confirm email" dashboard toggle | **Not readable through the MCP** — GoTrue config is not exposed as a table or tool |

### Evidence

```sql
select count(*)::int as total_users,
       count(confirmation_sent_at)::int as confirmation_emails_sent,
       count(email_confirmed_at)::int as confirmed,
       count(*) filter (
         where confirmation_sent_at is not null and email_confirmed_at is null
       )::int as pending_confirmation
from auth.users;
```

Result: `total_users = 5`, `confirmation_emails_sent = 2`, `confirmed = 5`,
`pending_confirmation = 0`.

`confirmation_sent_at` is only populated when Supabase sends a confirmation
email, so the presence of those timestamps is strong evidence that **Confirm
email is enabled**. The code now fails closed regardless: `handle_new_user`
does not set `email_confirmed_at`, and `isVerifiedAdmin` requires it.

### Remaining manual check

Open **Authentication → Providers → Email** in the Supabase dashboard and
confirm **Confirm email** is enabled. The MCP cannot read that toggle, so this
is the one item that still needs an owner click.

## 2. Migrations applied

Applied in dependency order. Versions are the ledger values recorded by
`supabase_migrations.schema_migrations`.

| Version | Name | Local file |
|---|---|---|
| `20261127194206` | `pending_dms_workspace_guard_20261127` | `20261127_pending_dms_workspace_guard.sql` |
| `20261127194208` | `rerun_claim_timestamp_20261127` | `20261127_rerun_claim_timestamp.sql` |
| `20261127194210` | `webhook_events_retention_index_20261127` | `20261127_webhook_events_retention_index.sql` |
| `20261127194216` | `webhook_dedupe_analytics_20261128` | `20261128_webhook_dedupe_analytics.sql` |
| `20261127194221` | `webhook_claim_lease_20261128` | `20261128_webhook_claim_lease.sql` |
| `20261127194225` | `pending_dms_queue_hardening_20261128` | `20261128_pending_dms_queue_hardening.sql` |
| `20261127194228` | `rerun_hardening_20261128` | `20261128_rerun_hardening.sql` |
| `20261127194230` | `cron_locks_20261128` | `20261128_cron_locks.sql` |
| `20261127194232` | `qstash_replay_20261128` | `20261128_qstash_replay.sql` |
| `20261127195817` | `reference_binding_20261128` | `20261128_reference_binding.sql` |
| `20261127204525` | `conversion_token_version_20261128` | `20261128_conversion_token_version.sql` |
| `20261127204533` | `workspace_members_insert_20261128` | `20261128_workspace_members_insert.sql` |
| `20261127204537` | `oauth_state_nonces_20261128` | `20261128_oauth_state_nonces.sql` |
| `20261127211004` | `pending_dms_claim_20261128` | `20261128_pending_dms_claim.sql` |

### What each migration added

- **`pending_dms_workspace_guard`** — `enforce_pending_dms_workspace` trigger
  rejecting a `pending_dms` row whose `automation_id` or `rule_id` belongs to
  another workspace.
- **`rerun_claim_timestamp`** — `rerun_job_items.claimed_at` plus
  `idx_rerun_items_claimed`, so stuck-item recovery uses the claim time instead
  of the insert time.
- **`webhook_events_retention_index`** — `idx_webhook_events_account` and
  `idx_webhook_events_received` for the disconnect purge and the 30-day
  retention delete.
- **`webhook_dedupe_analytics`** — `webhook_events` analytics columns
  (`dedupe_key`, `workspace_id`, `event_kind`, `external_event_id`, `source`,
  `attempts`, `duplicate_count`, `last_duplicate_at`, `sent_count`,
  `skipped_count`, `failed_count`, `skip_reason`), the unique dedupe index, the
  `webhook_health` aggregate RPC, and the `dm_send_claims` table with
  `claim_dm_send` / `release_dm_send`.
- **`webhook_claim_lease`** — `webhook_events.lease_expires_at`, the
  `claim_webhook_payload` RPC (claim / duplicate / in-progress), and the
  stale/failed sweep indexes.
- **`pending_dms_queue_hardening`** — `enqueue_queued_dm` RPC (atomic
  partial-index upsert), the account-reference check in
  `enforce_pending_dms_workspace`, the
  `pending_dms_queued_requires_automation` check constraint, and
  `idx_pending_dms_workspace_drain`.
- **`rerun_hardening`** — `is_workspace_owner`, the owner-only
  `"Owners update rerun_jobs"` policy, and the
  `enforce_rerun_job_workspace` trigger.
- **`cron_locks`** — `cron_locks` table plus `acquire_cron_lock` /
  `release_cron_lock` RPCs, the Postgres fallback for `withCronLock`.
- **`qstash_replay`** — `qstash_replay_guard` table plus
  `claim_qstash_signature`, the replay cache for verified QStash signatures.
- **`reference_binding`** — `enforce_followup_step_workspace`,
  `enforce_dm_log_workspace`, `enforce_conversation_contact_workspace`, and
  `enforce_message_conversation_workspace` triggers, binding
  `followup_steps.automation_id`, `dm_logs.automation_id`,
  `conversations.contact_id`, and `messages.conversation_id` to the row's own
  workspace. A pre-apply check found **0** existing violations in all four
  tables.
- **`conversion_token_version`** — `workspaces.conversion_token_version`
  (default 1), the revocation counter used by the Settings "Rotate token"
  action.
- **`workspace_members_insert`** — `"Owners can add workspace members"` INSERT
  policy, so the OWNER upsert in the Instagram connect route no longer fails
  silently under RLS.
- **`oauth_state_nonces`** — `oauth_state_nonces` table plus
  `store_oauth_state_nonce` / `consume_oauth_state_nonce`, making signed OAuth
  state single-use for its 10-minute lifetime.
- **`pending_dms_claim`** — `pending_dms.claimed_at` plus a partial index, the
  atomic claim marker that stops two concurrent postbacks from releasing the
  same opt-in twice.

## 3. Constraint validation

`pending_dms_queued_requires_automation` was added `NOT VALID` so the migration
would not scan the table. The live check found **0** legacy queued rows with a
null `automation_id`, so the constraint was validated:

```sql
select count(*)::int
from public.pending_dms
where kind = 'queued' and automation_id is null;
-- 0

ALTER TABLE public.pending_dms
  VALIDATE CONSTRAINT pending_dms_queued_requires_automation;
```

Result: `convalidated = true`.

## 4. Post-apply verification

| Check | Result |
|---|---|
| `webhook_events` analytics columns | `attempts`, `dedupe_key`, `duplicate_count`, `failed_count`, `lease_expires_at`, `sent_count`, `skip_reason`, `skipped_count`, `workspace_id` all present |
| RPCs | `acquire_cron_lock`, `claim_dm_send`, `claim_qstash_signature`, `claim_webhook_payload`, `enqueue_queued_dm`, `is_workspace_owner` all present |
| Tables | `cron_locks`, `dm_send_claims`, `qstash_replay_guard` all present |
| Triggers | `enforce_pending_dms_workspace` on `pending_dms`, `enforce_rerun_job_workspace` on `rerun_jobs` |
| `rerun_jobs` policies | `Members read rerun_jobs` (SELECT), `Owners update rerun_jobs` (UPDATE); the old member-wide cancel policy is gone |
| `pending_dms_queued_requires_automation` | `convalidated = true` |

## 5. Deployment notes

- The application code that calls `enqueue_queued_dm`, `claim_webhook_payload`,
  `claim_dm_send`, `acquire_cron_lock`, `claim_qstash_signature` and
  `is_workspace_owner` can now be deployed; the RPCs exist.
- Set `ADMIN_API_SECRET` in production to a value different from
  `CRON_SECRET`. Admin endpoints fail closed (401) without it.
- The retention cron now prunes `dm_send_claims`, `qstash_replay_guard` and
  `cron_locks` by `expires_at`.
- Confirm the **Confirm email** dashboard toggle as described in section 1.

The same items are tracked as checkboxes in
[`docs/00-overview/PRODUCTION_LAUNCH_CHECKLIST.md`](./00-overview/PRODUCTION_LAUNCH_CHECKLIST.md)
§6 and
[`docs/00-overview/EXTERNAL_ACTIONS_BEFORE_LAUNCH.md`](./00-overview/EXTERNAL_ACTIONS_BEFORE_LAUNCH.md)
§2.4 / §3.1.1.

## 6. Post-deploy

After the application deploy that follows these migrations:

- **Run the webhook re-subscribe backfill.** Existing
  `instagram_accounts.webhook_subscribed = true` rows may be stale, because the
  connect route previously recorded the flag without storing the real Meta
  result. Call `POST /api/admin/resubscribe-webhooks` with
  `Authorization: Bearer <ADMIN_API_SECRET>` and `{"limit": 50}`, repeating
  until `scanned` is 0. The exact command is in
  [`docs/00-overview/PRODUCTION_LAUNCH_CHECKLIST.md`](./00-overview/PRODUCTION_LAUNCH_CHECKLIST.md)
  §6.5.
- **Allow POST to `graph.facebook.com`.** The OAuth code exchange and
  long-lived token exchange now send `client_secret` in a POST body; an egress
  proxy/WAF that only allows GET will break Facebook login and token refresh.
- **Disable or redact request logging for `graph.instagram.com`.** Meta's
  Instagram long-lived token endpoint only accepts GET with `client_secret` in
  the query string, so proxy, CDN, APM and platform request logs must not
  capture that URL.
- **Set `APP_URL` or `NEXT_PUBLIC_SITE_URL`** to the exact public origin
  registered in the Meta app's Valid OAuth Redirect URIs. The callback and
  connect routes no longer derive the origin from forwarded headers; without a
  configured origin, OAuth fails closed. The registered redirect URI must be
  `<origin>/api/auth/meta/callback`.
- **Set a dedicated `OAUTH_STATE_SECRET`** in production, different from
  `TOKEN_VAULT_SECRET`. The app now fails closed without it.
- **If any tokens were encrypted under the old hardcoded vault key**, set
  `TOKEN_VAULT_LEGACY_SECRET` to that old key so the refresh cron can decrypt
  and re-encrypt them, then remove it once no legacy rows remain. There is no
  hardcoded fallback in any environment.
- **Legacy plaintext tokens are rejected by `decryptToken`.** The refresh cron
  still migrates `EAA…`/`IG…` plaintext rows through
  `readStoredTokenForMigration`; any non-cron caller now requires a vault
  ciphertext.
