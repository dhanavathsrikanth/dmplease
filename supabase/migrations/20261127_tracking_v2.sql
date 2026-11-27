-- T1.6: delivery/read receipts + durable click ledger.
-- Additive and re-runnable.

-- Meta read/delivery receipts land on the message and the delivery log.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE public.dm_logs
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Idempotent click events so a Redis-buffered retry cannot double count.
ALTER TABLE public.link_clicks
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS user_agent text;

-- Non-partial so PostgREST can use it as an ON CONFLICT target. Postgres
-- treats NULLs as distinct, so legacy rows without an event_id are fine.
CREATE UNIQUE INDEX IF NOT EXISTS idx_link_clicks_event_id
  ON public.link_clicks (event_id);

CREATE INDEX IF NOT EXISTS idx_link_clicks_workspace_clicked
  ON public.link_clicks (workspace_id, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_logs_read
  ON public.dm_logs (workspace_id, read_at DESC)
  WHERE read_at IS NOT NULL;
