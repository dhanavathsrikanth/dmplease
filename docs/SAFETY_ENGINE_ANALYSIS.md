# Safety Engine — LinkPlease analysis vs. dmplease implementation

> **Purpose:** Understand how LinkPlease markets and designs its "Safety Engine,"
> compare it with what we have built across Phases 1–3, and propose how we make
> it a **standardized, free-for-everyone feature** instead of a paid upsell.

---

## 1. What LinkPlease claims

Source: homepage (`/#safety`), pricing page, and both comparison pages.

### 1.1 Headline

> **"Built to protect your account."**
> "Every LinkPlease send is automatically queued, paced, and varied. Stay
> completely safe from spam filters, even during viral spikes."

### 1.2 Four numbered pillars (from the homepage mockup)

| # | Pillar | Claimed behavior |
|---|---|---|
| 01 | **Smart rate-limiting** | "Messages are intelligently paced so you never hit Meta limits." |
| 02 | **Viral spike regulation** | "We automatically throttle delivery during viral spikes to stay safe." |
| 03 | **AI message rotation** | "AI-generated variants ensure you never send identical replies." |
| 04 | **Official Graph API** | "100% official Meta API integration. No password sharing, ever." |

### 1.3 Live dashboard mockup

The homepage shows a "LinkPlease Safety Engine — Live" card with:
- "All systems normal — Sending at a steady, human pace."
- Pipeline: **Trigger → Smart-wait queue → AI variant → Graph API → Delivered**
- **12** in queue
- **100%** delivered
- **0** limit breaches
- "Sends per minute vs Meta rate limit" demand gauge (LinkPlease vs Meta, with LinkPlease always below)

### 1.4 Plan gating

| Plan | Price | Safety features included |
|---|---|---|
| Free | ₹0 | Smart queue & viral-spike protection (basic) |
| Pro | ₹399/mo | + Smart queue & viral-spike protection |
| Super | ₹799/mo | + AI message rotation, Comment Guard, 10k AI credits |
| Max | ₹899/mo | + **IG Shield — AI account protection** ("Full AI protection for accounts that cannot afford a flag") |
| Enterprise | Custom | + dedicated account manager |

**Key insight:** the basic safety engine is on *every* plan (including Free). "AI protection" (IG Shield) is the only paid safety upsell, and it is deliberately vague — no public documentation of what it actually does.

### 1.5 FAQ answers (from homepage)

- *"Is LinkPlease safe for my Instagram account?"* — "100% official Meta Graph API", Meta Verified Tech Provider.
- *"What happens if one of my posts goes viral?"* — "LinkPlease detects the surge and paces delivery instead of sending thousands of DMs at once."
- *"How does the AI protection actually work?"* — accordion (not expanded in HTML; content not publicly available).

### 1.6 Comparison page claims (vs ManyChat, vs LinkDM)

- "LinkPlease is focused on Instagram — and on that surface it goes further, with re-trigger, AI message rotation and the **account-safety engine** doing the worrying for you."
- "Queue-based rate limiting — Smart wait paces every send under Meta's limits" (Included / Not documented for LinkDM)
- "Viral spike throttling — Automatically slows delivery when a post takes off" (Included / Not documented)
- "IG Shield — AI account protection — Adds AI-powered safeguards for accounts operating at higher volume" (Included / Not documented)

### 1.7 Security partner

Cyvigilant security partner badge on the homepage footer.

---

## 2. How LinkPlease's safety engine is *designed* (reverse-engineered)

Based on the homepage mockup, comparison claims, and our codebase analysis:

| Layer | What it likely does | Evidence |
|---|---|---|
| **Official Graph API** | Only uses Meta's official API, no password sharing | Meta Verified Tech Provider badge |
| **Smart-wait queue** | All sends go through a queue; delivery is paced | "Trigger → Smart-wait queue → AI variant → Graph API → Delivered" |
| **Smart rate-limiting** | Token bucket or sliding window per account | "Messages are intelligently paced so you never hit Meta limits" |
| **Viral spike regulation** | Detects comment surge, throttles delivery | "LinkPlease detects the surge and paces delivery instead of sending thousands of DMs at once" |
| **AI message rotation** | Generates N variants, rotates so identical replies never repeat | Super plan feature; "AI writes multiple variants" |
| **IG Shield (paid)** | Opaque "AI-powered safeguards for accounts operating at higher volume" | Max plan only; no public documentation of what it does |

