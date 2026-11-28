import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface AutomationData {
  id: string;
  name: string;
  goal: string | null;
  triggerType?: string | null;
  postScope?: string | null;
  postId?: string | null;
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeywords: string[];
  dmMessage: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessages?: string[];
  followGateEnabled?: boolean;
  active: boolean;
  createdAt: Date;
}

export interface UserProfileData {
  id: string;
  email: string | null;
  fullName: string | null;
  instagramHandle: string | null;
  niche: string | null;
  avatarUrl: string | null;
  avatarGradient: string | null;
  onboardingCompleted: boolean;
  heardFrom: string | null;
  switchingFrom: string | null;
  primaryGoal: string | null;
  createdAt: Date;
  updatedAt: Date;
  ownedWorkspaces: Array<{
    id: string;
    name: string;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
    automations?: AutomationData[];
  }>;
}

/**
 * Retrieves the currently authenticated Supabase user from session cookies.
 */
async function loadCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

/** Deduped per request: layout and page both need the authenticated user. */
export const getCurrentUser = cache(loadCurrentUser);

/**
 * Retrieves the user profile along with their workspaces and automations.
 */
async function loadCurrentProfile(): Promise<UserProfileData | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  // Query directly via Supabase Client with RLS. This is the only data path:
  // the Prisma mirror is not reachable from the deployment, and attempting it
  // first stalled every dashboard render for ~10s before falling back here.
  const supabase = await createClient();
  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: workspacesData } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  const workspaceIds = (workspacesData || []).map((w) => w.id);
  let automationsData: Array<{
    id: string;
    workspace_id: string;
    name: string;
    goal: string | null;
    trigger_keywords: string[];
    dm_message: string;
    active: boolean;
    created_at: string;
  }> = [];

  if (workspaceIds.length > 0) {
    const { data: autos } = await supabase
      .from("automations")
      .select("*")
      .in("workspace_id", workspaceIds);
    if (autos) automationsData = autos;
  }

  const ownedWorkspaces = (workspacesData || []).map((w) => ({
    id: w.id,
    name: w.name,
    ownerId: w.owner_id,
    createdAt: new Date(w.created_at),
    updatedAt: new Date(w.updated_at),
    automations: automationsData
      .filter((a) => a.workspace_id === w.id)
      .map((a: Record<string, unknown>) => ({
        id: a.id as string,
        name: a.name as string,
        goal: (a.goal as string) || null,
        triggerType: (a.trigger_type as string) || "COMMENT",
        postScope: (a.post_scope as string) || null,
        postId: (a.post_id as string) || null,
        postThumbnailUrl: (a.post_thumbnail_url as string) || null,
        postCaption: (a.post_caption as string) || null,
        triggerKeywords: (a.trigger_keywords as string[]) || [],
        dmMessage: (a.dm_message as string) || "",
        buttonText: (a.button_text as string) || null,
        buttonUrl: (a.button_url as string) || null,
        publicReplyEnabled: !!a.public_reply_enabled,
        publicReplyMessages: (a.public_reply_messages as string[]) || [],
        followGateEnabled: !!a.follow_gate_enabled,
        active: !!a.active,
        createdAt: new Date(a.created_at as string),
      })),
  }));

  if (!profileData) {
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: (user.user_metadata?.full_name || user.user_metadata?.name || null) as string | null,
      instagramHandle: null,
      niche: null,
      avatarUrl: (user.user_metadata?.avatar_url || null) as string | null,
      avatarGradient: null,
      onboardingCompleted: false,
      heardFrom: null,
      switchingFrom: null,
      primaryGoal: null,
      createdAt: new Date(user.created_at),
      updatedAt: new Date(),
      ownedWorkspaces,
    };
  }

  return {
    id: profileData.id,
    email: profileData.email,
    fullName: profileData.full_name,
    instagramHandle: profileData.instagram_handle,
    niche: profileData.niche,
    avatarUrl: profileData.avatar_url,
    avatarGradient: profileData.avatar_gradient,
    onboardingCompleted: profileData.onboarding_completed ?? false,
    heardFrom: profileData.heard_from,
    switchingFrom: profileData.switching_from,
    primaryGoal: profileData.primary_goal,
    createdAt: new Date(profileData.created_at),
    updatedAt: new Date(profileData.updated_at),
    ownedWorkspaces,
  };
}

/** Deduped per request so navigation doesn't re-run this heavy query. */
export const getCurrentProfile = cache(loadCurrentProfile);
