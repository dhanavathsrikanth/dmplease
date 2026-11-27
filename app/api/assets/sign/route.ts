import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  createAssetUpload,
  deleteAsset,
  hasR2,
  isWorkspaceAssetKey,
} from "@/lib/cloudflare/r2";
import { isMessageFormat } from "@/lib/message-formats";

const signSchema = z.object({
  format: z.string().refine(isMessageFormat, "Unsupported message format"),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
  filename: z.string().trim().max(255).optional(),
});

const deleteSchema = z.object({ objectKey: z.string().min(1).max(1000) });

async function workspaceForUser(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/** Returns whether Cloudflare R2 is configured, so the UI can be honest. */
export async function GET() {
  return NextResponse.json({ configured: hasR2() });
}

/** Creates a short-lived presigned PUT URL for a Cloudflare R2 object. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = signSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const workspaceId = await workspaceForUser(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  try {
    const ticket = await createAssetUpload({
      workspaceId,
      format: parsed.data.format as Parameters<typeof createAssetUpload>[0]["format"],
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    return NextResponse.json({ success: true, ...ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not sign upload";
    const unavailable = message.includes("not configured");
    return NextResponse.json(
      { error: message },
      { status: unavailable ? 503 : 400 }
    );
  }
}

/** Deletes an asset the workspace owns. */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
  }

  const workspaceId = await workspaceForUser(user.id);
  if (!workspaceId || !isWorkspaceAssetKey(workspaceId, parsed.data.objectKey)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    await deleteAsset(parsed.data.objectKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[assets] Delete failed:", error);
    return NextResponse.json({ error: "Could not delete asset" }, { status: 500 });
  }
}