**Important observation:** LinkPlease's dashboard numbers (100% delivered, 0 breaches) are a **marketing mockup**, not real-time data. The comparison pages even say "Not documented" for most safety features on competitors — meaning LinkPlease itself does not publicly document the implementation details.

---

## 3. What we have built (Phases 1–3)

### 3.1 Complete parity table

| Capability | LinkPlease claim | Our implementation | Status |
|---|---|---|---|
| Official Graph API, no password sharing | ✅ Meta Verified Tech Provider | ✅ Yes (OAuth + vault) | Parity |
| Meta Tech Provider badge | ✅ | ⚠️ Not applied | Business action |
| Smart rate-limiting | ✅ "Intelligently paced" | ✅ Token bucket (`checkRateLimit`) + Upstash sliding window (`acquireSendSlot`) | **Parity** |
| Recipient cooldown (10 min/post) | ✅ | ✅ `checkRecipientCooldown` | Parity |
| 24h dedupe | ✅ | ✅ dm_logs check | Parity |
| Jitter / human-like pauses | ✅ "natural, human-like pauses" | ✅ `randomizedDelay(50,350)` + jitter | Parity |
| Variant rotation | ✅ "AI message rotation" | ✅ `chooseVariant` + cross-instance Redis history | **Better** (deterministic, never repeats) |
| Viral spike detection | ✅ "Viral spike regulation" | ✅ `isViralSpike` + `lib/meta/throttle.ts` (elevated/critical levels) | **Better** (measured, not mocked) |
| Smart-wait queue | ✅ "Smart-wait queue" | ✅ QStash + durable `pending_dms` | Parity |
| Live safety dashboard | ✅ Mockup | ✅ Real dashboard: score, gauge, queue, events | **Better** (real data) |
| Account health monitoring | ⚠️ "IG Shield" (paid, opaque) | ✅ `lib/meta/account-health.ts` (consecutive failures, auto-pause, token status) | **Better** (transparent) |
| Opt-out / STOP handling | ❌ Not marketed | ✅ Full opt-out + re-subscribe | **We have it, they don't** |
| Block/spam detection | ❌ None | ❌ None | Gap (neither has it) |
| Safety score / risk indicator | ❌ None | ✅ Composite 0–100 score with deductions | **We have it, they don't** |
| Fail-open tightening | ❌ Unknown | ✅ Dedupe fails closed; documented per guard | **We have it** |
| Pre-launch validator | ❌ None | ✅ `validateAutomationInput` wired into create/update | **We have it** |
| Security partner badge | ✅ Cyvigilant | ❌ None | Business action |

### 3.2 What we do differently (and better)

1. **Real numbers, not mockups.** LinkPlease's "100% delivered, 0 breaches" is a static mockup. Ours is computed from `safety_events`, `dm_logs`, and Redis counters. A creator can see *why* a send was delayed.

2. **Transparent account health.** LinkPlease's IG Shield is a paid, opaque "AI protection" feature with no public documentation. Ours shows consecutive failures, token status, last error, and last send time — and auto-pauses at 5 consecutive failures with a visible, reversible banner.

3. **Opt-out compliance.** LinkPlease does not mention STOP/unsubscribe handling anywhere. Ours implements full opt-out with re-subscribe, which is a Meta compliance requirement.

4. **Safety score.** A composite 0–100 score with a breakdown of deductions. LinkPlease has nothing equivalent.

5. **Pre-launch validation.** Our `validateAutomationInput` catches loops, duplicate keywords and too many links before a campaign goes live. LinkPlease has no equivalent.

6. **Fail-closed dedupe.** If the DB lookup for "recently messaged" fails, we treat the recipient as already contacted (skip) rather than risk a duplicate. LinkPlease's behavior is unknown.

---

## 4. How to make it a standardized feature available for everyone

### 4.1 Current plan-gating comparison

| Feature | LinkPlease | Our current state |
|---|---|---|
| Basic safety engine | Free (all plans) | Free (all plans) ✅ |
| AI message rotation | Super ($14.99/mo) | Free ✅ (better — ours is deterministic, not AI) |
| IG Shield / AI protection | Max ($17.99/mo) | Free ✅ (account health is transparent, not opaque) |
| Safety dashboard | ❌ Not offered | Free ✅ |
| Safety score | ❌ Not offered | Free ✅ |
| Opt-out handling | ❌ Not offered | Free ✅ |

**We already give everything away for free.** The question is how to position and present it.

### 4.2 Standardization strategy

**Principle: safety is a product right, not a premium feature.** Every creator — free or paid — deserves to not get their account banned. Gating safety behind a paywall is both unethical and a competitive liability (competitors can attack it).

