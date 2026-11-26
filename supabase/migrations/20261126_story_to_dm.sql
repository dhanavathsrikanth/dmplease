-- Story-to-DM completion: allow DM reactions as a rule trigger and record
-- aggregate story insight metrics. Additive/safe to re-run.

ALTER TABLE public.dm_rules
  DROP CONSTRAINT IF EXISTS dm_rules_trigger_type_check;
ALTER TABLE public.dm_rules
  ADD CONSTRAINT dm_rules_trigger_type_check
  CHECK (trigger_type IN (
    'DM_KEYWORD', 'STORY_REPLY', 'STORY_MENTION', 'SHARE_TO_DM', 'MESSAGE_REACTION'
  ));

-- Aggregate story replies/taps already land in insight_snapshots via the
-- webhook processor; this index keeps the analytics read path fast.
CREATE INDEX IF NOT EXISTS idx_insight_snapshots_metric
  ON public.insight_snapshots (workspace_id, metric, day DESC);
