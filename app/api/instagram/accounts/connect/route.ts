import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/meta/vault";
import { subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { hasDatabaseUrl } from "@/lib/config";

const connectSchema = z.object({
  accounts: z
    .array(
      z.object({
        instagramBusinessId: z.string().min(1),
        username: z.string().min(1),
        displayName: z.string().nullable().optional(),
        facebookPageId: z.string().nullable().optional(),
        pageToken: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(50),
});

/** Creates one isolated workspace per selected Instagram account. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account selection", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const profile = await getCurrentProfile();
  const workspaceIds = (profile?.ownedWorkspaces ?? []).map((workspace) => workspace.id);
  const supabase = await createClient();

  const { data: connectedRows } = workspaceIds.length
    ? await supabase
        .from("instagram_accounts")
        .select("instagram_id, access_token")
        .in("workspace_id", workspaceIds)
        .limit(1)
    : { data: null };

  const source = connectedRows?.[0];
  if (!source?.access_token) {
    return NextResponse.json(
      { error: "Connect one account first, then add more in bulk." },
      { status: 400 }
    );
  }

  let sourceToken: string;
  try {
    sourceToken = decryptToken(source.access_token);
  } catch {
    return NextResponse.json({ error: "Stored token could not be decrypted" }, { status: 500 });
  }

  const results: Array<{ username: string; ok: boolean; error?: string }> = [];

  for (const account of parsed.data.accounts) {
    try {
      const workspaceName = `@${account.username}`;

      const { data: newWorkspace } = await supabase
        .from("workspaces")
        .insert({ name: workspaceName, owner_id: user.id })
        .select("id")
        .single();

      if (!newWorkspace?.id) throw new Error("Could not create workspace");
      const workspaceId: string = newWorkspace.id;

      await supabase.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: user.id, role: "OWNER" },
        { onConflict: "workspace_id,user_id" }
      );

      const token = account.pageToken || sourceToken;
      const encryptedToken = encryptToken(token);
      const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

      const { error: insertError } = await supabase.from("instagram_accounts").upsert(
        {
          workspace_id: workspaceId,
          instagram_id: account.instagramBusinessId,
          username: account.username,
          name: account.displayName || account.username,
          access_token: encryptedToken,
          token_expires_at: expiresAt,
          webhook_subscribed: true,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instagram_id" }
      );
      if (insertError) throw insertError;

      if (hasDatabaseUrl()) {
        try {
          await prisma.instagramAccount.upsert({
            where: { instagramId: account.instagramBusinessId },
            create: {
              workspaceId,
              instagramId: account.instagramBusinessId,
              username: account.username,
              name: account.displayName || account.username,
              accessToken: encryptedToken,
              tokenExpiresAt: new Date(expiresAt),
              webhookSubscribed: true,
            },
            update: { workspaceId, username: account.username },
          });
        } catch (error) {
          console.warn("[bulk-connect] Prisma mirror failed:", error);
        }
      }

      const subscribeTarget = account.facebookPageId || account.instagramBusinessId;
      await subscribeInstagramAccountToWebhooks(subscribeTarget, token);

      results.push({ username: account.username, ok: true });
    } catch (error) {
      results.push({
        username: account.username,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const created = results.filter((result) => result.ok).length;
  return NextResponse.json({ success: created > 0, created, results });
}