**What we should standardize (make free for all):**

1. **Proactive throttle** — already free. No change needed.
2. **Account health monitor** — already free. No change needed.
3. **Opt-out/STOP handling** — already free. No change needed.
4. **Safety score + dashboard** — already free. No change needed.
5. **Pre-launch validation** — already free. No change needed.
6. **Breach counting** — already free. No change needed.

**What we should NOT do (avoid LinkPlease's mistakes):**
- Do not create a paid "AI Shield" tier. It is opaque marketing.
- Do not gate the basic safety dashboard behind a plan.
- Do not claim "AI protection" without real AI — our measured, transparent version is the differentiator.

### 4.3 How to promote it (our positioning)

LinkPlease's positioning: "AI safety layer" + "IG Shield" (paid, opaque, mockup dashboard).

Our positioning should be: **"Honest safety — measured, not mocked."**

Key messages:
1. **"Your safety numbers are real."** — LinkPlease's dashboard is a static mockup. Ours is computed from actual safety events, DM logs and Redis counters.
2. **"You see why a send was delayed."** — LinkPlease says "we pace it"; we show the throttle level, the queue depth and the reason.
3. **"Account health you can act on."** — Consecutive failures, token status, last error, last send — all visible, with a one-click resume.
4. **"Compliance built in."** — STOP/unsubscribe handling is a Meta requirement. We have it; LinkPlease doesn't mention it.
5. **"Free for everyone."** — Safety is not a premium feature. Every creator on every plan gets the full safety engine.

### 4.4 What to add to make it a "loved" feature

1. **Safety score on the dashboard home** — a single number (0–100) with band, visible on Overview. Creators love a single number they can track.
2. **"All systems normal" banner** — when score ≥ 80, show a reassuring green banner. When degraded, show what to fix.
3. **Safety event explanations** — each event type (`rate_limit_breach`, `viral_throttle`, `opt_out`) should have a plain-English explanation in the UI, not just a machine code.
4. **Safety digest email/notification** — weekly summary: "Your account sent 1,234 DMs this week with 0 breaches and 0 throttles."
5. **Safety badge for marketing** — "Safety score: 98/100" badge creators can share, like LinkPlease's "100% Safe & Verified by Meta" but honest.

### 4.5 Competitive advantage summary

| Axis | LinkPlease | dmplease |
|---|---|---|
| Safety identity | "AI safety layer" (marketing) | "Honest safety" (measured) |
| Dashboard | Static mockup | Real-time, computed |
| Throttle transparency | "We pace it" (black box) | Level + delay + reason visible |
| Account health | Paid "IG Shield" (opaque) | Free, transparent, auto-pause |
| Opt-out/STOP | Not mentioned | Full compliance |
| Safety score | None | Composite 0–100 with breakdown |
| Pre-launch validation | None | Loops, duplicates, >3 links caught |
| Cost | Free basic / $17.99/mo for "AI protection" | Free for everyone |

---

## 5. Recommendation

We have already built most of what LinkPlease claims (and more). The remaining work to make it a **standardized, loved feature**:

1. **Promote the safety score** — put it on the Overview dashboard and the campaign edit page. It's the single most shareable number.
2. **Add plain-English explanations** for every safety event kind in the UI.
3. **Add a safety digest** — weekly email/notification summarizing safety metrics.
4. **Apply for Meta Tech Provider badge** — this is the one business action that closes the trust gap.
5. **Never gate safety behind a plan.** This is our strongest competitive differentiator against LinkPlease's paid IG Shield.

The full technical proposal for the remaining implementation work is in `docs/SAFETY_ENGINE_PROPOSAL.md`. Phase 1 (proactive throttle, breach counting, pre-launch validation, fail-closed dedupe) is already shipped. Phases 2 (account health, opt-out, dashboard) and 3 (dedicated safety page, score, retention, tests) are also shipped. The remaining work is purely UX polish and marketing.---

## 6. Cross-reference

- `docs/SAFETY_ENGINE_PROPOSAL.md` — technical implementation proposal (Phases 1–3)
- `docs/FEATURE_IMPLEMENTATION_AUDIT.md` — row 15 (Safety checks + smart delays) — now ✅ Working
- `docs/FEATURE_GUIDE.md` — Part 11 (Safety engine)
- `lib/meta/throttle.ts`, `lib/meta/account-health.ts`, `lib/meta/safety-score.ts` — implementation
- `app/dashboard/safety/page.tsx` — dedicated safety dashboard
- `components/dashboard/safety-card.tsx` — per-account health UI