# dmplease — Pricing & Plan Strategy (vs. Zorcha and LinkPlease)

> Research date: 2026-11-26. Companion docs: `ZORCHA_FEATURE_ANALYSIS.md`, `LINKPLEASE_FEATURE_ANALYSIS.md`, `PRODUCT_DEVELOPMENT_TIERS.md`.
> "Linkleys" is treated as **LinkPlease** (`linkplease.co`). All competitor figures below are taken from their public pricing pages as checked on this date.

---

## 1. Competitor pricing — exact numbers

### 1.1 Zorcha (per workspace; Monthly / Quarterly / Annual-per-month)

| Plan | USD monthly | USD quarterly | USD annual | INR monthly | INR quarterly | INR annual | AI credits/mo | Product-sale fee |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Free | $0 | $0 | $0 | ₹0 | ₹0 | ₹0 | 15K | **8%** |
| Pro | $14.99 | $11.99 | $9.99 | ₹1,199 | ₹899 | ₹799 | 150K (10×) | **5%** |
| Ultimate | $39.99 | $29.99 | $24.99 | ₹2,999 | ₹2,249 | ₹1,999 | 1.5M (100×) | **3%** |
| Business | $109.99 | $89.99 | $79.99 | ₹8,999 | ₹6,999 | ₹5,999 | 7.5M (500×) | **1%** |

Additional: Cashfree's 2% payment-processing fee is charged **separately** on top of the platform fee. AI credits are metered per response (length/complexity) and top-ups can be bought without changing plan.

**What each Zorcha tier actually gates:**
- **Free:** unlimited automations/DMs/contacts, Ask-for-Follow, basic queue + analytics, unlimited FAQs + history, unlimited contacts/exports + Meta/Google Ads sync, free Link-in-Bio (templates, links, social, buttons, media gallery, embeds, SEO), unlimited forms/submissions, all product types.
- **Pro:** Re-run, personalised DMs, DM variations, multi-message, collect phone/email, follow-ups, **Basic Flow Builder**, advanced queue, short-link rotation, advanced analytics, FAQ generator, unlimited segments, dynamic QRs, password lock, Instagram grid, email verification, 5% fee.
- **Ultimate:** **Advanced Flow Builder**, advanced integrations, template builder (soon), unlimited broadcasts, unlimited bio pages + personal branding, protected forms, 3% fee.
- **Business:** AI Conversation (unlimited data sources + knowledge base), 1% fee, sales-assisted onboarding.

### 1.2 LinkPlease (INR-first, per Instagram account; USD shown on comparison pages)

| Plan | INR monthly | INR annual | USD (comparison pages) | AI credits/mo | Platform fee |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Free | ₹0 | ₹0 | $0 | 0 | none stated |
| Pro | ₹399 | ₹4,788/yr (~₹399/mo, save 20%) | $14.99 | 0 | none stated |
| Super | ₹799 | ₹9,590/yr (save 20%) | — | 10K | none stated |
| Max *(most popular)* | ₹899 | ₹10,788/yr (save 25%) | — | 10K | none stated |
| Enterprise | Custom | — | — | — | — |

**What each LinkPlease tier actually gates:**
- **Free:** unlimited automations, **1,000 DMs/mo, 1,000 contacts**, Comment/Share/DM/Story/Live automation, smart queue + viral-spike protection, Ask-for-Follow, Re-trigger, lead collection.
- **Pro:** unlimited DMs/automations/contacts, all triggers, analytics, email support.
- **Super:** AI message rotation, Collab DMs (brand-deal detector), Comment Guard (AI moderation), 10K AI credits.
- **Max:** IG Shield (AI account protection), priority WhatsApp **support** (not WhatsApp automation).
- **Enterprise:** multiple accounts, dedicated account manager, custom solutions, early access.

Note: LinkPlease's Digital Products are showcased on the homepage but are **not listed in any plan** — treat as unclear/unavailable. No refunds for the current period. GST may apply.

### 1.3 Market reference points (for positioning)

