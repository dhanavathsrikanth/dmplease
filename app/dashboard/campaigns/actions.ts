"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validateCampaign } from "@/lib/validation/campaign";
import { validateAutomationInput } from "@/lib/meta/safety";
import { runDmQueueDrain } from "@/lib/dm-queue";
import { getAdminDb } from "@/lib/db-admin";
import { setSafetyPaused } from "@/lib/meta/account-health";
import {
  followupStepsSchema,
  type FollowupStepInput,
} from "@/lib/validation/followup";

export interface CreateCampaignPayload {
  name: string;
  goal?: string;
  triggerType?: "COMMENT" | "SHARE_TO_DM";
  postScope: "ANY_POST" | "SPECIFIC_POST" | "NEXT_POST";
  postId?: string | null;
  postThumbnailUrl?: string | null;
  postCaption?: string | null;
  triggerKeywords: string[];
  dmMessage: string;
  dmVariants?: string[];
  buttonText?: string | null;
  buttonUrl?: string | null;
  publicReplyEnabled?: boolean;
  publicReplyMessages?: string[];
  followGateEnabled?: boolean;
  openingMessage?: string | null;
  followGateButtonLabel?: string | null;
  followGateOnUnavailable?: "hold" | "deliver";
  collectField?: string;
  collectRetryMessage?: string | null;
  collectSkipMessage?: string | null;
  collectSuccessMessage?: string | null;
  collectSkipKeywords?: string[];
  collectMaxAttempts?: number;
  messageFormat?: string;
  messageAssets?: Record<string, unknown> | null;
  shortLinksEnabled?: boolean;
  linkRotatorId?: string | null;
  hourlyCap?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
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

  // Pre-launch safety screening: loops, duplicate keywords, too many links.
  const safetyIssues = validateAutomationInput({
    name: values.name,
    message: values.dmMessage,
    keywords: values.triggerKeywords,
    buttonUrl: values.buttonUrl,
    variants: values.dmVariants,
  });
  if (safetyIssues.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of safetyIssues) {
      (fieldErrors[issue.field] ??= []).push(issue.message);
    }
    return {
      success: false,
      error: safetyIssues[0].message,
      fieldErrors,
    };
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
        trigger_type: values.triggerType,
        trigger_keywords:
          values.triggerType === "SHARE_TO_DM"
            ? []
            : cleanKeywords.length > 0
              ? cleanKeywords
              : ["START"],
        dm_message: values.dmMessage,
        dm_variants: values.dmVariants,
        button_text: values.buttonText || null,
        button_url: values.buttonUrl || null,
        public_reply_enabled: values.publicReplyEnabled,
        public_reply_messages: values.publicReplyMessages,
        follow_gate_enabled: values.followGateEnabled,
        opening_message: values.openingMessage || null,
        follow_gate_button_label: values.followGateButtonLabel || null,
        follow_gate_on_unavailable: values.followGateOnUnavailable,
        collect_field: values.collectField === "none" ? null : values.collectField,
        collect_retry_message: values.collectRetryMessage || null,
        collect_skip_message: values.collectSkipMessage || null,
        collect_success_message: values.collectSuccessMessage || null,
        collect_skip_keywords: values.collectSkipKeywords,
        collect_max_attempts: values.collectMaxAttempts,
        message_format: values.messageFormat || "text",
        message_assets: values.messageAssets ?? {},
        short_links_enabled: values.shortLinksEnabled,
        link_rotator_id: values.linkRotatorId || null,
        hourly_cap: values.hourlyCap ?? 0,
        delay_min_ms: values.delayMinMs ?? 0,
        delay_max_ms: values.delayMaxMs ?? 2000,
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

