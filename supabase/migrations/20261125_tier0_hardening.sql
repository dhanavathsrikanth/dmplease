-- Tier 0 hardening: workspace-scoped RLS for business tables and the webhook job ledger.
-- Safe to re-run. Apply with `supabase db push` or in the Supabase SQL editor.

-- ── Helper: workspace membership (avoids recursive RLS on workspace_members) ──
CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = target_workspace
      AND wm.user_id = (SELECT auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = target_workspace
      AND w.owner_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;

-- ── Webhook job ledger (written by the service-role webhook path only) ───────
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object               text NOT NULL,
  status               text NOT NULL DEFAULT 'PENDING',
  instagram_account_id text,
  payload              jsonb NOT NULL,
  error                text,
  duration_ms          integer,
  received_at          timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  completed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_received
  ON public.webhook_events (status, received_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- No authenticated policies: only the service role (webhook + diagnostics) reads this table.

-- ── RLS policies for workspace-owned tables ──────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['automations', 'instagram_accounts', 'dm_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format($sql$
      DROP POLICY IF EXISTS "Members read %1$s" ON public.%1$I;
      CREATE POLICY "Members read %1$s" ON public.%1$I
        FOR SELECT TO authenticated
        USING (public.is_workspace_member(workspace_id));

      DROP POLICY IF EXISTS "Members insert %1$s" ON public.%1$I;
      CREATE POLICY "Members insert %1$s" ON public.%1$I
        FOR INSERT TO authenticated
        WITH CHECK (public.is_workspace_member(workspace_id));

      DROP POLICY IF EXISTS "Members update %1$s" ON public.%1$I;
      CREATE POLICY "Members update %1$s" ON public.%1$I
        FOR UPDATE TO authenticated
        USING (public.is_workspace_member(workspace_id))
        WITH CHECK (public.is_workspace_member(workspace_id));

      DROP POLICY IF EXISTS "Members delete %1$s" ON public.%1$I;
      CREATE POLICY "Members delete %1$s" ON public.%1$I
        FOR DELETE TO authenticated
        USING (public.is_workspace_member(workspace_id));
    $sql$, tbl);
  END LOOP;
END $$;
