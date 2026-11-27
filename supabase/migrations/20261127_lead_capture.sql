-- T1.7: Lead capture / Contacts.
-- Additive and re-runnable.

-- Configurable collect step on campaigns and inbox rules.
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS collect_retry_message text,
  ADD COLUMN IF NOT EXISTS collect_skip_message text,
  ADD COLUMN IF NOT EXISTS collect_success_message text,
  ADD COLUMN IF NOT EXISTS collect_skip_keywords text[] NOT NULL DEFAULT '{skip,later,no thanks,not now}',
  ADD COLUMN IF NOT EXISTS collect_max_attempts integer NOT NULL DEFAULT 3;

ALTER TABLE public.dm_rules
  ADD COLUMN IF NOT EXISTS collect_retry_message text,
  ADD COLUMN IF NOT EXISTS collect_skip_message text,
  ADD COLUMN IF NOT EXISTS collect_success_message text,
  ADD COLUMN IF NOT EXISTS collect_skip_keywords text[] NOT NULL DEFAULT '{skip,later,no thanks,not now}',
  ADD COLUMN IF NOT EXISTS collect_max_attempts integer NOT NULL DEFAULT 3;

-- Snapshot the config on the pending prompt so a later edit cannot change an
-- in-flight conversation.
ALTER TABLE public.pending_dms
  ADD COLUMN IF NOT EXISTS collect_config jsonb,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Contact lifecycle + notes.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notes text;

-- Lead event ledger: prompt sent, captured, skipped, invalid.
CREATE TABLE IF NOT EXISTS public.lead_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id        uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  rule_id              uuid REFERENCES public.dm_rules(id) ON DELETE SET NULL,
  contact_id           uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  recipient_id         text,
  kind                 text NOT NULL CHECK (kind IN ('prompt','captured','skipped','invalid')),
  field                text,
  value                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_workspace_recent
  ON public.lead_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_automation
  ON public.lead_events (automation_id, created_at DESC);

ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read lead_events" ON public.lead_events;
CREATE POLICY "Members read lead_events" ON public.lead_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
