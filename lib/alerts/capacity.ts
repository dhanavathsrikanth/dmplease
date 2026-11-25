import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

/**
 * Platform-level capacity guard.
 *
 * The current architecture is intentional: Next.js on Vercel writes to
 * Supabase over HTTPS because Vercel cannot reach Supabase's Postgres ports.
 * It is economical at small scale but has a known envelope. This module
 * measures where we are inside that envelope and alerts admins before it breaks.
 */

export const THRESHOLDS = {
  warning: { eventsPerDay: 10_000, dmsPerDay: 5_000, accounts: 100, failuresPerDay: 25 },
  critical: { eventsPerDay: 50_000, dmsPerDay: 20_000, accounts: 300, failuresPerDay: 100 },
} as const;

export interface CapacityMetrics {
  accounts: number;
  activeAutomations: number;
  events24h: number;
  comments24h: number;
  dms24h: number;
  contacts: number;
  failures24h: number;
  avgProcessingMs: number | null;
}

const EMPTY: CapacityMetrics = {
  accounts: 0,
  activeAutomations: 0,
  events24h: 0,
  comments24h: 0,
  dms24h: 0,
  contacts: 0,
  failures24h: 0,
  avgProcessingMs: null,
};

export async function collectCapacityMetrics(): Promise<CapacityMetrics> {
  if (!hasAdminDb()) return EMPTY;
  const db = getAdminDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const [accounts, automations, events, comments, dms, contacts, failures, durations] =
      await Promise.all([
        db.from("instagram_accounts").select("id", { count: "exact", head: true }),
        db.from("automations").select("id", { count: "exact", head: true }).eq("active", true),
        db.from("webhook_events").select("id", { count: "exact", head: true }).gte("received_at", since),
        db.from("comment_events").select("id", { count: "exact", head: true }).gte("received_at", since),
        db.from("dm_logs").select("id", { count: "exact", head: true }).gte("sent_at", since),
        db.from("contacts").select("id", { count: "exact", head: true }),
        db.from("webhook_events").select("id", { count: "exact", head: true }).eq("status", "FAILED").gte("received_at", since),
        db.from("webhook_events").select("duration_ms").gte("received_at", since).not("duration_ms", "is", null),
      ]);

    const samples = (durations.data ?? [])
      .map((row) => row.duration_ms)
      .filter((value): value is number => typeof value === "number");

    return {
      accounts: accounts.count ?? 0,
      activeAutomations: automations.count ?? 0,
      events24h: events.count ?? 0,
      comments24h: comments.count ?? 0,
      dms24h: dms.count ?? 0,
      contacts: contacts.count ?? 0,
      failures24h: failures.count ?? 0,
      avgProcessingMs: samples.length
        ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
        : null,
    };
  } catch (error) {
    console.warn("[capacity] Could not collect metrics:", error);
    return EMPTY;
  }
}

export const ARCHITECTURE_BRIEF = `Current architecture (intentional, not accidental)
- Next.js 16 serverless on Vercel; Supabase Auth + Postgres for data.
- Backend writes use Supabase's HTTPS REST API with a service-role key. This is because Vercel cannot reach Supabase's Postgres ports (5432/6543) in this environment, while HTTPS works.
- Webhook flow: verify HMAC signature -> acknowledge Meta immediately -> process in after() -> match automations/rules -> send DM via Meta Graph API -> write contacts, conversations, messages, logs and safety events.
- Purpose: comment-to-DM automation plus story mentions/replies, share-to-DM, DM keyword rules, follow-gate, lead capture, re-runs and analytics.

Comfortable operating envelope (before this design should be changed)
- Up to about 100 connected Instagram accounts.
- Up to about 10,000 webhook events per day.
- Up to about 5,000 automated DMs per day.
- Short bursts are absorbed by jitter and variant rotation; the hourly limiter is in-memory and therefore per serverless instance.

Known limits of this design
- One HTTP request per database write (latency and Supabase API quota grow with volume).
- Service-role key bypasses RLS: high blast radius if leaked.
- In-memory rate buckets are not shared across instances, so a global per-account cap is not exact.
- after() has a finite max duration; failed jobs are recorded but not automatically retried.

Recommended architecture at the next scale plateau
1. Durable job queue with retry and dead-letter (the existing webhook_events / pending_dms tables can back it, or use QStash/Upstash).
2. Shared, durable rate-limit counters keyed by Instagram account ID.
3. Replace broad service-role writes with narrow SECURITY DEFINER RPCs and a limited database role.
4. When volume justifies it, move to a direct Postgres connection with IPv4 (Supabase IPv4 add-on or a host without Vercel's port restriction) and batch writes.
5. Put analytics on a read replica or warehouse; keep the transactional database lean.

Action: watch the daily capacity alerts. Warning means plan the change; critical means implement it immediately.`;

