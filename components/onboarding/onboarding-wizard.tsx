"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Search,
  Instagram,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { submitOnboarding, OnboardingPayload } from "@/app/onboarding/actions";
import { ThemeSwitcher } from "@/components/theme-switcher";

interface OnboardingWizardProps {
  initialUser: {
    id: string;
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
  initialConnectedAccount?: {
    id?: string;
    username: string;
  } | null;
  connectionStatus?: string;
  connectionError?: string;
  initialAccountParam?: string;
}

const ROLES = [
  { id: "creator", title: "Creator / Influencer", icon: "📱" },
  { id: "founder", title: "Founder / Entrepreneur", icon: "🚀" },
  { id: "marketer", title: "Marketer", icon: "📣" },
  { id: "agency", title: "Agency or Freelancer", icon: "🧳" },
  { id: "ecommerce", title: "E-Commerce / DTC", icon: "🛍️" },
  { id: "coach", title: "Coach / Consultant", icon: "💡" },
  { id: "developer", title: "Developer", icon: "⌨️" },
  { id: "other", title: "Other", icon: "✨" },
];

const AUTOMATION_GOALS = [
  {
    id: "lead_magnet",
    title: "Lead Magnet / Freebie",
    subtitle: "Guide, checklist, or template",
    icon: "📖",
    trigger: "GUIDE",
    dm: "Hey! Here is your free training guide: https://trydmplease.com/guide. Enjoy! 🙌",
  },
  {
    id: "discount",
    title: "Discounts & Store Links",
    subtitle: "Coupons, flash sales & merch",
    icon: "🏷️",
    trigger: "VIP",
    dm: "Here's your 20% off code: VIP20. Shop here: https://trydmplease.com/shop 🛍️",
  },
  {
    id: "booking",
    title: "Bookings & Calls",
    subtitle: "Calendly link & consultations",
    icon: "📅",
    trigger: "CALL",
    dm: "Would love to chat! Pick a time on my calendar: https://calendly.com/your-call 📅",
  },
  {
    id: "custom",
    title: "Custom Keyword Reply",
    subtitle: "Secret keyword / power users",
    icon: "⚡",
    trigger: "START",
    dm: "Thanks for commenting! Here is your exclusive link: https://trydmplease.com/access 🚀",
  },
  {
    id: "launch",
    title: "Product Launch / Waitlist",
    subtitle: "Beta access & drops",
    icon: "🚀",
    trigger: "LAUNCH",
    dm: "You're on the early-access list! Join here: https://trydmplease.com/beta 🎉",
  },
  {
    id: "support",
    title: "FAQ & Instant Help",
    subtitle: "Quick answers to common questions",
    icon: "💬",
    trigger: "HELP",
    dm: "Hey! Here are the answers to our most common questions: https://trydmplease.com/faq 💡",
  },
] as const;

const ATTRIBUTION_OPTIONS = [
  "Google",
  "Instagram",
  "X / Twitter",
  "LinkedIn",
  "Friend or colleague",
  "Newsletter",
  "Product Hunt",
  "Other",
];

export function OnboardingWizard({
  initialUser,
  initialConnectedAccount,
  connectionStatus,
  connectionError,
  initialAccountParam,
}: OnboardingWizardProps) {
  const router = useRouter();

  // If user just connected their account via OAuth, start on Step 2 to show success!
  const hasConnectedAccount = Boolean(
    initialConnectedAccount ||
      connectionStatus === "connected" ||
      initialAccountParam
  );

  const [connectedAccount] = useState<{ username: string } | null>(
    initialConnectedAccount ||
      (initialAccountParam
        ? { username: initialAccountParam.replace(/^@/, "") }
        : null)
  );

  // Steps: 1 (Name & Role), 2 (Connect Instagram), 3 (Automation), 4 (Attribution), 5 (All Set celebration)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(
    connectionStatus === "connected" ? 2 : 1
  );

  // Profile data
  const rawNames = (initialUser.fullName || "").trim().split(" ");
  const [firstName, setFirstName] = useState(rawNames[0] || "");
  const [lastName, setLastName] = useState(rawNames.slice(1).join(" ") || "");
  const [instagramHandle, setInstagramHandle] = useState(
    connectedAccount?.username || ""
  );

  // Role
  const [selectedRole, setSelectedRole] = useState("creator");

