-- In-chat "Ask to follow" prompts and follower-growth attribution.
-- Additive only — safe to re-run.

CREATE TABLE IF NOT EXISTS public.follow_prompts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid,
  contact_id           uuid,
  conversation_id      uuid,
  pending_id           uuid,
  recipient_id         text NOT NULL,
  source               text NOT NULL DEFAULT 'inbox_agent'
                         CHECK (source IN ('inbox_agent', 'automation', 'rule')),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'tapped', 'follower', 'not_follower', 'unavailable', 'expired')),
  prior_follower       boolean,
  handle               text,
  promised_content     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  tapped_at            timestamptz,
  resolved_at          timestamptz,
  delivered_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_follow_prompts_workspace
  ON public.follow_prompts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_prompts_conversation
  ON public.follow_prompts (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_prompts_pending ON public.follow_prompts (pending_id);

-- Let verification checks be attributed to an in-chat prompt.
ALTER TABLE public.follow_checks
  ADD COLUMN IF NOT EXISTS prompt_id uuid;
CREATE INDEX IF NOT EXISTS idx_follow_checks_prompt ON public.follow_checks (prompt_id);

ALTER TABLE public.follow_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read follow_prompts" ON public.follow_prompts;
CREATE POLICY "Members read follow_prompts" ON public.follow_prompts
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members insert follow_prompts" ON public.follow_prompts;
CREATE POLICY "Members insert follow_prompts" ON public.follow_prompts
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members update follow_prompts" ON public.follow_prompts;
CREATE POLICY "Members update follow_prompts" ON public.follow_prompts
  FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
