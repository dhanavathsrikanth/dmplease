"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const contactUpdateSchema = z.object({
  contactId: z.string().uuid("Invalid contact."),
  workspaceId: z.string().uuid("Invalid workspace."),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  properties: z.record(z.string(), z.string().max(500)).default({}),
  status: z.enum(["new", "contacted", "qualified", "customer", "archived"]).default("new"),
  notes: z.string().max(2000).nullable().optional(),
});

export interface ContactUpdateInput {
  contactId: string;
  workspaceId: string;
  tags: string[];
  properties: Record<string, string>;
  status: "new" | "contacted" | "qualified" | "customer" | "archived";
  notes?: string | null;
}

async function assertOwnership(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, error: "Not authenticated" };
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) {
    return { supabase, ok: false as const, error: "Workspace not found or access denied" };
  }
  return { supabase, ok: true as const, error: null };
}

export async function updateContact(input: ContactUpdateInput) {
  const parsed = contactUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid contact update",
    };
  }
  const { supabase, ok, error } = await assertOwnership(parsed.data.workspaceId);
  if (!ok) return { success: false, error };

  const { error: updateError } = await supabase
    .from("contacts")
    .update({
      tags: parsed.data.tags,
      properties: parsed.data.properties,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.contactId)
    .eq("workspace_id", parsed.data.workspaceId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  revalidatePath("/dashboard/contacts");
  revalidatePath(`/dashboard/contacts/${parsed.data.contactId}`);
  return { success: true };
}

export async function deleteContact(contactId: string, workspaceId: string) {
  const { supabase, ok, error } = await assertOwnership(workspaceId);
  if (!ok) return { success: false, error };

  const { error: deleteError } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("workspace_id", workspaceId);
  if (deleteError) return { success: false, error: deleteError.message };

  revalidatePath("/dashboard/contacts");
  return { success: true };
}
