import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, getCurrentProfile } from "@/lib/profile";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = {
  title: "Welcome & Setup - dmplease",
  description: "Set up your brand and first Instagram automation.",
};

async function OnboardingContent() {
  await connection();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login?next=/onboarding");
  }

  const profile = await getCurrentProfile();

  // If already onboarded, redirect straight to the dashboard
  if (profile && (profile as unknown as { onboardingCompleted?: boolean }).onboardingCompleted) {
    redirect("/dashboard");
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
    />
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background animate-pulse" />}>
      <OnboardingContent />
    </Suspense>
  );
}
