import { Suspense } from "react";

import { UpdatePasswordForm } from "@/components/update-password-form";
import { AuthSidePanel } from "@/components/auth/auth-side-panel";
import { RecoveryLinkInvalid } from "@/components/auth/recovery-link-invalid";
import { createClient } from "@/lib/supabase/server";
import {
  readRecoveryGrant,
  recoveryGrantMatches,
} from "@/lib/auth/recovery-cookie";

export const metadata = {
  title: "Update Password - dmplease",
  description: "Set a new password for your dmplease account.",
  robots: { index: false, follow: false },
};

/**
 * Recovery landing page.
 *
 * This route is intentionally gated on a signed recovery grant issued by
 * /auth/confirm after a recovery email exchange. A normal authenticated
 * session is not enough: otherwise any session (including a stolen one) could
 * use this page to replace the password without knowing the current one.
 */
async function UpdatePasswordContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const grant = await readRecoveryGrant();
  const authorized = recoveryGrantMatches(grant, user?.id);

  return authorized ? (
    <UpdatePasswordForm email={user?.email ?? null} />
  ) : (
    <RecoveryLinkInvalid signedIn={Boolean(user)} />
  );
}

export default function UpdatePasswordPage() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <main className="flex-1 flex items-center justify-center px-6 py-12 lg:px-12">
        <Suspense fallback={<div className="w-full max-w-sm animate-pulse h-96" />}>
          <UpdatePasswordContent />
        </Suspense>
      </main>
      <AuthSidePanel />
    </div>
  );
}
