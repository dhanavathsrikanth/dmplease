-- T1.5: Meta Insights v2 — per-media snapshots, scope tracking, sync status.
-- Additive and re-runnable.

-- Per-media rows share the table with account rows. `media_id = ''` marks an
-- account-level snapshot so the unique constraint works without NULLs.
ALTER TABLE public.insight_snapshots
  ADD COLUMN IF NOT EXISTS media_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS permalink text,
  ADD COLUMN IF NOT EXISTS caption text;

-- Replace the old unique constraint with one that includes media_id.
ALTER TABLE public.insight_snapshots
  DROP CONSTRAINT IF EXISTS insight_snapshots_instagram_account_id_day_metric_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_snapshots_unique
  ON public.insight_snapshots (instagram_account_id, day, metric, media_id);

CREATE INDEX IF NOT EXISTS idx_insight_snapshots_media
  ON public.insight_snapshots (instagram_account_id, media_id, day DESC);

-- Scope + sync status on the account so we never call Insights without the
-- instagram_manage_insights permission.
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS granted_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS insights_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS insights_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS insights_error text;

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_insights_status
  ON public.instagram_accounts (insights_status);
