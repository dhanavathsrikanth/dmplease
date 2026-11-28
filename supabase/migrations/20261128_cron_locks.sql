-- Postgres-backed cron locks.
--
-- Redis is the fast path for cron mutual exclusion, but a Redis outage used to
-- let every worker run the same job concurrently. These RPCs give the lock a
-- durable second store: a single row per key, claimed only when the previous
-- lease has expired, so a Redis outage degrades to Postgres instead of failing
-- open. Service-role only; no authenticated policies.

CREATE TABLE IF NOT EXISTS public.cron_locks (
  key        text PRIMARY KEY,
  token      uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_locks_expiry
  ON public.cron_locks (expires_at);

ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;
-- Service-role only: no authenticated policies.

CREATE OR REPLACE FUNCTION public.acquire_cron_lock(
  p_key text,
  p_token uuid,
  p_ttl_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean;
BEGIN
  INSERT INTO public.cron_locks (key, token, expires_at)
  VALUES (
    p_key, p_token,
    now() + make_interval(secs => GREATEST(p_ttl_seconds, 5)::double precision)
  )
  ON CONFLICT (key) DO UPDATE
  SET token = EXCLUDED.token,
      expires_at = EXCLUDED.expires_at
  WHERE public.cron_locks.expires_at < now()
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cron_lock(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_cron_lock(
  p_key text,
  p_token uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.cron_locks
  WHERE key = p_key AND token = p_token;
$$;

REVOKE ALL ON FUNCTION public.release_cron_lock(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text, uuid) TO service_role;
