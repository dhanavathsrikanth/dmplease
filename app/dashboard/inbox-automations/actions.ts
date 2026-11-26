"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";

const TRIGGER_TYPES = [
  "DM_KEYWORD",
  "STORY_REPLY",
  "STORY_MENTION",
  "SHARE_TO_DM",
  "MESSAGE_REACTION",
] as const;

const COLLECT_FIELDS = ["none", "email", "phone", "name", "custom"] as const;

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  workspaceId: z.string().uuid("Select a workspace."),
  name: z
    .string()
    .trim()
    .min(1, "Give this rule a name.")
    .max(120, "Keep the name under 120 characters."),
  triggerType: z.enum(TRIGGER_TYPES),
  keywords: z.array(z.string().trim().min(1)).max(25).default([]),
  message: z
    .string()
    .trim()
    .min(1, "Write the reply message.")
    .max(2000, "Keep the message under 2000 characters."),
  buttonText: z.string().trim().max(80).default(""),
  buttonUrl: z
    .union([z.literal(""), z.url("Enter a valid URL or leave this blank.")])
    .default(""),
  collectField: z.enum(COLLECT_FIELDS).default("none"),
  /** Ask for Follow — applies to DM, story and share rules. */
  followGateEnabled: z.boolean().default(false),
  openingMessage: z.string().trim().max(500).default(""),
  followGateButtonLabel: z.string().trim().max(20).default(""),
  followGateOnUnavailable: z.enum(["hold", "deliver"]).default("hold"),
  oncePerDays: z.coerce.number().int().min(0).max(365).default(45),
  active: z.boolean().default(true),
});

type RuleInput = z.input<typeof ruleSchema>;

interface RuleActionResult {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

function fail(error: string): RuleActionResult {
  return { success: false, error };
}

function validationFail(error: z.ZodError): RuleActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    success: false,
    error: "Please check the highlighted fields.",
    fieldErrors,
  };
}

/** Returns the caller's owned workspace IDs, or null when unauthenticated. */
async function ownedWorkspaceIds(): Promise<string[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return (profile.ownedWorkspaces || []).map((workspace) => workspace.id);
}

async function ownedRuleId(id: string): Promise<string | null> {
  const workspaceIds = await ownedWorkspaceIds();
  if (!workspaceIds || workspaceIds.length === 0) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("dm_rules")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();

  const row = data as { id: string; workspace_id: string } | null;
  if (!row || !workspaceIds.includes(row.workspace_id)) return null;
  return row.id;
}

function cleanupKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const value = keyword.trim().toUpperCase();
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export async function createRule(payload: RuleInput): Promise<RuleActionResult> {
  const workspaceIds = await ownedWorkspaceIds();
  if (!workspaceIds) return fail("Not authenticated.");

  const parsed = ruleSchema.safeParse(payload);
  if (!parsed.success) return validationFail(parsed.error);

  const values = parsed.data;
  if (!workspaceIds.includes(values.workspaceId)) {
    return fail("That workspace was not found or you do not have access to it.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dm_rules")
    .insert({
      workspace_id: values.workspaceId,
      name: values.name,
      trigger_type: values.triggerType,
      keywords: cleanupKeywords(values.keywords),
      message: values.message,
      variants: [],
      button_text: values.buttonText || null,
      button_url: values.buttonUrl || null,
      collect_field: values.collectField === "none" ? null : values.collectField,
      follow_gate_enabled: values.followGateEnabled,
      opening_message: values.openingMessage || null,
      follow_gate_button_label: values.followGateButtonLabel || null,
      follow_gate_on_unavailable: values.followGateOnUnavailable,
      once_per_days: values.oncePerDays,
      priority: 0,
      active: values.active,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[dm_rules] create failed:", error.message);
    return fail(error.message || "Could not create the rule.");
  }

  revalidatePath("/dashboard/inbox-automations");
  return { success: true, id: data?.id };
}

export async function updateRule(payload: RuleInput): Promise<RuleActionResult> {
  if (!payload.id) return fail("Missing rule ID.");

  const parsed = ruleSchema.safeParse(payload);
  if (!parsed.success) return validationFail(parsed.error);

  const ownedId = await ownedRuleId(payload.id);
  if (!ownedId) return fail("That rule was not found or you do not have access to it.");

  const values = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("dm_rules")
    .update({
      name: values.name,
      trigger_type: values.triggerType,
      keywords: cleanupKeywords(values.keywords),
      message: values.message,
      button_text: values.buttonText || null,
      button_url: values.buttonUrl || null,
      collect_field: values.collectField === "none" ? null : values.collectField,
      follow_gate_enabled: values.followGateEnabled,
      opening_message: values.openingMessage || null,
      follow_gate_button_label: values.followGateButtonLabel || null,
      follow_gate_on_unavailable: values.followGateOnUnavailable,
      once_per_days: values.oncePerDays,
      active: values.active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ownedId);

  if (error) {
    console.error("[dm_rules] update failed:", error.message);
    return fail(error.message || "Could not update the rule.");
  }

  revalidatePath("/dashboard/inbox-automations");
  return { success: true, id: ownedId };
}

export async function deleteRule(id: string): Promise<RuleActionResult> {
  const ownedId = await ownedRuleId(id);
  if (!ownedId) return fail("That rule was not found or you do not have access to it.");

  const supabase = await createClient();
  const { error } = await supabase.from("dm_rules").delete().eq("id", ownedId);
  if (error) {
    console.error("[dm_rules] delete failed:", error.message);
    return fail(error.message || "Could not delete the rule.");
  }

  revalidatePath("/dashboard/inbox-automations");
  return { success: true };
}

export async function toggleRule(
  id: string,
  active: boolean
): Promise<RuleActionResult> {
  const ownedId = await ownedRuleId(id);
  if (!ownedId) return fail("That rule was not found or you do not have access to it.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("dm_rules")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", ownedId);

  if (error) {
    console.error("[dm_rules] toggle failed:", error.message);
    return fail(error.message || "Could not update the rule.");
  }

  revalidatePath("/dashboard/inbox-automations");
  return { success: true };
}
