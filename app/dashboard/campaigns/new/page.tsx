import { Suspense } from "react";
import { connection } from "next/server";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { Skeleton } from "@/components/ui/skeleton";
import { listLinkRotators } from "@/app/dashboard/campaigns/link-actions";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getCampaignTemplate } from "@/lib/campaign-templates";

export const metadata = {
  title: "New Campaign - dmplease",
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

export default function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <NewCampaignContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewCampaignContent({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let connectedHandle: string | undefined = undefined;
  if (workspaceIds.length > 0) {
    const { data } = await supabase
      .from("instagram_accounts")
      .select("username")
      .in("workspace_id", workspaceIds)
      .limit(1);
    if (data && data.length > 0 && data[0].username) {
      connectedHandle = data[0].username;
    }
  }

  const linkRotators = await listLinkRotators();
  const templateDefaults = getCampaignTemplate(template)?.defaults;

  return (
    <CampaignBuilder
      initialHandle={connectedHandle}
      linkRotators={linkRotators}
      draftKey={template ?? "blank"}
      initialCampaign={
        templateDefaults
          ? {
              id: "template",
              name: templateDefaults.name,
              triggerKeywords: templateDefaults.triggerKeywords,
              dmMessage: templateDefaults.dmMessage,
              buttonText: templateDefaults.buttonText,
              buttonUrl: templateDefaults.buttonUrl,
              followGateEnabled: templateDefaults.followGateEnabled,
              publicReplyEnabled: templateDefaults.publicReplyEnabled,
              collectField: templateDefaults.collectField,
            }
          : undefined
      }
    />
  );
}
