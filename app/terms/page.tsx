import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

export const metadata = {
  title: "Terms - dmplease",
  description: "Terms of use for the dmplease Instagram automation platform.",
};

export default function TermsPage() {
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
          <div className="size-10 rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 flex items-center justify-center">
            <FileText className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Terms of use</h1>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          A short summary of the rules for using dmplease. By connecting an account you agree to these terms.
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your account</h2>
            <p className="text-muted-foreground">
              You must own or be authorized to manage the Instagram account you connect. You are responsible
              for the keywords, messages and links you configure and for keeping them accurate and lawful.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Acceptable use</h2>
            <p className="text-muted-foreground">
              Do not use dmplease for spam, harassment, deceptive offers or anything that violates Meta&apos;s
              platform policies or applicable law. We may pause automation on accounts that put the platform
              or other users at risk.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Third-party services</h2>
            <p className="text-muted-foreground">
              Delivery depends on Meta&apos;s Graph API and its availability and rate limits. We cannot guarantee
              uninterrupted delivery. Your use of Instagram remains subject to Meta&apos;s own terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your content and data</h2>
            <p className="text-muted-foreground">
              You keep ownership of the messages and content you create. See our{" "}
              <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">
                Privacy page
              </Link>{" "}
              for how account and delivery data is handled.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Changes</h2>
            <p className="text-muted-foreground">
              We may update these terms as the product evolves. Material changes will be announced in the app.
            </p>
          </section>
        </div>

        <p className="mt-12 rounded-xl border border-amber-300/50 bg-amber-50/50 px-4 py-3 text-xs dark:bg-amber-950/20 dark:text-amber-200">
          This summary should be replaced with a counsel-reviewed terms document before a public launch.
        </p>
      </div>
    </main>
  );
}
