# Documentation Index

Technical guides for a LinkPlease / Zorcha-style Instagram DM automation and link-in-bio platform built with **Next.js App Router, Upstash Redis, Upstash QStash, PostgreSQL, and Cloudflare R2**.

The folders are numbered so they sort in a sensible reading order, like a desktop folder layout.

---

## 00 — Overview

| Doc | What it covers |
| --- | --- |
| [Production Launch Checklist](00-overview/PRODUCTION_LAUNCH_CHECKLIST.md) | End-to-end pre-launch checklist: webhook security, Redis/QStash reliability, R2/analytics pipeline, and smoke tests. |
| [External Actions Before Launch](00-overview/EXTERNAL_ACTIONS_BEFORE_LAUNCH.md) | **Start here.** Dashboard/console actions that cannot be done in code — Meta webhook field subscriptions (`message_reactions`, `story_insights`), Supabase/Vercel/Upstash/QStash checks, and production smoke tests. |

## 01 — Auth & Tokens

| Doc | What it covers |
| --- | --- |
| [Instagram OAuth Onboarding](01-auth-and-tokens/INSTAGRAM_OAUTH_ONBOARDING.md) | OAuth state cookie, short-lived → 60-day token exchange, profile fetch, encrypted persistence, and default creator setup. |
| [Token Encryption & Refresh](01-auth-and-tokens/INSTAGRAM_TOKEN_ENCRYPTION_REFRESH.md) | AES-256-GCM token encryption, proactive 15-day refresh, and Redis locking to prevent refresh races. |

## 02 — Webhooks

| Doc | What it covers |
| --- | --- |
| [Meta Signature Verification](02-webhooks/META_WEBHOOK_SIGNATURE_VERIFICATION.md) | `X-Hub-Signature-256` HMAC verification on raw bytes plus the GET verification handshake. |
| [Webhook Parsing & Processing](02-webhooks/IG_WEBHOOK_PARSING_PROCESSING.md) | Normalizing comment and DM events, skipping echoes/self-events, and routing into the automation pipeline. |
| [Story to DM](02-webhooks/STORY_TO_DM.md) | Story replies/mentions, DM reactions, aggregate story insights, double-fire prevention, and the required Meta webhook fields. |

## 03 — DM Pipeline

| Doc | What it covers |
| --- | --- |
| [Dedupe & Rate Limits](03-dm-pipeline/INSTAGRAM_DM_AUTOMATION_UPSTASH.md) | Idempotency lock, per-creator and per-recipient limiters, and delayed QStash overflow instead of dropped leads. |
| [Send-DM Worker](03-dm-pipeline/INSTAGRAM_SEND_DM_WORKER.md) | Signed worker route that fetches the token, calls the Instagram Graph API, and classifies transient vs. permanent errors. |
| [Follow-Up Scheduling & Cancellation](03-dm-pipeline/INSTAGRAM_DM_FOLLOWUP_SCHEDULING.md) | Delayed follow-up DMs cancelled on link click or reply via QStash `cancel()` + Redis engagement state. |
| [Ask for Follow](03-dm-pipeline/ASK_FOR_FOLLOW.md) | Verified follow gate, in-chat follow prompts, hold/deliver policy, and follower-growth attribution. |

## 04 — Caching

| Doc | What it covers |
| --- | --- |
| [Creator Cache Strategy](04-caching/CREATOR_CACHE_STRATEGY.md) | Cache-aside reads for bio configs and keyword triggers, TTLs, invalidation on dashboard writes, and trigger matching. |

## 05 — Analytics

| Doc | What it covers |
| --- | --- |
| [Redis Metrics & Delta Flushing](05-analytics/REDIS_METRICS_FLUSH.md) | Counter increments, dirty-key set, atomic `getset` flush, and delta restoration on DB failure. |
| [PostgreSQL Metrics Schema](05-analytics/POSTGRES_DAILY_METRICS_SCHEMA.md) | Daily rollup table, composite indexes, upsert SQL, and conversion-rate view. |
| [Live DB + Redis Merge](05-analytics/LIVE_ANALYTICS_MERGE.md) | Analytics endpoint that merges historical DB rows with today's unflushed Redis counters. |
| [Redis Lock for Cron Flush](05-analytics/REDIS_LOCK_CRON_GUARD.md) | Ownership-checked `SET NX EX` lock so overlapping flush invocations never run together. |

## 06 — Queue Ops

