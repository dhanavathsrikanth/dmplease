-- Workspace timezone + week start preferences.
-- Additive and re-runnable.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS week_starts_on integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspaces_week_starts_on_check'
  ) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_week_starts_on_check
      CHECK (week_starts_on BETWEEN 0 AND 6);
  END IF;
END $$;
