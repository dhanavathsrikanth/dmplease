import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";

export const metadata = {
  title: "Sign in - dmplease",
  description: "Sign in to manage Instagram comment-to-DM automations.",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Left Form Area */}
      <main className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <LoginForm />
        </Suspense>
      </main>

      {/* Right Testimonial Area */}
      <AuthSidePanel />
    </div>
  );
}
