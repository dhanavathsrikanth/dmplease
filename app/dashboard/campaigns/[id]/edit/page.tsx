import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { FollowupReport } from "@/components/campaigns/followup-report";
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
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <EditCampaignContent params={params} />
    </Suspense>
  );
}

async function EditCampaignContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  let connectedHandle: string | undefined;
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("username")
    .eq("workspace_id", campaign.workspace_id)
    .limit(1);
  if (accounts?.[0]?.username) connectedHandle = accounts[0].username;

  const [stepsRes, eventsRes, conversionsRes, gateChecksRes] = await Promise.all([
    supabase
      .from("followup_steps")
      .select("step, delay_minutes, enabled, holdout_percent")
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

  return (
    <div className="space-y-6">
    <CampaignBuilder
      mode="edit"
      initialHandle={connectedHandle}
      initialCampaign={{
        id: String(campaign.id),
        name: String(campaign.name ?? "Instagram Auto-DM Campaign"),
        postScope: campaign.post_scope as string | null,
        postId: campaign.post_id as string | null,
        postThumbnailUrl: campaign.post_thumbnail_url as string | null,
        postCaption: campaign.post_caption as string | null,
        triggerKeywords: (campaign.trigger_keywords as string[]) ?? [],
        dmMessage: String(campaign.dm_message ?? ""),
        buttonText: campaign.button_text as string | null,
        buttonUrl: campaign.button_url as string | null,
        publicReplyEnabled: campaign.public_reply_enabled as boolean | null,
        publicReplyMessages: campaign.public_reply_messages as string[] | null,
        followGateEnabled: campaign.follow_gate_enabled as boolean | null,
        openingMessage: campaign.opening_message as string | null,
        followGateButtonLabel: campaign.follow_gate_button_label as string | null,
        followGateOnUnavailable: campaign.follow_gate_on_unavailable as string | null,
      }}
    />
    <FollowupReport data={followupReport} />
      <FollowGateReport
        data={followGateReport}
        enabled={Boolean(campaign.follow_gate_enabled)}
      />
    </div>
  );
}
