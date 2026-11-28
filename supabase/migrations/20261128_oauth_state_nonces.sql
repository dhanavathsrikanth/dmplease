-- Single-use OAuth state nonces.
--
-- A signed state is only replayable for its 10-minute lifetime unless the nonce
-- it carries is recorded and consumed exactly once. The table is service-role
-- only: RLS is enabled with no policies, and the two SECURITY DEFINER functions
-- are the only way in.

CREATE TABLE IF NOT EXISTS public.oauth_state_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_state_nonces_expiry
  ON public.oauth_state_nonces (expires_at);
ALTER TABLE public.oauth_state_nonces ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.store_oauth_state_nonce(
  p_nonce text,
  p_ttl_seconds integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.oauth_state_nonces (nonce, expires_at)
  VALUES (
    p_nonce,
    now() + make_interval(secs => GREATEST(p_ttl_seconds, 60)::double precision)
  )
  ON CONFLICT (nonce) DO UPDATE SET expires_at = EXCLUDED.expires_at;
$$;

CREATE OR REPLACE FUNCTION public.consume_oauth_state_nonce(p_nonce text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_found boolean;
BEGIN
  DELETE FROM public.oauth_state_nonces
  WHERE nonce = p_nonce AND expires_at > now()
  RETURNING true INTO v_found;
  RETURN COALESCE(v_found, false);
END;
$$;

REVOKE ALL ON FUNCTION public.store_oauth_state_nonce(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_oauth_state_nonce(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.consume_oauth_state_nonce(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state_nonce(text) TO service_role;
