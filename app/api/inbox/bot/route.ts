import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const botSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  conversationId: z.string().uuid("Invalid conversation."),
  active: z.boolean(),
});

/**
 * POST /api/inbox/bot — resumes or pauses automation on a conversation after
 * a human agent took over. The webhook processor skips any conversation whose
 * `is_bot_active` is false.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = botSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 }
    );
  }
  const { workspaceId, conversationId, active } = parsed.data;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 403 }
    );
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found in this workspace" },
      { status: 404 }
    );
  }

  const { error } = await supabase
    .from("conversations")
    .update({ is_bot_active: active })
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/dashboard/inbox");
  return NextResponse.json({ success: true, active });
}
