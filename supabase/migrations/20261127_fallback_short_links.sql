-- Fallback ("Respond to all DMs") short-link support. Additive and re-runnable.

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS fallback_short_links_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_link_rotator_id uuid REFERENCES public.link_rotators(id) ON DELETE SET NULL;
