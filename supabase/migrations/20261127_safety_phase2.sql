-- Phase 2 of the safety engine: account health + opt-out tracking.
-- Additive and re-runnable.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out_keyword text;

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS safety_paused boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON public.contacts (workspace_id, opted_out_at)
  WHERE opted_out_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_safety_events_kind_created
  ON public.safety_events (kind, created_at DESC);
