-- Daily pre-aggregated creator metrics (Redis delta flush target).
CREATE TABLE IF NOT EXISTS public.daily_creator_metrics (
  id            BIGSERIAL PRIMARY KEY,
  day           DATE NOT NULL,
  creator_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('bio_link', 'automation_rule')),
  target_id     UUID NOT NULL,
  bio_clicks    BIGINT NOT NULL DEFAULT 0 CHECK (bio_clicks >= 0),
  dm_sent       BIGINT NOT NULL DEFAULT 0 CHECK (dm_sent >= 0),
  dm_link_clicks BIGINT NOT NULL DEFAULT 0 CHECK (dm_link_clicks >= 0),
  dm_replies    BIGINT NOT NULL DEFAULT 0 CHECK (dm_replies >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_creator_metrics_grain
    UNIQUE (day, creator_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_creator_day
  ON public.daily_creator_metrics (creator_id, day DESC, target_kind);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_creator_target_day
  ON public.daily_creator_metrics (creator_id, target_kind, target_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_day
  ON public.daily_creator_metrics (day DESC);

CREATE OR REPLACE VIEW public.v_daily_creator_metrics_rates AS
SELECT
  day, creator_id, target_kind, target_id,
  bio_clicks, dm_sent, dm_link_clicks, dm_replies,
  ROUND((dm_link_clicks::NUMERIC / NULLIF(dm_sent, 0)) * 100, 2) AS dm_ctr_pct,
  ROUND((dm_replies::NUMERIC / NULLIF(dm_sent, 0)) * 100, 2) AS dm_reply_rate_pct,
  updated_at
FROM public.daily_creator_metrics;

-- Additive upsert so Redis delta flushes never overwrite existing counts.
CREATE OR REPLACE FUNCTION public.increment_daily_metrics(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.daily_creator_metrics (
    day, creator_id, target_kind, target_id,
    bio_clicks, dm_sent, dm_link_clicks, dm_replies
  )
  SELECT
    (row->>'day')::date,
    (row->>'creator_id')::uuid,
    row->>'target_kind',
    (row->>'target_id')::uuid,
    COALESCE((row->>'bio_clicks')::bigint, 0),
    COALESCE((row->>'dm_sent')::bigint, 0),
    COALESCE((row->>'dm_link_clicks')::bigint, 0),
    COALESCE((row->>'dm_replies')::bigint, 0)
  FROM jsonb_array_elements(p_rows) AS row
  ON CONFLICT (day, creator_id, target_kind, target_id) DO UPDATE SET
    bio_clicks     = public.daily_creator_metrics.bio_clicks + EXCLUDED.bio_clicks,
    dm_sent        = public.daily_creator_metrics.dm_sent + EXCLUDED.dm_sent,
    dm_link_clicks = public.daily_creator_metrics.dm_link_clicks + EXCLUDED.dm_link_clicks,
    dm_replies     = public.daily_creator_metrics.dm_replies + EXCLUDED.dm_replies,
    updated_at     = now();
END $$;

ALTER TABLE public.daily_creator_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read daily metrics" ON public.daily_creator_metrics;
CREATE POLICY "Members read daily metrics" ON public.daily_creator_metrics
  FOR SELECT TO authenticated USING (public.is_workspace_member(creator_id));