| Tool | Entry paid | Billing model | Notable |
| :--- | ---: | :--- | :--- |
| ManyChat | $17–39/mo | Per active contact + overage | 25 free contacts; 7 channels; flow builder |
| LinkDM | $19/mo | Flat + 25,000 DM cap | 1,000 DMs free |
| ReplyRush | ₹900 / $10/mo | Flat + DM cap | — |
| CreatorFlow | $12–15/mo | Flat + DM cap | 500 DMs free |
| LinktoDM | ₹699/mo | Flat INR | 2,000 DMs, 2 accounts, 2 team members free |
| InstantDM | $9.99/mo | Flat | — |

**Key market insight:** the market splits into (a) **per-contact** (ManyChat), (b) **DM-capped** (LinkDM, ReplyRush, CreatorFlow, LinkPlease Free), (c) **flat unlimited + transaction fee** (Zorcha), and (d) **flat unlimited no fee** (LinkPlease paid). The winning message for dmplease is **(d) plus measured analytics, AI included, and no scary permissions**.

---

## 2. Pricing principles for dmplease

1. **One price per workspace, not per contact and not per account.** LinkPlease bills per Instagram account; Zorcha bills per workspace; ManyChat punishes audience growth with per-contact billing. We include multiple accounts at every paid tier — "your bill never grows because your audience did."
2. **Unlimited core usage on Free.** Zorcha already sets this expectation; LinkPlease's 1,000-DM cap is its biggest weakness. Match Zorcha's unlimited and beat LinkPlease outright.
3. **Zero platform fee on sales, on every plan.** Zorcha charges 8% → 1% + 2% gateway. This is the single clearest "serve better" number we can advertise. We pass through only payment-gateway cost.
4. **Bundle AI into the value tiers.** Zorcha gives 15K credits free and gates the generator/knowledge base; LinkPlease splits AI into separate ₹799/₹899 plans. We include AI FAQ + Comment Guard + Collab detector + variants in **Creator**, so the user never needs a second "AI plan."
5. **Never meter what we already have.** Your Tier 1 shipped real Insights conversion rate, tracked clicks, honest safety events, shareable reports and multi-account. Those are differentiators — include them broadly, especially on Free (shareable reports drive virality).
6. **Honest limits only.** "Unlimited" is always qualified by Meta's sending rules; show real queue depth, real delivery rate, no fabricated numbers. This is a brand position, not just a compliance note.
7. **Transparent credits + top-ups.** Publish exact credit allowances and a fixed top-up price; no per-message surprise billing.
8. **Refund-friendly.** LinkPlease has "no refunds for the current period"; offer a **14-day money-back guarantee** on annual plans as a trust differentiator.

---

## 3. Recommended plan architecture

**Decision: 4 self-serve plans + 1 custom Enterprise = 5 offers, but only 4 public price points.**
Do **not** copy LinkPlease's Super/Max AI split — it creates choice friction and makes users feel AI is an upsell. Do **not** copy Zorcha's 4-tier + separate AI credits + sales-assisted Business, which hides the real price.

| # | Plan | India (monthly) | International (monthly) | Target buyer |
| :--- | :--- | ---: | ---: | :--- |
| 1 | **Free** | ₹0 forever | $0 forever | New creators testing comment-to-DM |
| 2 | **Creator** | ₹499 | $9 | Solo creators, coaches, small shops |
| 3 | **Growth** | ₹1,499 | $29 | Serious creators, D2C brands, small agencies |
| 4 | **Scale** | ₹2,999 | $59 | Agencies, multi-brand, commerce-heavy |
| 5 | **Enterprise** | Custom | Custom | Large agencies / platforms |

### 3.1 India pricing (INR, per workspace, GST extra, UPI + card)

| Plan | Monthly | Quarterly (per mo) | Annual (per mo) | Annual total |
| :--- | ---: | ---: | ---: | ---: |
| Free | ₹0 | ₹0 | ₹0 | ₹0 |
| Creator | ₹499 | ₹449 | **₹399** | ₹4,788 |
| Growth | ₹1,499 | ₹1,299 | **₹1,199** | ₹14,388 |
| Scale | ₹2,999 | ₹2,499 | **₹2,299** | ₹27,588 |
| Enterprise | Custom | — | — | — |

