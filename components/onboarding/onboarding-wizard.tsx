"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  Check,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { submitOnboarding, OnboardingPayload } from "@/app/onboarding/actions";

// ── Meta (Infinity symbol) logo SVG ───────────────────────────────────────────
function MetaInfinityIcon({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M26.4 11.2C24.1 11.2 22.1 12.3 20.8 14C19 11.6 16.4 10.4 13.5 10.4C8.7 10.4 4.8 14.3 4.8 19.1C4.8 23.9 8.7 27.8 13.5 27.8C16.5 27.8 19.1 26.5 20.9 24.1C22.2 25.8 24.2 26.9 26.5 26.9C31 26.9 34.6 23.3 34.6 18.8C34.5 14.4 30.9 11.2 26.4 11.2ZM13.5 24.4C10.6 24.4 8.2 22 8.2 19.1C8.2 16.2 10.6 13.8 13.5 13.8C15.8 13.8 17.8 15.3 18.5 17.4C18.6 17.8 18.6 18.2 18.6 18.6C18.4 21.8 16.2 24.4 13.5 24.4ZM26.5 23.5C23.9 23.5 21.8 21.4 21.8 18.8C21.8 18.4 21.8 18 21.9 17.6C22.6 15.5 24.4 14.1 26.5 14.1C29.1 14.1 31.2 16.2 31.2 18.8C31.2 21.4 29.1 23.5 26.5 23.5Z"
        fill="#0866FF"
      />
    </svg>
  );
}

