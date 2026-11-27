-- Pending Meta OAuth connections: the account-selection checklist runs before
-- any workspace is created, so the user can choose exactly which accounts to add.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.pending_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'facebook',
  access_token     text NOT NULL,
  token_expires_at timestamptz,
  accounts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pending_connections_user
  ON public.pending_connections (user_id, created_at DESC);

ALTER TABLE public.pending_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own pending_connections" ON public.pending_connections;
CREATE POLICY "Users read own pending_connections" ON public.pending_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users write own pending_connections" ON public.pending_connections;
CREATE POLICY "Users write own pending_connections" ON public.pending_connections
  FOR ALL TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
