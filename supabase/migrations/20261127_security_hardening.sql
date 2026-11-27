-- Security hardening (2026-11-27)
--
-- Closes the findings from the production readiness audit:
--
--   1. public.v_daily_creator_metrics_rates was owned by postgres and granted
--      to anon. Because a view runs with its owner's privileges, it bypassed
--      RLS on daily_creator_metrics and exposed every workspace's metrics to
--      unauthenticated visitors.
--
--   2. public.increment_daily_metrics(jsonb) is SECURITY DEFINER and was
--      executable by anon, allowing anonymous metric poisoning.
--
--   3. public.handle_new_user() and public.is_workspace_member(uuid) were
--      executable by anon through PostgREST RPC.
--
-- The app never reads the view, and only the service role calls the metrics
-- RPC, so these revokes do not change application behaviour.

-- 1. Make the view honour the caller's RLS, then remove anonymous access.
ALTER VIEW public.v_daily_creator_metrics_rates SET (security_invoker = true);
REVOKE ALL ON public.v_daily_creator_metrics_rates FROM anon, authenticated;
GRANT SELECT ON public.v_daily_creator_metrics_rates TO authenticated;

-- 2. Only the service role may flush metrics.
REVOKE EXECUTE ON FUNCTION public.increment_daily_metrics(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_daily_metrics(jsonb) TO service_role;

-- 3. Trigger function: never callable through the API. The auth admin keeps
--    EXECUTE so signup triggers continue to work. Pin search_path because the
--    function is SECURITY DEFINER (all object references are schema-qualified).
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user()
  TO service_role, supabase_auth_admin;
ALTER FUNCTION public.handle_new_user() SET search_path = '';

-- 4. RLS helper: needed by signed-in users, never by anon.
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid)
  TO authenticated, service_role;