  const safetyIssues = validateAutomationInput({
    name: values.name,
    message: values.dmMessage,
    keywords: values.triggerKeywords,
    buttonUrl: values.buttonUrl,
    variants: values.dmVariants,
  });
  if (safetyIssues.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of safetyIssues) {
      (fieldErrors[issue.field] ??= []).push(issue.message);
    }
    return {
      success: false,
      error: safetyIssues[0].message,
      fieldErrors,
    };
  }

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
        dm_variants: values.dmVariants,
        button_text: values.buttonText || null,
        button_url: values.buttonUrl || null,
        public_reply_enabled: values.publicReplyEnabled,
        public_reply_messages: values.publicReplyMessages,
        follow_gate_enabled: values.followGateEnabled,
        opening_message: values.openingMessage || null,
        follow_gate_button_label: values.followGateButtonLabel || null,
        follow_gate_on_unavailable: values.followGateOnUnavailable,
        collect_field: values.collectField === "none" ? null : values.collectField,
        collect_retry_message: values.collectRetryMessage || null,
        collect_skip_message: values.collectSkipMessage || null,
        collect_success_message: values.collectSuccessMessage || null,
        collect_skip_keywords: values.collectSkipKeywords,
        collect_max_attempts: values.collectMaxAttempts,
        message_format: values.messageFormat || "text",
        message_assets: values.messageAssets ?? {},
        short_links_enabled: values.shortLinksEnabled,
        link_rotator_id: values.linkRotatorId || null,
        hourly_cap: values.hourlyCap ?? 0,
        delay_min_ms: values.delayMinMs ?? 0,
        delay_max_ms: values.delayMaxMs ?? 2000,
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

/**
 * Toggles a campaign's active flag. Ownership is checked explicitly (RLS is a
 * second line of defence) before the write.
 */
export async function toggleCampaignActive(id: string, active: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  const { data: campaign } = await supabase
    .from("automations")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return { success: false, error: "Campaign not found" };

  const { data: ownedWorkspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", campaign.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!ownedWorkspace) {
    return { success: false, error: "Not authorized to edit this campaign" };
  }

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

export async function drainDmQueueAction() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id);
  if (!workspaces?.length) {
    return { success: false, error: "No workspace found" };
  }

  try {
    // Scope the manual drain to the caller's workspaces. The cron and QStash
    // workers still drain globally; a tenant button must not spend another
    // tenant's send budget or report a global queue depth.
    const result = await runDmQueueDrain(getAdminDb(), {
      workspaceIds: workspaces.map((workspace) => workspace.id),
    });
    revalidatePath("/dashboard/overview");
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not drain the queue",
    };
  }
}

export async function setSafetyPausedAction(accountId: string, paused: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, workspace_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return { success: false, error: "Account not found" };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", account.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return { success: false, error: "Not authorized" };

  await setSafetyPaused(accountId, paused);
  revalidatePath("/dashboard/overview");
  return { success: true };
}

/**
 * Deletes a campaign. Ownership is checked explicitly (RLS is a second line of
 * defence) before the delete.
 */
export async function deleteCampaign(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  const { data: campaign } = await supabase
    .from("automations")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) return { success: false, error: "Campaign not found" };

  const { data: ownedWorkspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", campaign.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!ownedWorkspace) {
    return { success: false, error: "Not authorized to edit this campaign" };
  }

  const { error } = await supabase.from("automations").delete().eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

/**
 * Replaces the follow-up steps for one campaign.
 *
 * Ownership is checked explicitly (RLS is a second line of defence) and every
 * step is validated with the same schema the editor uses, so an invalid or
 * out-of-range step can never reach the cron engine.
 */
export async function saveFollowupSteps(
  campaignId: string,
  steps: FollowupStepInput[]
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  const validation = followupStepsSchema.safeParse(steps);
  if (!validation.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path.join(".") || "form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      success: false,
      error: validation.error.issues[0]?.message ?? "Invalid follow-up steps",
      fieldErrors,
    };
  }

  const { data: campaign } = await supabase
    .from("automations")
    .select("id, workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { success: false, error: "Campaign not found" };

  const { data: ownedWorkspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", campaign.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!ownedWorkspace) {
    return { success: false, error: "Not authorized to edit this campaign" };
  }

  try {
    const desired = validation.data.map((step) => step.step);
    const { data: existing } = await supabase
      .from("followup_steps")
      .select("step")
      .eq("automation_id", campaignId);
    const removed = (existing ?? [])
      .map((row) => Number(row.step))
      .filter((step) => !desired.includes(step));
    if (removed.length > 0) {
      await supabase
        .from("followup_steps")
        .delete()
        .eq("automation_id", campaignId)
        .in("step", removed);
    }

    const { error } = await supabase.from("followup_steps").upsert(
      validation.data.map((step) => ({
        workspace_id: campaign.workspace_id,
        automation_id: campaignId,
        step: step.step,
        delay_minutes: step.delayMinutes,
        message: step.message,
        enabled: step.enabled,
        holdout_percent: step.holdoutPercent,
      })),
      { onConflict: "automation_id,step" }
    );
    if (error) throw error;

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/campaigns/${campaignId}/edit`);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not save follow-ups",
    };
  }
}
