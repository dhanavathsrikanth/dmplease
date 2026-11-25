import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessage } from "@/lib/meta/client";

const replySchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  conversationId: z.string().uuid().nullish(),
  instagramAccountId: z.string().uuid().nullish(),
  recipientId: z.string().trim().min(1, "A recipient is required."),
  recipientUsername: z.string().trim().max(150).optional(),
  message: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(2000, "Messages are limited to 2000 characters."),
});

interface InstagramAccountRow {
  id: string;
  instagram_id: string;
  access_token: string | null;
  username: string | null;
}

/**
 * POST /api/inbox/reply — sends a manual reply from the connected Instagram
 * account and stores the outbound message in the conversation history.
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

  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Verify the workspace belongs to the signed-in user.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", input.workspaceId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 403 }
    );
  }

  // Resolve the Instagram account, making sure it is in the same workspace.
  let accountQuery = supabase
    .from("instagram_accounts")
    .select("id, instagram_id, access_token, username")
    .eq("workspace_id", input.workspaceId);

  if (input.instagramAccountId) {
    accountQuery = accountQuery.eq("id", input.instagramAccountId);
  }

  const { data: accounts } = await accountQuery.limit(1);
  const account = (accounts || [])[0] as InstagramAccountRow | undefined;

  if (!account?.instagram_id) {
    return NextResponse.json(
      { error: "No connected Instagram account for this workspace" },
      { status: 400 }
    );
  }
  if (!account.access_token) {
    return NextResponse.json(
      { error: "This Instagram account has no stored access token" },
      { status: 400 }
    );
  }

  let token: string;
  try {
    token = decryptToken(account.access_token);
  } catch {
    // Legacy rows may hold a plaintext token; let Meta decide if it is valid.
    token = account.access_token;
  }

  let result: { recipient_id?: string; message_id?: string; error?: { message?: string } };
  try {
    result = await sendDirectMessage(
      token,
      account.instagram_id,
      input.recipientId,
      input.message
    );
  } catch (error) {
    console.error("[inbox/reply] Meta request failed:", error);
    return NextResponse.json(
      { error: "Could not reach Meta to deliver this message" },
      { status: 502 }
    );
  }

  const sent = !result?.error;

  if (sent && input.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", input.conversationId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();

    if (conversation) {
      const { error: insertError } = await supabase.from("messages").insert({
        workspace_id: input.workspaceId,
        conversation_id: input.conversationId,
        external_id: result.message_id || null,
        direction: "outbound",
        sender_type: "agent",
        content_type: "text",
        content: { text: input.message },
        delivery_status: "SENT",
      });

      if (insertError) {
        console.warn("[inbox/reply] Could not store outbound message:", insertError.message);
      } else {
        await supabase
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", input.conversationId);
      }
    }
  }

  // Keep the legacy delivery log in sync for existing analytics views.
  const { error: logError } = await supabase.from("dm_logs").insert({
    workspace_id: input.workspaceId,
    instagram_account_id: account.id,
    automation_id: null,
    recipient_id: input.recipientId,
    recipient_username: input.recipientUsername || "instagram_user",
    trigger_keyword: "MANUAL_REPLY",
    dm_message: input.message,
    status: sent ? "SENT" : "FAILED",
  });
  if (logError) {
    console.warn("[inbox/reply] Could not record dm_log:", logError.message);
  }

  if (!sent) {
    return NextResponse.json(
      { error: result?.error?.message || "Meta rejected the message" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, messageId: result.message_id });
}
