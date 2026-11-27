-- T1.9: Persist share-to-DM events for analytics.
-- Additive and re-runnable.

CREATE TABLE IF NOT EXISTS public.share_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  external_id          text NOT NULL,
  sender_id            text NOT NULL,
  sender_username      text,
  media_id             text,
  title                text,
  url                  text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_share_events_workspace_recent
  ON public.share_events (workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_events_media
  ON public.share_events (workspace_id, media_id, received_at DESC);

ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read share_events" ON public.share_events;
CREATE POLICY "Members read share_events" ON public.share_events
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
