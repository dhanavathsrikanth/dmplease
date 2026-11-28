"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { LinkRotationMode } from "@/lib/link-rotation";
import { isHttpUrl } from "@/lib/safe-url";

const targetSchema = z.object({
  id: z.string().uuid().optional(),
  destinationUrl: z
    .string()
    .trim()
    .url("Enter a full URL such as https://yourbrand.com/offer")
    .refine(isHttpUrl, "Only http(s) URLs are allowed"),
  label: z.string().trim().max(80).optional(),
  enabled: z.boolean().default(true),
});

const rotatorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give this link group a name").max(80),
  mode: z.enum(["sticky", "round_robin"]).default("sticky"),
  targets: z.array(targetSchema).min(1, "Add at least one destination").max(10),
});

export interface LinkRotatorView {
  id: string;
  name: string;
  mode: LinkRotationMode;
  targets: Array<{
    id: string;
    destinationUrl: string;
    label: string | null;
    enabled: boolean;
  }>;
}

async function ownedWorkspaceId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function listLinkRotators(): Promise<LinkRotatorView[]> {
  const workspaceId = await ownedWorkspaceId();
  if (!workspaceId) return [];
  const supabase = await createClient();
  const { data: rotators } = await supabase
    .from("link_rotators")
    .select("id, name, mode")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (!rotators?.length) return [];

  const { data: targets } = await supabase
    .from("link_rotator_targets")
    .select("id, rotator_id, destination_url, label, enabled, position")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });

  return rotators.map((rotator) => ({
    id: String(rotator.id),
    name: String(rotator.name),
    mode: rotator.mode as LinkRotationMode,
    targets: (targets ?? [])
      .filter((target) => target.rotator_id === rotator.id)
      .map((target) => ({
        id: String(target.id),
        destinationUrl: String(target.destination_url),
        label: target.label ? String(target.label) : null,
        enabled: Boolean(target.enabled),
      })),
  }));
}

export async function saveLinkRotator(input: {
  id?: string;
  name: string;
  mode: string;
  targets: Array<{
    destinationUrl: string;
    label?: string;
    enabled: boolean;
    id?: string;
  }>;
}) {
  const parsed = rotatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid link group",
    };
  }
  const workspaceId = await ownedWorkspaceId();
  if (!workspaceId) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  let rotatorId = parsed.data.id;
  if (rotatorId) {
    const { data: owned } = await supabase
      .from("link_rotators")
      .select("id")
      .eq("id", rotatorId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!owned) return { success: false, error: "Link group not found" };
  }

  try {
    if (rotatorId) {
      await supabase
        .from("link_rotators")
        .update({ name: parsed.data.name, mode: parsed.data.mode })
        .eq("id", rotatorId);
      await supabase
        .from("link_rotator_targets")
        .delete()
        .eq("rotator_id", rotatorId);
    } else {
      const { data: created, error } = await supabase
        .from("link_rotators")
        .insert({
          workspace_id: workspaceId,
          name: parsed.data.name,
          mode: parsed.data.mode,
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Could not create link group");
      rotatorId = String(created.id);
    }

    const { error: targetsError } = await supabase
      .from("link_rotator_targets")
      .insert(
        parsed.data.targets.map((target, index) => ({
          workspace_id: workspaceId,
          rotator_id: rotatorId,
          destination_url: target.destinationUrl,
          label: target.label || null,
          enabled: target.enabled,
          position: index,
        }))
      );
    if (targetsError) throw targetsError;

    revalidatePath("/dashboard/campaigns");
    return { success: true, rotatorId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not save link group",
    };
  }
}

export async function deleteLinkRotator(id: string) {
  const workspaceId = await ownedWorkspaceId();
  if (!workspaceId) return { success: false, error: "Not authenticated" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("link_rotators")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/campaigns");
  return { success: true };
}
