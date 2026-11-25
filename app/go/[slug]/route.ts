import { NextRequest, NextResponse } from "next/server";
import { parseTrackedLink } from "@/lib/tracking";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/config";

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

  if (hasDatabaseUrl()) {
    try {
      await prisma.$executeRaw`
        INSERT INTO link_clicks (workspace_id, automation_id, contact_id, token, referrer)
        VALUES (
          ${payload.workspaceId}::uuid,
          ${payload.automationId ?? null}::uuid,
          ${payload.contactId ?? null}::uuid,
          ${slug},
          ${request.headers.get("referer") ?? null}
        )
      `;
    } catch (error) {
      // Click tracking must never block a follower from reaching the link.
      console.warn("[tracking] Could not record click:", error);
    }
  }

  return NextResponse.redirect(payload.url, 302);
}
