"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import {
  followGateButtonLabelSchema,
  openingMessageSchema,
} from "@/lib/validation/follow-gate";
import { dmVariantsSchema } from "@/lib/validation/dm-variants";
import { isValidTimeZone, normalizeWeekStart } from "@/lib/timezone";

const fallbackSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  accountId: z.string().uuid("Invalid account."),
  enabled: z.boolean(),
  message: z.string().trim().max(1000).default(""),
  variants: dmVariantsSchema,
  oncePerDays: z.coerce.number().int().min(0).max(365).default(45),
  followGateEnabled: z.boolean().default(false),
  openingMessage: openingMessageSchema.default(""),
  buttonLabel: followGateButtonLabelSchema.default(""),
  onUnavailable: z.enum(["hold", "deliver"]).default("hold"),
  buttonText: z.string().trim().max(20).default(""),
  buttonUrl: z.union([z.literal(""), z.url()]).default(""),
});

export type FallbackReplyInput = z.input<typeof fallbackSchema>;
export interface FallbackActionResult {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Persists the account-level "Respond to all DMs" fallback. Only workspace
 * owners can write, and the account must belong to that workspace.
 */
export async function saveFallbackReply(
  payload: FallbackReplyInput
): Promise<FallbackActionResult> {
  const parsed = fallbackSchema.safeParse(payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid settings",
      fieldErrors,
    };
  }
  const values = parsed.data;

  const profile = await getCurrentProfile();
  const owned = (profile?.ownedWorkspaces || []).map((workspace) => workspace.id);
  if (!owned.includes(values.workspaceId)) {
    return { success: false, error: "Workspace not found or access denied." };
  }

  const supabase = await createClient();
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", values.accountId)
    .eq("workspace_id", values.workspaceId)
    .maybeSingle();
  if (!account) {
    return { success: false, error: "Instagram account not found in this workspace." };
  }

  if (values.enabled && !values.message.trim()) {
    return {
      success: false,
      error: "Write a fallback message before enabling Respond to all DMs.",
      fieldErrors: { message: "A message is required when enabled." },
    };
  }

  const { error } = await supabase
    .from("instagram_accounts")
    .update({
      fallback_reply_enabled: values.enabled,
      fallback_reply_message: values.message.trim() || null,
      fallback_reply_variants: values.variants,
      fallback_once_per_days: values.oncePerDays,
      fallback_follow_gate_enabled: values.followGateEnabled,
      fallback_opening_message: values.followGateEnabled
        ? values.openingMessage || null
        : null,
      fallback_follow_gate_button_label: values.followGateEnabled
        ? values.buttonLabel || null
        : null,
      fallback_follow_gate_on_unavailable: values.onUnavailable,
      fallback_button_text: values.buttonText || null,
      fallback_button_url: values.buttonUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.accountId)
    .eq("workspace_id", values.workspaceId);

  if (error) {
    console.error("[fallback-reply] save failed:", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/inbox-automations");
  return { success: true };
}

const preferencesSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  timezone: z
    .string()
    .trim()
    .refine((value) => isValidTimeZone(value), "Choose a valid time zone."),
  weekStartsOn: z.coerce.number().int().min(0).max(6),
});

export type WorkspacePreferencesInput = z.input<typeof preferencesSchema>;

/**
 * Persists the workspace clock. Every analytics range, heatmap and timestamp
 * reads these values, so only the workspace owner may change them.
 */
export async function saveWorkspacePreferences(
  payload: WorkspacePreferencesInput
): Promise<FallbackActionResult> {
  const parsed = preferencesSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid preferences",
    };
  }
  const values = parsed.data;

  const profile = await getCurrentProfile();
  const owned = (profile?.ownedWorkspaces || []).map((workspace) => workspace.id);
  if (!owned.includes(values.workspaceId)) {
    return { success: false, error: "Workspace not found or access denied." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({
      timezone: values.timezone,
      week_starts_on: normalizeWeekStart(values.weekStartsOn),
      updated_at: new Date().toISOString(),
    })
    .eq("id", values.workspaceId);

  if (error) {
    console.error("[workspace-preferences] save failed:", error.message);
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/overview");
  revalidatePath("/dashboard");
  return { success: true };
}
