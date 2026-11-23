import { Suspense } from "react";
import { SignUpForm } from "@/components/sign-up-form";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";

export const metadata = {
  title: "Create an account - dmplease",
  description: "Sign up to start automating your Instagram comment-to-DM campaigns.",
};

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Left Form Area */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <SignUpForm />
        </Suspense>
      </div>

      {/* Right Testimonial Area */}
      <AuthSidePanel />
    </div>
  );
}
