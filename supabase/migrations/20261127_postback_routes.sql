-- Postback / button routing: configurable actions on button taps.
-- Additive and re-runnable.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;

CREATE TABLE IF NOT EXISTS public.postback_routes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  payload       text NOT NULL,
  action        text NOT NULL CHECK (action IN ('tag','branch','followup','optin')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, payload)
);

CREATE INDEX IF NOT EXISTS idx_postback_routes_workspace_active
  ON public.postback_routes (workspace_id, active, payload);

ALTER TABLE public.postback_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read postback_routes" ON public.postback_routes;
CREATE POLICY "Members read postback_routes" ON public.postback_routes
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members write postback_routes" ON public.postback_routes;
CREATE POLICY "Members write postback_routes" ON public.postback_routes
  FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
