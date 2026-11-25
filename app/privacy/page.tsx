import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Privacy - dmplease",
  description: "How dmplease handles your account, Instagram data and delivery logs.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to home
        </Link>

        <div className="mt-8 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 flex items-center justify-center">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          This page explains what dmplease stores and why. It is a plain-language summary of our current
          data practices.
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What we store</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>Your name, email address and sign-in provider identity.</li>
              <li>The Instagram account ID, username and profile details you connect.</li>
              <li>Your Instagram access token, encrypted with AES-256-GCM before it reaches the database.</li>
              <li>Automation settings: keywords, DM templates, buttons and rules you create.</li>
              <li>Delivery logs: who triggered a keyword, what was sent, when and whether it succeeded.</li>
              <li>Contact details you choose to capture in a DM, such as an email or phone number.</li>
              <li>Insights snapshots (reach and impressions) and tracked link-click counts.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Why we use it</h2>
            <p className="text-muted-foreground">
              To send the automated messages you configure, show you delivery and conversion results, and
              keep your connection working. We do not sell your data.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Who processes it</h2>
            <p className="text-muted-foreground">
              Meta&apos;s official Graph API is used to read comments and send messages. Data is hosted on
              Supabase (PostgreSQL) and the app runs on Vercel. We never ask for your Instagram password.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your controls</h2>
            <p className="text-muted-foreground">
              Disconnecting an account in Settings unsubscribes its webhook and removes the stored token.
              Deleting a workspace removes its automations, logs and contacts. Use the{" "}
              <Link href="/support" className="font-medium text-foreground underline underline-offset-4">
                support page
              </Link>{" "}
              to request a full data export or deletion.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Browser storage</h2>
            <p className="text-muted-foreground">
              We use session cookies to keep you signed in, and local storage to remember your theme and
              whether you dismissed the getting-started checklist.
            </p>
          </section>
        </div>

        <p className="mt-12 rounded-xl border border-amber-300/50 bg-amber-50/50 px-4 py-3 text-xs dark:bg-amber-950/20 dark:text-amber-200">
          This summary should be replaced with a counsel-reviewed privacy policy before a public launch.
        </p>
      </div>
    </main>
  );
}
