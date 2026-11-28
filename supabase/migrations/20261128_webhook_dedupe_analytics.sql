-- Durable webhook claim + delivery analytics.
--
-- The Redis claim is a fast path, but it fails open when Redis is unavailable.
-- A unique `dedupe_key` on the job ledger makes the claim atomic in Postgres,
-- so a Meta retry can never overlap the first run even without Redis.
--
-- The same row is the analytics record: workspace, event kind, source, outcome
-- counts, duplicate count and the first skip reason. That gives creators a
-- tenant-scoped view of what was delivered and why anything was skipped.

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_kind text,
  ADD COLUMN IF NOT EXISTS external_event_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'webhook',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_duplicate_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_reason text;

-- A full unique index (not partial) so PostgREST's `on_conflict` can infer it.
-- Postgres treats NULLs as distinct, so legacy rows without a key are fine.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_events_dedupe
  ON public.webhook_events (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace_received
  ON public.webhook_events (workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_kind_received
  ON public.webhook_events (event_kind, received_at DESC);

-- Backfill tenant linkage for rows written before the column existed. The
-- ledger is bounded by the 30-day retention job, so this is a single pass over
-- a small table.
UPDATE public.webhook_events we
SET workspace_id = ia.workspace_id
FROM public.instagram_accounts ia
WHERE we.workspace_id IS NULL
  AND we.instagram_account_id = ia.instagram_id;

-- Atomic duplicate counter. Called only when the claim insert conflicts, so it
-- is one indexed UPDATE and never races another writer.
CREATE OR REPLACE FUNCTION public.record_webhook_duplicate(p_dedupe_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.webhook_events
  SET duplicate_count = duplicate_count + 1,
      last_duplicate_at = now()
  WHERE dedupe_key = p_dedupe_key;
$$;

REVOKE ALL ON FUNCTION public.record_webhook_duplicate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_webhook_duplicate(text) TO service_role;

-- Exact, index-backed health aggregate. Fetching rows and counting in the app
-- caps at an arbitrary limit; this stays correct as a workspace grows.
CREATE OR REPLACE FUNCTION public.webhook_health(
  p_workspace_ids uuid[],
  p_since timestamptz
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH rows AS (
    SELECT status, duration_ms, duplicate_count, sent_count, skipped_count, skip_reason
    FROM public.webhook_events
    WHERE workspace_id = ANY(p_workspace_ids)
      AND received_at >= p_since
  )
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'done', COUNT(*) FILTER (WHERE status = 'DONE'),
    'failed', COUNT(*) FILTER (WHERE status = 'FAILED'),
    'pending', COUNT(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING')),
    'duplicates', COALESCE(SUM(duplicate_count), 0),
    'sent', COALESCE(SUM(sent_count), 0),
    'skipped', COALESCE(SUM(skipped_count), 0),
    'avgDurationMs', AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL),
    'topSkipReasons', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('reason', reason, 'count', cnt)
        ORDER BY cnt DESC
      )
      FROM (
        SELECT skip_reason AS reason, COUNT(*) AS cnt
        FROM rows
        WHERE skip_reason IS NOT NULL
        GROUP BY skip_reason
        ORDER BY cnt DESC
        LIMIT 3
      ) top
    ), '[]'::jsonb)
  )
  FROM rows;
$$;

REVOKE ALL ON FUNCTION public.webhook_health(uuid[], timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webhook_health(uuid[], timestamptz) TO service_role;

-- ── Atomic send claim ───────────────────────────────────────────────────────
-- The 24h dm_logs check is read-before-send. Two overlapping deliveries can
-- both pass it. This table makes the claim atomic: the first writer wins and
-- the second sees an unexpired row. The TTL covers the processing window; the
-- dm_logs row remains the long-lived 24h guard.
CREATE TABLE IF NOT EXISTS public.dm_send_claims (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id        uuid NOT NULL,
  instagram_account_id uuid,
  recipient_id         text NOT NULL,
  claimed_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  UNIQUE (automation_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_send_claims_expiry
  ON public.dm_send_claims (expires_at);

ALTER TABLE public.dm_send_claims ENABLE ROW LEVEL SECURITY;
-- Service-role only: no authenticated policies.

CREATE OR REPLACE FUNCTION public.claim_dm_send(
  p_workspace_id uuid,
  p_automation_id uuid,
  p_instagram_account_id uuid,
  p_recipient_id text,
  p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.dm_send_claims (
    workspace_id, automation_id, instagram_account_id,
    recipient_id, claimed_at, expires_at
  ) VALUES (
    p_workspace_id, p_automation_id, p_instagram_account_id,
    p_recipient_id, now(),
    now() + make_interval(secs => GREATEST(p_ttl_seconds, 60)::double precision)
  )
  ON CONFLICT (automation_id, recipient_id) DO UPDATE
  SET claimed_at = now(),
      expires_at = now() + make_interval(secs => GREATEST(p_ttl_seconds, 60)::double precision),
      workspace_id = EXCLUDED.workspace_id,
      instagram_account_id = EXCLUDED.instagram_account_id
  WHERE public.dm_send_claims.expires_at < now()
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dm_send(uuid, uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_dm_send(uuid, uuid, uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_dm_send(
  p_automation_id uuid,
  p_recipient_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.dm_send_claims
  WHERE automation_id = p_automation_id
    AND recipient_id = p_recipient_id;
$$;

REVOKE ALL ON FUNCTION public.release_dm_send(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_dm_send(uuid, text) TO service_role;
