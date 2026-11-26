import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
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

  return (
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
      }}
    />
  );
}
