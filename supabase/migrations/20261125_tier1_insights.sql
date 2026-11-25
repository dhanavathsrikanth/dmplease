-- Tier 1: Meta Insights snapshots, scoped to a workspace for RLS.

CREATE TABLE IF NOT EXISTS public.insight_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  day                  date NOT NULL,
  metric               text NOT NULL,
  value                bigint NOT NULL DEFAULT 0,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, day, metric)
);

CREATE INDEX IF NOT EXISTS idx_insight_snapshots_account_day
  ON public.insight_snapshots (instagram_account_id, day DESC);

ALTER TABLE public.insight_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read insight_snapshots" ON public.insight_snapshots;
CREATE POLICY "Members read insight_snapshots" ON public.insight_snapshots
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members insert insight_snapshots" ON public.insight_snapshots;
CREATE POLICY "Members insert insight_snapshots" ON public.insight_snapshots
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members update insight_snapshots" ON public.insight_snapshots;
CREATE POLICY "Members update insight_snapshots" ON public.insight_snapshots
  FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