  // Automation Goal
  const [selectedGoal, setSelectedGoal] = useState<
    "lead_magnet" | "discount" | "booking" | "custom" | "launch" | "support"
  >("lead_magnet");
  const [triggerKeyword, setTriggerKeyword] = useState("GUIDE");
  const [dmMessage, setDmMessage] = useState(
    "Hey! Here is your free training guide: https://trydmplease.com/guide. Enjoy! 🙌"
  );
  const [switchingFrom] = useState("none");

  // Attribution
  const [heardFrom, setHeardFrom] = useState("Google");

  // Loading & Error
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoalSelect = (
    goalId: "lead_magnet" | "discount" | "booking" | "custom" | "launch" | "support"
  ) => {
    setSelectedGoal(goalId);
    const preset = AUTOMATION_GOALS.find((g) => g.id === goalId);
    if (preset) {
      setTriggerKeyword(preset.trigger);
      setDmMessage(preset.dm);
    }
  };

  const handleFinish = async (chosenHeardFrom?: string) => {
    const finalHeard = chosenHeardFrom || heardFrom;
    setIsSubmitting(true);
    setErrorMsg(null);

    const fullComputedName =
      [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Creator";

    const finalHandle =
      connectedAccount?.username || instagramHandle.trim() || undefined;

    const payload: OnboardingPayload = {
      fullName: fullComputedName,
      instagramHandle: finalHandle,
      niche: selectedRole,
      primaryGoal: selectedGoal,
      triggerKeyword: triggerKeyword.trim() || "GUIDE",
      dmMessage: dmMessage.trim(),
      switchingFrom,
      heardFrom: finalHeard,
    };

    const res = await submitOnboarding(payload);

    if (res.success) {
      setIsSubmitting(false);
      setStep(5); // Show celebration "You're all set" screen
    } else {
      setIsSubmitting(false);
      setErrorMsg(res.error || "Failed to save settings. Please try again.");
    }
  };

  const effectiveHandle = connectedAccount?.username || instagramHandle || "yourbrand";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between bg-dot-grid relative">
      {/* ── Top Navigation Bar ── */}
      <nav className="w-full border-b border-neutral-200/80 dark:border-neutral-800 bg-background/90 backdrop-blur-md px-4 sm:px-8 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="size-8 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center font-bold text-sm tracking-tighter shadow-sm">
              dm
            </div>
            <span className="font-bold text-lg tracking-tight text-neutral-900 dark:text-white">
              dmplease
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-4 text-xs font-medium text-neutral-600 dark:text-neutral-400">
            <span className="cursor-pointer hover:text-neutral-900 dark:hover:text-white transition-colors">
              Automations
            </span>
            <span className="cursor-pointer hover:text-neutral-900 dark:hover:text-white transition-colors">
              Templates
            </span>
            <span className="cursor-pointer hover:text-neutral-900 dark:hover:text-white transition-colors">
              Integrations
            </span>
            <span className="cursor-pointer hover:text-neutral-900 dark:hover:text-white transition-colors">
              Analytics
            </span>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 text-xs text-neutral-500 w-64 justify-between">
          <span className="flex items-center gap-1.5">
            <Search className="size-3.5 text-neutral-400" />
            Search triggers, templates...
          </span>
          <kbd className="px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-[10px] font-mono">
            ⌘ K
          </kbd>
        </div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <Button
            asChild
            size="sm"
            className="rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 font-semibold text-xs px-4"
          >
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </nav>

      {/* ── Main Single-Card Viewport ── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        <div className="w-full max-w-[580px] min-h-[500px] bg-white dark:bg-neutral-900 rounded-[28px] border border-neutral-200/90 dark:border-neutral-800 p-7 sm:p-9 shadow-xl shadow-neutral-900/5 flex flex-col justify-between transition-all duration-300">
          
          {/* Top Card Bar: Pill Stepper & "Skip for now" */}
          {step <= 4 && (
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4].map((s) => (
                  <div
                    key={s}
                    className={`h-1.5 w-8 rounded-full transition-all duration-300 ${
                      s <= step
                        ? "bg-neutral-900 dark:bg-white"
                        : "bg-neutral-200 dark:bg-neutral-800"
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="text-xs sm:text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white underline underline-offset-4 transition-colors"
              >
                Skip to Dashboard
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 1: Welcome & Profile (Step 1 of 4)                   */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Welcome to dmplease
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Let&apos;s personalize your setup. Takes about 30 seconds.
                </p>

                <div className="mt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="firstName" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        First name
                      </Label>
                      <Input
                        id="firstName"
                        placeholder="Alex"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="rounded-xl border-neutral-200 dark:border-neutral-700 h-10 px-3.5 text-sm font-medium focus-visible:ring-neutral-900 dark:focus-visible:ring-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lastName" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Last name <span className="text-neutral-400 font-normal">optional</span>
                      </Label>
                      <Input
                        id="lastName"
                        placeholder="Rivera"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="rounded-xl border-neutral-200 dark:border-neutral-700 h-10 px-3.5 text-sm font-medium focus-visible:ring-neutral-900 dark:focus-visible:ring-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      What best describes you?
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {ROLES.slice(0, 4).map((r) => {
                        const isSelected = selectedRole === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setSelectedRole(r.id)}
                            className={`rounded-xl border p-2.5 flex items-center gap-2.5 transition-all text-left ${
                              isSelected
                                ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800"
                                : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 hover:bg-neutral-50/60"
                            }`}
                          >
                            <span className="text-sm shrink-0">{r.icon}</span>
                            <span className="font-semibold text-xs text-neutral-900 dark:text-neutral-100 truncate">
                              {r.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-xs text-neutral-400 dark:text-neutral-500 pt-1">
                    Signed in as {initialUser.email || "user@example.com"}
                  </p>
                </div>
              </div>

              {/* Bottom bar */}
              <div className="flex justify-end pt-6 border-t border-neutral-100 dark:border-neutral-800/80 mt-6">
                <Button
                  onClick={() => setStep(2)}
                  className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-7 h-10 text-sm shadow-sm"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 2: Connect your Instagram Account (Step 2 of 4)      */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Connect your Instagram
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Link your Instagram Business or Creator account to activate real-time comment listening and zero-latency DMs.
                </p>

                {connectionError && (
                  <div className="mt-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{connectionError}</span>
                  </div>
                )}

                {/* State A: Account Connected Successfully */}
                {connectedAccount ? (
                  <div className="mt-6 p-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="size-11 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-sm shrink-0">
                          <Instagram className="size-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm sm:text-base text-foreground">
                              @{connectedAccount.username}
                            </span>
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] font-semibold gap-1"
                            >
                              <CheckCircle2 className="size-3" /> Connected
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Meta Graph API v21.0 &bull; Webhooks Active
                          </p>
                        </div>
                      </div>

                      <a
                        href="/api/auth/meta/connect?next=/onboarding"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 shrink-0"
                      >
                        Switch
                      </a>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-emerald-500/20 text-xs text-neutral-600 dark:text-neutral-400">
                      <div className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600 shrink-0" />
                        <span>Comment Webhooks Ready</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600 shrink-0" />
                        <span>60-Day Vault Encryption</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* State B: Not Connected Yet */
                  <div className="mt-6 space-y-4">
                    <div className="p-5 rounded-2xl border border-neutral-200/90 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-850 space-y-4">
                      <div className="flex items-start gap-3.5">
                        <div className="size-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-xs mt-0.5">
                          <Instagram className="size-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            Meta Graph API Unified OAuth
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                            One-click authorization linking your Instagram Business or Creator account. Enables real-time webhook ingestion.
                          </p>
                        </div>
                      </div>

                      <Button
                        asChild
                        className="w-full h-11 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold text-sm shadow-sm gap-2"
                      >
                        <a href="/api/auth/meta/connect?next=/onboarding">
                          <Instagram className="size-4" />
                          Connect with Facebook / Meta
                        </a>
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 px-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                      <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
                      <span>Official Meta Graph API v21.0 &bull; AES-256 Vault &bull; Instant disconnect anytime</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between pt-6 border-t border-neutral-100 dark:border-neutral-800/80 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="rounded-xl border-neutral-200 dark:border-neutral-700 px-6 h-10 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Back
                </Button>

                <div className="flex items-center gap-3">
                  {!connectedAccount && (
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white underline underline-offset-4 transition-colors"
                    >
                      I&apos;ll connect later
                    </button>
                  )}
                  <Button
                    onClick={() => setStep(3)}
                    className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-7 h-10 text-sm shadow-sm"
                  >
                    {connectedAccount ? "Continue" : "Skip & Continue"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 3: Automation Goals & Trigger (Step 3 of 4)          */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Configure your first trigger
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Choose what followers comment on your posts, and what automated DM they receive.
                </p>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  {AUTOMATION_GOALS.map((g) => {
                    const isSelected = selectedGoal === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleGoalSelect(g.id)}
                        className={`rounded-2xl border p-2.5 sm:p-3 flex items-center justify-between transition-all text-left ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800 shadow-xs"
                            : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 hover:border-neutral-400 hover:bg-neutral-50/60"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div className="size-7 sm:size-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 text-sm sm:text-base">
                            {g.icon}
                          </div>
                          <span className="font-semibold text-xs sm:text-sm text-neutral-900 dark:text-neutral-100 truncate">
                            {g.title}
                          </span>
                        </div>
                        <div
                          className={`size-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ml-1.5 ${
                            isSelected
                              ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900"
                              : "border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                          }`}
                        >
                          {isSelected && <Check className="size-3 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      Trigger Keyword
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                      {triggerKeyword}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                    &ldquo;{dmMessage}&rdquo;
                  </p>
                </div>
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between pt-6 border-t border-neutral-100 dark:border-neutral-800/80 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="rounded-xl border-neutral-200 dark:border-neutral-700 px-6 h-10 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Back
                </Button>
                <Button
                  onClick={() => setStep(4)}
                  className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-7 h-10 text-sm shadow-sm"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 4: Attribution (Step 4 of 4)                         */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  How did you hear about us?
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Helps our team know what works.
                </p>

                {errorMsg && (
                  <div className="mt-3 p-2.5 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400">
                    {errorMsg}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5 mt-6">
                  {ATTRIBUTION_OPTIONS.map((opt) => {
                    const isSelected = heardFrom === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setHeardFrom(opt)}
                        className={`rounded-2xl border p-3.5 text-xs sm:text-sm font-semibold transition-all text-left flex items-center justify-between ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs"
                            : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 text-neutral-800 dark:text-neutral-200 hover:border-neutral-400 hover:bg-neutral-50/60"
                        }`}
                      >
                        <span>{opt}</span>
                        {isSelected && <Check className="size-3.5 stroke-[2.5]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between pt-6 border-t border-neutral-100 dark:border-neutral-800/80 mt-6">
                <Button
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setStep(3)}
                  className="rounded-xl border-neutral-200 dark:border-neutral-700 px-6 h-10 text-sm font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Back
                </Button>
                <Button
                  disabled={isSubmitting}
                  onClick={() => handleFinish()}
                  className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-7 h-10 text-sm shadow-sm"
                >
                  {isSubmitting ? "Launching..." : "Finish Setup"}
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 5: Celebration / All Set                             */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 5 && (
            <div className="flex-1 flex flex-col justify-between text-center animate-in fade-in duration-300">
              <div>
                <div className="size-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <Check className="size-7 stroke-[2.5]" />
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  You&apos;re all set, {firstName || "Creator"}.
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 max-w-md mx-auto leading-relaxed">
                  Your automation is armed! When followers comment on your posts, they will instantly receive your DM.
                </p>

                <div className="flex items-center justify-center gap-3 mt-6">
                  <Button
                    onClick={() => {
                      router.push("/dashboard");
                      router.refresh();
                    }}
                    className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-6 h-11 text-sm shadow-sm"
                  >
                    Go to Dashboard
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      router.push("/dashboard/campaigns");
                      router.refresh();
                    }}
                    className="rounded-xl border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 font-semibold px-6 h-11 text-sm"
                  >
                    View Campaigns
                  </Button>
                </div>

                {/* Status Card */}
                <div className="mt-8 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/80 p-4 text-left space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
                      <Sparkles className="size-3.5" />
                      <span>Live Trigger Active</span>
                    </div>
                    {connectedAccount && (
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        @{connectedAccount.username}
                      </span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Comment &ldquo;{triggerKeyword}&rdquo; on your Instagram posts &rarr; Instant DM.
                  </p>

                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={dmMessage}
                      className="rounded-xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-xs h-9 text-neutral-600 dark:text-neutral-400"
                    />
                    <Button
                      size="sm"
                      onClick={() => router.push("/dashboard")}
                      className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold text-xs px-4 h-9 shrink-0"
                    >
                      Check status
                    </Button>
                  </div>
                </div>
              </div>

              <div className="pt-2" />
            </div>
          )}

        </div>
      </main>

      {/* ── Minimal Fixed Footer ── */}
      <footer className="py-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
        dmplease &bull; Turn Instagram comments into automated DM conversations
      </footer>
    </div>
  );
}
