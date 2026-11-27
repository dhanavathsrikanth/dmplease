# Safety features — LinkPlease analysis vs. dmplease

> **Purpose:** Verify which of LinkPlease's three safety-related features actually exist,
> document what each one does from their landing page and docs, map them against
> our implementation, and propose implementation plans for the gaps.

---

## 1. What LinkPlease claims (from landing pages + docs)

### 1.1 Comment Guard (AI comment moderation)

**Source:** Homepage (`/#features`), Pricing page, vs ManyChat comparison, vs LinkDM comparison.

**Claimed behavior:**
> "Auto-hide spam comments — Hate, spam, and competitor promos are instantly
> classified and hidden the moment they land."

**Pricing FAQ:**
> "What does the AI comment moderation hide?" (accordion, not expanded in HTML)

**Plan gating:** Super (₹799/mo) and Max (₹899/mo). Free and Pro do **not** include it.

**AI credits:** "AI credits power the AI features — message variant generation,
comment moderation and the collaboration detector. Super and Max both include
10,000 credits per month."

**How it works (from comparison pages):**
- "Hate, spam, and competitor promos are instantly classified and hidden the
  moment they land."
- Comparison table row: "AI comment moderation" — Included on LinkPlease,
  "Not documented" on competitors.
- Super plan description: "Adds the AI layer — moderation, brand deals and
  smart replies."

**What's publicly documented:** Only the marketing claim. No API docs, no
sensitivity controls documented, no review log mentioned beyond the FAQ
accordion (content not publicly readable). The `.co.in` sibling site has a
fuller "AI replies" claim but is a different product shape.

### 1.2 Collab / brand-deal detector

**Source:** Homepage (`/#features`), Pricing page, vs ManyChat comparison.

**Claimed behavior:**
> "Never miss a brand deal again. Get instantly notified the moment a brand
> reaches out so deals never drown in your fan DMs."

**Mock alert shown on homepage:**
> "New Brand Deal Detected! 🎉 — Nike Partnerships sent you a DM. Check your
> inbox!"

**Plan gating:** Super (₹799/mo) and Max (₹899/mo).

**How it works (from comparison pages):**
- "Instant alert when a brand DMs you about a partnership"
- Comparison table row: "Brand collaboration detector" — Included on LinkPlease,
  "Not available" on LinkDM.
- "Never miss a brand deal again" — emotional hook on the homepage.

**What's publicly documented:** Only the marketing claim and the mock alert.
No details on detection method (keyword matching? sender analysis? LLM
classification?), notification channel (email? in-app? push?), or false-positive
handling.

### 1.3 IG Shield — AI account protection

**Source:** Pricing page (Max plan), vs LinkDM comparison.

**Claimed behavior:**
> "Adds AI-powered safeguards for accounts operating at higher volume."
> Claimed value: "Full AI protection for accounts that cannot afford a flag."

**Plan gating:** Max only (₹899/mo). This is the only safety feature gated
behind the highest paid tier.

**How it works (from comparison pages):**
- "Adds AI-powered safeguards for accounts operating at higher volume"
- Comparison table: "IG Shield — AI account protection" — Included on
  LinkPlease, "Not documented" on LinkDM.
- Pricing FAQ: "AI credits power the AI features — message variant generation,
  comment moderation and the collaboration detector." (Note: IG Shield is NOT
  listed as using AI credits, implying it's a separate mechanism.)

**What's publicly documented:** Nothing beyond the one-line claim. No details on
what "AI-powered safeguards" means, what triggers them, or how they differ from
the basic safety engine.

---

## 2. What we have implemented

### 2.1 Comment Guard (AI moderation)

**Status: ❌ Not implemented.**

- No AI integration exists in the codebase (no OpenAI, Anthropic, or LLM
  calls anywhere).
- `PRODUCT_DEVELOPMENT_TIERS.md` T2.3 lists it as `[ ]` (unchecked).
- `docs/FEATURE_IMPLEMENTATION_AUDIT.md` does not list it as a feature row.
- The `lib/ai/**` directory does not exist.

**What we do have:**
- `validateAutomationInput()` in `lib/meta/safety.ts` — catches loops, duplicate
  keywords, >3 links, invalid URLs. This is pre-launch screening, not
  runtime moderation.
