-- Durable re-run jobs: a job ledger plus individually tracked work items.
-- Replaces the old 60s `after()` loop, which could be truncated mid-run and
-- reported "queued" before anything was actually delivered.

CREATE TABLE IF NOT EXISTS public.rerun_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id  uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','completed','failed','cancelled')),
  days           integer NOT NULL DEFAULT 7,
  total          integer NOT NULL DEFAULT 0,
  sent           integer NOT NULL DEFAULT 0,
  skipped        integer NOT NULL DEFAULT 0,
  failed         integer NOT NULL DEFAULT 0,
  error_message  text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rerun_job_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES public.rerun_jobs(id) ON DELETE CASCADE,
  workspace_id        uuid NOT NULL,
  automation_id       uuid NOT NULL,
  account_graph_id    text NOT NULL,
  comment_id          text NOT NULL,
  media_id            text,
  comment_text        text,
  commenter_id        text NOT NULL,
  commenter_username  text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','sent','skipped','failed')),
  attempts            integer NOT NULL DEFAULT 0,
  error_message       text,
  processed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_rerun_jobs_workspace_recent
  ON public.rerun_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rerun_items_due
  ON public.rerun_job_items (job_id, status, created_at);

ALTER TABLE public.rerun_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rerun_job_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read rerun_jobs" ON public.rerun_jobs;
CREATE POLICY "Members read rerun_jobs" ON public.rerun_jobs
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "Members cancel rerun_jobs" ON public.rerun_jobs;
CREATE POLICY "Members cancel rerun_jobs" ON public.rerun_jobs
  FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members read rerun_job_items" ON public.rerun_job_items;
CREATE POLICY "Members read rerun_job_items" ON public.rerun_job_items
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
