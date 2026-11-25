-- Platform admin alerts: capacity thresholds and the one-time architecture brief.
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  severity     text NOT NULL DEFAULT 'info',
  title        text NOT NULL,
  body         text NOT NULL,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_status text NOT NULL DEFAULT 'pending',
  email_error  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_created
  ON public.admin_alerts (created_at DESC);

-- Deduplication (one alert per kind per day) is enforced by the alert runner,
-- since a timezone-dependent expression cannot be used in a Postgres index.

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
-- No authenticated/anon policies: only server-side service-role access.
