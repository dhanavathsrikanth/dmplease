import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { sendDirectMessage } from "@/lib/meta/client";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/instagram/send-dm
 * Body: { recipientId: string; message: string }
 *
 * Sends a manual DM from the creator's connected Instagram account
 * to a specific recipient (by IGSID). Used by the Inbox "Reply" button.
 * Records the send in dm_logs with status SENT or FAILED.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { recipientId, recipientUsername, message } = body as {
      recipientId: string;
      recipientUsername?: string;
      message: string;
    };

    if (!recipientId || !message?.trim()) {
      return NextResponse.json(
        { success: false, error: "recipientId and message are required" },
        { status: 400 }
      );
    }

    // Resolve workspace + Instagram account
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);

    const workspaceId = workspaces?.[0]?.id;
    if (!workspaceId) {
      return NextResponse.json({ success: false, error: "No workspace found" }, { status: 400 });
    }

    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, instagram_id, access_token, username")
      .eq("workspace_id", workspaceId)
      .limit(1);

    const account = accounts?.[0];
    if (!account?.access_token) {
      return NextResponse.json(
        { success: false, error: "No connected Instagram account" },
        { status: 400 }
      );
    }

    let token: string;
    try {
      token = decryptToken(account.access_token);
    } catch {
      token = account.access_token;
    }

    const result = await sendDirectMessage(token, account.instagram_id, recipientId, message.trim());
    const success = !result?.error;

    // Log the manual DM
    try {
      await prisma.dmLog.create({
        data: {
          workspaceId,
          instagramAccountId: account.id,
          automationId: null,
          recipientId,
          recipientUsername: recipientUsername || "instagram_user",
          triggerKeyword: "MANUAL_REPLY",
          dmMessage: message.trim(),
          status: success ? "SENT" : "FAILED",
        },
      });
    } catch (logErr) {
      console.warn("[send-dm] Log creation failed:", logErr);
    }

    if (!success) {
      return NextResponse.json(
        { success: false, error: result?.error?.message || "Meta API rejected the message" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, messageId: result.message_id });
  } catch (err: unknown) {
    console.error("[send-dm] Error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
