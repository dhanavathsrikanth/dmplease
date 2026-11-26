-- Phase B.4: follow-up sequence configuration, holdout assignment and outcomes.

CREATE TABLE IF NOT EXISTS public.followup_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id    uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  step             integer NOT NULL CHECK (step >= 1),
  delay_minutes    integer NOT NULL DEFAULT 1440,
  message          text NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  holdout_percent  integer NOT NULL DEFAULT 10 CHECK (holdout_percent >= 0 AND holdout_percent <= 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, step)
);

CREATE TABLE IF NOT EXISTS public.followup_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id  uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  contact_id     uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  recipient_id   text NOT NULL,
  step           integer NOT NULL,
  action         text NOT NULL CHECK (action IN ('sent','held_out','converted','opted_out')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, recipient_id, step, action)
);

CREATE INDEX IF NOT EXISTS idx_followup_steps_due
  ON public.followup_steps (enabled, step);
CREATE INDEX IF NOT EXISTS idx_followup_events_automation_step
  ON public.followup_events (automation_id, step, created_at DESC);

ALTER TABLE public.followup_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read followup_steps" ON public.followup_steps;
CREATE POLICY "Members read followup_steps" ON public.followup_steps
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members insert followup_steps" ON public.followup_steps;
CREATE POLICY "Members insert followup_steps" ON public.followup_steps
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members update followup_steps" ON public.followup_steps;
CREATE POLICY "Members update followup_steps" ON public.followup_steps
  FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members read followup_events" ON public.followup_events;
CREATE POLICY "Members read followup_events" ON public.followup_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
