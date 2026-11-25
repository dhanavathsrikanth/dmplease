import { Suspense } from "react";
import { connection } from "next/server";
import { AlertTriangle, Gauge, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/profile";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { ARCHITECTURE_BRIEF, isAdminEmail, THRESHOLDS, type CapacityMetrics } from "@/lib/alerts/capacity";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SendBriefButton } from "@/components/admin/send-brief-button";

export const metadata = {
  title: "Platform Capacity - dmplease",
};

function Loading() {
  return (
    <div className="space-y-6 max-w-5xl animate-pulse">
      <Skeleton className="h-8 w-72 rounded-xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

export default function AdminAlertsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminAlertsContent />
    </Suspense>
  );
}

async function AdminAlertsContent() {
  await connection();
  const user = await getCurrentUser();

  if (!isAdminEmail(user?.email)) {
    return (
      <main className="max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          This page is restricted to addresses listed in <code>ADMIN_ALERT_EMAILS</code>.
        </p>
      </main>
    );
  }

  let metrics: CapacityMetrics = {
    accounts: 0,
    activeAutomations: 0,
    events24h: 0,
    comments24h: 0,
    dms24h: 0,
    contacts: 0,
    failures24h: 0,
    avgProcessingMs: null,
  };
  let alerts: Array<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    body: string;
    email_status: string;
    email_error: string | null;
    created_at: string;
  }> = [];

  if (hasAdminDb()) {
    const db = getAdminDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [a, auto, ev, cm, dm, co, f] = await Promise.all([
      db.from("instagram_accounts").select("id", { count: "exact", head: true }),
      db.from("automations").select("id", { count: "exact", head: true }).eq("active", true),
      db.from("webhook_events").select("id", { count: "exact", head: true }).gte("received_at", since),
      db.from("comment_events").select("id", { count: "exact", head: true }).gte("received_at", since),
      db.from("dm_logs").select("id", { count: "exact", head: true }).gte("sent_at", since),
      db.from("contacts").select("id", { count: "exact", head: true }),
      db.from("webhook_events").select("id", { count: "exact", head: true }).eq("status", "FAILED").gte("received_at", since),
    ]);
    metrics = {
      accounts: a.count ?? 0,
      activeAutomations: auto.count ?? 0,
      events24h: ev.count ?? 0,
      comments24h: cm.count ?? 0,
      dms24h: dm.count ?? 0,
      contacts: co.count ?? 0,
      failures24h: f.count ?? 0,
      avgProcessingMs: null,
    };

    const { data } = await db
      .from("admin_alerts")
      .select("id, kind, severity, title, body, email_status, email_error, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    alerts = (data ?? []) as typeof alerts;
  }

  const rows = [
    { label: "Webhook events (24h)", value: metrics.events24h, warn: THRESHOLDS.warning.eventsPerDay, critical: THRESHOLDS.critical.eventsPerDay },
    { label: "Automated DMs (24h)", value: metrics.dms24h, warn: THRESHOLDS.warning.dmsPerDay, critical: THRESHOLDS.critical.dmsPerDay },
    { label: "Connected accounts", value: metrics.accounts, warn: THRESHOLDS.warning.accounts, critical: THRESHOLDS.critical.accounts },
    { label: "Failed jobs (24h)", value: metrics.failures24h, warn: THRESHOLDS.warning.failuresPerDay, critical: THRESHOLDS.critical.failuresPerDay },
  ];

  return (
    <main className="max-w-5xl space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight flex items-center gap-2">
            <Gauge className="size-6" aria-hidden="true" /> Platform Capacity
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Live load against the current architecture&apos;s envelope, with alerts before it breaks.
          </p>
        </div>
        <SendBriefButton />
      </div>

      {!hasAdminDb() && (
        <div role="status" className="rounded-2xl border border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 p-4 text-xs">
          Configure <code>SUPABASE_SERVICE_ROLE_KEY</code> to enable capacity monitoring.
        </div>
      )}

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 space-y-3">
        <h2 className="font-semibold text-sm">Current envelope</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((row) => {
            const state = row.value >= row.critical ? "critical" : row.value >= row.warn ? "warning" : "ok";
            return (
              <div key={row.label} className="rounded-xl border border-[#e0e2e8] dark:border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <Badge variant={state === "critical" ? "destructive" : state === "warning" ? "outline" : "tag-teal"} className="text-[10px]">
                    {state === "ok" ? "Healthy" : state}
                  </Badge>
                </div>
                <p className="mt-1 text-xl font-semibold">{row.value.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">warn at {row.warn.toLocaleString()} · critical at {row.critical.toLocaleString()}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <ShieldAlert className="size-4" aria-hidden="true" /> Architecture brief
        </h2>
        <p className="text-xs text-muted-foreground">This is the notice sent to admin email addresses.</p>
        <pre className="whitespace-pre-wrap rounded-xl bg-[#f7f8fa] dark:bg-muted/40 p-4 text-[11px] leading-relaxed font-sans">
{ARCHITECTURE_BRIEF}
        </pre>
      </Card>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 p-5 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <AlertTriangle className="size-4" aria-hidden="true" /> Alert history
        </h2>
        {alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No alerts yet. Daily checks run automatically.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-xl border border-[#e0e2e8] dark:border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{alert.title}</p>
                  <Badge variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "outline" : "tag-teal"} className="text-[10px]">
                    {alert.severity}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(alert.created_at).toLocaleString()} · email: {alert.email_status}
                  {alert.email_error ? ` · ${alert.email_error}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
