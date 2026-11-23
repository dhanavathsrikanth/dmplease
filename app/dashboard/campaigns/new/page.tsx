import { Suspense } from "react";
import { connection } from "next/server";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "New Campaign - dmplease",
};

function BuilderSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between pb-4 border-b">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-6">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <div className="lg:col-span-5 flex justify-center">
          <Skeleton className="w-[320px] h-[610px] rounded-[44px]" />
        </div>
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<BuilderSkeleton />}>
      <NewCampaignContent />
    </Suspense>
  );
}

async function NewCampaignContent() {
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

  return <CampaignBuilder initialHandle={connectedHandle} />;
}
