"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface GettingStartedProps {
  connected: boolean;
  campaignCount: number;
  ruleCount: number;
  dmCount: number;
}

interface Step {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
  done: boolean;
}

const STORAGE_KEY = "dmplease:getting-started-dismissed";

export function GettingStarted({
  connected,
  campaignCount,
  ruleCount,
  dmCount,
}: GettingStartedProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      // Storage may be unavailable; the checklist simply stays visible.
    }
  }, []);

  const steps: Step[] = [
    {
      id: "connect",
      title: "Connect your Instagram account",
      description: "We use Meta's official API — no password sharing required.",
      href: "/dashboard/settings",
      action: "Connect account",
      done: connected,
    },
    {
      id: "campaign",
      title: "Create your first campaign",
      description: "Pick a keyword and write the DM followers will receive.",
      href: "/dashboard/campaigns/new",
      action: "Create campaign",
      done: campaignCount > 0,
    },
    {
      id: "rule",
      title: "Add an auto-reply rule",
      description: "Reply to DMs, story mentions and shares automatically.",
      href: "/dashboard/inbox-automations",
      action: "Add a rule",
      done: ruleCount > 0,
    },
    {
      id: "test",
      title: "Send a test DM",
      description: "Comment your keyword from another account to see it work.",
      href: "/dashboard/logs",
      action: "View delivery log",
      done: dmCount > 0,
    },
  ];

  const completed = steps.filter((step) => step.done).length;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Ignore storage failures.
    }
  }

  if (dismissed || completed === steps.length) return null;

  return (
    <Card className="rounded-3xl border border-[#ffd02f]/40 bg-[#fff8e0]/40 dark:bg-[#746019]/10 shadow-subtle p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#746019] dark:text-[#ffd02f]">
            <Sparkles className="size-3.5" aria-hidden="true" /> Get started
          </p>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
            You&apos;re {completed === 0 ? "just getting started" : "making progress"}
          </h2>
          <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
            {completed} of {steps.length} steps complete. Follow these in order — it takes about five minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide the getting started checklist"
          className="rounded-full p-1.5 text-[#6b6f7e] hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#ffd02f]/20"
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-[#fcb900] transition-all duration-500"
          style={{ width: `${(completed / steps.length) * 100}%` }}
        />
      </div>

      <ul className="mt-5 grid gap-2.5 sm:grid-cols-2" aria-label="Setup steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <div
              className={`flex h-full items-start gap-3 rounded-2xl border p-3.5 transition-colors ${
                step.done
                  ? "border-emerald-300/50 bg-emerald-50/50 dark:border-emerald-700/40 dark:bg-emerald-950/15"
                  : "border-[#e0e2e8] dark:border-border/80 bg-card"
              }`}
            >
              <div
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  step.done
                    ? "bg-[#00b473] text-white"
                    : "bg-[#1c1c1e] text-white dark:bg-[#ffd02f] dark:text-[#1c1c1e]"
                }`}
                aria-hidden="true"
              >
                {step.done ? <Check className="size-3.5 stroke-[3]" /> : index + 1}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold text-xs text-foreground">{step.title}</p>
                <p className="text-[11px] leading-relaxed text-[#555a6a] dark:text-muted-foreground">
                  {step.description}
                </p>
                {!step.done && (
                  <Button asChild variant="ghost" size="sm" className="mt-1 h-7 rounded-full px-2 text-[11px] font-semibold text-[#4262ff] dark:text-[#ffd02f]">
                    <Link href={step.href}>
                      {step.action} <ArrowRight className="size-3 ml-1" aria-hidden="true" />
                    </Link>
                  </Button>
                )}
                {step.done && (
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-[#00b473]">
                    <CircleCheck className="size-3" aria-hidden="true" /> Done
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
