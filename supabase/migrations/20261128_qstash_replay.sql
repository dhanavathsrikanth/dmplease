-- QStash signature replay guard.
--
-- A QStash signature stays valid for five minutes, so a captured signed
-- request can be replayed inside that window. Every verified signature is
-- claimed once, keyed by the SHA-256 of the signature header, and the claim
-- expires with the signature. The first writer wins; a second delivery of the
-- same signature finds the row and is rejected.
--
-- Redis is the fast path (SET NX EX). This table is the durable fallback for
-- deployments without Redis, and the claim is atomic through the primary key.

CREATE TABLE IF NOT EXISTS public.qstash_replay_guard (
  signature_hash text PRIMARY KEY,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qstash_replay_expiry
  ON public.qstash_replay_guard (expires_at);

ALTER TABLE public.qstash_replay_guard ENABLE ROW LEVEL SECURITY;
-- Service-role only: no authenticated policies.

CREATE OR REPLACE FUNCTION public.claim_qstash_signature(
  p_signature_hash text,
  p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.qstash_replay_guard (signature_hash, expires_at)
  VALUES (
    p_signature_hash,
    now() + make_interval(secs => GREATEST(p_ttl_seconds, 60)::double precision)
  )
  ON CONFLICT (signature_hash) DO NOTHING
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_qstash_signature(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_qstash_signature(text, integer) TO service_role;
