-- Defense in depth for pending opt-in rows: a pending_dms row may only
-- reference an automation or rule that belongs to the same workspace. The
-- application already scopes these lookups, but a database guard prevents a
-- future writer from creating a cross-tenant reference.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_pending_dms_workspace ON public.pending_dms;
CREATE TRIGGER enforce_pending_dms_workspace
  BEFORE INSERT OR UPDATE ON public.pending_dms
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_dms_workspace();
