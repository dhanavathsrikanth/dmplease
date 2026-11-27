import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/meta/vault";
import { subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import { hasDatabaseUrl } from "@/lib/config";

interface PendingAccount {
  instagramBusinessId: string;
  facebookPageId?: string | null;
  username: string;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  followersCount?: number;
  isVerified?: boolean;
  pageToken?: string | null;
}

const connectSchema = z
  .object({
    pendingId: z.string().uuid().optional(),
    accountIds: z.array(z.string().min(1)).max(50).optional(),
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
      .max(50)
      .optional(),
  })
  .refine((data) => Boolean(data.pendingId) || Boolean(data.accounts?.length), {
    message: "Choose at least one account.",
  });

interface ConnectResult {
  username: string;
  instagramBusinessId: string;
  status: "created" | "skipped" | "failed";
  error?: string;
}

/**
 * Creates one isolated workspace per selected Instagram account.
 *
 * Idempotent: an account already connected to any of the user's workspaces is
 * skipped, never duplicated. Failures are returned per account so the UI can
 * retry only the ones that failed.
 */
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
      { error: parsed.error.issues[0]?.message ?? "Invalid account selection" },
      { status: 400 }
    );
  }

  const profile = await getCurrentProfile();
  const workspaceIds = (profile?.ownedWorkspaces ?? []).map((w) => w.id);
  const supabase = await createClient();

  // Resolve the token + account list from the pending OAuth session.
  let sourceToken: string | null = null;
  let pendingId: string | null = null;
  let selected: PendingAccount[] = [];

  if (parsed.data.pendingId) {
    const { data: pending } = await supabase
      .from("pending_connections")
      .select("id, access_token, accounts, expires_at")
      .eq("id", parsed.data.pendingId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!pending) {
      return NextResponse.json(
        { error: "This connection session expired. Please reconnect." },
        { status: 404 }
      );
    }
    if (new Date(String(pending.expires_at)).getTime() <= Date.now()) {
      await supabase.from("pending_connections").delete().eq("id", pending.id);
      return NextResponse.json(
        { error: "This connection session expired. Please reconnect." },
        { status: 410 }
      );
    }
    try {
      sourceToken = decryptToken(String(pending.access_token));
    } catch {
      return NextResponse.json(
        { error: "Stored token could not be decrypted" },
        { status: 500 }
      );
    }
    pendingId = String(pending.id);
    const all = (pending.accounts ?? []) as PendingAccount[];
    const ids = parsed.data.accountIds;
    selected = ids && ids.length > 0
      ? all.filter((account) => ids.includes(account.instagramBusinessId))
      : all;
  } else {
    // Legacy path: use the token from an already-connected account.
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
        { error: "Connect one account first, then add more." },
        { status: 400 }
      );
    }
    try {
      sourceToken = decryptToken(source.access_token);
    } catch {
      return NextResponse.json(
        { error: "Stored token could not be decrypted" },
        { status: 500 }
      );
    }
    selected = (parsed.data.accounts ?? []).map((account) => ({
      instagramBusinessId: account.instagramBusinessId,
      username: account.username,
      displayName: account.displayName ?? null,
      facebookPageId: account.facebookPageId ?? null,
      pageToken: account.pageToken ?? null,
    }));
  }

  if (!sourceToken || selected.length === 0) {
    return NextResponse.json(
      { error: "No accounts selected." },
      { status: 400 }
    );
  }

  // Already-connected accounts are skipped, never duplicated.
  const connectedIds = new Set<string>();
  if (workspaceIds.length > 0) {
    const { data: existing } = await supabase
      .from("instagram_accounts")
      .select("instagram_id")
      .in("workspace_id", workspaceIds);
    for (const row of existing ?? []) {
      connectedIds.add(String(row.instagram_id));
    }
  }

  const results: ConnectResult[] = [];

  for (const account of selected) {
    if (connectedIds.has(account.instagramBusinessId)) {
      results.push({
        username: account.username,
        instagramBusinessId: account.instagramBusinessId,
        status: "skipped",
      });
      continue;
    }

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

      let pageToken: string | null = null;
      if (account.pageToken) {
        try {
          pageToken = decryptToken(account.pageToken);
        } catch {
          pageToken = null;
        }
      }
      const token = pageToken || sourceToken;
      const encryptedToken = encryptToken(token);
      const expiresAt = new Date(
        Date.now() + 60 * 24 * 3600 * 1000
      ).toISOString();

      const { error: insertError } = await supabase
        .from("instagram_accounts")
        .upsert(
          {
            workspace_id: workspaceId,
            instagram_id: account.instagramBusinessId,
            username: account.username,
            name: account.displayName || account.username,
            profile_picture_url: account.profilePictureUrl ?? null,
            followers_count: account.followersCount ?? null,
            is_verified: account.isVerified ?? null,
            access_token: encryptedToken,
            token_status: pageToken ? "active" : "needs_attention",
            token_last_error: pageToken
              ? null
              : "No Facebook Page access token available; DM sending requires a Page token.",
            token_checked_at: new Date().toISOString(),
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
          console.warn("[connect] Prisma mirror failed:", error);
        }
      }

      const subscribeTarget =
        account.facebookPageId || account.instagramBusinessId;
      await subscribeInstagramAccountToWebhooks(subscribeTarget, token);

      connectedIds.add(account.instagramBusinessId);
      results.push({
        username: account.username,
        instagramBusinessId: account.instagramBusinessId,
        status: "created",
      });
    } catch (error) {
      results.push({
        username: account.username,
        instagramBusinessId: account.instagramBusinessId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const created = results.filter((result) => result.status === "created").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;

  // Keep the pending session only when something failed, so the UI can retry.
  if (pendingId && failed === 0) {
    await supabase.from("pending_connections").delete().eq("id", pendingId);
  }

  return NextResponse.json({
    success: created > 0 || skipped > 0,
    created,
    skipped,
    failed,
    results,
  });
}
