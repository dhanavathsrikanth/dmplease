-- T1.10: Deeper comment-keyword analytics.
-- Additive and re-runnable.

-- Store the media type so we can break down Reels vs feed posts.
ALTER TABLE public.comment_events
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS media_product_type text;

CREATE INDEX IF NOT EXISTS idx_comment_events_media
  ON public.comment_events (workspace_id, media_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_events_commenter
  ON public.comment_events (workspace_id, commenter_id, received_at DESC);