- Public reply variants + rotation (prevents identical replies).
- Safety events ledger (`safety_events`) for audit.

### 2.2 Collab / brand-deal detector

**Status: ❌ Not implemented.**

- No inbound DM classification or brand-deal detection logic exists.
- `PRODUCT_DEVELOPMENT_TIERS.md` T2.3 lists "Creator profile for brand
  collaborations" as `[ ]` (unchecked).
- We have a passive "Collabs" profile (from Zorcha analysis) but no detector.

**What we do have:**
- Inbox conversation tracking (`conversations`, `messages` tables).
- Inbound DM parsing (`parseMessageEvents`).
- Contact management with source tracking.
- No classification or notification system for brand deals.

### 2.3 Shield dashboard (IG Shield equivalent)

**Status: ✅ Implemented (and exceeded).**

We have built a full safety dashboard that is **transparent and free**, not
opaque and paid:

| LinkPlease IG Shield (claimed) | Our implementation |
|---|---|
| "AI-powered safeguards for accounts operating at higher volume" | Account health monitor: consecutive failures, token status, last send, last error |
| "Full AI protection for accounts that cannot afford a flag" | Auto-pause at 5 consecutive failures with visible, reversible banner |
| No public documentation of what it does | Every metric is computed from real data and explained in plain English |
| Paid (Max plan, ₹899/mo) | Free for everyone |
| Static mockup dashboard | Real-time safety score (0–100), live gauge, recent events |
| "100% delivered, 0 breaches" (marketing) | Measured delivery rate, breach count, throttle count |
| No opt-out handling mentioned | Full STOP/unsubscribe compliance with re-subscribe |
| No pre-launch validation mentioned | `validateAutomationInput` catches loops, duplicates, >3 links |

**Files:**
- `lib/meta/throttle.ts` — proactive viral-spike throttle
- `lib/meta/account-health.ts` — account health monitor + auto-pause
- `lib/meta/safety-score.ts` — composite 0–100 score
- `app/dashboard/safety/page.tsx` — dedicated safety dashboard
- `components/dashboard/safety-card.tsx` — per-account health UI
- `lib/safety-event-explanations.ts` — plain-English event explanations
- `app/api/cron/safety-retention/route.ts` — 30-day retention
- `app/api/cron/safety-digest/route.ts` — weekly digest email

---

## 3. Implementation plans for the gaps

### 3.1 Comment Guard (AI moderation)

**Complexity:** Medium. Requires AI/LLM integration (T2.3 prerequisite).

**Architecture:**

```
lib/ai/
  ├── classifier.ts          # LLM-based comment classifier
  ├── moderation.ts          # Moderation rules + sensitivity
  └── credits.ts             # Usage metering
app/api/instagram/moderate/
  └── route.ts               # Webhook handler for comment moderation
components/campaigns/
  └── comment-guard-settings.tsx  # Sensitivity + review log UI
```

**How it works:**
1. When a comment arrives, classify it using an LLM (OpenAI/Anthropic) with a
   prompt: "Classify this Instagram comment as: safe, spam, hate, competitor_promo,
   or scam. Return JSON with label and confidence."
2. If classified as spam/hate/scam/competitor_promo above the sensitivity
   threshold, hide the comment via Meta Graph API:
   `POST /{comment-id}?hidden=true` (requires `instagram_manage_comments`).
3. Log the moderation action in a `moderation_events` table with the original
   comment, classification, confidence, and action taken.
4. Review log UI shows hidden comments with undo capability.

**Sensitivity control:** A slider (0–100) where 0 = only obvious spam, 100 =
aggressive (may hide legitimate comments). Default: 50.

**AI credits:** Each classification costs 1 credit. Free tier: 100/month.
Creator tier: 10,000/month (matching LinkPlease's Super plan).

**Dependencies:** T2.3 (AI FAQ, variants, moderation) — requires `lib/ai/**`
and `ai_credits` models.

**Effort:** 2–3 weeks after T2.3 infrastructure is in place.

**Our advantage:** LinkPlease's Comment Guard is a black box (no sensitivity
control documented, no review log mentioned). Ours would have sensitivity
control, a review log with undo, and a "test panel" to preview classifications
before publishing (per T2.3 AC).

