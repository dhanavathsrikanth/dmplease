-- Six DM formats. Binary assets live in Cloudflare R2; only URLs and card
-- metadata are stored here. Additive and re-runnable.

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS message_format text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS message_assets jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.dm_logs
  ADD COLUMN IF NOT EXISTS message_format text;

ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_message_format_check;
ALTER TABLE public.automations
  ADD CONSTRAINT automations_message_format_check
  CHECK (message_format IN ('text','audio','pdf','media','card','carousel'));

CREATE INDEX IF NOT EXISTS idx_dm_logs_message_format
  ON public.dm_logs (workspace_id, message_format, sent_at DESC);
