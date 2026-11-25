import { NextRequest, NextResponse } from "next/server";
import { parseTrackedLink } from "@/lib/tracking";
import { recordMetricEvent } from "@/lib/metrics";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

/** Tracked campaign link: verifies the signature, records the click, redirects. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const payload = parseTrackedLink(slug);

  if (!payload) {
    return NextResponse.redirect(new URL("/?link=invalid", request.url), 302);
  }

  await recordMetricEvent({
    kind: "dm_link_click",
    creatorId: payload.workspaceId,
    targetId: payload.automationId ?? payload.workspaceId,
  });

  if (hasAdminDb()) {
    try {
      await getAdminDb().from("link_clicks").insert({
        workspace_id: payload.workspaceId,
        automation_id: payload.automationId ?? null,
        contact_id: payload.contactId ?? null,
        token: slug,
        referrer: request.headers.get("referer") ?? null,
      });
    } catch (error) {
      // Click tracking must never block a follower from reaching the link.
      console.warn("[tracking] Could not record click:", error);
    }
  }

  return NextResponse.redirect(payload.url, 302);
}
