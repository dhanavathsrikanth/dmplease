-- Saved analytics views: a named date range + tab per user per workspace.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.analytics_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  range_kind    text NOT NULL CHECK (range_kind IN ('7d','30d','90d','custom')),
  from_date     date,
  to_date       date,
  tab           text NOT NULL DEFAULT 'overview',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_analytics_views_user
  ON public.analytics_views (workspace_id, user_id, created_at DESC);

ALTER TABLE public.analytics_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own analytics_views" ON public.analytics_views;
CREATE POLICY "Users read own analytics_views" ON public.analytics_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users write own analytics_views" ON public.analytics_views;
CREATE POLICY "Users write own analytics_views" ON public.analytics_views
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
