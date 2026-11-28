-- The webhook ledger is purged by account on disconnect and by age in the
-- retention cron. Index both keys so the deletes stay cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_webhook_events_account
  ON public.webhook_events (instagram_account_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received
  ON public.webhook_events (received_at);
