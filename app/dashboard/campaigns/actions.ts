"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface CreateCampaignPayload {
  name: string;
  goal?: string;
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
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
}

export async function createCampaign(payload: CreateCampaignPayload) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // 1. Get or create workspace
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);

    let workspaceId = workspaces?.[0]?.id;

    if (!workspaceId) {
      const { data: newWs } = await supabase
        .from("workspaces")
        .insert({
          name: "My Workspace",
          owner_id: user.id,
        })
        .select("id")
        .single();
      workspaceId = newWs?.id;
    }

    if (!workspaceId) {
      return { success: false, error: "Could not resolve workspace" };
    }

    // 2. Insert automation
    const cleanKeywords = (payload.triggerKeywords || [])
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean);

    const { data, error } = await supabase
      .from("automations")
      .insert({
        workspace_id: workspaceId,
        name: payload.name.trim() || "Untitled Campaign",
        goal: payload.goal || "custom",
        post_scope: payload.postScope,
        post_id: payload.postId || null,
        post_thumbnail_url: payload.postThumbnailUrl || null,
        post_caption: payload.postCaption || null,
        trigger_keywords: cleanKeywords.length > 0 ? cleanKeywords : ["START"],
        dm_message: payload.dmMessage.trim(),
        button_text: payload.buttonText?.trim() || null,
        button_url: payload.buttonUrl?.trim() || null,
        public_reply_enabled: !!payload.publicReplyEnabled,
        public_reply_messages: payload.publicReplyMessages || [],
        follow_gate_enabled: !!payload.followGateEnabled,
        active: true,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/campaigns");
    return { success: true, campaignId: data?.id };
  } catch (err: unknown) {
    console.error("Create campaign error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to create campaign";
    return { success: false, error: message };
  }
}

export async function toggleCampaignActive(id: string, active: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("automations")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

export async function deleteCampaign(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("automations").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}
