-- Re-run hardening (2026-11-28)
--
-- Closes two gaps in the durable re-run feature:
--
--   1. "Members cancel rerun_jobs" let any workspace member UPDATE every column
--      of a job, while the API only allows the workspace owner to start or stop
--      a re-run. The policy is replaced with an owner-only one.
--
--   2. rerun_jobs.automation_id and rerun_jobs.workspace_id were independent
--      foreign keys, so a row could point at an automation owned by a different
--      workspace. A trigger now rejects that combination.
--
-- Safe to re-run. Apply with `supabase db push` or in the Supabase SQL editor.

-- ── Helper: workspace ownership (avoids recursive RLS on workspaces) ─────────
CREATE OR REPLACE FUNCTION public.is_workspace_owner(target_workspace uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = target_workspace AND w.owner_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated;

-- ── Owner-only re-run control ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members cancel rerun_jobs" ON public.rerun_jobs;
DROP POLICY IF EXISTS "Owners update rerun_jobs" ON public.rerun_jobs;
CREATE POLICY "Owners update rerun_jobs" ON public.rerun_jobs
  FOR UPDATE TO authenticated
  USING (public.is_workspace_owner(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id));

-- ── Keep a job's automation inside its own workspace ─────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_rerun_job_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automations a
    WHERE a.id = NEW.automation_id AND a.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'rerun_jobs.automation_id must belong to the same workspace';
  END IF;
  RETURN NEW;
END;
$$;
-- Trigger functions are never called through the API.
REVOKE ALL ON FUNCTION public.enforce_rerun_job_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_rerun_job_workspace ON public.rerun_jobs;
CREATE TRIGGER enforce_rerun_job_workspace
  BEFORE INSERT OR UPDATE ON public.rerun_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rerun_job_workspace();
