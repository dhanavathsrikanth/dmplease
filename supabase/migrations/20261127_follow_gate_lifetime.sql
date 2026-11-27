-- T1.11: lifetime follow verification + 24h inbound skip.
-- Additive and re-runnable.

-- Track the last inbound message so the gate can skip the tap for people who
-- already messaged the creator within 24 hours.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_last_inbound
  ON public.contacts (workspace_id, last_inbound_at DESC);
