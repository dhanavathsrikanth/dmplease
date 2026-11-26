import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";

/**
 * Sanitized Meta token diagnostics. Never returns token values — only booleans,
 * scopes, error codes and counts — so it is safe to call from logs/support.
 */
function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getCronSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function probe(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const json = (await response.json()) as Record<string, unknown>;
    const error = json.error as
      | { code?: number; message?: string; type?: string }
      | undefined;
    return {
      ok: response.ok && !error,
      status: response.status,
      error: error
        ? { code: error.code, message: error.message, type: error.type }
        : null,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: { message: error instanceof Error ? error.message : "fetch failed" },
      json: {} as Record<string, unknown>,
    };
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Admin DB unavailable" }, { status: 503 });
  }

  const { data: rows } = await getAdminDb()
    .from("instagram_accounts")
    .select("instagram_id, username, access_token, token_status")
    .limit(5);
  if (!rows?.length) {
    return NextResponse.json({ accounts: [] });
  }

  const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
  const appCheck = await probe(
    `https://graph.facebook.com/${process.env.META_APP_ID}?fields=id,name&access_token=${encodeURIComponent(appToken)}`
  );
  const results = [];

  for (const row of rows) {
    let token: string;
    try {
      token = decryptToken(String(row.access_token));
    } catch (error) {
      results.push({
        username: row.username,
        token_status: row.token_status,
        decryptError: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    const debug = await probe(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`
    );
    const debugData = (debug.json.data ?? {}) as Record<string, unknown>;
    const me = await probe(
      `https://graph.facebook.com/me?fields=id,name&access_token=${encodeURIComponent(token)}`
    );
    const pages = await probe(
      `https://graph.facebook.com/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`
    );
    const assignedPages = await probe(
      `https://graph.facebook.com/me/assigned_pages?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`
    );
    const conversations = await probe(
      `https://graph.instagram.com/${row.instagram_id}/conversations?limit=1&access_token=${encodeURIComponent(token)}`
    );
    const facebookConversations = await probe(
      `https://graph.facebook.com/${row.instagram_id}/conversations?limit=1&access_token=${encodeURIComponent(token)}`
    );
    const facebookMessagesProbe = await probe(
      `https://graph.facebook.com/${row.instagram_id}/messages?fields=id&access_token=${encodeURIComponent(token)}`
    );

    const pagesData: Array<{ access_token?: string }> = Array.isArray(pages.json.data)
      ? (pages.json.data as Array<{ access_token?: string }>)
      : [];
    const assignedData: Array<{ access_token?: string }> = Array.isArray(
      assignedPages.json.data
    )
      ? (assignedPages.json.data as Array<{ access_token?: string }>)
      : [];

    results.push({
      username: row.username,
      instagram_id: row.instagram_id,
      token_status: row.token_status,
      token_meta: {
        length: token.length,
        whitespace: (token.match(/\s/g) || []).length,
      },
      debug_token: {
        ok: debug.ok,
        error: debug.error,
        is_valid: debugData.is_valid,
        app_id: debugData.app_id,
        scopes: debugData.scopes,
        expires_at: debugData.expires_at,
        type: debugData.type,
      },
      me: { ok: me.ok, error: me.error, id: me.json.id ?? null },
      pages: {
        ok: pages.ok,
        error: pages.error,
        count: pagesData.length,
        withAccessToken: pagesData.filter((p) => Boolean(p?.access_token)).length,
      },
      assigned_pages: {
        ok: assignedPages.ok,
        error: assignedPages.error,
        count: assignedData.length,
        withAccessToken: assignedData.filter((p) => Boolean(p?.access_token)).length,
      },
      messaging_probe_graph_instagram: {
        ok: conversations.ok,
        error: conversations.error,
      },
      messaging_probe_graph_facebook: {
        ok: facebookConversations.ok,
        error: facebookConversations.error,
      },
      messages_probe_graph_facebook: {
        ok: facebookMessagesProbe.ok,
        error: facebookMessagesProbe.error,
      },
    });
  }

  return NextResponse.json({
    app_credentials: {
      configured_app_id: process.env.META_APP_ID ?? null,
      app_token_valid: appCheck.ok,
      app_token_error: appCheck.error,
      app_name: appCheck.json.name ?? null,
    },
    accounts: results,
  });
}