### 3.2 International pricing (USD, per workspace, Stripe)

| Plan | Monthly | Quarterly (per mo) | Annual (per mo) | Annual total |
| :--- | ---: | ---: | ---: | ---: |
| Free | $0 | $0 | $0 | $0 |
| Creator | $9 | $8 | **$7** | $84 |
| Growth | $29 | $25 | **$22** | $264 |
| Scale | $59 | $49 | **$42** | $504 |
| Enterprise | Custom | — | — | — |

### 3.3 Price-vs-competitor sanity check

| Our plan | vs. Zorcha | vs. LinkPlease | Story to tell |
| :--- | :--- | :--- | :--- |
| Creator ₹499 / $9 | Zorcha Pro ₹1,199 / $14.99 → **58% / 40% cheaper** | LinkPlease Pro ₹399 + Super ₹799 + Max ₹899 = **₹2,097/mo of features** → we bundle all at ₹499 | *"One plan, not three AI upsells"* |
| Growth ₹1,499 / $29 | Zorcha Ultimate ₹2,999 / $39.99 → **50% / 27% cheaper** | LinkPlease has no equivalent (no builder, no multi-account, no Insights) | *"Advanced flows + real analytics + 3 accounts"* |
| Scale ₹2,999 / $59 | Zorcha Business ₹8,999 / $109.99 → **67% / 46% cheaper** | LinkPlease Max ₹899 (and its WhatsApp is only support) | *"Everything + WhatsApp + 0% sales fee"* |

---

## 4. Feature allocation by plan (the "what you get" table)

### 4.1 Free — ₹0 / $0

