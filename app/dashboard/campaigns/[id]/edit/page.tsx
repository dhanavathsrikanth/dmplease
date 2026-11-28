import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { RerunButton } from "@/components/campaigns/rerun-button";
import { FollowupReport } from "@/components/campaigns/followup-report";
import { FollowupStepsEditor } from "@/components/campaigns/followup-steps-editor";
import { listLinkRotators } from "@/app/dashboard/campaigns/link-actions";
import { LinkPerformance } from "@/components/campaigns/link-performance";
import { CampaignAnalyticsCard } from "@/components/campaigns/campaign-analytics";
import { SharePerformance } from "@/components/campaigns/share-performance";
import { CommentPerformance } from "@/components/campaigns/comment-performance";
import { CampaignAnalyticsTabs } from "@/components/campaigns/campaign-analytics-tabs";
import { resolveAnalyticsRange } from "@/lib/analytics-range";
import { getWorkspacePreferences } from "@/lib/workspace-preferences";
import { listAnalyticsViews } from "@/app/dashboard/campaigns/analytics-view-actions";
import { loadCampaignAnalytics } from "@/lib/campaign-analytics";
import { FollowGateReport } from "@/components/campaigns/follow-gate-report";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Edit Campaign - dmplease",
};

function BuilderSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between pb-4 border-b">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-4">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
        <div className="lg:col-span-5 flex justify-center">
          <Skeleton className="w-[320px] h-[610px] rounded-[36px]" />
        </div>
      </div>
    </div>
  );
}

