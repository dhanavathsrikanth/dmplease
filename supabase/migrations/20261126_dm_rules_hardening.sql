-- Production-safe DM keyword rules and "Respond to all DMs".
-- Additive only — safe to re-run.

-- Account-level fallback reply used only when no rule matched.
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS fallback_reply_variants text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fallback_once_per_days integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS fallback_follow_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_opening_message text,
  ADD COLUMN IF NOT EXISTS fallback_follow_gate_button_label text,
  ADD COLUMN IF NOT EXISTS fallback_follow_gate_on_unavailable text NOT NULL DEFAULT 'hold',
  ADD COLUMN IF NOT EXISTS fallback_button_text text,
  ADD COLUMN IF NOT EXISTS fallback_button_url text;

-- Deterministic rule ordering: priority first, then creation order.
CREATE INDEX IF NOT EXISTS idx_dm_rules_priority
  ON public.dm_rules (workspace_id, trigger_type, priority DESC, created_at ASC);
