-- Allow a workspace owner to add members (including the OWNER row created when
-- connecting an Instagram account). Without this policy the owner upsert in
-- app/api/instagram/accounts/connect/route.ts silently fails under RLS.
-- Additive and re-runnable.

DROP POLICY IF EXISTS "Owners can add workspace members" ON public.workspace_members;
CREATE POLICY "Owners can add workspace members"
  ON public.workspace_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_id
        AND w.owner_id = (SELECT auth.uid())
    )
  );
