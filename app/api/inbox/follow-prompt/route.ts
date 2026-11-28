import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessageWithButton } from "@/lib/meta/client";
import { verifyFollowership } from "@/lib/meta/follow-gate";
import { captureServerEvent } from "@/lib/posthog-server";

const promptSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  conversationId: z.string().uuid().nullish(),
  instagramAccountId: z.string().uuid().nullish(),
  recipientId: z.string().trim().min(1, "A recipient is required."),
  recipientUsername: z.string().trim().max(150).optional(),
  /** Optional content released only after Meta confirms the follow. */
  promisedContent: z.string().trim().max(1000).optional(),
});

interface AccountRow {
  id: string;
  instagram_id: string;
  access_token: string | null;
  username: string | null;
}

/**
 * POST /api/inbox/follow-prompt — sends an in-chat "follow account" card with a
 * hard gate: the promised content is released only after the follow is verified
 * on the postback (or a DM reply). The pre-prompt check gives us accurate
 * attribution for follower growth from this feature.
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

  const parsed = promptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;

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

  let accountQuery = supabase
    .from("instagram_accounts")
    .select("id, instagram_id, access_token, username")
    .eq("workspace_id", input.workspaceId);
  if (input.instagramAccountId) {
    accountQuery = accountQuery.eq("id", input.instagramAccountId);
  }
  const { data: accounts } = await accountQuery.limit(1);
  const account = (accounts || [])[0] as AccountRow | undefined;

  if (!account?.instagram_id || !account.access_token) {
    return NextResponse.json(
      { error: "No connected Instagram account with a valid token" },
      { status: 400 }
    );
  }

  // The conversation must belong to this workspace before we write anything
  // against it (follow prompt, pending DM, or mirrored message).
  if (input.conversationId) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", input.conversationId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
  }

  let token: string;
  try {
    token = decryptToken(account.access_token);
  } catch {
    token = account.access_token;
  }

  // The person has already messaged us, so Meta can answer this accurately.
  const verification = await verifyFollowership(
    token,
    account.instagram_id,
    input.recipientId
  );

  if (verification.status === "follower") {
    return NextResponse.json({
      success: true,
      status: "already_follower",
      alreadyFollowing: true,
    });
  }

  const handle = (account.username || input.recipientUsername || "our account").replace(
    /^@/,
    ""
  );
  const displayName = input.recipientUsername || "there";
  const promised = input.promisedContent?.trim() || "";
  const openingText =
    `Hey ${displayName}! Follow @${handle} to stay in the loop` +
    `${promised ? " and unlock your content" : ""}, then tap below. 👇`;

  const { data: pending, error: pendingError } = await supabase
    .from("pending_dms")
    .insert({
      workspace_id: input.workspaceId,
      kind: "follow_prompt",
      instagram_account_id: account.id,
      recipient_id: input.recipientId,
      message: promised || null,
      button_text: "I'm following ✅",
    })
    .select("id")
    .single();

  if (pendingError || !pending?.id) {
    return NextResponse.json(
      { error: pendingError?.message || "Could not create the follow prompt" },
      { status: 500 }
    );
  }

  const { data: prompt, error: promptError } = await supabase
    .from("follow_prompts")
    .insert({
      workspace_id: input.workspaceId,
      instagram_account_id: account.id,
      conversation_id: input.conversationId ?? null,
      recipient_id: input.recipientId,
      pending_id: pending.id,
      source: "inbox_agent",
      status: "pending",
      prior_follower:
        verification.status === "not_follower"
          ? false
          : verification.status === "unavailable"
            ? null
            : true,
      handle,
      promised_content: promised || null,
    })
    .select("id")
    .single();

  if (promptError || !prompt?.id) {
    await supabase.from("pending_dms").delete().eq("id", pending.id);
    return NextResponse.json(
      { error: promptError?.message || "Could not record the follow prompt" },
      { status: 500 }
    );
  }

  const result = await sendDirectMessageWithButton(
    token,
    account.instagram_id,
    input.recipientId,
    openingText,
    "I'm following ✅",
    `OPTIN:${pending.id}`
  );

  if (result?.error) {
    await supabase.from("follow_prompts").delete().eq("id", prompt.id);
    await supabase.from("pending_dms").delete().eq("id", pending.id);
    return NextResponse.json(
      { error: "Meta rejected the follow prompt. Try again shortly." },
      { status: 502 }
    );
  }

  // Mirror the outbound card into the stored thread so it survives a reload.
  if (input.conversationId) {
    await supabase.from("messages").insert({
      workspace_id: input.workspaceId,
      conversation_id: input.conversationId,
      external_id: result?.message_id ?? null,
      direction: "outbound",
      sender_type: "agent",
      content_type: "text",
      content: { text: `${openingText}\n\n[I'm following ✅]` },
      delivery_status: "sent",
    });
  }

  captureServerEvent({
    event: "follow_prompt_sent",
    properties: {
      prompt_id: prompt.id,
      prior_follower: verification.status === "not_follower" ? false : null,
      source: "inbox_agent",
    },
    anonymous: true,
  });

  return NextResponse.json({
    success: true,
    status: "prompt_sent",
    promptId: prompt.id,
    openingText,
    priorFollower: verification.status === "not_follower" ? false : null,
  });
}
