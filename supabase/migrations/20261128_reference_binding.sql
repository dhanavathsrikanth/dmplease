-- Bind cross-table references to the row's own workspace.
--
-- The INSERT policies on these tables only check is_workspace_member(workspace_id),
-- which constrains the row's tenant column but not the foreign keys it points at.
-- A member could therefore insert a row in their own workspace that references
-- another tenant's automation, contact or conversation. The application already
-- scopes these lookups; these triggers are defence in depth for any future writer.
--
-- Triggers only apply to new writes, so existing rows are left untouched and no
-- NOT VALID constraints are needed. Safe to re-run.

-- 1. followup_steps.automation_id -> automations in the same workspace.
CREATE OR REPLACE FUNCTION public.enforce_followup_step_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.automations a
    WHERE a.id = NEW.automation_id
      AND a.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'followup_steps.automation_id must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_followup_step_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_followup_step_workspace ON public.followup_steps;
CREATE TRIGGER enforce_followup_step_workspace
  BEFORE INSERT OR UPDATE ON public.followup_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_followup_step_workspace();

-- 2. dm_logs.automation_id -> automations in the same workspace (nullable).
CREATE OR REPLACE FUNCTION public.enforce_dm_log_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.automation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.automations a
    WHERE a.id = NEW.automation_id
      AND a.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'dm_logs.automation_id must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_dm_log_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_dm_log_workspace ON public.dm_logs;
CREATE TRIGGER enforce_dm_log_workspace
  BEFORE INSERT OR UPDATE ON public.dm_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dm_log_workspace();

-- 3. conversations.contact_id -> contacts in the same workspace.
CREATE OR REPLACE FUNCTION public.enforce_conversation_contact_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id
      AND c.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'conversations.contact_id must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_conversation_contact_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_conversation_contact_workspace ON public.conversations;
CREATE TRIGGER enforce_conversation_contact_workspace
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_contact_workspace();

-- 4. messages.conversation_id -> conversations in the same workspace.
CREATE OR REPLACE FUNCTION public.enforce_message_conversation_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = NEW.conversation_id
      AND c.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'messages.conversation_id must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_message_conversation_workspace() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_message_conversation_workspace ON public.messages;
CREATE TRIGGER enforce_message_conversation_workspace
  BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_conversation_workspace();
