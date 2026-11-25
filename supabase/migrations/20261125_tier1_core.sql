-- Tier 1 core: contacts, conversations, message history, DM rules, safety and tracking.
-- Additive only — safe to re-run.

-- ── Contacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_id       text NOT NULL,
  username           text,
  display_name       text,
  email              text,
  phone              text,
  properties         jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags               text[] NOT NULL DEFAULT '{}',
  source             text,
  opted_in_at        timestamptz,
  follow_verified_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, instagram_id)
);

-- ── Conversations & messages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE SET NULL,
  contact_id          uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'open',
  is_bot_active       boolean NOT NULL DEFAULT true,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, instagram_account_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  external_id     text,
  direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_type     text NOT NULL DEFAULT 'bot' CHECK (sender_type IN ('contact', 'bot', 'agent')),
  content_type    text NOT NULL DEFAULT 'text',
  content         jsonb NOT NULL,
  delivery_status text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_id)
);

-- ── Inbox / story / share automations ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dm_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  trigger_type  text NOT NULL CHECK (trigger_type IN ('DM_KEYWORD','STORY_REPLY','STORY_MENTION','SHARE_TO_DM')),
  keywords      text[] NOT NULL DEFAULT '{}',
  message       text NOT NULL,
  variants      text[] NOT NULL DEFAULT '{}',
  button_text   text,
  button_url    text,
  collect_field text,
  once_per_days integer NOT NULL DEFAULT 45,
  priority      integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Persisted webhook events for retro re-runs ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.comment_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  external_id          text NOT NULL,
  media_id             text,
  commenter_id         text NOT NULL,
  commenter_username   text,
  text                 text,
  received_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, external_id)
);

-- ── Pending opt-in / lead-capture follow-ups ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_dms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind                 text NOT NULL DEFAULT 'optin',
  automation_id        uuid,
  rule_id              uuid,
  instagram_account_id uuid REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  recipient_id         text NOT NULL,
  comment_id           text,
  message              text,
  button_text          text,
  button_url           text,
  collect_field        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- ── Click tracking & safety ledger ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.link_clicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id uuid,
  contact_id    uuid,
  token         text NOT NULL,
  referrer      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.safety_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  instagram_account_id uuid,
  recipient_id         text,
  kind                 text NOT NULL DEFAULT 'dm',
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── New automation settings ─────────────────────────────────────────────────
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS dm_variants text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS collect_field text,
  ADD COLUMN IF NOT EXISTS opening_message text,
  ADD COLUMN IF NOT EXISTS hourly_cap integer NOT NULL DEFAULT 0;

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON public.contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON public.conversations(workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_rules_workspace ON public.dm_rules(workspace_id, trigger_type);
CREATE INDEX IF NOT EXISTS idx_comment_events_recent ON public.comment_events(workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_events_window ON public.safety_events(instagram_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_link_clicks_automation ON public.link_clicks(automation_id, created_at DESC);

-- ── RLS: workspace-scoped reads/writes for the browser, service role bypasses ─
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'contacts','conversations','messages','dm_rules','comment_events',
    'pending_dms','link_clicks','safety_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members read ' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id))',
      'Members read ' || tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members insert ' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id))',
      'Members insert ' || tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members update ' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id))',
      'Members update ' || tbl, tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members delete ' || tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id))',
      'Members delete ' || tbl, tbl
    );
  END LOOP;
END $$;
