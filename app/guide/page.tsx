import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Instagram,
  MessageSquare,
  MousePointer2,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "The Comment-to-DM Playbook | dmplease",
  description:
    "A short, practical guide to turning Instagram comments into real conversations with automated DMs.",
  openGraph: {
    title: "The Comment-to-DM Playbook",
    description:
      "Turn a comment into a conversation — and a conversation into a customer.",
    type: "article",
  },
};

const steps = [
  {
    icon: MessageSquare,
    title: "1. Pick one keyword",
    body: "Choose a single, obvious word for people to comment — LINK, GUIDE or START. Put it in your caption and pin a comment reminding followers to use it.",
  },
  {
    icon: Instagram,
    title: "2. Match the right post",
    body: "Decide whether the automation should watch one specific post or every post. Specific posts are best for launches; Any post works for an always-on funnel.",
  },
  {
    icon: Sparkles,
    title: "3. Keep the DM short",
    body: "Say what they get, in one or two sentences. Use {username} to personalise it. Long blocks of text are easy to ignore in an inbox.",
  },
  {
    icon: MousePointer2,
    title: "4. Add one button",
    body: "Give people one clear action — Get it, Download, or Watch. A single button converts better than a list of options.",
  },
  {
    icon: Check,
    title: "5. Measure and refine",
    body: "Check your dmplease analytics after 24 hours. If comments turn into DMs but not clicks, improve the message — not the keyword.",
  },
];

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <header className="border-b border-[#e0e2e8] dark:border-border/80">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-[#ffd02f] text-[#1c1c1e]">
              <MessageSquare className="size-4" />
            </span>
            dmplease
          </Link>
          <Link
            href="/auth/sign-up"
            className="text-sm font-medium text-[#555a6a] transition-colors hover:text-foreground dark:text-muted-foreground"
          >
            Get started →
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 pb-20 pt-14 sm:pt-20">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#a07d00] dark:text-[#ffd02f]">
          Free guide
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          The Comment-to-DM Playbook
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[#555a6a] dark:text-muted-foreground sm:text-lg">
          Turn a comment into a conversation — and a conversation into a
          customer. Five small changes that make automated DMs feel human.
        </p>

        <div className="mt-10 space-y-3">
          {steps.map((step) => (
            <section
              key={step.title}
              className="rounded-2xl border border-[#e0e2e8] bg-card p-5 dark:border-border/80"
            >
              <div className="flex gap-4">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff6d6] text-[#8a6c00] dark:bg-[#ffd02f]/10 dark:text-[#ffd02f]">
                  <step.icon className="size-4" />
                </span>
                <div>
                  <h2 className="font-medium">{step.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#555a6a] dark:text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-[#1c1c1e] p-6 text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]">
          <p className="text-sm font-semibold">Starter DM template</p>
          <p className="mt-3 rounded-xl bg-white/10 p-4 font-mono text-xs leading-relaxed dark:bg-black/10">
            {"Hey {username}! Thanks for your comment. Here's your free guide: {link}. Enjoy! 🙌"}
          </p>
          <Link
            href="/auth/sign-up"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#ffd02f] px-4 py-2.5 text-sm font-semibold text-[#1c1c1e] transition-opacity hover:opacity-90 dark:bg-[#1c1c1e] dark:text-white"
          >
            Set up your first automation
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}
