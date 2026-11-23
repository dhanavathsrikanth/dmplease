"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitOnboarding, OnboardingPayload } from "@/app/onboarding/actions";
import { ThemeSwitcher } from "@/components/theme-switcher";

interface OnboardingWizardProps {
  initialUser: {
    id: string;
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
}

const ROLES = [
  { id: "designer", title: "Product designer", icon: "✏️" },
  { id: "founder", title: "Founder", icon: "🚀" },
  { id: "pm", title: "Product manager", icon: "🧭" },
  { id: "developer", title: "Developer", icon: "⌨️" },
  { id: "marketer", title: "Marketer", icon: "📣" },
  { id: "agency", title: "Agency or freelancer", icon: "🧳" },
  { id: "student", title: "Student", icon: "🎓" },
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
  "X / Twitter",
  "LinkedIn",
  "Friend or colleague",
  "Newsletter",
  "Product Hunt",
  "AI assistant",
  "Other",
];

export function OnboardingWizard({ initialUser }: OnboardingWizardProps) {
  const router = useRouter();

  // Steps: 1 (Name), 2 (Role), 3 (Automation), 4 (Attribution), 5 (All Set celebration)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Profile data
  const rawNames = (initialUser.fullName || "").trim().split(" ");
  const [firstName, setFirstName] = useState(rawNames[0] || "");
  const [lastName, setLastName] = useState(rawNames.slice(1).join(" ") || "");
  const [instagramHandle, setInstagramHandle] = useState("");

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
  const [switchingFrom, setSwitchingFrom] = useState("none");

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

    const fullComputedName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Creator";

    const payload: OnboardingPayload = {
      fullName: fullComputedName,
      instagramHandle: instagramHandle.trim() || undefined,
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between bg-dot-grid relative">
      {/* ── Top Navigation Bar (SaaSFrame Reference Design) ── */}
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

        {/* Center Search Pill (Visual Reference) */}
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

      {/* ── Main Single-Card Viewport (Strictly Fits in Screen, Zero Overflow) ── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* UNIFIED CARD CONTAINER: Identical dimensions & rounded style across all steps */}
        <div className="w-full max-w-[580px] min-h-[480px] bg-white dark:bg-neutral-900 rounded-[28px] border border-neutral-200/90 dark:border-neutral-800 p-7 sm:p-9 shadow-xl shadow-neutral-900/5 flex flex-col justify-between transition-all duration-300">
          
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
                Skip for now
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 1: Welcome to dmplease (Exact Match to Image 5)     */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Welcome to dmplease
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Four quick questions to tailor your setup. Takes 20 seconds.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="firstName" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        First name
                      </Label>
                      <Input
                        id="firstName"
                        placeholder="Element"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="rounded-xl border-neutral-200 dark:border-neutral-700 h-11 px-3.5 text-sm font-medium focus-visible:ring-neutral-900 dark:focus-visible:ring-white"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lastName" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Last name <span className="text-neutral-400 font-normal">optional</span>
                      </Label>
                      <Input
                        id="lastName"
                        placeholder="of code"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="rounded-xl border-neutral-200 dark:border-neutral-700 h-11 px-3.5 text-sm font-medium focus-visible:ring-neutral-900 dark:focus-visible:ring-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="handle" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      Instagram handle <span className="text-neutral-400 font-normal">optional</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-semibold text-sm">
                        @
                      </span>
                      <Input
                        id="handle"
                        placeholder="yourbrand"
                        value={instagramHandle}
                        onChange={(e) => setInstagramHandle(e.target.value.replace(/^@/, ""))}
                        className="rounded-xl border-neutral-200 dark:border-neutral-700 h-11 pl-8 text-sm font-medium focus-visible:ring-neutral-900 dark:focus-visible:ring-white"
                      />
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
          {/* SCREEN 2: What best describes you? (Exact Match to Image 4) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  What best describes you?
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  We&apos;ll tailor your trigger words and DM templates for your work.
                </p>

                {/* 2-Column Options Grid (Image 4 exact style) */}
                <div className="grid grid-cols-2 gap-2.5 mt-6">
                  {ROLES.map((r) => {
                    const isSelected = selectedRole === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedRole(r.id)}
                        className={`rounded-2xl border p-3 flex items-center gap-3 transition-all text-left ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800 shadow-xs"
                            : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50/60"
                        }`}
                      >
                        <div className="size-8 rounded-xl bg-neutral-100 dark:bg-neutral-700/60 flex items-center justify-center shrink-0 text-base">
                          {r.icon}
                        </div>
                        <span className="font-semibold text-xs sm:text-sm text-neutral-900 dark:text-neutral-100 truncate">
                          {r.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
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
                <Button
                  onClick={() => setStep(3)}
                  className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-7 h-10 text-sm shadow-sm"
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 3: What are you looking for? (Exact Match Image 3)  */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  What are you looking for?
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  Pick as many as you like. We&apos;ll configure your triggers.
                </p>

                {/* 2-Column Options with Icons and Rounded Checkboxes (Image 3 exact style) */}
                <div className="grid grid-cols-2 gap-2.5 mt-5">
                  {AUTOMATION_GOALS.map((g) => {
                    const isSelected = selectedGoal === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleGoalSelect(g.id)}
                        className={`rounded-2xl border p-3 flex items-center justify-between transition-all text-left ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800 shadow-xs"
                            : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50/60"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <div className="size-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 text-base">
                            {g.icon}
                          </div>
                          <span className="font-semibold text-xs sm:text-sm text-neutral-900 dark:text-neutral-100 truncate">
                            {g.title}
                          </span>
                        </div>
                        <div
                          className={`size-4 sm:size-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ml-2 ${
                            isSelected
                              ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900"
                              : "border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800"
                          }`}
                        >
                          {isSelected && <Check className="size-3 sm:size-3.5 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
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
          {/* SCREEN 4: How did you hear about us? (Exact Match Image 2) */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  How did you hear about us?
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                  It helps a small team know what works.
                </p>

                {errorMsg && (
                  <div className="mt-3 p-2.5 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400">
                    {errorMsg}
                  </div>
                )}

                {/* 2-Column Options Grid (Image 2 exact style) */}
                <div className="grid grid-cols-2 gap-2.5 mt-6">
                  {ATTRIBUTION_OPTIONS.map((opt) => {
                    const isSelected = heardFrom === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => {
                          setHeardFrom(opt);
                        }}
                        className={`rounded-2xl border p-3.5 text-xs sm:text-sm font-semibold transition-all text-left flex items-center justify-between ${
                          isSelected
                            ? "border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs"
                            : "border-neutral-200/90 dark:border-neutral-700/80 bg-white dark:bg-neutral-850 text-neutral-800 dark:text-neutral-200 hover:border-neutral-400 dark:hover:border-neutral-500 hover:bg-neutral-50/60"
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
                  {isSubmitting ? "Launching..." : "Finish"}
                </Button>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/* SCREEN 5: You're all set (Exact Match to Image 1)          */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {step === 5 && (
            <div className="flex-1 flex flex-col justify-between text-center animate-in fade-in duration-300">
              <div>
                {/* Soft Green Check Badge (Image 1) */}
                <div className="size-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
                  <Check className="size-7 stroke-[2.5]" />
                </div>

                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
                  You&apos;re all set, {firstName || "Creator"}.
                </h1>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 max-w-md mx-auto leading-relaxed">
                  Start with your automation: when followers comment on your Instagram posts, they will instantly receive your DM.
                </p>

                {/* Two Action Buttons side by side (Image 1) */}
                <div className="flex items-center justify-center gap-3 mt-6">
                  <Button
                    onClick={() => {
                      router.push("/dashboard");
                      router.refresh();
                    }}
                    className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-semibold px-6 h-11 text-sm shadow-sm"
                  >
                    Start exploring
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      router.push("/dashboard");
                      router.refresh();
                    }}
                    className="rounded-xl border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 font-semibold px-6 h-11 text-sm"
                  >
                    See Pro plans
                  </Button>
                </div>

                {/* Bottom Nested Promo/Status Card (Image 1) */}
                <div className="mt-8 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/80 p-4 text-left space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
                    <div className="size-4 rounded-md bg-purple-100 dark:bg-purple-950/60 flex items-center justify-center text-[10px]">
                      ⚡
                    </div>
                    <span>From the engine of dmplease</span>
                  </div>

                  <p className="text-xs sm:text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Live trigger active: Comment &ldquo;{triggerKeyword}&rdquo; on your Instagram posts.
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

                  <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    Live analytics by dmplease: comment logs, delivery speed, and conversion rates.
                  </p>
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
