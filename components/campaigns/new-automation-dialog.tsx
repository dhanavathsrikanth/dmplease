"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Calendar,
  Inbox,
  Mail,
  MessageCircle,
  Play,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CAMPAIGN_TEMPLATES,
  type CampaignTemplate,
  type CampaignTemplateAccent,
  type CampaignTemplateIcon,
} from "@/lib/campaign-templates";
import { cn } from "@/lib/utils";

const ICONS: Record<CampaignTemplateIcon, React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles,
  message: MessageCircle,
  zap: Zap,
  bot: Bot,
  inbox: Inbox,
  story: Sparkles,
  flow: Workflow,
  users: Users,
  mail: Mail,
  trending: TrendingUp,
  book: BookOpen,
  calendar: Calendar,
  plus: Plus,
};

const ACCENTS: Record<
  CampaignTemplateAccent,
  { card: string; icon: string; label: string }
> = {
  brand: {
    card: "border-brand/40 bg-brand-soft/40 hover:border-brand/70 dark:bg-brand/10",
    icon: "bg-brand text-brand-foreground",
    label: "text-brand-soft-foreground dark:text-brand",
  },
  success: {
    card: "border-success/30 bg-success-soft/30 hover:border-success/60 dark:bg-success/10",
    icon: "bg-success text-white",
    label: "text-success-soft-foreground dark:text-success-soft-foreground",
  },
  rose: {
    card: "border-rose/40 bg-rose-soft/30 hover:border-rose/70 dark:bg-rose/10",
    icon: "bg-rose text-[#7d2663]",
    label: "text-rose-soft-foreground dark:text-rose-soft-foreground",
  },
  coral: {
    card: "border-coral/30 bg-coral-soft/30 hover:border-coral/60 dark:bg-coral/10",
    icon: "bg-coral text-[#600000]",
    label: "text-coral-soft-foreground dark:text-coral-soft-foreground",
  },
  info: {
    card: "border-info/30 bg-info-soft/40 hover:border-info/60 dark:bg-info/10",
    icon: "bg-info text-white",
    label: "text-info-soft-foreground dark:text-info-soft-foreground",
  },
};

function TemplateCard({
  template,
  onSelect,
}: {
  template: CampaignTemplate;
  onSelect: () => void;
}) {
  const Icon = ICONS[template.icon];
  const accent = ACCENTS[template.accent];

  return (
    <Link
      href={template.href}
      onClick={onSelect}
      className={cn(
        "group flex items-start gap-3 rounded-2xl border p-3.5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        accent.card
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-xs",
          accent.icon
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {template.title}
          </span>
          {template.badge && (
            <span
              className={cn(
                "shrink-0 rounded-md bg-card/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest",
                accent.label
              )}
            >
              {template.badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
          {template.description}
        </span>
      </span>
      <ArrowRight
        className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

interface NewAutomationDialogProps {
  className?: string;
  label?: string;
}

export function NewAutomationDialog({
  className,
  label = "New Automation",
}: NewAutomationDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className={cn(
            "h-9 shrink-0 gap-1.5 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90",
            className
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            New Automation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Start from a proven template or build a flow from scratch. Every
            automation can be edited after it is created.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-6 md:grid-cols-[1.05fr_1fr]">
          {/* Flow Builder */}
          <Link
            href="/dashboard/campaigns/new"
            onClick={() => setOpen(false)}
            className="group relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,hsl(var(--brand-soft))_0%,hsl(var(--card))_55%,hsl(var(--info-soft))_100%)] p-5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-[linear-gradient(135deg,hsl(var(--brand)/0.12)_0%,hsl(var(--card))_55%,hsl(var(--info)/0.12)_100%)]"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-brand/20 blur-2xl"
            />
            <div className="relative">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
                <Workflow className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 text-base font-semibold text-foreground">
                Flow Builder
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Build Your Flow, Your Way — triggers, conditions, follow gates
                and multi-step DMs.
              </p>
            </div>
            <span className="relative mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Play className="size-3.5" aria-hidden="true" />
              See Tutorial
              <ArrowRight
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>

          {/* Templates */}
          <div className="space-y-2">
            <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Templates
            </p>
            {CAMPAIGN_TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => setOpen(false)}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
