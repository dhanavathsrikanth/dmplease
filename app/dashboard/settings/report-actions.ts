"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface ReportLinkView {
  id: string;
  token: string;
  enabled: boolean;
  createdAt: string;
}

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

export async function getReportLink(
  workspaceId: string
): Promise<ReportLinkView | null> {
  const { supabase, ok } = await assertOwnership(workspaceId);
  if (!ok) return null;
  const { data } = await supabase
    .from("report_links")
    .select("id, token, enabled, created_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    token: String(data.token),
    enabled: Boolean(data.enabled),
    createdAt: String(data.created_at),
  };
}

export async function createReportLink(workspaceId: string) {
  const { supabase, user, ok } = await assertOwnership(workspaceId);
  if (!ok || !user) {
    return { success: false, error: "Workspace not found or access denied" };
  }

  // One active link per workspace: revoke any existing ones first.
  await supabase
    .from("report_links")
    .update({ enabled: false, revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);

  const token = randomBytes(24).toString("base64url");
  const { error } = await supabase.from("report_links").insert({
    workspace_id: workspaceId,
    token,
    enabled: true,
    created_by: user.id,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/settings");
  return { success: true, token };
}

export async function setReportLinkEnabled(
  id: string,
  workspaceId: string,
  enabled: boolean
) {
  const { supabase, ok } = await assertOwnership(workspaceId);
  if (!ok) return { success: false, error: "Not authorized" };
  const { error } = await supabase
    .from("report_links")
    .update({ enabled })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { success: true };
}

export async function revokeReportLink(id: string, workspaceId: string) {
  const { supabase, ok } = await assertOwnership(workspaceId);
  if (!ok) return { success: false, error: "Not authorized" };
  const { error } = await supabase
    .from("report_links")
    .update({ enabled: false, revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { success: true };
}
