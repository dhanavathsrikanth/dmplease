"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export interface AnalyticsView {
  id: string;
  name: string;
  rangeKind: "7d" | "30d" | "90d" | "custom";
  from: string | null;
  to: string | null;
  tab: string;
}

const viewSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  name: z.string().trim().min(1, "Give the view a name.").max(60),
  rangeKind: z.enum(["7d", "30d", "90d", "custom"]),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid start date.")
    .nullable()
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid end date.")
    .nullable()
    .optional(),
  tab: z.string().trim().max(30).default("overview"),
});

async function assertOwnership(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ok: false as const };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  return { supabase, user, ok: Boolean(workspace) };
}

export async function listAnalyticsViews(
  workspaceId: string
): Promise<AnalyticsView[]> {
  const { supabase, user, ok } = await assertOwnership(workspaceId);
  if (!ok || !user) return [];
  const { data } = await supabase
    .from("analytics_views")
    .select("id, name, range_kind, from_date, to_date, tab")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    rangeKind: row.range_kind as AnalyticsView["rangeKind"],
    from: row.from_date ? String(row.from_date) : null,
    to: row.to_date ? String(row.to_date) : null,
    tab: String(row.tab ?? "overview"),
  }));
}

export async function saveAnalyticsView(input: {
  workspaceId: string;
  name: string;
  rangeKind: "7d" | "30d" | "90d" | "custom";
  from?: string | null;
  to?: string | null;
  tab: string;
}) {
  const parsed = viewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid view",
    };
  }
  const { supabase, user, ok } = await assertOwnership(parsed.data.workspaceId);
  if (!ok || !user) {
    return { success: false, error: "Workspace not found or access denied" };
  }

  const { error } = await supabase.from("analytics_views").upsert(
    {
      workspace_id: parsed.data.workspaceId,
      user_id: user.id,
      name: parsed.data.name,
      range_kind: parsed.data.rangeKind,
      from_date: parsed.data.rangeKind === "custom" ? parsed.data.from ?? null : null,
      to_date: parsed.data.rangeKind === "custom" ? parsed.data.to ?? null : null,
      tab: parsed.data.tab,
    },
    { onConflict: "workspace_id,user_id,name" }
  );
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/campaigns");
  return { success: true };
}

export async function deleteAnalyticsView(id: string, workspaceId: string) {
  const { supabase, user, ok } = await assertOwnership(workspaceId);
  if (!ok || !user) {
    return { success: false, error: "Workspace not found or access denied" };
  }
  const { error } = await supabase
    .from("analytics_views")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}
