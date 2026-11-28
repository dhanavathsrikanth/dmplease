-- Harden the durable DM queue for multi-tenant scale.
--
-- 1. `enqueue_queued_dm` performs the partial-index upsert atomically.
--    PostgREST's `on_conflict` cannot express `WHERE kind = 'queued'`, so the
--    previous `.upsert()` could not infer `uniq_pending_queued_claim` and the
--    parked DM was lost. The RPC also keeps the write to one round trip.
-- 2. A queued row must name an automation; otherwise the drain can never
--    resolve campaign copy.
-- 3. A pending row's account must belong to the same workspace as the row.
-- 4. The workspace-scoped drain path gets a covering index.

CREATE OR REPLACE FUNCTION public.enqueue_queued_dm(
  p_workspace_id uuid,
  p_automation_id uuid,
  p_instagram_account_id uuid,
  p_recipient_id text,
  p_comment_id text,
  p_message text,
  p_button_text text,
  p_button_url text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.pending_dms (
    workspace_id, kind, automation_id, instagram_account_id,
    recipient_id, comment_id, message, button_text, button_url,
    status, next_attempt_at, attempts, last_error
  ) VALUES (
    p_workspace_id, 'queued', p_automation_id, p_instagram_account_id,
    p_recipient_id, p_comment_id, p_message, p_button_text, p_button_url,
    'pending', now(), 0, NULL
  )
  ON CONFLICT (automation_id, recipient_id, comment_id) WHERE kind = 'queued'
  DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    instagram_account_id = EXCLUDED.instagram_account_id,
    message = EXCLUDED.message,
    button_text = EXCLUDED.button_text,
    button_url = EXCLUDED.button_url,
    status = 'pending',
    next_attempt_at = now(),
    last_error = NULL;
$$;

-- Only the service role parks overflow DMs. A tenant cannot call the RPC
-- directly, and the workspace trigger below still validates the references.
REVOKE ALL ON FUNCTION public.enqueue_queued_dm(
  uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_queued_dm(
  uuid, uuid, uuid, text, text, text, text, text
) TO service_role;

-- Extend the cross-tenant guard to the account reference. A pending row may
-- only point at an account in its own workspace.
CREATE OR REPLACE FUNCTION public.enforce_pending_dms_workspace()
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
    RAISE EXCEPTION 'pending_dms.automation_id must belong to the same workspace';
  END IF;

  IF NEW.rule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dm_rules r
    WHERE r.id = NEW.rule_id
      AND r.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'pending_dms.rule_id must belong to the same workspace';
  END IF;

  IF NEW.instagram_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.instagram_accounts ia
    WHERE ia.id = NEW.instagram_account_id
      AND ia.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'pending_dms.instagram_account_id must belong to the same workspace';
  END IF;

  RETURN NEW;
END;
$$;

-- A queued row without an automation can never be rendered. Enforce it for new
-- rows without scanning a large existing table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_dms_queued_requires_automation'
  ) THEN
    ALTER TABLE public.pending_dms
      ADD CONSTRAINT pending_dms_queued_requires_automation
      CHECK (kind <> 'queued' OR automation_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- The global drain uses idx_pending_dms_drain. A tenant-triggered drain filters
-- by workspace first, so give it a matching covering index.
CREATE INDEX IF NOT EXISTS idx_pending_dms_workspace_drain
  ON public.pending_dms (workspace_id, kind, status, next_attempt_at, created_at);
