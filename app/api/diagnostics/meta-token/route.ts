import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiSecret } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";
import { getRateLimiterFor } from "@/lib/upstash";

/**
 * Sanitized Meta token diagnostics. Never returns token values — only booleans,
 * scopes, error codes and counts — so it is safe to call from logs/support.
 *
 * This route fans out to the Meta Graph API, so it is gated on the dedicated
 * admin secret (never the shared cron secret) and rate limited per hour. Pass
 * `?accountId=<uuid>` to probe a single account instead of the default batch.
 */

/** Maximum accounts probed in one call when no accountId is supplied. */
const ACCOUNT_CAP = 3;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getAdminApiSecret()}`;
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
    return json({ error: "Unauthorized" }, 401);
  }

  // A leaked admin secret must not become an amplifier against the Meta app
  // quota. Two calls per hour is enough for support work.
  try {
    const limiter = getRateLimiterFor("diagnostics:meta-token", 2);
    const limit = await limiter.limit("meta-token");
    if (!limit.success) {
      return json(
        { error: "Rate limited", retryAfterMs: limit.reset - Date.now() },
        429
      );
    }
  } catch (error) {
    // Fail open: a limiter outage must not hide diagnostics. The failure is
    // logged so a missing Upstash configuration is still visible in the logs.
    console.warn(
      "[diagnostics/meta-token] rate limiter unavailable",
      error instanceof Error ? error.message : error
    );
  }

  if (!hasAdminDb()) {
    return json({ error: "Admin DB unavailable" }, 503);
  }

  const accountId = request.nextUrl.searchParams.get("accountId")?.trim() || null;
  if (accountId && !UUID_RE.test(accountId)) {
    return json({ error: "accountId must be a UUID" }, 400);
  }

  const db = getAdminDb();
  const columns = "instagram_id, username, access_token, token_status";
  let rows: Array<{
    instagram_id: string;
    username: string | null;
    access_token: string;
    token_status: string | null;
  }> | null = null;

  if (accountId) {
    // Targeted probe: exactly one row, scoped by primary key.
    const { data } = await db
      .from("instagram_accounts")
      .select(columns)
      .eq("id", accountId)
      .limit(1);
    rows = data;
  } else {
    const { data } = await db
      .from("instagram_accounts")
      .select(columns)
      .limit(ACCOUNT_CAP);
    rows = data;
  }

  if (!rows?.length) {
    return json({ accounts: [] });
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
    const profileProbe = await probe(
      `https://graph.facebook.com/${row.instagram_id}?fields=id,username,name,profile_picture_url,followers_count,is_verified&access_token=${encodeURIComponent(token)}`
    );
    const profileBasicProbe = await probe(
      `https://graph.facebook.com/${row.instagram_id}?fields=id,username,name,profile_picture_url,followers_count&access_token=${encodeURIComponent(token)}`
    );
    const pageProbe = await probe(
      `https://graph.facebook.com/me/accounts?fields=id,name,is_verified,instagram_business_account{id}&access_token=${encodeURIComponent(token)}`
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
      profile_basic_probe: {
        ok: profileBasicProbe.ok,
        error: profileBasicProbe.error,
        has_profile_picture: Boolean(profileBasicProbe.json.profile_picture_url),
        profile_picture_url: profileBasicProbe.json.profile_picture_url ?? null,
        followers_count: profileBasicProbe.json.followers_count ?? null,
      },
      page_verification_probe: {
        ok: pageProbe.ok,
        error: pageProbe.error,
        count: Array.isArray(pageProbe.json.data) ? pageProbe.json.data.length : 0,
      },
      profile_probe: {
        ok: profileProbe.ok,
        error: profileProbe.error,
        fields: Object.keys(profileProbe.json),
        is_verified: profileProbe.json.is_verified ?? null,
        has_profile_picture: Boolean(profileProbe.json.profile_picture_url),
        followers_count: profileProbe.json.followers_count ?? null,
      },
    });
  }

  const urlCheck = (value: string | undefined) => {
    try {
      const parsed = new URL(value || "http://localhost:3000");
      return { present: Boolean(value), valid: true, origin: parsed.origin };
    } catch {
      return {
        present: Boolean(value),
        valid: false,
        firstCodepoint: value ? String(value).charCodeAt(0) : null,
      };
    }
  };

  return json({
    env_urls: {
      NEXT_PUBLIC_SITE_URL: urlCheck(process.env.NEXT_PUBLIC_SITE_URL),
      APP_URL: urlCheck(process.env.APP_URL),
    },
    bom_check: Object.fromEntries(
      [
        "NEXT_PUBLIC_SITE_URL",
        "APP_URL",
        "META_APP_ID",
        "META_APP_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "QSTASH_TOKEN",
        "QSTASH_CURRENT_SIGNING_KEY",
        "QSTASH_NEXT_SIGNING_KEY",
        "CRON_SECRET",
        "TOKEN_VAULT_SECRET",
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
        "NEXT_PUBLIC_POSTHOG_HOST",
      ].map((key) => [key, process.env[key]?.charCodeAt(0) === 65279])
    ),
    app_credentials: {
      configured_app_id: process.env.META_APP_ID ?? null,
      app_token_valid: appCheck.ok,
      app_token_error: appCheck.error,
      app_name: appCheck.json.name ?? null,
    },
    accounts: results,
  });
}