// ── Instagram gradient logo SVG ──────────────────────────────────────────────
function InstagramLogoIcon({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="ig-grad-onb" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#ffd600" />
          <stop offset="30%" stopColor="#ff7a00" />
          <stop offset="55%" stopColor="#ff0069" />
          <stop offset="80%" stopColor="#d300c5" />
          <stop offset="100%" stopColor="#7638fa" />
        </radialGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill="url(#ig-grad-onb)" />
      <rect x="9.5" y="9.5" width="17" height="17" rx="4.5" stroke="white" strokeWidth="2.2" fill="none"/>
      <circle cx="18" cy="18" r="4.2" stroke="white" strokeWidth="2.2" fill="none"/>
      <circle cx="23.6" cy="12.4" r="1.3" fill="white"/>
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────
interface OnboardingWizardProps {
  initialUser: {
    id: string;
    email?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
  };
  initialConnectedAccount?: { id?: string; username: string } | null;
  connectionStatus?: string;
  connectionError?: string;
  initialAccountParam?: string;
}

const AUTOMATION_GOALS = [
  {
    id: "lead_magnet",
    title: "Lead Magnet / Freebie",
    subtitle: "Guide, checklist or resource",
    icon: "📖",
    trigger: "GUIDE",
    dm: "Hey {username}! Here is your free guide: https://trydmplease.com/guide. Enjoy! 🙌",
  },
  {
    id: "discount",
    title: "Discounts & Store Links",
    subtitle: "Coupons, drops & merch",
    icon: "🏷️",
    trigger: "VIP",
    dm: "Here's your 20% off VIP code: VIP20. Shop here: https://trydmplease.com/shop 🛍️",
  },
  {
    id: "booking",
    title: "Bookings & Calls",
    subtitle: "Calendly link & appointments",
    icon: "📅",
    trigger: "CALL",
    dm: "Would love to chat with you {username}! Pick a time here: https://calendly.com/your-call 📅",
  },
  {
    id: "launch",
    title: "Product Launch / Waitlist",
    subtitle: "Early beta access & drops",
    icon: "🚀",
    trigger: "LAUNCH",
    dm: "You're on the early-access list {username}! Join here: https://trydmplease.com/beta 🎉",
  },
] as const;

const ATTRIBUTION_OPTIONS = [
  "Google",
  "Instagram",
  "X / Twitter",
  "Friend or colleague",
  "Newsletter",
  "Product Hunt",
  "YouTube",
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

  // Facebook appends `#_=_` to the redirect URL. Remove it so the URL stays clean.
  useEffect(() => {
    if (window.location.hash === "#_=_") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
  }, []);

  const [connectedAccount] = useState<{ username: string } | null>(
    initialConnectedAccount ||
      (initialAccountParam ? { username: initialAccountParam.replace(/^@/, "") } : null)
  );

  // Steps: 0=Channel Picker (Zorcha two-option UI), 1=Profile, 2=Automation Goal, 3=Attribution, 4=All Set
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(
    connectionStatus === "connected" ? 1 : 0
  );

  const rawNames = (initialUser.fullName || "").trim().split(" ");
  const [firstName, setFirstName] = useState(rawNames[0] || "");
  const [lastName, setLastName] = useState(rawNames.slice(1).join(" ") || "");

  const [selectedGoal, setSelectedGoal] = useState<
    "lead_magnet" | "discount" | "booking" | "launch"
  >("lead_magnet");
  const [triggerKeyword, setTriggerKeyword] = useState("GUIDE");
  const [dmMessage, setDmMessage] = useState(
    "Hey {username}! Here is your free training guide: https://trydmplease.com/guide. Enjoy! 🙌"
  );
  const [heardFrom, setHeardFrom] = useState("Instagram");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoalSelect = (goalId: typeof selectedGoal) => {
    setSelectedGoal(goalId);
    const preset = AUTOMATION_GOALS.find((g) => g.id === goalId);
    if (preset) {
      setTriggerKeyword(preset.trigger);
      setDmMessage(preset.dm);
    }
  };

  const handleFinish = async (chosen?: string) => {
    setIsSubmitting(true);
    setErrorMsg(null);
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Creator";
    const payload: OnboardingPayload = {
      fullName,
      instagramHandle: connectedAccount?.username,
      niche: "creator",
      primaryGoal: selectedGoal,
      triggerKeyword: triggerKeyword.trim() || "GUIDE",
      dmMessage: dmMessage.trim(),
      switchingFrom: "none",
      heardFrom: chosen || heardFrom,
    };
    const res = await submitOnboarding(payload);
    setIsSubmitting(false);
    if (res.success) {
      posthog.capture("onboarding_completed", {
        primary_goal: selectedGoal,
        attribution_source: chosen || heardFrom,
        instagram_connected: Boolean(connectedAccount),
      });
      setStep(4);
    } else setErrorMsg(res.error || "Failed to save. Please try again.");
  };

  const totalSteps = 3;
  const progressStep = step;

  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#f4f5f9] dark:bg-[#09090b] text-[#1c1c1e] dark:text-[#f4f4f5] antialiased selection:bg-purple-100 selection:text-purple-900 font-sans">
      
      {/* ── Top Center Logo Header (exact Zorcha style) ── */}
      <header className="w-full pt-8 pb-4 flex flex-col items-center justify-center">
        <Link href="/" className="inline-flex items-center gap-2.5 group">
          <div className="size-8 rounded-xl bg-gradient-to-tr from-[#6c47ff] to-[#4262ff] flex items-center justify-center text-white font-black text-sm shadow-md group-hover:scale-105 transition-transform">
            dm
          </div>
          <span className="font-rubik font-bold text-xl tracking-tight text-[#1a1a2e] dark:text-white">
            dmplease
          </span>
        </Link>
      </header>

      {/* ── Main Container (Expansive Glassmorphism Card) ── */}
      <main className="flex-1 flex items-center justify-center px-4 py-4 sm:py-6">
        <div
          className="w-full max-w-4xl rounded-[32px] overflow-hidden bg-white/85 dark:bg-zinc-900/80 backdrop-blur-2xl border border-white/90 dark:border-zinc-800 shadow-[0_20px_70px_rgba(108,71,255,0.08),0_1px_3px_rgba(0,0,0,0.05)] transition-all"
        >
          {/* Progress bar for steps 1-3 */}
          {step >= 1 && step <= 3 && (
            <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[#6c47ff] to-[#4262ff]"
                style={{ width: `${(progressStep / totalSteps) * 100}%` }}
              />
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 0: Channel Selector (Exact Zorcha Two-Option Parity)         */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 0 && (
            <div className="flex flex-col md:flex-row items-stretch min-h-[500px]">
              {/* Left Column: Form & Channels */}
              <div className="w-full md:w-[54%] p-8 sm:p-12 flex flex-col justify-between space-y-8">
                <div className="space-y-6">
                  {/* Headline following Figma scale: H2 40-48px */}
                  <div>
                    <h1 className="font-rubik text-3xl sm:text-[2.5rem] leading-[1.12] font-extrabold tracking-tight text-[#111827] dark:text-white">
                      Let&apos;s Kick{" "}
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6c47ff] to-[#8b5cf6]">
                        Things Off!
                      </span>
                    </h1>
                    <p className="mt-3 text-[15px] sm:text-[16px] text-[#6b7280] dark:text-zinc-400 font-normal leading-relaxed">
                      Connect an account and we&apos;ll set up your first campaign for you.
                      <br className="hidden sm:inline" /> Takes about a minute — you can change everything later.
                    </p>
                  </div>

                  {connectionError && (
                    <div className="p-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-xs font-medium flex items-center gap-2.5">
                      <AlertCircle className="size-4 shrink-0" />
                      <span>{connectionError}</span>
                    </div>
                  )}

                  {/* Connected state */}
                  {connectedAccount ? (
                    <div className="rounded-2xl p-5 bg-gradient-to-br from-[#6c47ff] to-[#4262ff] text-white shadow-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <InstagramLogoIcon className="size-9" />
                          <div>
                            <p className="font-bold text-sm">@{connectedAccount.username}</p>
                            <p className="text-violet-200 text-xs">Meta Graph API &bull; Webhooks Subscribed</p>
                          </div>
                        </div>
                        <CheckCircle2 className="size-6 text-emerald-300" />
                      </div>
                      <Button
                        onClick={() => setStep(1)}
                        className="w-full h-11 rounded-xl font-semibold text-sm bg-white text-[#6c47ff] hover:bg-violet-50 shadow-sm"
                      >
                        Continue Workspace Setup
                        <ArrowRight className="size-4 ml-2" />
                      </Button>
                    </div>
                  ) : (
                    /* The 2 Channel Buttons matching Zorcha layout */
                    <div className="space-y-3 pt-1">
                      {/* Option 1: Instagram Direct */}
                      <a
                        href="/api/auth/meta/connect?provider=instagram&next=/onboarding"
                        className="group flex items-center justify-between w-full px-5 py-4 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-white/90 dark:bg-zinc-800/60 hover:border-[#6c47ff]/60 hover:bg-[#faf9ff] dark:hover:bg-zinc-800 transition-all shadow-xs cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <InstagramLogoIcon className="size-8 shrink-0 group-hover:scale-105 transition-transform" />
                          <div className="text-left">
                            <p className="font-semibold text-sm text-[#111827] dark:text-zinc-100">
                              Instagram <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6c47ff]">Recommended</span>
                            </p>
                            <p className="text-[11px] text-[#6b7280] dark:text-zinc-400">
                              Comment-to-DM, stories &amp; reel automation
                            </p>
                          </div>
                        </div>
                        <span className="text-[#6c47ff] font-bold text-base group-hover:translate-x-0.5 transition-transform">
                          &rarr;
                        </span>
                      </a>

                      {/* Option 2: Facebook Messenger */}
                      <a
                        href="/api/auth/meta/connect?next=/onboarding"
                        className="group flex items-center justify-between w-full px-5 py-4 rounded-2xl border border-zinc-200/90 dark:border-zinc-800 bg-white/90 dark:bg-zinc-800/60 hover:border-[#0866FF]/60 hover:bg-[#f2f7ff] dark:hover:bg-zinc-800 transition-all shadow-xs cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <MetaInfinityIcon className="size-8 shrink-0 group-hover:scale-105 transition-transform" />
                          <div className="text-left">
                            <p className="font-semibold text-sm text-[#111827] dark:text-zinc-100">
                              Meta Business
                            </p>
                            <p className="text-[11px] text-[#6b7280] dark:text-zinc-400">
                              Multiple Instagram accounts &amp; business pages
                            </p>
                          </div>
                        </div>
                        <span className="text-[#0866FF] font-bold text-base group-hover:translate-x-0.5 transition-transform">
                          &rarr;
                        </span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Bottom Meta Certification Badge (Exact Zorcha format) */}
                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-bold">
                      <MetaInfinityIcon className="size-4" />
                      <span>Meta</span>
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                      Tech Provider
                    </span>
                  </div>
                  <p className="text-xs text-[#6b7280] dark:text-zinc-400 leading-relaxed">
                    dmplease operates on official Meta Graph API v21.0 with end-to-end OAuth token encryption.
                  </p>
                </div>
              </div>

              {/* Right Column: Visual Creator Portrait Panel (Zorcha visual parity) */}
              <div className="hidden md:flex md:w-[46%] relative overflow-hidden bg-gradient-to-tr from-[#fbcfe8] via-[#fed7aa] to-[#f472b6] p-8 flex-col justify-between rounded-r-[32px]">
                {/* Background decorative glow elements */}
                <div className="absolute top-10 right-10 size-48 rounded-full bg-amber-400/40 blur-3xl" />
                <div className="absolute bottom-10 left-10 size-48 rounded-full bg-violet-500/30 blur-3xl" />

                <div className="relative z-10 space-y-2">
                  <Badge className="bg-white/90 text-zinc-800 dark:bg-black/60 dark:text-white rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-md shadow-xs">
                    ⚡ Instant Engagement
                  </Badge>
                  <h3 className="font-rubik font-bold text-2xl text-zinc-900 leading-tight">
                    Turn comments into customers while you sleep.
                  </h3>
                </div>

                {/* Live simulation glass card floating in right panel */}
                <div className="relative z-10 rounded-2xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-white/70 p-4 shadow-xl space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-gradient-to-tr from-amber-500 to-pink-500 flex items-center justify-center text-white text-[10px] font-bold">
                        IG
                      </div>
                      <span className="font-semibold text-zinc-900 dark:text-white">@follower_user</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">Just now</span>
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300">
                    commented: <span className="font-bold text-zinc-900 dark:text-white font-mono bg-amber-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">&quot;GUIDE&quot;</span>
                  </p>
                  <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-zinc-800/60 border border-violet-100 dark:border-zinc-700 text-[11px] text-violet-900 dark:text-violet-200 flex items-center gap-1.5">
                    <Zap className="size-3 text-[#6c47ff] shrink-0" />
                    <span>Delivered automatically via the Meta Graph API</span>
                  </div>
                </div>

                <div className="relative z-10 flex items-center justify-between text-[11px] text-zinc-700 font-medium pt-2">
                  <span>You choose every keyword and message</span>
                  <span className="font-bold">Official Meta Graph API</span>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 1: Creator Profile Details                                   */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="p-8 sm:p-12 max-w-xl mx-auto space-y-6">
              <div>
                <p className="text-xs font-bold text-[#6c47ff] uppercase tracking-wider mb-1.5">
                  Step 1 of 3
                </p>
                <h2 className="font-rubik text-2xl sm:text-3xl font-extrabold tracking-tight text-[#111827] dark:text-white">
                  Tell us about <span className="text-[#6c47ff]">yourself</span>
                </h2>
                <p className="text-xs sm:text-sm text-[#6b7280] dark:text-zinc-400 mt-1">
                  We&apos;ll use this to set up your primary workspace.
                </p>
              </div>

              {connectedAccount && (
                <div className="rounded-2xl px-4 py-3 bg-[#6c47ff]/10 border border-[#6c47ff]/20 flex items-center justify-between text-xs font-medium">
                  <div className="flex items-center gap-2 text-zinc-900 dark:text-white">
                    <CheckCircle2 className="size-4 text-[#6c47ff]" />
                    <span>Connected Instagram: <strong>@{connectedAccount.username}</strong></span>
                  </div>
                  <Badge variant="tag-teal" className="text-[10px] py-0.5">Workspace Ready</Badge>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">First Name</Label>
                    <Input
                      placeholder="Alex"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="h-10 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border-zinc-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      Last Name <span className="text-zinc-400 font-normal">(optional)</span>
                    </Label>
                    <Input
                      placeholder="Rivera"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="h-10 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border-zinc-200"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Account Email</Label>
                  <Input
                    readOnly
                    value={initialUser.email || ""}
                    className="h-10 rounded-xl text-xs bg-zinc-100 dark:bg-zinc-800/80 font-mono text-zinc-600 dark:text-zinc-400 border-zinc-200"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(0)}
                  className="rounded-full text-xs text-zinc-500"
                >
                  &larr; Back
                </Button>
                <Button
                  size="sm"
                  disabled={!firstName.trim()}
                  onClick={() => setStep(2)}
                  className="rounded-full px-6 font-semibold text-xs h-10 bg-[#1c1c1e] text-white hover:bg-zinc-800 dark:bg-white dark:text-black shadow-xs"
                >
                  Continue &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 2: Main Automation Goal & Template                          */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="p-8 sm:p-12 max-w-xl mx-auto space-y-6">
              <div>
                <p className="text-xs font-bold text-[#6c47ff] uppercase tracking-wider mb-1.5">
                  Step 2 of 3
                </p>
                <h2 className="font-rubik text-2xl sm:text-3xl font-extrabold tracking-tight text-[#111827] dark:text-white">
                  What is your <span className="text-[#6c47ff]">main goal?</span>
                </h2>
                <p className="text-xs sm:text-sm text-[#6b7280] dark:text-zinc-400 mt-1">
                  Choose a recipe to activate your first automation right away.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {AUTOMATION_GOALS.map((goal) => {
                  const isSelected = selectedGoal === goal.id;
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => handleGoalSelect(goal.id)}
                      className={`p-3.5 rounded-2xl text-left border transition-all ${
                        isSelected
                          ? "border-[#6c47ff] bg-violet-50/70 dark:bg-violet-950/30 ring-1 ring-[#6c47ff]"
                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800/60 hover:bg-zinc-50"
                      }`}
                    >
                      <span className="text-xl">{goal.icon}</span>
                      <p className="font-semibold text-xs text-zinc-900 dark:text-white mt-1.5 leading-tight">
                        {goal.title}
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 leading-tight line-clamp-1">
                        {goal.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Selected message preview */}
              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    Keyword Trigger:
                  </span>
                  <span className="font-mono font-bold px-2 py-0.5 rounded-md bg-[#6c47ff] text-white text-[11px]">
                    {triggerKeyword}
                  </span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 italic">
                  &ldquo;{dmMessage}&rdquo;
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(1)}
                  className="rounded-full text-xs text-zinc-500"
                >
                  &larr; Back
                </Button>
                <Button
                  size="sm"
                  onClick={() => setStep(3)}
                  className="rounded-full px-6 font-semibold text-xs h-10 bg-[#1c1c1e] text-white hover:bg-zinc-800 dark:bg-white dark:text-black shadow-xs"
                >
                  Continue &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 3: Attribution                                              */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="p-8 sm:p-12 max-w-xl mx-auto space-y-6">
              <div>
                <p className="text-xs font-bold text-[#6c47ff] uppercase tracking-wider mb-1.5">
                  Step 3 of 3
                </p>
                <h2 className="font-rubik text-2xl sm:text-3xl font-extrabold tracking-tight text-[#111827] dark:text-white">
                  How did you <span className="text-[#6c47ff]">find us?</span>
                </h2>
                <p className="text-xs sm:text-sm text-[#6b7280] dark:text-zinc-400 mt-1">
                  Optional — it only helps us improve the setup flow. Skip if you&apos;d rather not answer.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {ATTRIBUTION_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setHeardFrom(opt)}
                    className={`p-3 rounded-xl text-left text-xs font-semibold border transition-all ${
                      heardFrom === opt
                        ? "border-[#6c47ff] bg-violet-50 text-[#6c47ff] dark:bg-violet-950/40"
                        : "border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep(2)}
                  disabled={isSubmitting}
                  className="rounded-full text-xs text-zinc-500"
                >
                  &larr; Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isSubmitting}
                    onClick={() => void handleFinish("Not shared")}
                    className="rounded-full text-xs text-zinc-500"
                  >
                    Skip for now
                  </Button>
                  <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => void handleFinish()}
                    className="rounded-full px-6 font-semibold text-xs h-10 bg-gradient-to-r from-[#6c47ff] to-[#4262ff] text-white shadow-md hover:opacity-95"
                  >
                    {isSubmitting ? "Setting up..." : "Finish setup"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 4: All Set Celebration Screen                               */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <div className="p-8 sm:p-14 max-w-lg mx-auto text-center space-y-6">
              <div className="size-16 rounded-2xl bg-gradient-to-tr from-[#6c47ff] to-[#4262ff] flex items-center justify-center mx-auto text-white shadow-lg">
                <Check className="size-8 stroke-[3]" />
              </div>

              <div>
                <h2 className="font-rubik text-3xl font-extrabold text-[#111827] dark:text-white">
                  You&apos;re All Set!
                </h2>
                <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-md mx-auto leading-relaxed">
                  Your first campaign is ready. When someone comments{" "}
                  <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[#6c47ff]/10 text-[#6c47ff]">{triggerKeyword}</span>{" "}
                  on your post, dmplease sends them a DM automatically. To test it, comment that word from another account.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  onClick={() => {
                    router.push("/dashboard");
                    router.refresh();
                  }}
                  className="rounded-full px-7 h-11 text-xs font-semibold bg-[#1c1c1e] text-white hover:bg-zinc-800 dark:bg-white dark:text-black shadow-xs"
                >
                  Go to Dashboard &rarr;
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-full px-5 h-11 text-xs font-semibold border-zinc-200"
                >
                  <Link href="/dashboard/campaigns">View Campaigns</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Zorcha Footer Parity (exact row of links below container) ── */}
      <footer className="w-full pb-8 pt-4 flex flex-col items-center justify-center text-[12px] text-zinc-500 space-y-2">
        <div className="flex items-center gap-4 flex-wrap justify-center font-medium">
          <span>&copy;2026 dmplease Inc.</span>
          <span>&bull;</span>
          <Link href="/terms" className="hover:text-zinc-800 dark:hover:text-zinc-300">
            Terms &amp; Conditions
          </Link>
          <span>&bull;</span>
          <Link href="/privacy" className="hover:text-zinc-800 dark:hover:text-zinc-300">
            Privacy Policy
          </Link>
          <span>&bull;</span>
          <Link href="/support" className="hover:text-zinc-800 dark:hover:text-zinc-300">
            Support
          </Link>
          <span>&bull;</span>
          <Link href="/auth/login" className="hover:text-zinc-800 dark:hover:text-zinc-300">
            Sign Out
          </Link>
        </div>
      </footer>
    </div>
  );
}