| Area | Included |
| :--- | :--- |
| Accounts | 1 Instagram account + 1 Facebook Page |
| Automations | **Unlimited automations, unlimited DMs** (Meta sending limits apply — stated honestly) |
| Triggers | Comment-to-DM, DM keyword / Respond-to-all-DMs, Story reply + reaction, Story mention, **Share-to-DM**, **IG Live**, Re-trigger (last 7 days) |
| Gating | Ask-for-Follow with real verification, opening-message opt-in, postback/button routing |
| Messages | Public reply rotation, non-AI DM variants, personalised variables, tracked short links, multi-link DMs |
| Lead capture | Unlimited contacts, forms inside DM (email/phone/name/custom), **CSV export**, tags |
| Safety | Smart queue, per-account rate caps, jitter, viral-spike throttle, pre-launch loop/duplicate/spam checks, reply-once guard — with a **live honest safety dashboard** |
| Analytics | **Real** DMs sent, delivery rate, opt-ins, link clicks, 7-day trend, keyword breakdown, **shareable revocable public report** |
| AI | **Unlimited AI FAQs + 25,000 credits/mo** (beats Zorcha Free's 15K), conversation history, built-in tester, fallback, intent-based + multilingual replies |
| Link-in-Bio | Unlimited links, templates, social links, buttons, media gallery, embeds, SEO metadata |
| Support | Email + community, guided 4-step onboarding |
| Fees | **0% platform fee** on any sales; no ads permission required at signup |

> Free alone already beats Zorcha Free (more AI credits, shareable reports, no sales fee) and LinkPlease Free (no 1,000-DM cap, AI included).

### 4.2 Creator — ₹499 / $9

Everything in Free, plus:

| Area | Added |
| :--- | :--- |
| AI | AI FAQ Generator, **AI message-variant generator**, **Comment Guard** (auto-hide spam/hate/competitor promos), **Collab/brand-deal detector**, persona/tone/length/emoji controls, learns-from-inbox — i.e. LinkPlease Super + Max bundled |
| AI credits | **200,000/mo** (Zorcha Pro gives 150K) |
| Flows | **Basic Flow Builder**: visual canvas, templates, text/image/card/delay/condition/collect-info/tag steps, preview + test before go-live |
| Messaging | Multi-message DMs (text/PDF/audio/image/card/carousel), follow-up sequences, reply-once-per-person, skip comment-thread replies |
| Analytics | **Meta Insights integration**: true conversion rate = DMs ÷ impressions, 30/90-day comparisons, per-campaign breakdown |
| Link-in-Bio | Dynamic QR codes, password lock, Instagram grid, basic bio analytics |
| Safety | Advanced send-speed controls, dedicated queue visibility |
| Accounts | 2 Instagram accounts + 2 Facebook Pages |
| Support | Priority email (human reply target published) |

### 4.3 Growth — ₹1,499 / $29

Everything in Creator, plus:

| Area | Added |
| :--- | :--- |
| Flows | **Advanced Flow Builder**: all 8 triggers (comment, DM keyword, story reply, ad reply, form submit, contact created, tag added/removed), Randomize A/B/C/D, Smart Delay, HTTP request/webhooks, Google Sheets, per-step analytics, template builder |
| Accounts | **3 Instagram accounts + 3 Facebook Pages** (LinkPlease charges per account; we don't) |
| Team | 3 seats with OWNER / ADMIN / MEMBER roles + audit log |
| Audience | Unlimited segments, **unlimited broadcasts**, advanced integrations |
| Commerce (basics) | Product pages, free/paid, file delivery up to 50 MB, UPI/card/Stripe checkout, buyers + revenue dashboard, discount codes, receipt emails — **0% platform fee** (gateway fees only) |
| WhatsApp | **1 WhatsApp Business number** via Embedded Signup, service-window replies, template manager |
| Integrations | **Public API + MCP server** (list/create/edit/duplicate automations from ChatGPT/Claude/Cursor), webhooks, Google Sheets |
| Forms | Email verification, form-submit trigger |
| AI credits | **750,000/mo** |
| Support | Priority support + free migration help from Zorcha / LinkPlease / ManyChat |

### 4.4 Scale — ₹2,999 / $59

Everything in Growth, plus:

| Area | Added |
| :--- | :--- |
| Accounts & team | **Unlimited** Instagram accounts and Facebook Pages, unlimited team seats, custom roles, SSO-ready |
| Commerce (full) | Bookings (1:1 video sessions), Webinars, Events, Coffee/tips, Bundles, Courses + Challenges, storefront/Shop page with categories + search + sorting, upsells (up to 6), refund terms, up to 10 checkout questions, sold-out limits, custom domain, **0% platform fee on every product type** |
| WhatsApp | 3 numbers, full template manager, quality-tier tracking, cross-channel inbox (IG + FB + WhatsApp), IG-DM → WhatsApp hand-off with referral params |
| AI | Knowledge base / unlimited data sources (Zorcha Business tier), **2,000,000 credits/mo** |
| Reporting | White-label shareable reports, scheduled report emails, custom dashboards |
| Support | Dedicated onboarding + priority support, SLA target published |

### 4.5 Enterprise — Custom

Unlimited accounts/team/credits, custom WhatsApp limits, SLA, dedicated account manager, SSO/SAML, data-residency options, white-label platform, custom contracts, partner/agency multi-tenant controls.

---

## 5. Add-ons & metering (revenue beyond subscriptions)

| Add-on | Price | Rationale |
| :--- | :--- | :--- |
| AI credit top-up | India ₹199 / 100K credits; Intl $3 / 100K | Zorcha sells credits but publishes no fixed price — clarity wins |
| Extra WhatsApp number | ₹499 / $8 per number per month, plus Meta conversation fees passed through | Meta fees are external; never hide them |
| Custom domain for bio/store | Included in Scale; ₹499 / $8 per domain on lower plans | Zorcha gates multiple pages to Ultimate; we include at Scale |
| Onboarding / migration package | Free on annual Growth+, otherwise ₹2,499 / $49 one-time | Converts switchers from Zorcha/LinkPlease/ManyChat |
| 14-day annual refund | Policy, not price | LinkPlease explicitly has no refunds — differentiator |

---

## 6. Billing mechanics & policies

- **Billing unit:** per workspace (not per contact, not per Instagram account). Free = 1 account; Creator = 2; Growth = 3; Scale/Enterprise = unlimited.
- **Cycles:** monthly, quarterly, annual with the discounts above; annual billed once; upgrade anytime, prorated.
- **India:** UPI + card via Razorpay/Cashfree, GST invoice automatically downloadable, INR display by default with country detection.
- **International:** Stripe, USD display, local tax handling, VAT invoice.
- **"Unlimited" honesty:** all plans display "subject to Meta's messaging rules and sending limits; our queue paces delivery instead of cutting you off."
- **No overage billing.** If a limit is reached (AI credits, accounts), we notify and degrade gracefully — never silently charge.
- **No platform fee on customer sales**, ever. Gateway fees are shown transparently at checkout.
- **Free migration:** recreate triggers from Zorcha/LinkPlease/ManyChat with support help — mirrors LinkPlease's most effective switching argument.

---

## 7. Launch sequencing (what to sell now vs. later)

Your current code has Tier 0/1 shipped; Flow Builder, AI, commerce and WhatsApp are not built yet. Sell only what exists, but publish the full roadmap-backed pricing page.

| Phase | Sell | Gate honestly |
| :--- | :--- | :--- |
| **Now (Tier 1)** | Free + Creator at the prices above, but label advanced items "coming soon" and don't charge for them yet | Free: all shipped triggers, safety, real analytics, contacts, reports. Creator: add AI FAQ + Comment Guard + Collab detector as soon as T2.3 lands |
| **+30–60 days** | Enable Growth when Flow Builder (T2.1–T2.2), team roles (T2.5), billing (T2.6) and MCP (T2.8) ship | Keep price locked at ₹1,499 / $29 |
| **+60–90 days** | Enable Scale when commerce (T3.5) and WhatsApp (T3.2) ship | Keep price locked at ₹2,999 / $59 |
| **Later** | Enterprise once Meta Tech Provider (T3.3) and SSO land | Custom quote |

**Do not ship a paid tier with a feature that doesn't exist.** Your own `PRODUCT_DEVELOPMENT_TIERS.md` explicitly forbids fabricated metrics — extend that rule to pricing.

---

## 8. Metrics to validate the pricing

| Metric | Target | Why |
| :--- | ---: | :--- |
| Free → paid conversion | 5–8% within 90 days | LinkPlease's 1,000-DM cap forces conversion; ours relies on value — track it closely |
| Creator share of paid | > 60% | The ₹499/$9 tier is the volume engine |
| Annual plan share | > 35% | Improves cash and retention |
| Churn at cap moment | < 5% | Watch what happens when AI credits or account limits are hit |
| ARPA | ₹600–900 / $8–12 blended | Confirms the mix is healthy |
| Migration-led signups | > 20% of new paid | Comparison pages + free migration should show up here |
| Refund rate | < 3% | Validates the 14-day guarantee isn't being abused |

Run a **₹299 / $5 "Founding Creator" lifetime price** for the first 200 annual signups to seed revenue and testimonials — grandfathered forever, then close it. This creates urgency without devaluing the main tiers.

---

## 9. Caveats

- Competitor prices were checked on 2026-11-26 and can change; Zorcha's comparison posts themselves use outdated competitor figures — don't copy those.
- Zorcha's AI credit consumption depends on message length/complexity, so "15K credits" is not directly comparable to a fixed reply count.
- "0% platform fee" means we absorb no gateway cost; advertise it as *"no dmplease platform fee — only your payment gateway's standard fee,"* not as "zero fees."
- "Unlimited DMs" is always bounded by Meta's policies; say so on the pricing page.
- Meta WhatsApp conversation fees are external and must be passed through transparently.
- Final prices should be A/B tested; the numbers above are a defensible starting point, not gospel.

---

## 10. One-line recommendation

**Launch 4 self-serve plans + Enterprise: Free ₹0/$0 (unlimited core + more AI than Zorcha's free), Creator ₹499/$9 (bundles everything LinkPlease sells at ₹2,097/mo, plus real analytics), Growth ₹1,499/$29 (advanced flows, 3 accounts, team, MCP, 1 WhatsApp, 0% sales fee), Scale ₹2,999/$59 (unlimited accounts, full commerce + WhatsApp, 0% fee), Enterprise custom — priced 40–67% below Zorcha and positioned as the only plan family with no platform fee, no contact billing, no DM cap and no fake metrics.**
