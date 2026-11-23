import { Suspense } from "react";
import { VerifyRequestView } from "@/components/auth/verify-request-view";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";

export const metadata = {
  title: "Check your email - dmplease",
  description: "A sign-in link was sent to your email.",
};

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <VerifyRequestView />
        </Suspense>
      </div>
      <AuthSidePanel />
    </div>
  );
}