export interface AlertCandidate {
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
}

export function evaluateCapacity(metrics: CapacityMetrics): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const w = THRESHOLDS.warning;
  const c = THRESHOLDS.critical;

  if (
    metrics.events24h >= c.eventsPerDay ||
    metrics.dms24h >= c.dmsPerDay ||
    metrics.accounts >= c.accounts ||
    metrics.failures24h >= c.failuresPerDay
  ) {
    out.push({
      kind: "capacity_critical",
      severity: "critical",
      title: "Platform capacity critical — scale architecture now",
      body: `Current 24h load: ${metrics.events24h} webhook events, ${metrics.dms24h} DMs, ${metrics.accounts} accounts, ${metrics.failures24h} failed jobs. This exceeds the safe envelope of the current Supabase-REST architecture. Implement the durable queue, shared rate limiting and scoped database writes before volume grows further.\n\n${ARCHITECTURE_BRIEF}`,
    });
  } else if (
    metrics.events24h >= w.eventsPerDay ||
    metrics.dms24h >= w.dmsPerDay ||
    metrics.accounts >= w.accounts ||
    metrics.failures24h >= w.failuresPerDay
  ) {
    out.push({
      kind: "capacity_warning",
      severity: "warning",
      title: "Platform approaching capacity envelope",
      body: `Current 24h load: ${metrics.events24h} webhook events, ${metrics.dms24h} DMs, ${metrics.accounts} accounts, ${metrics.failures24h} failed jobs. Still within the design envelope, but plan the next architecture step now.\n\n${ARCHITECTURE_BRIEF}`,
    });
  }

  return out;
}

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_ALERT_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  return getAdminEmails().some((admin) => admin.toLowerCase() === normalized);
}

async function sendEmail(subject: string, body: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ALERT_FROM_EMAIL?.trim();
  const to = getAdminEmails();
  if (!key || !from || to.length === 0) {
    return { status: "not_configured" as const, error: "RESEND_API_KEY, ALERT_FROM_EMAIL or ADMIN_ALERT_EMAILS is missing" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        status: "failed" as const,
        error: `Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
      };
    }
    return { status: "sent" as const };
  } catch (error) {
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : "Email request failed",
    };
  }
}

export interface AlertRunResult {
  metrics: CapacityMetrics;
  created: number;
  emailed: number;
  errors: string[];
}

/** Creates due alerts, emails them to admins, and records delivery status. */
export async function runCapacityCheck(options: { forceBrief?: boolean } = {}): Promise<AlertRunResult> {
  const result: AlertRunResult = { metrics: EMPTY, created: 0, emailed: 0, errors: [] };
  if (!hasAdminDb()) {
    result.errors.push("Admin database is not configured");
    return result;
  }

  const db = getAdminDb();
  const metrics = await collectCapacityMetrics();
  result.metrics = metrics;

  const candidates: AlertCandidate[] = [...evaluateCapacity(metrics)];
  if (options.forceBrief) {
    candidates.unshift({
      kind: "architecture_brief",
      severity: "info",
      title: "dmplease architecture brief and capacity limits",
      body: ARCHITECTURE_BRIEF,
    });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const candidate of candidates) {
    try {
      const { data: existing } = await db
        .from("admin_alerts")
        .select("id")
        .eq("kind", candidate.kind)
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();

      if (existing && !options.forceBrief) continue;

      const delivery = await sendEmail(candidate.title, candidate.body);
      const { error } = await db.from("admin_alerts").insert({
        kind: candidate.kind,
        severity: candidate.severity,
        title: candidate.title,
        body: candidate.body,
        metrics,
        email_status: delivery.status,
        email_error: "error" in delivery ? delivery.error : null,
        sent_at: delivery.status === "sent" ? new Date().toISOString() : null,
      });
      if (error) throw error;

      result.created++;
      if (delivery.status === "sent") result.emailed++;
      if (delivery.status === "failed" && "error" in delivery) {
        result.errors.push(`${candidate.kind}: ${delivery.error}`);
      }
    } catch (error) {
      result.errors.push(
        `${candidate.kind}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }
  }

  return result;
}
