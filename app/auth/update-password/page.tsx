import { Suspense } from "react";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";

export const metadata = {
  title: "Update Password - dmplease",
  description: "Set a new password for your dmplease account.",
};

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <UpdatePasswordForm />
        </Suspense>
      </div>
      <AuthSidePanel />
    </div>
  );
}
