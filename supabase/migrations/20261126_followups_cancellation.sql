-- 24h follow-ups: cancellation ledger, idempotency claim and due-query indexes.
-- Additive and re-runnable; safe to apply more than once.

-- `cancelled` records a follow-up suppressed because the person clicked a
-- tracked link or replied after the opt-in / first DM.
ALTER TABLE public.followup_events
  DROP CONSTRAINT IF EXISTS followup_events_action_check;
ALTER TABLE public.followup_events
  ADD CONSTRAINT followup_events_action_check
  CHECK (action IN ('sent','held_out','converted','opted_out','cancelled'));

-- One outcome per (automation, recipient, step, action) — the engine upserts
-- with ignoreDuplicates so overlapping cron runs cannot double-send.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_followup_event_claim
  ON public.followup_events (automation_id, recipient_id, step, action);

-- Due detection and engagement lookups should not scan whole tables.
CREATE INDEX IF NOT EXISTS idx_followup_steps_enabled_step
  ON public.followup_steps (enabled, step);
CREATE INDEX IF NOT EXISTS idx_dm_logs_followup_due
  ON public.dm_logs (workspace_id, automation_id, sequence_step, status, sent_at);
CREATE INDEX IF NOT EXISTS idx_link_clicks_contact_recent
  ON public.link_clicks (workspace_id, contact_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_workspace
  ON public.conversations (workspace_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_recent
  ON public.messages (conversation_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_optin
  ON public.contacts (workspace_id, instagram_id, opted_in_at);