### 3.2 Collab / brand-deal detector

**Complexity:** Low-Medium. Can be built without AI (keyword/sender heuristics)
or with AI for better accuracy.

**Architecture:**

```
lib/collab-detector.ts       # Heuristic + optional LLM classification
app/api/inbox/collab-scan/   # Webhook handler for inbound DM classification
components/dashboard/
  └── collab-alerts.tsx      # Alert list UI
```

**How it works (heuristic v1, no AI):**
1. When an inbound DM arrives from a sender not in the creator's contacts list
   (i.e., someone new), check the message text for collaboration keywords:
   - "collab", "collaboration", "partnership", "sponsor", "brand deal",
     "ambassador", "paid promotion", "shoutout", "barter", "pr package"
2. Check the sender's profile (via Meta Graph API) for signals:
   - Verified badge (brands are often verified)
   - Business account type
   - Follower count > threshold (e.g., 10k)
3. If multiple signals match, classify as "potential brand deal" and:
   - Create a `collab_alerts` row with sender info, message snippet, confidence.
   - Send an in-app notification (and optionally email).
   - Show a badge in the inbox conversation list.

**How it works (AI v2, with LLM):**
1. Same trigger (new sender DM).
2. Classify with LLM: "Is this DM a brand collaboration inquiry, a fan
   message, spam, or a support request? Return JSON with label and confidence."
3. Higher accuracy, handles edge cases (e.g., a brand DMing without using
   the word "collab").

**Dependencies:** None for v1 (heuristics). v2 requires T2.3 (AI infrastructure).

**Effort:** v1: 1 week. v2: 1 additional week after T2.3.

**Our advantage:** LinkPlease's detector is a black box with a mock alert.
Ours would show the detection reason (keyword match, verified sender, etc.),
allow dismissing false positives, and track conversion (did the brand deal
happen?).

### 3.3 Shield dashboard (IG Shield equivalent)

**Status: ✅ Already implemented.** See `docs/SAFETY_ENGINE_ANALYSIS.md` for
the full comparison. Our "Shield" is the safety dashboard (`/dashboard/safety`)
which is transparent, measured, and free — vs LinkPlease's opaque, paid,
mockup-based IG Shield.

**Remaining polish (done):**
- ✅ Safety score on Overview
- ✅ Plain-English event explanations
- ✅ Weekly safety digest email
- ⬜ Meta Tech Provider badge application (business action)

---

## 4. Summary matrix

| Feature | LinkPlease | dmplease | Status | Plan |
|---|---|---|---|---|
| Comment Guard (AI moderation) | ✅ Super/Max (opaque) | ❌ Not built | T2.3 prerequisite | 2–3 weeks after T2.3 |
| Collab detector (brand deals) | ✅ Super/Max (opaque) | ❌ Not built | v1: heuristics (1 week); v2: AI (1 week after T2.3) | 1–2 weeks |
| IG Shield (AI protection) | ✅ Max (opaque, paid) | ✅ Built (transparent, free) | Complete | Done |
| Basic safety engine | ✅ Free | ✅ Free | Complete | Done |
| Safety score | ❌ None | ✅ Built | Complete | Done |
| Opt-out/STOP handling | ❌ None | ✅ Built | Complete | Done |
| Pre-launch validation | ❌ None | ✅ Built | Complete | Done |

## 5. Recommendation

1. **Comment Guard and Collab detector** both depend on T2.3 (AI infrastructure).
   Until then, build the Collab detector v1 using heuristics (no AI dependency)
   — it's a low-effort, high-emotional-impact feature.

2. **Comment Guard v1** can also be built without AI using a keyword/regex
   blocklist (spam patterns, competitor names, profanity). It won't be as
   accurate as LinkPlease's AI version, but it ships faster and is honest about
   being rule-based. Upgrade to AI classification when T2.3 lands.

3. **Shield dashboard** is already done and better than LinkPlease's. The
   remaining work is purely marketing (badge application, positioning).

4. **Priority order:** Collab detector v1 (1 week, no deps) → Comment Guard v1
   (1 week, no deps) → Comment Guard v2 / Collab v2 with AI (after T2.3).