"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { validateCampaign } from "@/lib/validation/campaign";
import { validateAutomationInput } from "@/lib/meta/safety";

export interface OnboardingPayload {
  fullName: string;
  instagramHandle?: string;
  niche?: string;
  avatarUrl?: string;
  avatarGradient?: string;
  primaryGoal: string;
  triggerKeyword: string;
  dmMessage: string;
  switchingFrom: string;
  heardFrom: string;
}

export async function submitOnboarding(payload: OnboardingPayload) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Screen the first automation before any writes. A whitespace-only keyword
  // would otherwise be stored as [''] and match every comment.
  const triggerKeyword = payload.triggerKeyword?.trim() ?? "";
  if (!triggerKeyword) {
    return {
      success: false,
      error: "Add a trigger keyword so we know which comments to reply to.",
    };
  }

  let automationName = "My First Automation";
  if (payload.primaryGoal === "lead_magnet") automationName = "Freebie / Lead Magnet Delivery";
  if (payload.primaryGoal === "discount") automationName = "Flash Sale / VIP Discount";
  if (payload.primaryGoal === "booking") automationName = "Book a Discovery Call";
  if (payload.primaryGoal === "custom") automationName = "Custom Keyword Auto-Reply";

  const candidate = {
    name: automationName,
    goal: payload.primaryGoal,
    postScope: "ANY_POST" as const,
    triggerKeywords: [payload.triggerKeyword],
    dmMessage: payload.dmMessage,
    hourlyCap: 30,
  };

  const validation = validateCampaign(candidate);
  if (!validation.success || !validation.data) {
    return { success: false, error: validation.error };
  }
  const values = validation.data;

  // Same pre-launch safety screening as createCampaign: loops, duplicate
  // keywords, too many links and spam patterns.
  const safetyIssues = validateAutomationInput({
    name: candidate.name,
    message: candidate.dmMessage,
    keywords: candidate.triggerKeywords,
    buttonUrl: null,
    variants: [],
  });
  if (safetyIssues.length > 0) {
    return { success: false, error: safetyIssues[0].message };
  }

  try {
    // 1. Update Profile with full customisation
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: payload.fullName,
        instagram_handle: payload.instagramHandle ? payload.instagramHandle.replace(/^@/, "").trim() : null,
        niche: payload.niche || null,
        avatar_url: payload.avatarUrl || null,
        avatar_gradient: payload.avatarGradient || null,
        primary_goal: payload.primaryGoal,
        switching_from: payload.switchingFrom,
        heard_from: payload.heardFrom,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (profileError) {
      console.error("Profile update error:", profileError);
    }

    // 2. Fetch or create user's workspace
    let workspaceId: string | null = null;
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);

    if (workspaces && workspaces.length > 0) {
      workspaceId = workspaces[0].id;
    } else {
      const { data: newWorkspace } = await supabase
        .from("workspaces")
        .insert({
          name: `${payload.fullName}'s Workspace`,
          owner_id: user.id,
        })
        .select("id")
        .single();
      if (newWorkspace) {
        workspaceId = newWorkspace.id;
      }
    }

    // 3. Create their first Automation based on their selected preset
    if (workspaceId) {
      const { error: automationError } = await supabase.from("automations").insert({
        workspace_id: workspaceId,
        name: values.name,
        goal: values.goal || "custom",
        post_scope: "ANY_POST",
        trigger_keywords: values.triggerKeywords,
        dm_message: values.dmMessage,
        hourly_cap: 30,
        active: true,
      });

      if (automationError) {
        console.error("Automation insert error:", automationError);
        return { success: false, error: "Could not create your first automation" };
      }
    }

    revalidatePath("/", "layout");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save onboarding data";
    return { success: false, error: message };
  }
}
