-- Lease-based webhook claim.
--
-- The dedupe key is the hash of the whole verified payload, so its scope
-- matches the processing scope (every entry/change in the batch). The missing
-- piece was release: a crash after the claim left the row PENDING forever, so
-- Meta's retry was rejected as a duplicate and the batch was never processed.
--
-- A claim now carries a lease. A retry can re-claim when the previous attempt
-- FAILED or its lease expired. A completed row (DONE) is still a duplicate.

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

/**
 * Claims a payload for processing.
 *
 * Returns jsonb:
 *   { "status": "claimed",     "id": "<uuid>" }  -> process it
 *   { "status": "duplicate",   "id": "<uuid>" }  -> already completed
 *   { "status": "in_progress", "id": "<uuid>" }  -> another worker holds a live lease
 */
CREATE OR REPLACE FUNCTION public.claim_webhook_payload(
  p_dedupe_key text,
  p_object text,
  p_instagram_account_id text,
  p_workspace_id uuid,
  p_event_kind text,
  p_external_event_id text,
  p_payload jsonb,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_lease interval := make_interval(
    secs => GREATEST(p_lease_seconds, 60)::double precision
  );
BEGIN
  INSERT INTO public.webhook_events (
    dedupe_key, object, status, instagram_account_id, workspace_id,
    event_kind, external_event_id, payload, attempts, received_at,
    lease_expires_at
  ) VALUES (
    p_dedupe_key, p_object, 'PENDING', p_instagram_account_id, p_workspace_id,
    p_event_kind, p_external_event_id, p_payload, 1, now(),
    now() + v_lease
  )
  ON CONFLICT (dedupe_key) DO UPDATE
  SET status = 'PENDING',
      attempts = public.webhook_events.attempts + 1,
      received_at = now(),
      lease_expires_at = now() + v_lease,
      error = NULL
  WHERE public.webhook_events.status = 'FAILED'
     OR (
       public.webhook_events.status IN ('PENDING', 'PROCESSING')
       AND public.webhook_events.lease_expires_at < now()
     )
  RETURNING id, status INTO v_id, v_status;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'claimed', 'id', v_id);
  END IF;

  SELECT id, status INTO v_id, v_status
  FROM public.webhook_events
  WHERE dedupe_key = p_dedupe_key;

  IF v_status = 'DONE' THEN
    UPDATE public.webhook_events
    SET duplicate_count = duplicate_count + 1,
        last_duplicate_at = now()
    WHERE id = v_id;
    RETURN jsonb_build_object('status', 'duplicate', 'id', v_id);
  END IF;

  -- A live lease means another worker is processing this batch. Count the
  -- suppressed retry so creators can see the retry volume.
  UPDATE public.webhook_events
  SET duplicate_count = duplicate_count + 1,
      last_duplicate_at = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('status', 'in_progress', 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_payload(
  text, text, text, uuid, text, text, jsonb, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_webhook_payload(
  text, text, text, uuid, text, text, jsonb, integer
) TO service_role;

-- Stale rows are candidates for the recovery sweep. The partial index keeps
-- the sweep cheap even when the ledger is large.
CREATE INDEX IF NOT EXISTS idx_webhook_events_stale
  ON public.webhook_events (lease_expires_at)
  WHERE status IN ('PENDING', 'PROCESSING');

-- Failed rows are retried a bounded number of times by the recovery sweep.
CREATE INDEX IF NOT EXISTS idx_webhook_events_failed_attempts
  ON public.webhook_events (attempts)
  WHERE status = 'FAILED';
