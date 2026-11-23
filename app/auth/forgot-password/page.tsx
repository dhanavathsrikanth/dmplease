import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";

export const metadata = {
  title: "Forgot Password - dmplease",
  description: "Reset your dmplease account password.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <ForgotPasswordForm />
        </Suspense>
      </div>
      <AuthSidePanel />
    </div>
  );
}
