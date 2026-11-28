"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Play, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface SetupAccordionProps {
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
  badge?: string;
}

export function SetupAccordion({
  connected,
  campaignCount,
  ruleCount,
  dmCount,
}: SetupAccordionProps) {
  const steps = useMemo<Step[]>(
    () => [
      {
        id: "connect",
        title: "Connect your Instagram account",
        description:
          "We use Meta's official API — no password sharing required.",
        href: "/dashboard/settings",
        action: "Connect account",
        done: connected,
      },
      {
        id: "campaign",
        title: "Launch your first automation",
        description:
          "Pick a keyword and write the DM followers will receive automatically.",
        href: "/dashboard/campaigns/new",
        action: "Create Automation",
        done: campaignCount > 0,
      },
      {
        id: "rule",
        title: "Answer all your FAQs",
        description:
          "Take care of similar questions with instant replies — 24/7.",
        href: "/dashboard/inbox-automations",
        action: "Create AI FAQ",
        done: ruleCount > 0,
        badge: "AI",
      },
      {
        id: "test",
        title: "Send a test DM",
        description:
          "Comment your keyword from another account to see the flow work end to end.",
        href: "/dashboard/logs",
        action: "View delivery log",
        done: dmCount > 0,
      },
    ],
    [connected, campaignCount, ruleCount, dmCount]
  );

  const completed = steps.filter((step) => step.done).length;
  const firstIncomplete = steps.find((step) => !step.done)?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(firstIncomplete);

  const progress = Math.round((completed / steps.length) * 100);
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const dash = (progress / 100) * circumference;

  return (
    <section
      aria-labelledby="get-setup-heading"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div className="flex items-center gap-2.5 px-6 pt-4">
        <svg
          className="size-[26px] -rotate-90"
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          <g transform="translate(4, 0)">
            <circle
              cx="20"
              cy="20"
              r={radius}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="6"
            />
            <circle
              cx="20"
              cy="20"
              r={radius}
              fill="none"
              stroke="hsl(var(--brand))"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ filter: "drop-shadow(hsl(var(--brand) / 0.45) 0 0 6px)" }}
            />
          </g>
        </svg>
        <h2
          id="get-setup-heading"
          className="text-lg font-bold leading-[23px] text-foreground"
        >
          Get setup
        </h2>
        <span className="ml-auto text-xs font-semibold text-muted-foreground">
          {completed}/{steps.length}
        </span>
      </div>

      <div className="flex flex-col gap-3.5 px-6 pb-6 pt-7">
        {steps.map((step, index) => {
          const isOpen = openId === step.id;
          return (
            <div key={step.id}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : step.id)}
                aria-expanded={isOpen}
                aria-controls={`setup-panel-${step.id}`}
                className="flex min-h-5 w-full items-center gap-4 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-[3px] box-border",
                    step.done
                      ? "border-success bg-success text-white"
                      : "border-border-strong"
                  )}
                  aria-hidden="true"
                >
                  {step.done && <Check className="size-3 stroke-[3]" />}
                </span>
                <span className="flex min-w-0 items-center gap-3.5">
                  <span
                    className={cn(
                      "text-base font-semibold leading-5",
                      step.done
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                  {step.badge && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[7px] bg-brand px-1.5 py-0.5 text-[10px] font-extrabold tracking-widest text-brand-foreground">
                      <Sparkles className="size-2.5" aria-hidden="true" />
                      {step.badge}
                    </span>
                  )}
                </span>
              </button>

              <div
                id={`setup-panel-${step.id}`}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <div className="flex flex-col gap-3 pl-9 pt-1.5">
                    <p className="max-w-[320px] text-sm font-medium leading-[18px] text-muted-foreground">
                      {step.description}
                    </p>
                    {!step.done && (
                      <Link
                        href={step.href}
                        className="group relative inline-flex w-fit items-center gap-2 overflow-hidden rounded-[14px] border border-border-strong bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-[background-color,box-shadow,transform] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97]"
                      >
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(255,255,255,0.18),transparent_70%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                        />
                        <span className="relative">{step.action}</span>
                        <ArrowRight
                          className="relative size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </Link>
                    )}
                    {step.done && (
                      <p className="flex items-center gap-1 text-xs font-semibold text-success-soft-foreground dark:text-success-soft-foreground">
                        <Check className="size-3" aria-hidden="true" /> Completed
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {index < steps.length - 1 && (
                <div className="ml-9 mt-3 h-px bg-border" aria-hidden="true" />
              )}
            </div>
          );
        })}

        <Link
          href="/guide"
          className="mt-1 inline-flex w-fit items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Play className="size-3.5" aria-hidden="true" />
          Play Video
        </Link>
      </div>
    </section>
  );
}
