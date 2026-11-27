-- T1.9: Share-to-DM as a first-class campaign trigger.
-- Additive and re-runnable.

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'COMMENT';

-- Keep the constraint idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automations_trigger_type_check'
  ) THEN
    ALTER TABLE public.automations
      ADD CONSTRAINT automations_trigger_type_check
      CHECK (trigger_type IN ('COMMENT', 'SHARE_TO_DM'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_automations_trigger_type
  ON public.automations (workspace_id, trigger_type, active);
