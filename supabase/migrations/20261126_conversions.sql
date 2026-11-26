-- Phase B: server-verified conversion events for ROI attribution.
-- Low volume, high value: only real leads/purchases are written here.

CREATE TABLE IF NOT EXISTS public.conversions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  automation_id      uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  post_id            text,
  keyword            text,
  sequence_step      integer NOT NULL DEFAULT 1,
  type               text NOT NULL CHECK (type IN ('lead','checkout','purchase','subscribe')),
  revenue_minor      bigint NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'INR',
  external_event_id  text,
  source             text NOT NULL DEFAULT 'webhook',
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_conversions_workspace_occurred
  ON public.conversions (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversions_workspace_post
  ON public.conversions (workspace_id, post_id);
CREATE INDEX IF NOT EXISTS idx_conversions_workspace_keyword
  ON public.conversions (workspace_id, keyword);

ALTER TABLE public.conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read conversions" ON public.conversions;
CREATE POLICY "Members read conversions" ON public.conversions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members insert conversions" ON public.conversions;
CREATE POLICY "Members insert conversions" ON public.conversions
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
