"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
    if (workspaceId && payload.triggerKeyword && payload.dmMessage) {
      let automationName = "My First Automation";
      if (payload.primaryGoal === "lead_magnet") automationName = "Freebie / Lead Magnet Delivery";
      if (payload.primaryGoal === "discount") automationName = "Flash Sale / VIP Discount";
      if (payload.primaryGoal === "booking") automationName = "Book a Discovery Call";
      if (payload.primaryGoal === "custom") automationName = "Custom Keyword Auto-Reply";

      await supabase.from("automations").insert({
        workspace_id: workspaceId,
        name: automationName,
        goal: payload.primaryGoal,
        trigger_keywords: [payload.triggerKeyword.toUpperCase().trim()],
        dm_message: payload.dmMessage,
        active: true,
      });
    }

    revalidatePath("/", "layout");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save onboarding data";
    return { success: false, error: message };
  }
}
