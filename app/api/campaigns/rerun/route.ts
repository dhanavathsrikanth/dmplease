import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { WebhookCommentEvent } from "@/lib/meta/webhook";

export const maxDuration = 60;

const rerunSchema = z.object({
  campaignId: z.string().uuid("Invalid campaign."),
  days: z.coerce.number().int().min(1).max(90).default(7),
  dryRun: z.boolean().default(false),
});

interface AutomationRow {
  id: string;
  workspace_id: string;
  name: string;
  goal: string | null;
  post_scope: string | null;
  post_id: string | null;
  trigger_keywords: string[] | null;
  dm_message: string;
  button_text: string | null;
  button_url: string | null;
  follow_gate_enabled: boolean | null;
  dm_variants: string[] | null;
  collect_field: string | null;
  opening_message: string | null;
  hourly_cap: number | null;
  active: boolean | null;
}

interface AccountRow {
  id: string;
  instagram_id: string;
  username: string | null;
}

interface CommentEventRow {
  instagram_account_id: string | null;
  external_id: string;
  media_id: string | null;
  commenter_id: string;
  commenter_username: string | null;
  text: string | null;
}

interface AutomationForProcessor {
  id: string;
  workspaceId: string;
  name?: string;
  goal?: string | null;
  postScope?: string | null;
  postId?: string | null;
  triggerKeywords?: string[] | null;
  dmMessage?: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  followGateEnabled?: boolean | null;
  dmVariants?: string[] | null;
  collectField?: string | null;
  openingMessage?: string | null;
  hourlyCap?: number | null;
  active?: boolean;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase().trim()));
}

/**
 * POST /api/campaigns/rerun
 * Body: { campaignId: string; days?: number; dryRun?: boolean }
 *
 * Finds recent comment events that match the campaign keywords and have not
 * been contacted in the last 24 hours. Dry runs only count; real runs queue
 * the deliveries after the response is sent.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rerunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 }
    );
  }
  const { campaignId, days, dryRun } = parsed.data;

  const { data: automationRow, error: automationError } = await supabase
    .from("automations")
    .select(
      "id, workspace_id, name, goal, post_scope, post_id, trigger_keywords, dm_message, button_text, button_url, follow_gate_enabled, dm_variants, collect_field, opening_message, hourly_cap, active"
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (automationError) {
    console.error("[rerun] Automation lookup failed:", automationError.message);
    return NextResponse.json({ error: "Could not load the campaign." }, { status: 500 });
  }
  const automation = automationRow as AutomationRow | null;
  if (!automation) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", automation.workspace_id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!workspace) {
    return NextResponse.json(
      { error: "Campaign not found or access denied" },
      { status: 403 }
    );
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
  const keywords = automation.trigger_keywords || [];

  const { data: accountRows } = await supabase
    .from("instagram_accounts")
    .select("id, instagram_id, username")
    .eq("workspace_id", automation.workspace_id);

  const accounts = (accountRows || []) as AccountRow[];
  const graphIdByDbId = new Map<string, string>();
  for (const account of accounts) {
    graphIdByDbId.set(account.id, account.instagram_id);
  }

  const { data: eventRows, error: eventError } = await supabase
    .from("comment_events")
    .select("instagram_account_id, external_id, media_id, commenter_id, commenter_username, text")
    .eq("workspace_id", automation.workspace_id)
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(2000);

  if (eventError) {
    console.error("[rerun] Comment event lookup failed:", eventError.message);
    return NextResponse.json({ error: "Could not load recent comments." }, { status: 500 });
  }

  const events = (eventRows || []) as CommentEventRow[];
  const seenRecipients = new Set<string>();
  const eligible: CommentEventRow[] = [];

  for (const event of events) {
    if (!event.commenter_id || seenRecipients.has(event.commenter_id)) continue;
    if (!event.instagram_account_id || !graphIdByDbId.has(event.instagram_account_id)) continue;
    if (!matchesKeywords(event.text || "", keywords)) continue;
    seenRecipients.add(event.commenter_id);
    eligible.push(event);
  }

  const candidates = eligible.slice(0, 200);
  const recipientIds = candidates.map((event) => event.commenter_id);
  const alreadyContacted = new Set<string>();

  if (recipientIds.length > 0) {
    const { data: priorLogs } = await supabase
      .from("dm_logs")
      .select("recipient_id")
      .eq("automation_id", campaignId)
      .gte("sent_at", twentyFourHoursAgo)
      .in("recipient_id", recipientIds);

    for (const log of priorLogs || []) {
      if (log.recipient_id) alreadyContacted.add(log.recipient_id);
    }
  }

  const toSend = candidates.filter((event) => !alreadyContacted.has(event.commenter_id));
  const sample = toSend
    .slice(0, 5)
    .map((event) => event.commenter_username || event.commenter_id);

  if (dryRun) {
    return NextResponse.json({ count: toSend.length, sample });
  }

  const automationForProcessor: AutomationForProcessor = {
    id: automation.id,
    workspaceId: automation.workspace_id,
    name: automation.name,
    goal: automation.goal,
    postScope: automation.post_scope,
    postId: automation.post_id,
    triggerKeywords: automation.trigger_keywords || [],
    dmMessage: automation.dm_message,
    buttonText: automation.button_text,
    buttonUrl: automation.button_url,
    followGateEnabled: automation.follow_gate_enabled,
    dmVariants: automation.dm_variants || [],
    collectField: automation.collect_field,
    openingMessage: automation.opening_message,
    hourlyCap: automation.hourly_cap,
    active: Boolean(automation.active),
  };

  after(async () => {
    try {
      // Loaded lazily so the response is never blocked by processor startup.
      const processor = (await import("@/lib/meta/webhook-processor")) as unknown as {
        processCommentEventForAutomation?: (
          event: WebhookCommentEvent,
          auto: AutomationForProcessor
        ) => Promise<{ sent: boolean; skipped?: string }>;
      };

      if (!processor.processCommentEventForAutomation) {
        console.warn("[rerun] processCommentEventForAutomation is not available yet.");
        return;
      }

      for (const event of toSend) {
        const graphId = graphIdByDbId.get(event.instagram_account_id || "");
        if (!graphId) continue;

        const webhookEvent: WebhookCommentEvent = {
          instagramAccountId: graphId,
          commentId: event.external_id,
          commentText: event.text || "",
          commenterId: event.commenter_id,
          commenterName: event.commenter_username || undefined,
          mediaId: event.media_id || "",
        };

        try {
          await processor.processCommentEventForAutomation(webhookEvent, automationForProcessor);
        } catch (error) {
          console.error("[rerun] Failed to process a comment event:", error);
        }
      }
    } catch (error) {
      console.error("[rerun] Background processing failed:", error);
    }
  });

  return NextResponse.json({ success: true, queued: toSend.length });
}
