"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const postbackRouteSchema = z.object({
  id: z.string().uuid().optional(),
  workspaceId: z.string().uuid("Invalid workspace."),
  automationId: z.string().uuid().nullable().optional(),
  payload: z.string().trim().min(1, "A payload is required.").max(255),
  action: z.enum(["tag", "branch", "followup"]),
  config: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});

export interface PostbackRouteView {
  id: string;
  payload: string;
  action: "tag" | "branch" | "followup";
  config: Record<string, unknown>;
  active: boolean;
  automationId: string | null;
}

export async function listPostbackRoutes(
  workspaceId: string
): Promise<PostbackRouteView[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return [];
  const { data } = await supabase
    .from("postback_routes")
    .select("id, payload, action, config, active, automation_id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: String(row.id),
    payload: String(row.payload),
    action: row.action as "tag" | "branch" | "followup",
    config: (row.config ?? {}) as Record<string, unknown>,
    active: Boolean(row.active),
    automationId: row.automation_id ? String(row.automation_id) : null,
  }));
}

export async function savePostbackRoute(input: {
  id?: string;
  workspaceId: string;
  automationId?: string | null;
  payload: string;
  action: "tag" | "branch" | "followup";
  config: Record<string, unknown>;
  active: boolean;
}) {
  const parsed = postbackRouteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid route" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", parsed.data.workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return { success: false, error: "Workspace not found or access denied" };

  try {
    if (parsed.data.id) {
      const { error } = await supabase
        .from("postback_routes")
        .update({
          payload: parsed.data.payload,
          action: parsed.data.action,
          config: parsed.data.config,
          active: parsed.data.active,
          automation_id: parsed.data.automationId ?? null,
        })
        .eq("id", parsed.data.id)
        .eq("workspace_id", parsed.data.workspaceId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("postback_routes").insert({
        workspace_id: parsed.data.workspaceId,
        automation_id: parsed.data.automationId ?? null,
        payload: parsed.data.payload,
        action: parsed.data.action,
        config: parsed.data.config,
        active: parsed.data.active,
      });
      if (error) throw error;
    }
    revalidatePath("/dashboard/inbox-automations");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not save the route",
    };
  }
}

export async function deletePostbackRoute(id: string, workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return { success: false, error: "Not authorized" };
  const { error } = await supabase
    .from("postback_routes")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/inbox-automations");
  return { success: true };
}
