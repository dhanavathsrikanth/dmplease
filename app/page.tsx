import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Instagram,
  Layers,
  MessageSquare,
  ShieldCheck,
  Terminal,
  Zap,
  MousePointer2,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { safeNextPath } from "@/lib/safe-redirect";

async function OAuthCodeRedirect({
  searchParams,
}: {
  searchParams?: Promise<{ code?: string; next?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  if (resolvedParams?.code) {
    // Sanitize before forwarding so the callback route never receives an
    // off-site target, even though it validates again on arrival.
    const nextParam = resolvedParams.next
      ? `&next=${encodeURIComponent(
          safeNextPath(resolvedParams.next, "https://app.local")
        )}`
      : "";
    redirect(
      `/auth/callback?code=${encodeURIComponent(
        resolvedParams.code
      )}${nextParam}`
    );
  }
  return null;
}

export default async function Home(props: {
  searchParams?: Promise<{ code?: string; next?: string }>;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <Suspense fallback={null}>
        <OAuthCodeRedirect searchParams={props.searchParams} />
      </Suspense>

      {/* ── Miro-Inspired Top Navigation ── */}
      <header className="sticky top-0 z-50 w-full glass-panel border-b border-[#e0e2e8]/80 dark:border-border/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              {/* Miro Yellow Signature Mark */}
              <div className="size-8 rounded-lg bg-[#ffd02f] flex items-center justify-center font-bold text-sm text-[#1c1c1e] shadow-xs">
                dm
              </div>
              <span className="font-semibold text-lg tracking-tight text-foreground flex items-center">
                dmplease
                <span className="inline-block size-2 rounded-full bg-[#ffd02f] ml-1.5" />
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#555a6a] dark:text-muted-foreground">
              <a href="#features" className="hover:text-foreground transition-colors">
                Visual Workflows
              </a>
              <a href="#architecture" className="hover:text-foreground transition-colors">
                Dispatcher
              </a>
              <a href="#pricing" className="hover:text-foreground transition-colors">
                Pricing
              </a>
              <Link href="/dashboard" className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-xs font-medium text-[#555a6a] hover:text-foreground hidden sm:inline-flex rounded-full px-4"
            >
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="bg-[#1c1c1e] hover:bg-[#2c2c34] text-white font-medium text-xs px-5 h-9 rounded-full shadow-xs dark:bg-white dark:text-[#1c1c1e] dark:hover:bg-neutral-200"
            >
              <Link href="/onboarding">
                Start free
                <ArrowRight className="size-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Miro Hero Section (Whiteboard Canvas Feel) ── */}
      <section className="relative pt-16 sm:pt-24 pb-16 px-4 sm:px-6 max-w-7xl mx-auto w-full flex flex-col items-center text-center">
        {/* Subtle Canvas Dot Grid Background */}
        <div className="absolute inset-0 -z-10 bg-dot-grid opacity-70 pointer-events-none" />

        {/* Miro Signature Canary Yellow Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#ffd02f]/50 bg-[#fff8e0] text-xs font-semibold text-[#746019] mb-8 shadow-xs dark:bg-[#746019]/30 dark:text-[#ffd02f] dark:border-[#ffd02f]/30">
          <span className="size-2 rounded-full bg-[#fcb900] animate-pulse" />
          <span>Visual Instagram DM Automations</span>
          <span className="text-[#ffd02f]">•</span>
          <span className="font-mono text-[11px]">Official Meta Graph API</span>
        </div>

        {/* Display Typography */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-medium tracking-tight text-foreground max-w-4xl !leading-[1.08]">
          Turn Instagram comments into revenue with visual automated DMs.
        </h1>

        <p className="mt-6 text-base sm:text-lg text-[#555a6a] dark:text-muted-foreground max-w-2xl font-normal leading-relaxed">
          The collaborative comment-to-DM engine. Automatically deliver lead magnets, VIP discounts, and booking links the instant someone comments on your Reel or post.
        </p>

        {/* Dual Actions: Miro Black Pill + Outline Pill */}
        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3.5 w-full sm:w-auto">
          <Button
            asChild
            size="lg"
            className="w-full sm:w-auto bg-[#1c1c1e] hover:bg-[#2c2c34] text-white font-medium text-sm h-11 px-7 rounded-full shadow-card dark:bg-white dark:text-[#1c1c1e] dark:hover:bg-neutral-200"
          >
            <Link href="/onboarding">
              Start building free
              <ArrowRight className="size-4 ml-1.5" />
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="w-full sm:w-auto border-[#c7cad5] dark:border-border bg-background text-foreground hover:bg-[#f7f8fa] text-sm h-11 px-6 rounded-full"
          >
            <Link href="/dashboard">
              Live Dashboard Preview
            </Link>
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap justify-center items-center gap-5 text-xs text-[#6b6f7e] dark:text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5 text-[#00b473]" /> No credit card required
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5 text-[#00b473]" /> 100% Meta Graph compliant
          </span>
          <span>•</span>
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5 text-[#00b473]" /> Infinite visual scale
          </span>
        </div>

        {/* ── Miro Whiteboard Mockup (Sticky Notes, Cursors, Canvas Style) ── */}
        <div className="mt-14 w-full max-w-5xl rounded-3xl glass-card liquid-sheen shadow-mockup overflow-hidden text-left relative">
          {/* Simulated Miro Collaboration Cursor */}
          <div className="absolute top-20 right-28 hidden md:flex items-center gap-2 pointer-events-none z-20 animate-bounce duration-1000">
            <MousePointer2 className="size-4 text-[#4262ff] fill-[#4262ff]" />
            <span className="px-2 py-0.5 rounded-full bg-[#4262ff] text-white text-[11px] font-medium shadow-xs">
              Sarah (Creator)
            </span>
          </div>

          <div className="absolute bottom-16 right-16 hidden md:flex items-center gap-2 pointer-events-none z-20">
            <MousePointer2 className="size-4 text-[#0fbcb0] fill-[#0fbcb0]" />
            <span className="px-2 py-0.5 rounded-full bg-[#0fbcb0] text-white text-[11px] font-medium shadow-xs">
              Alex (Automation)
            </span>
          </div>

          {/* Mockup Window Chrome */}
          <div className="h-11 border-b border-[#e0e2e8] dark:border-border bg-[#f7f8fa] dark:bg-card px-5 flex items-center justify-between text-xs text-[#6b6f7e] dark:text-muted-foreground">
            <div className="flex items-center gap-2.5">
              <div className="size-3 rounded-full bg-[#ff9999]" />
              <div className="size-3 rounded-full bg-[#ffd02f]" />
              <div className="size-3 rounded-full bg-[#0fbcb0]" />
              <span className="ml-3 font-medium text-[12px] text-[#1c1c1e] dark:text-foreground hidden sm:inline flex items-center gap-1.5">
                <StickyNote className="size-3.5 text-[#ffd02f] fill-[#ffd02f]" />
                Instagram Growth Board • Automated Canvas
              </span>
            </div>
            <div className="flex items-center gap-2.5 font-medium text-[11px]">
              <span className="size-2 rounded-full bg-[#00b473]" />
              <span className="text-[#1c1c1e] dark:text-foreground font-semibold">WEBHOOK ACTIVE</span>
            </div>
          </div>

          {/* Mockup Interior Grid */}
          <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-background">
            {/* Left Column: Miro Sticky Note Rule Card */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="text-xs font-semibold text-[#6b6f7e] uppercase tracking-wider">
                Live Automation Recipe
              </div>

              {/* Pastel Yellow Sticky Card */}
              <div className="p-5 rounded-2xl border border-[#ffd02f]/50 bg-[#fff8e0] dark:bg-[#746019]/20 text-[#1c1c1e] dark:text-foreground space-y-4 shadow-subtle">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="size-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shadow-xs">
                      <Instagram className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-foreground">Reels Growth Masterclass</div>
                      <div className="text-[11px] text-[#555a6a] dark:text-muted-foreground">Any reel or carousel post</div>
                    </div>
                  </div>
                  <Badge variant="tag-teal" className="text-[10px] py-0.5 px-2.5">
                    Live Active
                  </Badge>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] text-[#555a6a] dark:text-muted-foreground font-medium">When comment matches:</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-[#1c1c1e] text-white font-medium">
                      GUIDE
                    </span>
                    <span className="text-xs text-[#555a6a] font-mono">or</span>
                    <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-[#1c1c1e] text-white font-medium">
                      TRAINING
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[#ffd02f]/40 dark:border-border">
                  <div className="text-[11px] text-[#555a6a] dark:text-muted-foreground font-medium">Instant automated DM:</div>
                  <div className="p-3 rounded-xl bg-white/90 dark:bg-card text-xs text-foreground font-normal leading-relaxed border border-[#ffd02f]/30 shadow-xs">
                    &quot;Hey! Here is your free Instagram Growth Checklist: https://trydmplease.com/guide. Enjoy! 🙌&quot;
                  </div>
                </div>
              </div>

              {/* Pastel Metrics Row — illustrative sample data */}
              <p className="text-[10px] font-medium text-[#6b6f7e] dark:text-muted-foreground mb-2">
                Sample dashboard data
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl border border-[#c3faf5] bg-[#c3faf5]/30 dark:bg-[#187574]/20">
                  <div className="text-[10px] text-[#187574] dark:text-[#c3faf5] uppercase font-bold">DMs Sent</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">3,842</div>
                  <div className="text-[10px] text-[#00b473] font-semibold mt-0.5 flex items-center">
                    +24% today
                  </div>
                </div>
                <div className="p-3.5 rounded-2xl border border-[#ffd8f4] bg-[#ffd8f4]/30 dark:bg-[#7d2663]/20">
                  <div className="text-[10px] text-[#7d2663] dark:text-[#ffd8f4] uppercase font-bold">Delivery</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">99.8%</div>
                  <div className="text-[10px] text-[#555a6a] dark:text-muted-foreground font-mono mt-0.5">240ms avg</div>
                </div>
                <div className="p-3.5 rounded-2xl border border-[#ffe6cd] bg-[#ffe6cd]/30 dark:bg-[#804000]/20">
                  <div className="text-[10px] text-[#600000] dark:text-[#ffe6cd] uppercase font-bold">CTR</div>
                  <div className="text-xl font-bold text-foreground mt-0.5">42.1%</div>
                  <div className="text-[10px] text-[#00b473] font-semibold mt-0.5">1,617 leads</div>
                </div>
              </div>
            </div>

            {/* Right Column: Live Event Stream Terminal */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-[#6b6f7e] uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="size-3.5" /> Real-Time Meta Dispatch Stream
                </div>
                <div className="text-[11px] font-mono text-[#6b6f7e]">
                  event_id: <span className="text-foreground">meta_wh_7491</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#1c1c1e] text-white font-mono text-xs space-y-2.5 border border-[#2c2c34] shadow-inner h-[280px] overflow-y-auto">
                <div className="flex items-start gap-2 text-[11px] text-neutral-400">
                  <span className="text-[#ffd02f] font-bold">12:04:18.420</span>
                  <span className="text-neutral-500">[WEBHOOK]</span>
                  <span>Received Instagram comment payload from @sarah_creator</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-neutral-300">
                  <span className="text-[#ffd02f] font-bold">12:04:18.482</span>
                  <span className="text-neutral-500">[PARSE]</span>
                  <span>Extracted keyword: <span className="text-[#ffd02f] font-semibold">&quot;GUIDE&quot;</span> on post #1798324</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-neutral-300">
                  <span className="text-[#ffd02f] font-bold">12:04:18.514</span>
                  <span className="text-neutral-500">[MATCH]</span>
                  <span>Matched rule &quot;Reels Growth Masterclass&quot;</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-[#00b473]">
                  <span className="text-[#ffd02f] font-bold">12:04:18.690</span>
                  <span className="text-neutral-500">[DISPATCH]</span>
                  <span>DM sent to user_id: 894120934 via Meta Graph API • 270ms</span>
                </div>
                <div className="my-2 border-t border-neutral-800" />
                <div className="flex items-start gap-2 text-[11px] text-neutral-400">
                  <span className="text-[#ffd02f] font-bold">12:04:22.102</span>
                  <span className="text-neutral-500">[WEBHOOK]</span>
                  <span>Received comment from @david_design: &quot;Please send the GUIDE thanks!&quot;</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-[#00b473]">
                  <span className="text-[#ffd02f] font-bold">12:04:22.380</span>
                  <span className="text-neutral-500">[DISPATCH]</span>
                  <span>DM delivered • HTTP 200 OK • Token refresh valid (58d remaining)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Miro Feature Cards (Pastel Tints) ── */}
      <section id="features" className="py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full border-t border-[#e0e2e8] dark:border-border">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge variant="tag-yellow" className="mb-3 text-[11px] py-1 px-3">
            Collaborative Automation
          </Badge>
          <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-foreground">
            A visual workspace for your audience growth.
          </h2>
          <p className="mt-4 text-sm sm:text-base text-[#555a6a] dark:text-muted-foreground">
            No brittle browser extensions or unofficial scrapers. dmplease connects straight to Meta&apos;s Webhooks API and handles automated DMs with precision.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Pastel Yellow Card */}
          <Card className="p-7 rounded-3xl border border-[#ffd02f]/40 bg-[#fff8e0]/60 dark:bg-[#746019]/20 space-y-4">
            <div className="size-10 rounded-2xl bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center font-bold shadow-xs">
              <Zap className="size-5" />
            </div>
            <h3 className="font-semibold text-lg text-foreground tracking-tight">
              Zero Latency Webhooks
            </h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              Responds to comments in under 300 milliseconds. Your audience receives your link while they are still looking at your screen.
            </p>
          </Card>

          {/* Pastel Teal Card */}
          <Card className="p-7 rounded-3xl border border-[#0fbcb0]/30 bg-[#c3faf5]/60 dark:bg-[#187574]/20 space-y-4">
            <div className="size-10 rounded-2xl bg-[#0fbcb0] text-white flex items-center justify-center font-bold shadow-xs">
              <Layers className="size-5" />
            </div>
            <h3 className="font-semibold text-lg text-foreground tracking-tight">
              Multi-Keyword Triggers
            </h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              Match exact words, phrases, or regex patterns across Reels, Carousels, and Feed Posts with automated fallback responses.
            </p>
          </Card>

          {/* Pastel Rose Card */}
          <Card className="p-7 rounded-3xl border border-[#ffd8f4]/50 bg-[#fde0f0]/60 dark:bg-[#7d2663]/20 space-y-4">
            <div className="size-10 rounded-2xl bg-[#ffd8f4] text-[#7d2663] flex items-center justify-center font-bold shadow-xs">
              <MessageSquare className="size-5" />
            </div>
            <h3 className="font-semibold text-lg text-foreground tracking-tight">
              Personalized Flows
            </h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              Dynamically include the user&apos;s name, unique discount vouchers, or Calendly booking links with one-click attribution tracking.
            </p>
          </Card>

          {/* Pastel Coral Card */}
          <Card className="p-7 rounded-3xl border border-[#ff9999]/40 bg-[#ffe6cd]/60 dark:bg-[#804000]/20 space-y-4">
            <div className="size-10 rounded-2xl bg-[#ff9999] text-[#600000] flex items-center justify-center font-bold shadow-xs">
              <ShieldCheck className="size-5" />
            </div>
            <h3 className="font-semibold text-lg text-foreground tracking-tight">
              Meta Safe & Compliant
            </h3>
            <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              100% compliant with Instagram Graph API policies. Includes automatic rate limiting and jitter to protect your account.
            </p>
          </Card>
        </div>
      </section>

      {/* ── Architecture & Developer Experience ── */}
      <section id="architecture" className="py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full border-t border-[#e0e2e8] dark:border-border">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-6">
            <Badge variant="tag-purple" className="px-3 py-1 text-xs">
              DEVELOPER ARCHITECTURE
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-foreground">
              Built on Supabase Postgres & Next.js Server Components.
            </h2>
            <p className="text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
              Every message, campaign, and webhook event is securely logged in Postgres with Row-Level Security (RLS). Inspect live logs, monitor token refresh cycles, and trigger actions via standard API endpoints.
            </p>

            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2.5 text-foreground font-medium">
                <CheckCircle2 className="size-4 text-[#00b473]" />
                Row-Level Security on all workspaces and DM logs
              </div>
              <div className="flex items-center gap-2.5 text-foreground font-medium">
                <CheckCircle2 className="size-4 text-[#00b473]" />
                Background token rotation via Next.js cron handlers
              </div>
              <div className="flex items-center gap-2.5 text-foreground font-medium">
                <CheckCircle2 className="size-4 text-[#00b473]" />
                Direct Meta Graph API webhook subscription verification
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            {/* Dark Mockup Container */}
            <div className="rounded-3xl border border-[#2c2c34] bg-[#1c1c1e] text-white overflow-hidden shadow-mockup">
              <div className="h-11 border-b border-[#2c2c34] bg-[#222226] px-5 flex items-center justify-between text-xs font-mono text-neutral-400">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#ffd02f]" />
                  <span>app/api/webhook/route.ts</span>
                </div>
                <span className="text-[11px] text-neutral-500">TypeScript</span>
              </div>
              <pre className="p-6 text-xs font-mono leading-relaxed overflow-x-auto text-neutral-300">
                <code>{`// Verify first, acknowledge instantly, dispatch in the background
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyWebhookSignature(body, req.headers)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  after(() => processWebhookPayload(JSON.parse(body)));
  return Response.json({ status: 'EVENT_RECEIVED' });
}`}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── Miro-Inspired 4-Tier Pricing Grid ── */}
      <section id="pricing" className="py-24 px-4 sm:px-6 max-w-7xl mx-auto w-full border-t border-[#e0e2e8] dark:border-border">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <Badge variant="tag-yellow" className="mb-3 text-[11px] py-1 px-3">
            Plans & Pricing
          </Badge>
          <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-foreground">
            Simple, transparent pricing for every creator.
          </h2>
          <p className="mt-4 text-sm sm:text-base text-[#555a6a] dark:text-muted-foreground">
            Start free, connect your Instagram account, and scale as your community grows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto items-stretch">
          {/* Tier 1: Free */}
          <Card className="p-7 rounded-2xl border border-[#e0e2e8] dark:border-border bg-card flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-foreground">Free</h3>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-1">For testing and experimenting</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">$0</span>
                <span className="text-xs text-[#555a6a]">/ month</span>
              </div>
              <ul className="space-y-3 text-xs text-[#555a6a] dark:text-muted-foreground pt-4 border-t border-[#e0e2e8] dark:border-border">
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> Up to 100 automated DMs/mo
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> 1 Connected Instagram
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> Keyword trigger matching
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-[#00b473]" /> 7-day log history
                </li>
              </ul>
            </div>
            <Button
              asChild
              variant="outline"
              className="mt-8 w-full border-[#c7cad5] rounded-full text-xs font-medium h-10"
            >
              <Link href="/onboarding">Get started</Link>
            </Button>
          </Card>

          {/* Tier 2: Starter */}
          <Card className="p-7 rounded-2xl border border-[#e0e2e8] dark:border-border bg-card flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-foreground">Starter</h3>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-1">For creators & small shops</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">$15</span>
                <span className="text-xs text-[#555a6a]">/ month</span>
              </div>
              <ul className="space-y-3 text-xs text-[#555a6a] dark:text-muted-foreground pt-4 border-t border-[#e0e2e8] dark:border-border">
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> Up to 1,500 DMs/mo
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> 2 Instagram accounts
                </li>
                <li className="flex items-center gap-2 text-foreground">
                  <Check className="size-4 text-[#00b473]" /> Story reply triggers
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-[#00b473]" /> 30-day log history
                </li>
              </ul>
            </div>
            <Button
              asChild
              variant="outline"
              className="mt-8 w-full border-[#c7cad5] rounded-full text-xs font-medium h-10"
            >
              <Link href="/onboarding">Choose Starter</Link>
            </Button>
          </Card>

          {/* Tier 3: Business (Miro Featured Tier - Lavender #f5f3ff with Blue 2px border) */}
          <div className="p-7 rounded-2xl border-2 border-[#4262ff] bg-[#f5f3ff] dark:bg-[#4262ff]/10 text-foreground flex flex-col justify-between shadow-card relative scale-[1.02]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg text-foreground">Business</h3>
                  <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-1">For fast-growing brands</p>
                </div>
                <Badge className="bg-[#ffd02f] text-[#1c1c1e] font-bold text-[10px] rounded-full px-2.5 py-0.5 shadow-xs">
                  POPULAR
                </Badge>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">$39</span>
                <span className="text-xs text-[#555a6a]">/ month</span>
              </div>
              <ul className="space-y-3 text-xs text-[#1c1c1e] dark:text-neutral-200 pt-4 border-t border-[#4262ff]/20">
                <li className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-[#4262ff]" /> Unlimited Automated DMs
                </li>
                <li className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-[#4262ff]" /> Multiple Instagram accounts
                </li>
                <li className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-[#4262ff]" /> Custom link conversion tracking
                </li>
                <li className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-[#4262ff]" /> Welcome DM automations
                </li>
                <li className="flex items-center gap-2 font-medium">
                  <Check className="size-4 text-[#4262ff]" /> 90-day execution log explorer
                </li>
              </ul>
            </div>
            <Button
              asChild
              className="mt-8 w-full bg-[#1c1c1e] hover:bg-[#2c2c34] text-white font-medium rounded-full text-xs h-10 shadow-xs dark:bg-[#4262ff] dark:text-white dark:hover:bg-[#2a41b6]"
            >
              <Link href="/onboarding">Upgrade to Business</Link>
            </Button>
          </div>

          {/* Tier 4: Enterprise (Miro Dark Card #1c1c1e) */}
          <div className="p-7 rounded-2xl bg-[#1c1c1e] text-white flex flex-col justify-between shadow-card">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-white">Enterprise</h3>
                <p className="text-xs text-neutral-400 mt-1">For agencies & top brands</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">$129</span>
                <span className="text-xs text-neutral-400">/ month</span>
              </div>
              <ul className="space-y-3 text-xs text-neutral-300 pt-4 border-t border-neutral-800">
                <li className="flex items-center gap-2 text-white">
                  <Check className="size-4 text-[#ffd02f]" /> Everything in Business
                </li>
                <li className="flex items-center gap-2 text-white">
                  <Check className="size-4 text-[#ffd02f]" /> Up to 25 Workspaces
                </li>
                <li className="flex items-center gap-2 text-white">
                  <Check className="size-4 text-[#ffd02f]" /> Dedicated webhook cluster
                </li>
                <li className="flex items-center gap-2 text-white">
                  <Check className="size-4 text-[#ffd02f]" /> Priority 24/7 support
                </li>
              </ul>
            </div>
            <Button
              asChild
              className="mt-8 w-full bg-white text-[#1c1c1e] hover:bg-neutral-200 rounded-full text-xs font-semibold h-10 shadow-xs"
            >
              <Link href="/onboarding">Contact sales</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Frequently Asked Questions (Accordion + Liquid Glass) ── */}
      <section className="py-20 px-4 sm:px-6 max-w-4xl mx-auto w-full">
        <div className="text-center space-y-3 mb-10">
          <Badge className="bg-[#fff8e0] text-[#746019] border border-[#ffd02f]/40 dark:bg-[#746019]/30 dark:text-[#ffd02f] rounded-full px-3 py-1 text-xs font-semibold">
            Got Questions?
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-sm text-[#555a6a] dark:text-muted-foreground max-w-lg mx-auto">
            Everything you need to know about Instagram DM automations, Meta compliance, and how deliveries are dispatched.
          </p>
        </div>

        <div className="glass-card rounded-3xl p-6 sm:p-8 shadow-card">
          <Accordion type="single" collapsible className="w-full space-y-2">
            <AccordionItem value="item-1">
              <AccordionTrigger className="text-sm sm:text-base font-semibold">
                How does dmplease connect with my Instagram account?
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                We use the official Meta Graph API and OAuth 2.0. You simply connect your Instagram Professional or Business account with one click. We never ask for your password or execute unauthorized actions.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger className="text-sm sm:text-base font-semibold">
                Will automated DMs trigger Instagram spam protection?
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                No. Because our dispatcher sends direct messages strictly in response to an explicit user comment via official Meta Webhooks and Send API, it is 100% compliant with Meta Platform Terms and Rate Limits.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger className="text-sm sm:text-base font-semibold">
                How fast are direct messages delivered to commenters?
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                Our edge dispatcher processes incoming Meta webhooks and sends the DM payload in an average of under 280 milliseconds. Your commenters receive the DM virtually instantaneously while they are still looking at your Reel.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger className="text-sm sm:text-base font-semibold">
                Can I target specific Reels or apply automations to all posts?
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                Both! You can set the target scope to &quot;Any Post/Reel&quot; so any follower typing your keyword gets your link, or target an exact Reel thumbnail selected from your active feed, or even configure &quot;Next Post&quot; before publishing.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5">
              <AccordionTrigger className="text-sm sm:text-base font-semibold">
                Can I customize the DM with the commenter&apos;s username and buttons?
              </AccordionTrigger>
              <AccordionContent className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                Yes! You can use dynamic variables like &#123;username&#125; and interactive call-to-action buttons with tracked destination URLs that open seamlessly inside Instagram.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* ── Miro Iconic Dark Footer (#1c1c1e) ── */}
      <footer className="w-full bg-[#1c1c1e] text-white mt-auto py-16 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8 text-xs text-[#a5a8b5]">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="size-7 rounded-lg bg-[#ffd02f] flex items-center justify-center font-bold text-xs text-[#1c1c1e]">
                dm
              </div>
              <span className="font-semibold text-white tracking-tight text-base">dmplease</span>
              <span className="text-neutral-500">•</span>
              <span className="text-neutral-400">Visual Instagram Automation</span>
            </div>
            <p className="text-[11px] text-[#6b6f7e] max-w-sm">
              The visual workspace for turning Instagram comments into automated direct messages.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <Link href="/dashboard" className="hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/dashboard/campaigns" className="hover:text-white transition-colors">
              Campaigns
            </Link>
            <Link href="/dashboard/diagnostics" className="hover:text-white transition-colors">
              Diagnostics
            </Link>
            <Link href="/onboarding" className="hover:text-white transition-colors">
              Onboarding
            </Link>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-[#00b473]" />
            <span className="font-mono text-[11px] text-neutral-300">Built on Meta&apos;s official Graph API</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
