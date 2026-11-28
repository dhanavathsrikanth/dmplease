import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { parseTrackedLink } from "@/lib/tracking";
import { recordMetricEvent } from "@/lib/metrics";
import { getWorkspaceTimeZone } from "@/lib/workspace-preferences";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { safeRedirectTarget } from "@/lib/safe-url";
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
      // Full id so the conversion ingest can attribute to the exact campaign.
      url.searchParams.set("utm_campaign", link.automationId);
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
    // Stored destinations are user-supplied; never emit a non-http(s) Location.
    const destination = safeRedirectTarget(tracked.destination_url);
    if (!destination) {
      return NextResponse.redirect(new URL("/?link=invalid", request.url), 302);
    }
    const userAgent = request.headers.get("user-agent") ?? "";
    await recordMetricEvent({
      kind: "dm_link_click",
      creatorId: tracked.workspace_id,
      targetId: tracked.automation_id ?? tracked.workspace_id,
      timeZone: await getWorkspaceTimeZone(tracked.workspace_id),
    });
    await recordTrackedLinkClick({
      link: tracked,
      referrer: request.headers.get("referer") ?? null,
      userAgent,
      eventId: randomUUID(),
    });
    return NextResponse.redirect(
      withAttribution(destination, {
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

  // Defense in depth: the token parser already rejects non-http(s) URLs.
  const legacyDestination = safeRedirectTarget(payload.url);
  if (!legacyDestination) {
    return NextResponse.redirect(new URL("/?link=invalid", request.url), 302);
  }

  await recordMetricEvent({
    kind: "dm_link_click",
    creatorId: payload.workspaceId,
    targetId: payload.automationId ?? payload.workspaceId,
    timeZone: await getWorkspaceTimeZone(payload.workspaceId),
  });

  if (hasAdminDb()) {
    const userAgent = request.headers.get("user-agent") ?? "";
    let destinationHost: string | null = null;
    try {
      destinationHost = new URL(payload.url).hostname;
    } catch {
      destinationHost = null;
    }
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
        destination_host: destinationHost,
        clicked_at: new Date().toISOString(),
        is_bot: /bot|crawler|spider|facebookexternalhit|preview/i.test(userAgent),
        event_id: randomUUID(),
        user_agent: userAgent.slice(0, 500) || null,
      });
    } catch (error) {
      console.warn("[tracking] Could not record click:", error);
    }
  }

  return NextResponse.redirect(legacyDestination, 302);
}
