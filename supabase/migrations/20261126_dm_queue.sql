-- Durable DM queue for hourly-cap overflow.
-- Additive and re-runnable.

ALTER TABLE public.pending_dms
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS message_format text NOT NULL DEFAULT 'text';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_dms_status_check'
  ) THEN
    ALTER TABLE public.pending_dms
      ADD CONSTRAINT pending_dms_status_check
      CHECK (status IN ('pending','processing','sent','skipped','failed'));
  END IF;
END $$;

-- One queued overflow row per automation/recipient/comment.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_queued_claim
  ON public.pending_dms (automation_id, recipient_id, comment_id)
  WHERE kind = 'queued';

CREATE INDEX IF NOT EXISTS idx_pending_dms_drain
  ON public.pending_dms (kind, status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_pending_dms_workspace_kind
  ON public.pending_dms (workspace_id, kind, status);