export default async function EditCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ range?: string; from?: string; to?: string; tab?: string }>;
}) {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <EditCampaignContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditCampaignContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ range?: string; from?: string; to?: string; tab?: string }>;
}) {
  const { id } = await params;
  const paramsValue = (await searchParams) ?? {};
  await connection();

  const profile = await getCurrentProfile();
  if (!profile) notFound();
  const ownedWorkspaceIds = (profile.ownedWorkspaces || []).map((w) => w.id);
  if (ownedWorkspaceIds.length === 0) notFound();

  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("automations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!campaign || !ownedWorkspaceIds.includes(String(campaign.workspace_id))) {
    notFound();
  }

  const preferences = await getWorkspacePreferences(String(campaign.workspace_id));
  const analyticsRange = resolveAnalyticsRange({
    range: paramsValue.range,
    from: paramsValue.from,
    to: paramsValue.to,
    timeZone: preferences.timezone,
  });
  const analyticsDays = analyticsRange.days;
  const activeTab = paramsValue.tab ?? "overview";

  let connectedHandle: string | undefined;
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("username")
    .eq("workspace_id", campaign.workspace_id)
    .limit(1);
  if (accounts?.[0]?.username) connectedHandle = accounts[0].username;

  const [stepsRes, eventsRes, conversionsRes, gateChecksRes, linkRotators, linkClicksRes, trackedLinksRes] =
    await Promise.all([
      supabase
        .from("followup_steps")
        .select("step, delay_minutes, message, enabled, holdout_percent")
        .eq("automation_id", id)
        .order("step"),
      supabase
        .from("followup_events")
        .select("step, action, contact_id")
        .eq("automation_id", id),
      supabase
        .from("conversions")
        .select("contact_id, revenue_minor")
        .eq("workspace_id", campaign.workspace_id),
      supabase
        .from("follow_checks")
        .select("status, reason")
        .eq("automation_id", id)
        .order("created_at", { ascending: false })
        .limit(500),
      listLinkRotators(),
      supabase
        .from("link_clicks")
        .select("token, contact_id, is_bot, clicked_at")
        .eq("automation_id", id)
        .order("clicked_at", { ascending: false })
        .limit(2000),
      supabase
        .from("tracked_links")
        .select("short_code, destination_url, label")
        .eq("automation_id", id)
        .limit(500),
    ]);

  const gateRows = gateChecksRes.data ?? [];
  const reasonCounts = new Map<string, number>();
  for (const row of gateRows) {
    if (row.status === "unavailable" && row.reason) {
      reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
    }
  }
  const followGateReport = {
    total: gateRows.length,
    follower: gateRows.filter((row) => row.status === "follower").length,
    notFollower: gateRows.filter((row) => row.status === "not_follower").length,
    unavailable: gateRows.filter((row) => row.status === "unavailable").length,
    skipped: gateRows.filter((row) => row.status === "skipped").length,
    topReasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
  };

  const conversionsByContact = new Map<string, number>();
  for (const row of conversionsRes.data ?? []) {
    if (!row.contact_id) continue;
    conversionsByContact.set(
      row.contact_id,
      (conversionsByContact.get(row.contact_id) ?? 0) + Number(row.revenue_minor ?? 0)
    );
  }

  const followupReport = {
    steps: (stepsRes.data ?? []).map((step) => {
      const events = (eventsRes.data ?? []).filter((e) => e.step === step.step);
      const sentContacts = events
        .filter((e) => e.action === "sent" && e.contact_id)
        .map((e) => String(e.contact_id));
      const holdoutContacts = events
        .filter((e) => e.action === "held_out" && e.contact_id)
        .map((e) => String(e.contact_id));
      const sumRevenue = (contacts: string[]) =>
        contacts.reduce((sum, c) => sum + (conversionsByContact.get(c) ?? 0), 0);
      return {
        step: Number(step.step),
        delayMinutes: Number(step.delay_minutes),
        enabled: Boolean(step.enabled),
        holdoutPercent: Number(step.holdout_percent),
        sent: events.filter((e) => e.action === "sent").length,
        heldOut: events.filter((e) => e.action === "held_out").length,
        converted: events.filter((e) => e.action === "converted").length,
        conversionsFromSent: sentContacts.filter((c) => conversionsByContact.has(c)).length,
        conversionsFromHoldout: holdoutContacts.filter((c) => conversionsByContact.has(c)).length,
        revenueFromSent: sumRevenue(sentContacts) / 100,
      };
    }),
  };

  const linkMeta = new Map(
    (trackedLinksRes.data ?? []).map((link) => [
      String(link.short_code),
      {
        destination: String(link.destination_url ?? ""),
        label: link.label ? String(link.label) : null,
      },
    ])
  );
  const clickGroups = new Map<string, { clicks: number; people: Set<string>; last: string | null }>();
  for (const click of linkClicksRes.data ?? []) {
    if (click.is_bot) continue;
    const code = String(click.token ?? "");
    if (!code) continue;
    const group = clickGroups.get(code) ?? { clicks: 0, people: new Set<string>(), last: null };
    group.clicks++;
    if (click.contact_id) group.people.add(String(click.contact_id));
    if (!group.last && click.clicked_at) group.last = String(click.clicked_at);
    clickGroups.set(code, group);
  }
  const linkPerformance = [...clickGroups.entries()]
    .map(([code, group]) => ({
      shortCode: code,
      destination: linkMeta.get(code)?.destination ?? "",
      label: linkMeta.get(code)?.label ?? null,
      clicks: group.clicks,
      uniqueClickers: group.people.size,
      lastClickedAt: group.last,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  const [campaignAnalytics, savedViews] = await Promise.all([
    loadCampaignAnalytics(
      String(campaign.workspace_id),
      String(campaign.id),
      analyticsDays,
      analyticsRange.kind === "custom"
        ? { from: analyticsRange.from, to: analyticsRange.to }
        : undefined,
      preferences.timezone
    ),
    listAnalyticsViews(String(campaign.workspace_id)),
  ]);

  return (
    <div className="space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
      <div>
        <h1 className="text-xl sm:text-2xl font-medium tracking-tight text-foreground">
          {String(campaign.name ?? "Campaign")}
        </h1>
        <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
          Edit this automation or apply it to recent comments.
        </p>
      </div>
      <RerunButton
        campaign={{
          id: String(campaign.id),
          name: String(campaign.name ?? "Campaign"),
          active: Boolean(campaign.active),
          postScope: campaign.post_scope as string | null,
        }}
      />
    </div>
    <CampaignBuilder
      mode="edit"
      initialHandle={connectedHandle}
      draftKey={`edit:${id}`}
      initialUpdatedAt={campaign.updated_at as string | null}
      initialCampaign={{
        id: String(campaign.id),
        name: String(campaign.name ?? "Instagram Auto-DM Campaign"),
        triggerType: campaign.trigger_type as string | null,
        postScope: campaign.post_scope as string | null,
        postId: campaign.post_id as string | null,
        postThumbnailUrl: campaign.post_thumbnail_url as string | null,
        postCaption: campaign.post_caption as string | null,
        triggerKeywords: (campaign.trigger_keywords as string[]) ?? [],
        dmMessage: String(campaign.dm_message ?? ""),
        dmVariants: (campaign.dm_variants as string[] | null) ?? [],
        messageFormat: campaign.message_format as string | null,
        messageAssets: campaign.message_assets as
          | {
              asset?: { url: string; mimeType?: string; filename?: string } | null;
              cards?: Array<{ title: string; subtitle?: string; imageUrl?: string }> | null;
              links?: Array<{ title: string; url: string }> | null;
              publicReplyLimit?: number | null;
              collectQuestion?: string | null;
              collectAllowSkip?: boolean | null;
              collectCustomProperty?: {
                key: string;
                question: string;
                type: "options" | "yes_no" | "text";
                options: string[];
              } | null;
            }
          | null,
        buttonText: campaign.button_text as string | null,
        buttonUrl: campaign.button_url as string | null,
        publicReplyEnabled: campaign.public_reply_enabled as boolean | null,
        publicReplyMessages: campaign.public_reply_messages as string[] | null,
        followGateEnabled: campaign.follow_gate_enabled as boolean | null,
        openingMessage: campaign.opening_message as string | null,
        followGateButtonLabel: campaign.follow_gate_button_label as string | null,
        followGateOnUnavailable: campaign.follow_gate_on_unavailable as string | null,
        collectField: campaign.collect_field as string | null,
        collectRetryMessage: campaign.collect_retry_message as string | null,
        collectSkipMessage: campaign.collect_skip_message as string | null,
        collectSuccessMessage: campaign.collect_success_message as string | null,
        collectSkipKeywords: campaign.collect_skip_keywords as string[] | null,
        collectMaxAttempts: campaign.collect_max_attempts as number | null,
        shortLinksEnabled: campaign.short_links_enabled as boolean | null,
        linkRotatorId: campaign.link_rotator_id as string | null,
        hourlyCap: campaign.hourly_cap as number | null,
        delayMinMs: campaign.delay_min_ms as number | null,
        delayMaxMs: campaign.delay_max_ms as number | null,
      }}
      linkRotators={linkRotators}
    />
    <CampaignAnalyticsTabs
      days={analyticsDays}
      from={analyticsRange.from}
      to={analyticsRange.to}
      rangeKind={analyticsRange.kind}
      activeTab={activeTab}
      savedViews={savedViews}
      workspaceId={String(campaign.workspace_id)}
      timeZone={preferences.timezone}
      overview={<CampaignAnalyticsCard data={campaignAnalytics} />}
      comments={
        <CommentPerformance
          data={campaignAnalytics.comment}
          comparison={campaignAnalytics.comparison}
          timeZone={preferences.timezone}
          weekStartsOn={preferences.weekStartsOn}
        />
      }
      shares={
        <SharePerformance
          data={campaignAnalytics.share}
          comparison={campaignAnalytics.comparison}
        />
      }
      links={
        <LinkPerformance
          rows={linkPerformance}
          timeZone={preferences.timezone}
        />
      }
      followups={
        <div className="space-y-4">
          <FollowupStepsEditor
            campaignId={String(id)}
            initialSteps={(stepsRes.data ?? []).map((step) => ({
              step: Number(step.step),
              delayMinutes: Number(step.delay_minutes),
              message: String(step.message ?? ""),
              enabled: Boolean(step.enabled),
              holdoutPercent: Number(step.holdout_percent),
            }))}
          />
          <FollowupReport data={followupReport} />
        </div>
      }
      followGate={
        <FollowGateReport
          data={{
            ...followGateReport,
            campaignId: String(campaign.id),
            workspaceId: String(campaign.workspace_id),
          }}
          enabled={Boolean(campaign.follow_gate_enabled)}
        />
      }
    />
    </div>
  );
}
