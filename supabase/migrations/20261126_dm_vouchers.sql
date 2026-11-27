-- Stable per-person voucher codes for personalised DMs.
-- Codes are deterministic (HMAC) and this table is the durable audit trail.

CREATE TABLE IF NOT EXISTS public.dm_vouchers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scope_key     text NOT NULL,
  recipient_id  text NOT NULL,
  code          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_vouchers_workspace_recent
  ON public.dm_vouchers (workspace_id, created_at DESC);

ALTER TABLE public.dm_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read dm_vouchers" ON public.dm_vouchers;
CREATE POLICY "Members read dm_vouchers" ON public.dm_vouchers
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
