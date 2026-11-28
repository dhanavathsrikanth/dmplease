"use server";

import { revalidatePath } from "next/cache";

import { createWorkspaceToken } from "@/lib/conversions";
import { createClient } from "@/lib/supabase/server";

export type RotateConversionTokenResult =
  | { success: true; token: string }
  | { success: false; error: string };

/**
 * Rotates the workspace conversion token.
 *
 * The token itself is stateless, so revocation works by bumping the workspace's
 * `conversion_token_version`: the ingest route rejects any token whose version
 * claim does not match the stored value. Every previously issued token stops
 * working immediately.
 */
export async function rotateConversionToken(): Promise<RotateConversionTokenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: workspace, error: readError } = await supabase
    .from("workspaces")
    .select("id, conversion_token_version")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (readError) {
    return { success: false, error: readError.message };
  }
  if (!workspace) {
    return { success: false, error: "Workspace not found" };
  }

  const currentVersion = Number(workspace.conversion_token_version ?? 1);
  const newVersion = currentVersion + 1;

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({ conversion_token_version: newVersion })
    .eq("id", workspace.id)
    .eq("owner_id", user.id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  revalidatePath("/dashboard/settings");
  return {
    success: true,
    token: createWorkspaceToken(String(workspace.id), newVersion),
  };
}
