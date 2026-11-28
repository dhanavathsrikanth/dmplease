-- Track when a worker claimed a re-run item so stuck-item recovery does not
-- re-queue work that is still in flight. `created_at` is the insert time and
-- never changes, so it cannot distinguish an abandoned claim from a live one.
ALTER TABLE public.rerun_job_items
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_rerun_items_claimed
  ON public.rerun_job_items (status, claimed_at);
