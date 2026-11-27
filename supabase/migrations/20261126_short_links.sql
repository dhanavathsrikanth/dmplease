-- Short-link rotation: durable short URLs, rotators and complete click attribution.
-- Additive and re-runnable.

-- The click ledger was missing the columns the worker already writes.
ALTER TABLE public.link_clicks
  ADD COLUMN IF NOT EXISTS post_id text,
  ADD COLUMN IF NOT EXISTS keyword text,
  ADD COLUMN IF NOT EXISTS sequence_step integer,
  ADD COLUMN IF NOT EXISTS destination_host text,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- A rotator holds the destinations a creator wants to spread followers across.
CREATE TABLE IF NOT EXISTS public.link_rotators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  mode          text NOT NULL DEFAULT 'sticky'
                CHECK (mode IN ('sticky','round_robin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.link_rotator_targets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rotator_id      uuid NOT NULL REFERENCES public.link_rotators(id) ON DELETE CASCADE,
  destination_url text NOT NULL,
  label           text,
  enabled         boolean NOT NULL DEFAULT true,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One short code per (rotator, recipient) or per direct campaign destination.
CREATE TABLE IF NOT EXISTS public.tracked_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id   uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  rotator_id      uuid REFERENCES public.link_rotators(id) ON DELETE SET NULL,
  target_id       uuid REFERENCES public.link_rotator_targets(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  short_code      text NOT NULL UNIQUE,
  destination_url text NOT NULL,
  label           text,
  post_id         text,
  keyword         text,
  sequence_step   integer,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS link_rotator_id uuid REFERENCES public.link_rotators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS short_links_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tracked_links_workspace_recent
  ON public.tracked_links (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracked_links_rotator_recipient
  ON public.tracked_links (rotator_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_rotator_targets_enabled
  ON public.link_rotator_targets (rotator_id, enabled, position);
CREATE INDEX IF NOT EXISTS idx_link_clicks_tracked_code
  ON public.link_clicks (token, clicked_at DESC);

ALTER TABLE public.link_rotators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_rotator_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['link_rotators','link_rotator_targets','tracked_links']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Members read %I" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "Members read %I" ON public.%I FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id))',
      tbl, tbl
    );
  END LOOP;
END $$;
