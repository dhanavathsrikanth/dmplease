-- Ask for Follow: configurable gate on campaigns (automations) and inbox/story/share
-- rules, plus a durable verification ledger for diagnostics and retry limits.
-- Additive only — safe to re-run.

-- ── Campaign gate settings ───────────────────────────────────────────────────
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS follow_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_message text,
  ADD COLUMN IF NOT EXISTS follow_gate_button_label text,
  ADD COLUMN IF NOT EXISTS follow_gate_on_unavailable text NOT NULL DEFAULT 'hold';

-- ── Rule gate settings (DM keyword, story reply/mention, share to DM) ────────
ALTER TABLE public.dm_rules
  ADD COLUMN IF NOT EXISTS follow_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_message text,
  ADD COLUMN IF NOT EXISTS follow_gate_button_label text,
  ADD COLUMN IF NOT EXISTS follow_gate_on_unavailable text NOT NULL DEFAULT 'hold';

-- ── Verification ledger ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.follow_checks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid,
  automation_id        uuid,
  rule_id              uuid,
  pending_id           uuid,
  recipient_id         text NOT NULL,
  status               text NOT NULL CHECK (status IN ('follower', 'not_follower', 'unavailable')),
  method               text NOT NULL DEFAULT 'none',
  reason               text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_checks_workspace
  ON public.follow_checks (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_checks_recipient
  ON public.follow_checks (workspace_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_checks_pending
  ON public.follow_checks (pending_id);

-- ── RLS: workspace-scoped browser access; service role bypasses ─────────────
ALTER TABLE public.follow_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read follow_checks" ON public.follow_checks;
CREATE POLICY "Members read follow_checks" ON public.follow_checks
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Members insert follow_checks" ON public.follow_checks;
CREATE POLICY "Members insert follow_checks" ON public.follow_checks
  FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
