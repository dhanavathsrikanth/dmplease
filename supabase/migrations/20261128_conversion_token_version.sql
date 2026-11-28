-- Workspace conversion tokens carry a version claim. Rotating the token in
-- Settings increments this column, which invalidates every previously issued
-- token for the workspace.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS conversion_token_version integer NOT NULL DEFAULT 1;
