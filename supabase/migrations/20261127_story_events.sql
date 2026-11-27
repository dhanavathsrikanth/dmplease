-- Story events: persisted for re-run (T1.8) and diagnostics.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.story_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  external_id          text NOT NULL,
  media_id             text,
  sender_id            text NOT NULL,
  sender_username      text,
  kind                 text NOT NULL CHECK (kind IN ('MENTION','REPLY','REACTION')),
  reaction             text,
  text                 text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_story_events_workspace_recent
  ON public.story_events (workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_events_media
  ON public.story_events (media_id, received_at DESC);

ALTER TABLE public.story_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read story_events" ON public.story_events;
CREATE POLICY "Members read story_events" ON public.story_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
