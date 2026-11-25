import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

export const metadata = {
  title: "Support - dmplease",
  description: "How to get help with your dmplease automations.",
};

export default function SupportPage() {
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
          <div className="size-10 rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 flex items-center justify-center">
            <LifeBuoy className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Most issues are visible in the dashboard. Check these first — they answer the common questions
          without waiting for a reply.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {[
            {
              title: "1. Check System Health",
              body: "Diagnostics shows whether your database, Meta connection, webhook signature and token vault are configured. Follow the Fix hint under any item that needs attention.",
              href: "/dashboard/diagnostics",
              action: "Open Diagnostics",
            },
            {
              title: "2. Check the Activity Log",
              body: "See whether a delivery was sent or failed, which keyword matched and when it happened. Failed entries usually point to a permissions or token issue.",
              href: "/dashboard/logs",
              action: "View Activity Log",
            },
            {
              title: "3. Reconnect Instagram",
              body: "If messages stopped arriving, reconnect the account in Settings to refresh permissions and webhook subscriptions.",
              href: "/dashboard/settings",
              action: "Open Settings",
            },
            {
              title: "4. Report a bug",
              body: "If none of the above helps, open an issue on the public repository with the steps to reproduce and what you expected to happen.",
              href: "https://github.com/dhanavathsrikanth/dmplease/issues",
              action: "Open GitHub Issues",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-card p-5 space-y-2"
            >
              <h2 className="font-semibold text-sm">{item.title}</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
              <Link
                href={item.href}
                className="inline-block text-xs font-semibold text-foreground underline underline-offset-4"
              >
                {item.action}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          Looking for legal details? See our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>{" "}
          pages.
        </p>
      </div>
    </main>
  );
}
