-- Remove the auto-confirm side effect from handle_new_user.
--
-- The live function had drifted from the repo and contained:
--   UPDATE auth.users SET email_confirmed_at = now() ...
-- which marked every new user as confirmed and bypassed the Supabase
-- "Confirm email" setting. This recreates the function without that update so
-- email confirmation is actually enforced.
--
-- The body matches supabase/migrations/20261123_create_profiles_and_workspaces.sql.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_workspace_id UUID;
  user_display_name TEXT;
BEGIN
  user_display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'User'
  );

  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    user_display_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    avatar_url = coalesce(nullif(excluded.avatar_url, ''), public.profiles.avatar_url),
    updated_at = now();

  INSERT INTO public.workspaces (name, owner_id)
  VALUES (user_display_name || '''s Workspace', new.id)
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, new.id, 'OWNER')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN new;
END;
$$;
