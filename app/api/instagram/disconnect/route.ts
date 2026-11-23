import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import { unsubscribeInstagramAccountFromWebhooks } from "@/lib/meta/client";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();

    // 1. Get user workspaces
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id);

    const workspaceIds = (workspaces || []).map((w) => w.id);

    // 2. Attempt to unsubscribe from Meta webhooks before deleting
    if (workspaceIds.length > 0) {
      const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select("instagram_id, access_token")
        .in("workspace_id", workspaceIds);

      if (accounts && accounts.length > 0) {
        for (const acc of accounts) {
          if (acc.access_token && acc.instagram_id) {
            try {
              const plainToken = decryptToken(acc.access_token);
              await unsubscribeInstagramAccountFromWebhooks(
                acc.instagram_id,
                plainToken
              );
            } catch (unsubErr) {
              console.warn(
                "[Instagram Disconnect] Webhook unsubscribe warning:",
                unsubErr
              );
            }
          }
        }
      }
    }

    // 3. Clear profile instagram handle
    await supabase
      .from("profiles")
      .update({ instagram_handle: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    // 4. Erase from Supabase instagram_accounts table
    if (workspaceIds.length > 0) {
      await supabase
        .from("instagram_accounts")
        .delete()
        .in("workspace_id", workspaceIds);
    }

    // 5. Erase from Prisma database if direct connection is available
    const dbUrl = process.env.DATABASE_URL || "";
    const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

    if (hasDb) {
      try {
        await prisma.instagramAccount.deleteMany({
          where: {
            workspace: {
              ownerId: user.id,
            },
          },
        });
      } catch (e) {
        console.warn("[Instagram Disconnect Prisma fallback]:", e);
      }
    }

    // 6. Completely purge layout and settings page caches
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/campaigns");
    revalidatePath("/dashboard/overview");

    return NextResponse.json({ success: true, disconnected: true });
  } catch (error: any) {
    console.error("[Instagram Disconnect Error]:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to disconnect Instagram account" },
      { status: 500 }
    );
  }
}