| Doc | What it covers |
| --- | --- |
| [Failure Callbacks & DLQ](06-queue-ops/QSTASH_DLQ_FAILURE_HANDLING.md) | `failureCallback` setup, signed callback handling, DLQ inspection/replay/delete, and idempotent replays. |
| [Flush Schedule Management](06-queue-ops/QSTASH_FLUSH_SCHEDULE.md) | Idempotent every-minute schedule creation, pause/resume/delete, and an admin control route. |

## 07 — Storage & Media

| Doc | What it covers |
| --- | --- |
| [R2 Presigned Uploads](07-storage-and-media/R2_PRESIGNED_UPLOADS.md) | Validated S3 presigned PUT URLs for avatars and thumbnails, CORS setup, and direct browser uploads with a client helper. |

## 08 — Public Pages

| Doc | What it covers |
| --- | --- |
| [Public Bio Page Rendering](08-public-pages/PUBLIC_BIO_PAGE_RENDERING.md) | Cached Server Component bio page, SEO metadata, R2 image allowlisting via `next/image`, and `/go/[linkId]` click routing. |

## 09 — Architecture

| Doc | What it covers |
| --- | --- |
| [Scaling Architecture & Migration Plan](09-architecture/SCALING_ARCHITECTURE.md) | Target architecture for 25,000 creators, vendor/cost decisions, security (scoped RPCs), data partitioning, observability, and phased migration. |

## 10 — Product Analytics

| Doc | What it covers |
| --- | --- |
| [Product Analytics (beyond GA4)](10-analytics/PRODUCT_ANALYTICS.md) | PostHog event taxonomy, GA4-blind server-side outcomes, saved dashboards and insights, decision thresholds, and cost controls. |

## 11 — Reliability

| Doc | What it covers |
| --- | --- |
| [Production Flow, Incident Diagnosis & Reliability Fix](11-reliability/PRODUCTION_FLOW_INCIDENT.md) | Full comment→DM flowchart, evidence from the 2026-11-26 incident, root causes, hardened flow, deployed fixes and verification procedure. |

## 13 — Product

| Doc | What it covers |
| --- | --- |
| [Beyond Auto-DM — ROI Analytics Roadmap](13-product/ROI_ANALYTICS_ROADMAP.md) | Four-layer analytics moat vs Zorcha/LinkPlease, required data model, product surfaces, packaging and phased delivery. |

---

## Suggested Reading Order

1. [Production Launch Checklist](00-overview/PRODUCTION_LAUNCH_CHECKLIST.md)
2. [Instagram OAuth Onboarding](01-auth-and-tokens/INSTAGRAM_OAUTH_ONBOARDING.md) → [Token Encryption & Refresh](01-auth-and-tokens/INSTAGRAM_TOKEN_ENCRYPTION_REFRESH.md)
3. [Meta Signature Verification](02-webhooks/META_WEBHOOK_SIGNATURE_VERIFICATION.md) → [Webhook Parsing & Processing](02-webhooks/IG_WEBHOOK_PARSING_PROCESSING.md)
4. [Dedupe & Rate Limits](03-dm-pipeline/INSTAGRAM_DM_AUTOMATION_UPSTASH.md) → [Send-DM Worker](03-dm-pipeline/INSTAGRAM_SEND_DM_WORKER.md) → [Follow-Up Scheduling](03-dm-pipeline/INSTAGRAM_DM_FOLLOWUP_SCHEDULING.md)
5. [Creator Cache Strategy](04-caching/CREATOR_CACHE_STRATEGY.md) → [Public Bio Page Rendering](08-public-pages/PUBLIC_BIO_PAGE_RENDERING.md)
6. [Redis Metrics & Delta Flushing](05-analytics/REDIS_METRICS_FLUSH.md) → [PostgreSQL Metrics Schema](05-analytics/POSTGRES_DAILY_METRICS_SCHEMA.md) → [Live DB + Redis Merge](05-analytics/LIVE_ANALYTICS_MERGE.md) → [Redis Lock for Cron Flush](05-analytics/REDIS_LOCK_CRON_GUARD.md)
7. [Flush Schedule Management](06-queue-ops/QSTASH_FLUSH_SCHEDULE.md) → [Failure Callbacks & DLQ](06-queue-ops/QSTASH_DLQ_FAILURE_HANDLING.md)
8. [R2 Presigned Uploads](07-storage-and-media/R2_PRESIGNED_UPLOADS.md)
