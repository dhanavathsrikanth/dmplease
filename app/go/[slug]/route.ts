import { NextRequest, NextResponse } from "next/server";

import { parseTrackedLink } from "@/lib/tracking";
import { recordMetricEvent } from "@/lib/metrics";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  findTrackedLink,
  recordTrackedLinkClick,
} from "@/lib/meta/link-resolver";

function withAttribution(destination: string, link: {
  automationId?: string | null;
  postId?: string | null;
  keyword?: string | null;
}): string {
  try {
    const url = new URL(destination);
    url.searchParams.set("utm_source", "dmplease");
    url.searchParams.set("utm_medium", "instagram_dm");
    if (link.automationId) {
      url.searchParams.set("utm_campaign", link.automationId.slice(0, 8));
    }
    if (link.postId) url.searchParams.set("utm_content", link.postId);
    if (link.keyword) url.searchParams.set("utm_term", link.keyword);
    return url.toString();
  } catch {
    return destination;
  }
}

/** Short-link redirect: resolves the slug, records a click, then redirects. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const tracked = await findTrackedLink(slug);

  if (tracked) {
    const userAgent = request.headers.get("user-agent") ?? "";
    await recordMetricEvent({
      kind: "dm_link_click",
      creatorId: tracked.workspace_id,
      targetId: tracked.automation_id ?? tracked.workspace_id,
    });
    await recordTrackedLinkClick({
      link: tracked,
      referrer: request.headers.get("referer") ?? null,
      userAgent,
    });
    return NextResponse.redirect(
      withAttribution(tracked.destination_url, {
        automationId: tracked.automation_id,
        postId: tracked.post_id,
        keyword: tracked.keyword,
      }),
      302
    );
  }

  // Legacy signed tokens remain valid — old DMs keep working after deploy.
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
        post_id: payload.postId ?? null,
        keyword: payload.keyword ?? null,
        sequence_step: payload.sequenceStep ?? null,
        destination_host: new URL(payload.url).hostname,
        clicked_at: new Date().toISOString(),
        is_bot: /bot|crawler|spider|facebookexternalhit|preview/i.test(
          request.headers.get("user-agent") ?? ""
        ),
      });
    } catch (error) {
      console.warn("[tracking] Could not record click:", error);
    }
  }

  return NextResponse.redirect(payload.url, 302);
}
