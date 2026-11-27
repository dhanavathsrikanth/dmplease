import { NextRequest, NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/followups";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getAdminEmails } from "@/lib/alerts/capacity";
import { sendEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const db = getAdminDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await db
    .from("safety_events")
    .select("workspace_id, kind")
    .gte("created_at", since)
    .limit(20000);

  const { data: accounts } = await db
    .from("instagram_accounts")
    .select("workspace_id, username, token_status, consecutive_failures, safety_paused");

  const byWorkspace = new Map<
    string,
    { breaches: number; throttles: number; spikes: number; optOuts: number; exceptions: number }
  >();
  for (const event of events ?? []) {
    const workspaceId = String(event.workspace_id);
    const stats = byWorkspace.get(workspaceId) ?? {
      breaches: 0,
      throttles: 0,
      spikes: 0,
      optOuts: 0,
      exceptions: 0,
    };
    const kind = String(event.kind);
    if (kind === "rate_limit_breach") stats.breaches++;
    else if (kind === "viral_throttle") stats.throttles++;
    else if (kind === "viral_spike") stats.spikes++;
    else if (kind === "opt_out") stats.optOuts++;
    else if (kind === "follow_gate_exception") stats.exceptions++;
    byWorkspace.set(workspaceId, stats);
  }

  const lines: string[] = [];
  lines.push("Weekly safety digest — last 7 days");
  lines.push("");
  lines.push(`Workspaces with activity: ${byWorkspace.size}`);
  lines.push("");

  for (const [workspaceId, stats] of byWorkspace) {
    const accountsForWorkspace = (accounts ?? []).filter(
      (account) => String(account.workspace_id) === workspaceId
    );
    lines.push(`Workspace ${workspaceId.slice(0, 8)}`);
    lines.push(`  Rate-limit breaches: ${stats.breaches}`);
    lines.push(`  Viral throttles: ${stats.throttles}`);
    lines.push(`  Viral spikes: ${stats.spikes}`);
    lines.push(`  Opt-outs: ${stats.optOuts}`);
    lines.push(`  Gate exceptions: ${stats.exceptions}`);
    for (const account of accountsForWorkspace) {
      lines.push(
        `  Account @${account.username ?? "unknown"}: token=${account.token_status ?? "unknown"}, consecutive_failures=${account.consecutive_failures ?? 0}, paused=${account.safety_paused ?? false}`
      );
    }
    lines.push("");
  }

  if (byWorkspace.size === 0) {
    lines.push("No safety events recorded this week. All accounts are quiet.");
  }

  const body = lines.join("\n");
  const result = await sendEmail({
    to: getAdminEmails(),
    subject: "Weekly safety digest — dmplease",
    text: body,
  });

  return NextResponse.json({ success: result.status === "sent", ...result });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
