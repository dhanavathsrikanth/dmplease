 Show how to create and manage a recurring QStash schedule via SDK to trigger /api/cron/flush-metrics every minute.

To trigger /api/cron/flush-metrics every minute via Upstash QStash, use client.schedules.create() with cron: "* * * * *" and a deterministic scheduleId so you can create, update, inspect, pause, resume, or delete the schedule idempotently from code or a setup script without creating duplicates.

---

### 1. Create or Upsert the Every-Minute Flush Schedule (`scripts/manage-flush-schedule.ts`)

Passing a custom scheduleId (such as "flush-metrics-every-minute") creates the schedule if it doesn't exist or updates its settings if it already does. Attach failureCallback and retries so repeated flush failures land in your failure handler and DLQ.

```typescript
import { Client } from "@upstash/qstash";

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
});

const FLUSH_SCHEDULE_ID = "flush-metrics-every-minute";

export async function upsertFlushMetricsSchedule() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL is required");
  }

  return qstash.schedules.create({
    scheduleId: FLUSH_SCHEDULE_ID,
    destination: `${appUrl}/api/cron/flush-metrics`,
    cron: "* * * * *", // Every 1 minute (maximum QStash schedule resolution)
    retries: 3,
    timeout: "30s",
    failureCallback: `${appUrl}/api/webhooks/qstash-failure`,
    body: JSON.stringify({ source: "qstash_schedule", job: "flush_metrics" }),
    headers: {
      "Content-Type": "application/json",
    },
  });
}
```

Run it once during deployment or setup:

```bash
npx tsx -e 'import { upsertFlushMetricsSchedule } from "./scripts/manage-flush-schedule"; upsertFlushMetricsSchedule().then(console.log);'
```

---

### 2. Inspect, Pause, Resume, and Delete Schedules

Use client.schedules (list, get, pause, resume, delete) to manage the schedule programmatically or via an internal admin endpoint:

```typescript
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export async function listAllSchedules() {
  return qstash.schedules.list();
}

export async function getFlushScheduleStatus(scheduleId = "flush-metrics-every-minute") {
  return qstash.schedules.get(scheduleId);
}

export async function pauseFlushSchedule(scheduleId = "flush-metrics-every-minute") {
  return qstash.schedules.pause({ schedule: scheduleId });
}

export async function resumeFlushSchedule(scheduleId = "flush-metrics-every-minute") {
  return qstash.schedules.resume({ schedule: scheduleId });
}

export async function deleteFlushSchedule(scheduleId = "flush-metrics-every-minute") {
  return qstash.schedules.delete(scheduleId);
}
```

---

### 3. Optional Admin Control Route (`app/api/admin/schedules/flush-metrics/route.ts`)

If you want to inspect or pause/resume the metrics flusher without opening the Upstash Console:

```typescript
import { NextResponse } from "next/server";
import {
  deleteFlushSchedule,
  getFlushScheduleStatus,
  pauseFlushSchedule,
  resumeFlushSchedule,
  upsertFlushMetricsSchedule,
} from "../../../../../scripts/manage-flush-schedule";

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.ADMIN_API_SECRET;
  return Boolean(expected && authHeader === `Bearer ${expected}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const schedule = await getFlushScheduleStatus();
    return NextResponse.json({ schedule });
  } catch (err) {
    return NextResponse.json(
      { error: "Schedule not found or unavailable", details: String(err) },
      { status: 404 }
    );
  }
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: "upsert" | "pause" | "resume" | "delete";
  };

  switch (body.action) {
    case "upsert": {
      const result = await upsertFlushMetricsSchedule();
      return NextResponse.json({ ok: true, action: "upsert", result });
    }
    case "pause": {
      await pauseFlushSchedule();
      return NextResponse.json({ ok: true, action: "pause" });
    }
    case "resume": {
      await resumeFlushSchedule();
      return NextResponse.json({ ok: true, action: "resume" });
    }
    case "delete": {
      await deleteFlushSchedule();
      return NextResponse.json({ ok: true, action: "delete" });
    }
    default:
      return NextResponse.json(
        { error: "Invalid action. Use 'upsert', 'pause', 'resume', or 'delete'." },
        { status: 400 }
      );
  }
}
```

---

### Operational Notes for a 1-Minute Cron Job

* **Up to 60s Initial Activation:** After creating a schedule, allow up to 60 seconds for QStash to load it onto an active node and fire the first execution.
* **Keep /api/cron/flush-metrics Fast and Bounded:** Because the schedule fires every minute, keep batch sizes bounded (`BATCH_SIZE = 250`) and set a sensible timeout (such as `"30s"`) so a slow database call doesn't overlap with the next minute's trigger.
* **Deleting vs. Pausing:** Pausing stops new scheduled dispatches while keeping the schedule configuration intact; deleting removes the schedule from future triggers without cancelling messages that were already published."
