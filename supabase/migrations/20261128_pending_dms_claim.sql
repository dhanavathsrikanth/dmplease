-- Atomic claim marker for pending opt-in rows.
--
-- A postback can be delivered more than once (Meta retries, QStash retries, or
-- two taps in flight). `consumePending` now claims the row with a single
-- `UPDATE … WHERE claimed_at IS NULL`, so only one consumer can release the
-- opt-in. Callers that keep the row (follow gate not yet satisfied, transient
-- send failure) clear the marker so the follower can try again.
ALTER TABLE public.pending_dms
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.pending_dms.claimed_at IS
  'Set when a consumer atomically claims the row; NULL means unclaimed.';

-- The claim lookup is by primary key, but the partial index keeps the
-- "unclaimed and unexpired" scan cheap for recovery/diagnostics queries.
CREATE INDEX IF NOT EXISTS idx_pending_dms_unclaimed
  ON public.pending_dms (expires_at)
  WHERE claimed_at IS NULL;
