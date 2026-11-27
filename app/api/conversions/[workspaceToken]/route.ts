import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { parseWorkspaceToken } from "@/lib/conversions";

const conversionSchema = z.object({
  event_type: z.enum(["lead", "checkout", "purchase", "subscribe"]),
  external_event_id: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
  igsid: z.string().trim().max(100).optional(),
  revenue: z.number().min(0).max(100000000).optional(),
  currency: z.string().trim().length(3).optional(),
  url: z.string().trim().max(2000).optional(),
  post_id: z.string().trim().max(255).optional(),
  keyword: z.string().trim().max(100).optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a UTM campaign value to a real automation id.
 *
 * New links carry the full UUID. Older links carried an 8-character prefix, so
 * we resolve that prefix within the workspace instead of writing an invalid
 * UUID into the conversions table.
 */
async function resolveAutomationId(
  db: ReturnType<typeof getAdminDb>,
  workspaceId: string,
  value: string | null
): Promise<string | null> {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (UUID_RE.test(raw)) return raw;
  if (!/^[0-9a-f]{6,12}$/i.test(raw)) return null;
  const { data } = await db
    .from("automations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("id", `${raw}%`)
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

/**
 * Public, signed conversion ingest. The workspace token is generated in
 * Settings and is safe to paste into an external checkout or pixel.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceToken: string }> }
) {
  const { workspaceToken } = await context.params;
  const workspaceId = parseWorkspaceToken(workspaceToken);

  if (!workspaceId) {
    return NextResponse.json(
      { error: "Invalid workspace token" },
      { status: 401, headers: CORS_HEADERS }
    );
  }
  if (!hasAdminDb()) {
    return NextResponse.json(
      { error: "Conversion tracking unavailable" },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const parsed = conversionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.flatten().fieldErrors },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const body = parsed.data;
  if (!body.email && !body.igsid) {
    return NextResponse.json(
      { error: "Provide email or igsid so the conversion can be attributed" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const db = getAdminDb();
  const { data: workspace } = await db
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // Resolve the person we can attribute to.
  let contactId: string | null = null;
  if (body.igsid) {
    const { data: byIg } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("instagram_id", body.igsid)
      .maybeSingle();
    contactId = byIg?.id ?? null;
  }
  if (!contactId && body.email) {
    const { data: byEmail } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email", body.email)
      .maybeSingle();
    contactId = byEmail?.id ?? null;
  }

  // Attribution order: explicit fields → UTM params → last recorded click.
  let automationId: string | null = null;
  let postId: string | null = body.post_id ?? null;
  let keyword: string | null = body.keyword ?? null;
  let sequenceStep = 1;

  if (body.url) {
    try {
      const url = new URL(body.url);
      automationId = await resolveAutomationId(
        db,
        workspaceId,
        url.searchParams.get("utm_campaign")
      );
      postId = postId ?? url.searchParams.get("utm_content");
      keyword = keyword ?? url.searchParams.get("utm_term");
    } catch {
      // Keep explicit fields if the URL is malformed.
    }
  }

  if ((!postId || !keyword || !automationId) && contactId) {
    const { data: lastClick } = await db
      .from("link_clicks")
      .select("automation_id, post_id, keyword, sequence_step")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contactId)
      .order("clicked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastClick) {
      automationId = automationId ?? (lastClick.automation_id as string | null);
      postId = postId ?? (lastClick.post_id as string | null);
      keyword = keyword ?? (lastClick.keyword as string | null);
      sequenceStep = Number(lastClick.sequence_step ?? 1);
    }
  }

  const revenueMinor =
    typeof body.revenue === "number" ? Math.round(body.revenue * 100) : 0;

  const { data: row, error } = await db
    .from("conversions")
    .upsert(
      {
        workspace_id: workspaceId,
        contact_id: contactId,
        automation_id: automationId,
        post_id: postId,
        keyword: keyword ? keyword.toUpperCase() : null,
        sequence_step: sequenceStep,
        type: body.event_type,
        revenue_minor: revenueMinor,
        currency: body.currency ?? "INR",
        external_event_id: body.external_event_id,
        source: "webhook",
        occurred_at: body.occurred_at ?? new Date().toISOString(),
        metadata: body.metadata ?? {},
      },
      { onConflict: "workspace_id,external_event_id", ignoreDuplicates: true }
    )
    .select("id, contact_id, post_id, keyword")
    .maybeSingle();

  if (error) {
    console.error("[conversions] Insert failed:", error);
    return NextResponse.json(
      { error: "Could not record conversion" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      success: true,
      duplicate: !row,
      attributed: Boolean(contactId || automationId || postId || keyword),
    },
    { headers: CORS_HEADERS }
  );
}
