-- Shareable public report links with an opt-in toggle and revocation.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.report_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,
  enabled       boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_links_workspace
  ON public.report_links (workspace_id, created_at DESC);

ALTER TABLE public.report_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read report_links" ON public.report_links;
CREATE POLICY "Members read report_links" ON public.report_links
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members write report_links" ON public.report_links;
CREATE POLICY "Members write report_links" ON public.report_links
  FOR ALL TO authenticated USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
