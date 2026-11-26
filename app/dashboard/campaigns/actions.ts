"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validateCampaign } from "@/lib/validation/campaign";

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
  openingMessage?: string | null;
  followGateButtonLabel?: string | null;
  followGateOnUnavailable?: "hold" | "deliver";
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

  const validation = validateCampaign(payload);
  if (!validation.success || !validation.data) {
    return {
      success: false,
      error: validation.error,
      fieldErrors: validation.fieldErrors,
    };
  }
  const values = validation.data;

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
    const cleanKeywords = values.triggerKeywords
      .map((keyword) => keyword.trim().toUpperCase())
      .filter(Boolean);

    const { data, error } = await supabase
      .from("automations")
      .insert({
        workspace_id: workspaceId,
        name: values.name,
        goal: values.goal || "custom",
        post_scope: values.postScope,
        post_id: values.postId || null,
        post_thumbnail_url: values.postThumbnailUrl || null,
        post_caption: values.postCaption || null,
        trigger_keywords: cleanKeywords.length > 0 ? cleanKeywords : ["START"],
        dm_message: values.dmMessage,
        button_text: values.buttonText || null,
        button_url: values.buttonUrl || null,
        public_reply_enabled: values.publicReplyEnabled,
        public_reply_messages: values.publicReplyMessages,
        follow_gate_enabled: values.followGateEnabled,
        opening_message: values.openingMessage || null,
        follow_gate_button_label: values.followGateButtonLabel || null,
        follow_gate_on_unavailable: values.followGateOnUnavailable,
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

/**
 * Updates an existing campaign. Ownership is checked explicitly (RLS is a
 * second line of defence) before any field is written.
 */
export async function updateCampaign(
  id: string,
  payload: CreateCampaignPayload
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const validation = validateCampaign(payload);
  if (!validation.success || !validation.data) {
    return {
      success: false,
      error: validation.error,
      fieldErrors: validation.fieldErrors,
    };
  }
  const values = validation.data;

  try {
    const { data: campaign } = await supabase
      .from("automations")
      .select("id, workspace_id")
      .eq("id", id)
      .maybeSingle();

    if (!campaign) {
      return { success: false, error: "Campaign not found" };
    }

    const { data: ownedWorkspace } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", campaign.workspace_id)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!ownedWorkspace) {
      return { success: false, error: "Not authorized to edit this campaign" };
    }

    const cleanKeywords = values.triggerKeywords
      .map((keyword) => keyword.trim().toUpperCase())
      .filter(Boolean);

    const { error } = await supabase
      .from("automations")
      .update({
        name: values.name,
        goal: values.goal || "custom",
        post_scope: values.postScope,
        post_id: values.postId || null,
        post_thumbnail_url: values.postThumbnailUrl || null,
        post_caption: values.postCaption || null,
        trigger_keywords:
          cleanKeywords.length > 0 ? cleanKeywords : ["START"],
        dm_message: values.dmMessage,
        button_text: values.buttonText || null,
        button_url: values.buttonUrl || null,
        public_reply_enabled: values.publicReplyEnabled,
        public_reply_messages: values.publicReplyMessages,
        follow_gate_enabled: values.followGateEnabled,
        opening_message: values.openingMessage || null,
        follow_gate_button_label: values.followGateButtonLabel || null,
        follow_gate_on_unavailable: values.followGateOnUnavailable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/campaigns");
    return { success: true, campaignId: id };
  } catch (err: unknown) {
    console.error("Update campaign error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save campaign",
    };
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
