-- Public comment replies: durable ledger so failures are logged and countable.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.public_replies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id       uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  comment_id          text NOT NULL,
  recipient_id        text,
  message             text NOT NULL,
  status              text NOT NULL CHECK (status IN ('sent','failed')),
  error_code          integer,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_replies_workspace_recent
  ON public.public_replies (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_replies_automation_status
  ON public.public_replies (automation_id, status, created_at DESC);

ALTER TABLE public.public_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read public_replies" ON public.public_replies;
CREATE POLICY "Members read public_replies" ON public.public_replies
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
