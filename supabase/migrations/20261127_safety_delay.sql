-- Safety delay columns on automations and dm_rules.
-- Additive and re-runnable.
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS delay_min_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_max_ms integer NOT NULL DEFAULT 2000;

ALTER TABLE public.dm_rules
  ADD COLUMN IF NOT EXISTS delay_min_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_max_ms integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS hourly_cap integer NOT NULL DEFAULT 0;
