import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = {
  title: "Welcome & Setup - dmplease",
  description: "Set up your brand and first Instagram automation.",
};

async function OnboardingContent({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; error?: string; account?: string; step?: string }>;
}) {
  await connection();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login?next=/onboarding");
  }

  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // If already onboarded, redirect straight to the dashboard
  if (profile && (profile as unknown as { onboardingCompleted?: boolean }).onboardingCompleted) {
    redirect("/dashboard");
  }

  const params = searchParams ? await searchParams : {};

  // Check if an Instagram account is already connected in the database
  let connectedInstagram: { username: string; id?: string } | null = null;
  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  if (workspaceIds.length === 0) {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", user.id);
    if (ws && ws.length > 0) {
      ws.forEach((w) => workspaceIds.push(w.id));
    }
  }

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, username")
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      connectedInstagram = {
        id: accounts[0].id,
        username: accounts[0].username,
      };
    }
  }

  // If URL params indicate a successful connection
  if (!connectedInstagram && params?.status === "connected" && params?.account) {
    connectedInstagram = {
      username: params.account,
    };
  }

  return (
    <OnboardingWizard
      initialUser={{
        id: user.id,
        email: user.email,
        fullName:
          profile?.fullName ||
          (user.user_metadata?.full_name as string) ||
          (user.user_metadata?.name as string) ||
          "",
        avatarUrl: profile?.avatarUrl || (user.user_metadata?.avatar_url as string) || "",
      }}
      initialConnectedAccount={connectedInstagram}
      connectionStatus={params?.status}
      connectionError={params?.error}
      initialAccountParam={params?.account}
    />
  );
}

export default function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; error?: string; account?: string; step?: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background animate-pulse" />}>
      <OnboardingContent searchParams={searchParams} />
    </Suspense>
  );
}
