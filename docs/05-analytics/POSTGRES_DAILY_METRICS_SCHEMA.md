 Design the PostgreSQL schema and indexes for storing daily link-in-bio clicks, DM sent counts, and DM conversion rates.

To support 30,000 monthly active users in a LinkPlease / Zorcha alternative—where creators inspect daily link-in-bio clicks, automated DM volume, and DM conversion rates across time ranges (e.g., last 7, 30, or 90 days)—the cleanest PostgreSQL design stores pre-aggregated daily rollups per (day, creator_id, target_kind, target_id) rather than querying billions of raw event rows on every dashboard load.

Compute conversion rates (dm_link_clicks / NULLIF(dm_sent, 0) and overall engagement/conversion rates) at query time in SQL or a view using NULLIF so they stay accurate when dm_sent is 0 and never drift out of sync with underlying counts.

---

### 1. Core PostgreSQL Schema (`daily_creator_metrics`)

This table directly matches the `metric:${day}:${kind}:${creatorId}:${targetId}` structure flushed from Upstash Redis:

* `target_kind`: `'bio_link'` (for a specific link on the creator's bio page) or `'automation_rule'` (for a comment/DM keyword trigger rule).
* `target_id`: The UUID/ID of the `bio_links` row or `automation_rules` row.
* `bio_clicks`: Total link-in-bio clicks on that date.
* `dm_sent`: Total initial automated Instagram DMs dispatched successfully.
* `dm_link_clicks`: Total clicks on tracked links inside those DMs.
* `dm_replies`: Total follower replies received on those DM threads.

```sql
-- Optional: if using gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL UNIQUE,
  instagram_user_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_creator_metrics (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  creator_id UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('bio_link', 'automation_rule')),
  target_id UUID NOT NULL,

  bio_clicks BIGINT NOT NULL DEFAULT 0 CHECK (bio_clicks >= 0),
  dm_sent BIGINT NOT NULL DEFAULT 0 CHECK (dm_sent >= 0),
  dm_link_clicks BIGINT NOT NULL DEFAULT 0 CHECK (dm_link_clicks >= 0),
  dm_replies BIGINT NOT NULL DEFAULT 0 CHECK (dm_replies >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Guarantees idempotent ON CONFLICT upserts from your Redis flush worker
  CONSTRAINT uq_daily_creator_metrics_grain
    UNIQUE (day, creator_id, target_kind, target_id)
);
```

---

### 2. Indexes for Fast Dashboard & Funnel Queries

Most creator analytics queries filter by `creator_id` and a day range (`day >= CURRENT_DATE - INTERVAL '30 days'`), optionally filtering by `target_kind` or `target_id`:

```sql
-- 1. Primary dashboard lookup: all metrics for a creator across a date range
--    (Also satisfies the leading prefix for creator_id + day queries)
CREATE INDEX idx_daily_metrics_creator_day
  ON daily_creator_metrics (creator_id, day DESC, target_kind)
  INCLUDE (target_id, bio_clicks, dm_sent, dm_link_clicks, dm_replies);

-- 2. Per-link or per-rule breakdown over time
CREATE INDEX idx_daily_metrics_creator_target_day
  ON daily_creator_metrics (creator_id, target_kind, target_id, day DESC);

-- 3. Optional: fast day-level scans for platform-wide admin or retention rollups
CREATE INDEX idx_daily_metrics_day
  ON daily_creator_metrics (day DESC);
```

---

### 3. Atomic Upsert Query for Your Redis Flush Worker

When `/api/cron/flush-metrics` flushes aggregated deltas from Redis, use `INSERT ... ON CONFLICT ... DO UPDATE` to add the delta onto existing counts and refresh `updated_at` in one round-trip:

```sql
INSERT INTO daily_creator_metrics (
  day,
  creator_id,
  target_kind,
  target_id,
  bio_clicks,
  dm_sent,
  dm_link_clicks,
  dm_replies
)
VALUES
  ($1::date, $2::uuid, $3::text, $4::uuid, $5::bigint, $6::bigint, $7::bigint, $8::bigint)
ON CONFLICT (day, creator_id, target_kind, target_id)
DO UPDATE SET
  bio_clicks     = daily_creator_metrics.bio_clicks + EXCLUDED.bio_clicks,
  dm_sent        = daily_creator_metrics.dm_sent + EXCLUDED.dm_sent,
  dm_link_clicks = daily_creator_metrics.dm_link_clicks + EXCLUDED.dm_link_clicks,
  dm_replies     = daily_creator_metrics.dm_replies + EXCLUDED.dm_replies,
  updated_at     = NOW();
```

---

### 4. SQL View & Query for Conversion Rates

Creating a view keeps DM click-through conversion rate (`dm_link_clicks / dm_sent`) and DM reply rate (`dm_replies / dm_sent`) consistent across every dashboard chart and API endpoint.

```sql
CREATE OR REPLACE VIEW v_daily_creator_metrics_rates AS
SELECT
  day,
  creator_id,
  target_kind,
  target_id,
  bio_clicks,
  dm_sent,
  dm_link_clicks,
  dm_replies,
  -- DM link click conversion rate (0.0 to 100.0%)
  ROUND(
    (dm_link_clicks::NUMERIC / NULLIF(dm_sent, 0)) * 100,
    2
  ) AS dm_ctr_pct,
  -- DM reply rate (0.0 to 100.0%)
  ROUND(
    (dm_replies::NUMERIC / NULLIF(dm_sent, 0)) * 100,
    2
  ) AS dm_reply_rate_pct,
  updated_at
FROM daily_creator_metrics;
```

Example query for a creator's last 30 days summary totals and conversion rates:

```sql
SELECT
  SUM(bio_clicks) AS total_bio_clicks,
  SUM(dm_sent) AS total_dm_sent,
  SUM(dm_link_clicks) AS total_dm_link_clicks,
  SUM(dm_replies) AS total_dm_replies,
  ROUND(
    (SUM(dm_link_clicks)::NUMERIC / NULLIF(SUM(dm_sent), 0)) * 100,
    2
  ) AS overall_dm_ctr_pct,
  ROUND(
    (SUM(dm_replies)::NUMERIC / NULLIF(SUM(dm_sent), 0)) * 100,
    2
  ) AS overall_dm_reply_rate_pct
FROM daily_creator_metrics
WHERE creator_id = $1::uuid
  AND day >= (CURRENT_DATE - INTERVAL '29 days')::date;
```

---

### Scaling Notes for 30,000+ Active Users

* **Predictable Row Growth:** Even if all 30,000 creators are active every single day with 5 targets each, that is at most 150,000 rows/day (~4.5M rows/month)—very manageable for PostgreSQL with proper composite indexes.
* **Partitioning Later (If Needed):** Once `daily_creator_metrics` grows past tens of millions of rows, you can range-partition by day (`PARTITION BY RANGE (day)`) monthly so old partitions can be archived or queried with partition pruning.
* **Keep Raw Events Separate:** If you also store raw click/DM logs for debugging or attribution audits, put raw events in a separate append-only table with a shorter retention window (e.g., 30–90 days) while keeping `daily_creator_metrics` for long-term creator charts."
