# dmplease — Feature Inventory, Competitor Comparison & UI Test Guide

> **Snapshot:** 2026-11-28 · branch `main` @ `cbe759d` · Next.js 16.4.6
> **Automated suite:** 101 files / 627 tests → **625 pass, 2 fail** (date-brittle, see §7)
> **Competitor data:** public pricing/feature pages for Zorcha (`zorcha.com/pricing`) and LinkPlease (`linkplease.co`, `/pricing`), read 2026-11-28.

---

## 1. How many features do we have?

**60 shipped capabilities, grouped into 8 families.** Every one below is reachable from the dashboard UI unless marked *backend-only*.

| # | Family | Capabilities | What it covers |
|---|---|---|---|
| 1 | Accounts & onboarding | 6 | Auth, Instagram OAuth, bulk connect, wizard, workspaces, token vault |
| 2 | Triggers | 8 | Comments, posts, shares, stories, inbox keywords, fallback, buttons |
| 3 | Message composition | 11 | Opening DM, follow gate, variables, vouchers, variants, 6 formats, buttons, public replies, lead capture, follow-ups, preview |
| 4 | Delivery & safety | 9 | Queue, caps, jitter, viral throttle, health, score, opt-out, screening, digest |
| 5 | Links & attribution | 5 | Short links, rotation, click ledger, UTMs, conversion ingest |
| 6 | Analytics | 10 | KPIs, Wins & Fixes, keyword/share/gate/follow-up reports, heatmap, Insights, saved views, public report |
| 7 | Audience | 4 | Contacts CRM, contact detail, CSV export, inbox |
| 8 | Operations | 7 | Re-run, activity log, diagnostics, admin alerts, DLQ, webhook ledger, timezone |
| | **Total** | **60** | |

For context: the original internal audit tracked **26 capabilities**; the product has roughly doubled since then (analytics rewrite, share-to-DM, postback routing, lead capture, public reports, auth hardening, ops tooling).

---

## 2. Full feature inventory

Status legend: **✅ shipped & UI-reachable** · **🔒 admin-only** · **⚙️ env-gated** · **🔌 backend-only**

### Family 1 — Accounts & onboarding (6)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 1 | Email/password auth: sign-up, email verification, login, forgot/reset, change password, optional Turnstile CAPTCHA | `/auth/sign-up`, `/auth/login`, `/auth/forgot-password`, `/auth/update-password`, Settings → Password | ✅ ⚙️ |
| 2 | Instagram OAuth connect (Meta Graph, 60-day token) | Settings → Instagram Professional Account → Connect | ✅ |
| 3 | Multi-account bulk connect with selection checklist | `/onboarding?pending=…`, Settings → pending selection | ✅ |
| 4 | Onboarding wizard (channel → profile → goal → attribution → done) | `/onboarding` | ✅ |
| 5 | Multi-workspace switcher (one workspace per connected account) | Sidebar footer | ✅ |
| 6 | Token vault (AES-256-GCM) + 15-day proactive refresh cron | Settings (status), `/api/cron/refresh-tokens` | ✅ 🔌 |

### Family 2 — Triggers (8)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 7 | Comment-to-DM keyword automation | Campaigns → New Campaign → Step 1/3 | ✅ |
| 8 | Post scope: Any Post/Reel · Specific Reel · Next Post | Campaign builder → Step 2 | ✅ |
| 9 | Next-Post auto reel permalink (`{permalink}` sentinel) | Campaign builder → Step 2 + button URL | ✅ |
| 10 | Share-to-DM (someone shares your post into your DM) | Campaign builder → Step 1 → Share to DM | ✅ |
| 11 | Story-to-DM: story reply, mention, reaction, reaction to your DM | `/dashboard/story-automations` | ✅ |
| 12 | Inbox keyword auto-replies with priority + catch-all | `/dashboard/inbox-automations` → Your rules | ✅ |
| 13 | "Respond to all DMs" account-level fallback | Settings → Respond to all DMs | ✅ |
| 14 | Button/postback routing (tag · send message · schedule follow-up) | `/dashboard/inbox-automations` → Button actions | ✅ |

### Family 3 — Message composition (11)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 15 | Opening DM copy (the "follow me first" message) | Campaign builder → Ask for Follow | ✅ |
| 16 | Ask-for-Follow gate with real Meta verification + hold/deliver policy | Campaign builder → Ask for Follow; rules; fallback | ✅ |
| 17 | Personalisation variables: `{username}` `{name}` `{email}` `{phone}` `{keyword}` `{link}` `{voucher}` `{voucher_url}` | Variable picker chips in every message field | ✅ |
| 18 | Unique per-person vouchers (HMAC-stable codes + tracked URL) | Variable picker → `{voucher}` / `{voucher_url}` | ✅ |
| 19 | DM variations (up to 10, no consecutive repeats, cross-instance history) | Campaign builder → DM variations | ✅ |
| 20 | Six message formats: text, audio, PDF, image/video, card, carousel (Cloudflare R2) | Campaign builder → Message format | ✅ ⚙️ |
| 21 | Action button CTA (title + URL, auto reel link supported) | Campaign builder → Interactive Action Button | ✅ |
| 22 | Public comment replies (up to 10 variants, ≥3 defaults, rotation) | Campaign builder → Public comment reply | ✅ |
| 23 | Lead capture: name / email / phone / custom property, retry/skip copy, max attempts | Campaign builder → Collect info | ✅ |
| 24 | 24h follow-up sequences: up to 3 steps, 60 min–7 days, holdout % | Campaign edit → Follow-ups tab | ✅ |
| 25 | Live Instagram-style phone preview using the production formatter | Campaign builder right column | ✅ |

### Family 4 — Delivery & safety (9)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 26 | Durable DM queue: backoff 5→60 min, 5 attempts, manual "Drain now" | `/dashboard/safety`, `/dashboard/overview` | ✅ |
| 27 | Hourly cap + recipient cooldown + 24h dedupe | Campaign builder → Safety & delivery | ✅ |
| 28 | Randomized pre-send delay (jitter) | Campaign builder → Safety & delivery | ✅ |
| 29 | Viral-spike throttle (elevated at 25+/min, critical at 100+/min) | `/dashboard/safety` | ✅ |
| 30 | Account health monitor + auto-pause after 5 consecutive failures | `/dashboard/safety` → Account safety | ✅ |
| 31 | Safety score 0–100 with deductions and plain-English events | `/dashboard/safety` | ✅ |
| 32 | Opt-out / STOP handling + resubscribe | Automatic; events on Safety page | ✅ |
| 33 | Campaign spam screening (char floods, all-caps, duplicate variants, >3 links, loops) | Campaign builder save validation | ✅ |
| 34 | Weekly safety digest email (Mondays 09:00) | `/api/cron/safety-digest` | ✅ ⚙️ 🔌 |

### Family 5 — Links & attribution (5)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 35 | Smart short links (`/go/{8-char}`) | Campaign builder → Smart tracked links | ✅ |
| 36 | Link rotation: sticky per person or round-robin, up to 10 destinations | Campaign builder → Smart tracked links | ✅ |
| 37 | Click tracking with bot flag, idempotent event id, Redis-buffered flush | Campaign edit → Links tab | ✅ |
| 38 | UTM auto-tagging (`utm_source=dmplease`, `utm_medium=instagram_dm`, `utm_campaign=…`) | Automatic on every DM link | ✅ |
| 39 | Conversion ingest API + revenue attribution | Settings → Revenue attribution (token) | ✅ 🔌 |

### Family 6 — Analytics (10)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 40 | Overview KPIs + 6-step conversion funnel | `/dashboard/overview` | ✅ |
| 41 | Wins & Fixes cards (top performer, biggest leak, this week) | `/dashboard/overview` | ✅ |
| 42 | Comment keyword performance: per keyword/post/media type, deltas, funnel | Campaign edit → Comments tab | ✅ |
| 43 | Best-time-to-post heatmap (day × hour, workspace timezone) | Campaign edit → Comments tab | ✅ |
| 44 | Share performance (shares, unique sharers, share→DM, top media) | Campaign edit → Shares tab | ✅ |
| 45 | Follow-gate report + live "Test a verification" (IGSID) | Campaign edit → Follow gate tab | ✅ |
| 46 | Follow-up report with holdout lift and revenue | Campaign edit → Follow-ups tab | ✅ |
| 47 | Meta Insights: reach, impressions, profile views, story views, conversion rate | `/dashboard/overview` → Instagram Insights | ✅ |
| 48 | Campaign analytics tabs, 7/30/90/custom ranges, saved views | Campaign edit → analytics header | ✅ |
| 49 | Public shareable report (token-gated, revocable) | Settings → Public report link; `/report/<token>` | ✅ |

### Family 7 — Audience (4)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 50 | Contacts CRM: search, source/tag/has filters | `/dashboard/contacts` | ✅ |
| 51 | Contact detail: conversation, lead timeline, status, tags, custom properties, notes | `/dashboard/contacts/[id]` | ✅ |
| 52 | Filtered CSV export | Contacts → Export CSV | ✅ |
| 53 | Inbox: conversation history, manual reply, bot pause/resume, "Ask to follow" | `/dashboard/inbox` | ✅ |

### Family 8 — Operations (7)

| # | Feature | Where in the UI | Status |
|---|---|---|---|
| 54 | Re-run / retro-trigger: dry run, 1/7/30-day window, durable jobs, live progress, cancel | Campaigns list + campaign edit | ✅ |
| 55 | Activity log (DM execution ledger) | `/dashboard/logs` | ✅ |
| 56 | Diagnostics / system health (DB, Graph API, signature, handshake, vault, cron, processing) | `/dashboard/diagnostics` | ✅ |
| 57 | Admin capacity alerts + architecture brief email | `/dashboard/admin/alerts` | 🔒 ⚙️ |
| 58 | Dead-letter queue panel: inspect, replay, delete | `/dashboard/admin/alerts` | 🔒 |
| 59 | Webhook ledger + replay + resubscribe/recover crons | Admin APIs + diagnostics | 🔒 🔌 |
| 60 | Workspace timezone + week start (drives every analytics surface) | Settings → Time zone & calendar | ✅ |

---

## 3. Competitor comparison

### 3.1 How to read this

- **dmplease** cells are source-verified in this repo.
- **Zorcha / LinkPlease** cells reflect what they **publicly advertise** on their pricing and feature pages on 2026-11-28. `—` means *not advertised*, not necessarily *impossible*.
- The list is deliberately DM-automation-weighted, which flatters us. Their link-in-bio / digital-product / AI lines are whole product categories we do not have.

Legend: ✅ advertised/shipped · 🟡 partial or plan-limited · ❌ absent · — not advertised

### 3.2 Capability matrix (65 rows)

| # | Capability | dmplease | Zorcha | LinkPlease |
|---|---|---|---|---|
| 1 | Comment-to-DM keyword automation | ✅ | ✅ | ✅ |
| 2 | Any-post / specific-post targeting | ✅ | ✅ | ✅ |
| 3 | Next-post auto-attach (real permalink) | ✅ | — | — |
| 4 | Share-to-DM trigger | ✅ | — | ✅ |
| 5 | Story-to-DM (reply / mention / reaction) | ✅ | ✅ | ✅ |
| 6 | Inbox keyword auto-replies | ✅ | ✅ | ✅ |
| 7 | Respond-to-all-DMs fallback | ✅ | — | — |
| 8 | Live-video comment automation | ❌ | — | ✅ |
| 9 | Facebook Page / Messenger | ❌ | ✅ | ✅ |
| 10 | Button / postback routing | ✅ | 🟡 | — |
| 11 | Multi-message sequences | ✅ | 🟡 | — |
| 12 | Visual flow builder | ❌ | ✅ | — |
| 13 | AI FAQ / chatbot | ❌ | ✅ | — |
| 14 | AI message rotation | ❌ | — | ✅ |
| 15 | AI comment moderation | ❌ | — | ✅ |
| 16 | Brand-deal / collab detector | ❌ | — | ✅ |
| 17 | AI account protection ("IG Shield") | ❌ | — | ✅ |
| 18 | Editable opening DM | ✅ | — | — |
| 19 | Ask-for-Follow gate | ✅ | ✅ | ✅ |
| 20 | Personalisation variables | ✅ | ✅ | ✅ |
| 21 | Unique per-person vouchers | ✅ | — | — |
| 22 | DM variations / rotation | ✅ | ✅ | ✅ |
| 23 | Six DM formats (audio/PDF/media/card/carousel) | ✅ | — | — |
| 24 | Public comment replies | ✅ | ✅ | ✅ |
| 25 | Lead capture (name/email/phone/custom) | ✅ | ✅ | ✅ |
| 26 | 24h follow-up sequences | ✅ | ✅ | — |
| 27 | Live phone preview | ✅ | — | — |
| 28 | Durable DM queue | ✅ | ✅ | ✅ |
| 29 | Hourly cap / cooldown / dedupe | ✅ | ✅ | ✅ |
| 30 | Viral-spike throttling | ✅ | — | ✅ |
| 31 | Account health + auto-pause | ✅ | — | — |
| 32 | Safety score dashboard | ✅ | — | ✅ |
| 33 | Opt-out / STOP handling | ✅ | — | — |
| 34 | Spam screening at save time | ✅ | — | — |
| 35 | Weekly safety digest email | ✅ | — | — |
| 36 | Meta Verified Tech Provider badge | ❌ | ✅ | ✅ |
| 37 | Short links | ✅ | ✅ | — |
| 38 | Link rotation | ✅ | ✅ | — |
| 39 | Click tracking | ✅ | ✅ | ✅ |
| 40 | UTM auto-tagging | ✅ | — | — |
| 41 | Conversion / revenue attribution | ✅ | — | — |
| 42 | Public shareable report | ✅ | — | — |
| 43 | Overview KPIs | ✅ | ✅ | ✅ |
| 44 | Per-keyword / per-post analytics | ✅ | ✅ | ✅ |
| 45 | Best-time heatmap | ✅ | — | — |
| 46 | Share performance report | ✅ | — | — |
| 47 | Follow-gate report | ✅ | — | — |
| 48 | Follow-up holdout / lift report | ✅ | — | — |
| 49 | Meta Insights (reach/impressions) | ✅ | — | — |
| 50 | Saved views + custom date ranges | ✅ | — | — |
| 51 | Audience segments | ❌ | ✅ | — |
| 52 | Broadcasts | ❌ | ✅ | — |
| 53 | Contacts CRM | ✅ | ✅ | ✅ |
| 54 | Tags / custom properties / notes | ✅ | — | — |
| 55 | CSV export | ✅ | ✅ | — |
| 56 | Inbox with manual reply + bot pause | ✅ | ✅ | ✅ |
| 57 | Link-in-bio page | ❌ | ✅ | — |
| 58 | Digital products / storefront | ❌ | ✅ | ✅ |
| 59 | Forms | ❌ | ✅ | — |
| 60 | Dynamic QR / password-locked pages | ❌ | ✅ | — |
| 61 | Click-to-DM ads | ❌ | ✅ | — |
| 62 | MCP server | ❌ | ✅ | — |
| 63 | Multi-account management | ✅ | 🟡 | ✅ |
| 64 | Workspace timezone / week start | ✅ | — | — |
| 65 | Admin ops (DLQ, webhook replay, capacity alerts) | ✅ | — | — |

### 3.3 Scorecard

| | dmplease | Zorcha | LinkPlease |
|---|---|---|---|
| Capabilities covered (of 65) | **48** | **32** (+2 partial) | **28** |
| DM-automation core (rows 1–35) | **30 / 35** | 20 / 35 | 19 / 35 |
| Analytics & attribution (rows 37–52) | **14 / 16** | 5 / 16 | 3 / 16 |
| Growth surfaces (rows 57–62) | **0 / 6** | **6 / 6** | 1 / 6 |
| Pricing model | Not yet enforced in code | Free + $14.99 / $39.99 / $109.99 | Free (1k DMs) + ₹399 / ₹799 / ₹899 |

**Read this honestly:** we win the *automation depth + attribution* half of the board and lose the *growth-surface* half completely. Zorcha is a creator storefront with DM automation attached; LinkPlease is DM automation with an AI safety layer. We are DM automation with ROI attribution.

### 3.4 Where we are genuinely ahead

1. **Revenue attribution** — conversion ingest, revenue by keyword/creative, AOV, repeat buyers. Neither competitor advertises this.
2. **Six DM formats** — audio, PDF, image/video, card, carousel. Neither advertises attachments beyond text/links.
3. **Unique vouchers** — stable per-person codes with tracked URLs. Unique to us.
4. **Next-Post auto-attach** — the reel's real permalink resolved at send time. Unique to us.
5. **Follow-up holdout + lift** — proves follow-ups earn their keep instead of just sending more.
6. **Public shareable reports** — token-gated, revocable, query-backed.
7. **Operational transparency** — safety score with deductions, DLQ panel, webhook ledger, diagnostics. Competitors show a marketing gauge.
8. **Workspace timezone** — every chart and day bucket respects the creator's clock.
9. **Postback routing** — button taps can tag, message, or schedule a follow-up.
10. **Lead capture with custom properties** — not just email/phone.

### 3.5 Where they are genuinely ahead (our gap list)

| Gap | Who has it | Why it matters | Effort |
|---|---|---|---|
| Link-in-bio page | Zorcha | Removes a second subscription; top-of-funnel surface | M |
| Digital products / checkout in DM | Zorcha, LinkPlease | Direct monetisation, not just lead gen | L |
| AI FAQ / chatbot | Zorcha | Handles unbounded inbound questions | M |
| Visual flow builder | Zorcha | Non-linear journeys; our rules are flat | L |
| Facebook Page / Messenger | Zorcha, LinkPlease | Roughly doubles addressable accounts | M |
| Live-video automation | LinkPlease | High-intent spike capture | S |
| AI comment moderation | LinkPlease | Brand-safety feature agencies ask for | M |
| Collab / brand-deal detector | LinkPlease | Creator-specific hook | S |
| AI message rotation | LinkPlease | We rotate deterministically, not generated | S |
| Segments + broadcasts | Zorcha | Re-engagement without a new campaign | M |
| Forms | Zorcha | Lead capture outside DMs | M |
| Click-to-DM ads | Zorcha | Paid acquisition funnel | L |
| MCP server | Zorcha | Agent/automation ecosystem play | S |
| Meta Verified Tech Provider badge | Both | Biggest single trust gap | Business process |

---

## 4. How to use and how to test each feature (UI)

### 4.0 Test environment setup (do this once)

| Requirement | Why | How |
|---|---|---|
| Instagram **Professional** (Creator/Business) account | Graph API only works on professional accounts | IG app → Settings → Account type |
| Meta app with Instagram product + webhooks | Comment/DM events | developers.facebook.com → your app → Webhooks → callback `https://<tunnel>/api/webhook`, verify token = `META_VERIFY_TOKEN` |
| Subscribed fields | `comments`, `messages`, `message_reactions`, `story_insights` | App dashboard → Webhooks → Instagram |
| Public tunnel for local dev | Meta must reach the webhook | `ngrok http 3000`, set `TUNNEL_URL` and `NEXT_PUBLIC_SITE_URL` |
| Second Instagram account | To comment/DM as a "follower" | Any personal account |
| Env vars | See `.env.example` | Supabase, Meta, `TOKEN_VAULT_SECRET`, `META_VERIFY_TOKEN`, `CRON_SECRET`, `ADMIN_API_SECRET`, `OAUTH_STATE_SECRET`, Upstash, QStash |
| Optional | Rich media, email, admin ops | `R2_*`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SHORT_LINK_DOMAIN` |

**Golden rule for UI testing:** every feature has three observable surfaces — the **UI state**, the **Activity Log** (`/dashboard/logs`), and the **Safety page** (`/dashboard/safety`). If the UI says it happened but the log doesn't, it didn't happen.

---

### Family 1 — Accounts & onboarding

#### 1. Email/password auth
**Use:** `/auth/sign-up` → verify email → `/auth/login`. Reset via `/auth/forgot-password`. Change password in Settings → Password.
**Test:**
1. Sign up with a fresh email → expect "check your email" screen.
2. Click the confirmation link → expect `/auth/confirm` → dashboard or onboarding.
3. Log out, log in with the same credentials → expect dashboard.
4. Request a reset, open the link, set a new password → expect sign-out of other sessions and login with the new password.
5. Try a weak password and a mismatched confirmation → expect inline errors, no submit.
**Pass:** no account is created without email confirmation; reset links are single-use.

#### 2. Instagram OAuth connect
**Use:** Settings → Instagram Professional Account → **Connect via Facebook / Meta** → approve scopes.
**Test:** connect → expect redirect back to Settings with `@handle`, avatar, "Webhook subscribed: Comments & Direct Messages". Then `/dashboard/diagnostics` → Meta Graph API check should be green with latency.
**Pass:** token stored encrypted (never in the browser), handle matches the account you approved.

#### 3. Multi-account bulk connect
**Use:** after OAuth, the app redirects to a checklist (`?pending=…`). Search, select accounts, "Create N workspaces".
**Test:** select 2 accounts → expect 2 workspaces in the sidebar switcher, each with its own campaigns/contacts. Re-run the same connect → already-connected accounts are greyed out and skipped.
**Pass:** no duplicate workspace for the same IG account.

#### 4. Onboarding wizard
**Use:** `/onboarding` → channel → profile → goal → attribution → finish.
**Test:** complete it with "Lead Magnet" → expect a first campaign created with `ANY_POST`, a keyword, a DM, hourly cap 30, and redirect to dashboard. Revisit `/onboarding` → expect redirect to `/dashboard`.
**Pass:** the created campaign appears in Campaigns and is Active.

#### 5. Workspace switcher
**Use:** sidebar footer → pick a workspace.
**Test:** switch between two workspaces → every page (campaigns, contacts, analytics, safety) must change data. Reload → the selection persists.
**Pass:** no cross-workspace data bleed.

#### 6. Token vault + refresh
**Use:** automatic. Visible in Diagnostics.
**Test:** Diagnostics → "Token encryption" and "Scheduled token refresh" checks green. Force a refresh via `POST /api/cron/refresh-tokens` with `Authorization: Bearer $CRON_SECRET` → expect 200 and a new `token_refreshed_at`.
**Pass:** no plaintext token anywhere in the DB or logs.

---

### Family 2 — Triggers

#### 7. Comment-to-DM
**Use:** Campaigns → New Campaign → **Comment keyword** → keyword `GUIDE` → write DM → Launch.
**Test:** from the second account, comment `GUIDE` on the targeted post → expect (a) a DM within seconds, (b) a public reply under the comment, (c) a row in `/dashboard/logs` with status Delivered, (d) the campaign's Dispatched count +1.
**Pass:** exactly one DM per comment; a second identical comment inside 24h is deduped.

#### 8. Post scope
**Use:** Step 2 → Any Post/Reel · Specific Reel (pick from grid) · Next Post.
**Test:** create one campaign per scope. Comment on the targeted reel → only the matching campaign fires. Comment on a different reel → no DM.
**Pass:** Specific Reel ignores other posts; Any Post fires on all.

#### 9. Next-Post auto permalink
**Use:** Step 2 → **Next Post**; the button URL shows "Auto — new reel permalink".
**Test:** publish the campaign, then upload a new reel, then comment the keyword on it → the DM must contain that reel's real URL (not `{permalink}`), and the button must open the reel.
**Pass:** the sentinel never appears in a DM; if Meta fails to return a permalink, the link is omitted and the DM still sends.

#### 10. Share-to-DM
**Use:** Step 1 → **Share to DM** (no keyword needed).
**Test:** from the second account, share your reel into your DM → expect a thank-you DM once, and the Shares tab to show 1 share / 1 DM / 100% rate.
**Pass:** sharing the same post twice in 24h does not double-send.

#### 11. Story-to-DM
**Use:** `/dashboard/story-automations` → New → trigger (reply/mention/reaction) → message → Create.
**Test:** reply to your story with any text → expect the configured DM. React with an emoji → expect the reaction trigger. Mention the account in a story → expect the mention trigger.
**Pass:** one DM per story event; a story reply does not also fire an inbox keyword rule (double-fire guard).

#### 12. Inbox keyword rules
**Use:** `/dashboard/inbox-automations` → New rule → trigger "Inbox keyword" → keywords → reply → priority.
**Test:** DM the account `PRICE` → expect the rule reply. DM something unmatched → expect the catch-all rule (blank keywords) or the account fallback.
**Pass:** higher priority wins; a rule with "run at most once per N days" does not repeat inside the window.

#### 13. Respond-to-all fallback
**Use:** Settings → Respond to all DMs → enable → message → Save.
**Test:** DM a keyword that matches no rule → expect the fallback reply. DM a keyword that *does* match a rule → expect the rule, not the fallback.
**Pass:** the fallback never steals a specific match.

#### 14. Button/postback routing
**Use:** `/dashboard/inbox-automations` → Button actions → payload + action (tag / message / follow-up).
**Test:** send a DM with a button whose payload matches a route, tap it from the second account → expect the tag applied on the contact, or the message sent, or the follow-up scheduled.
**Pass:** unknown payloads are ignored safely; the 24h messaging window is refreshed on tap.

---

### Family 3 — Message composition

#### 15. Opening DM
**Use:** Campaign builder → Ask for Follow → Opening message + button label.
**Test:** comment the keyword from a **non-follower** → expect the opening DM with the `OPTIN:` button, and the guide DM withheld. Check `/dashboard/logs` for a row with trigger `OPENING`.
**Pass:** the opener is logged as a real send; the guide is not delivered until the follow is verified.

#### 16. Ask-for-Follow gate
**Use:** toggle on; choose "Hold delivery" or "Deliver anyway" for unverifiable checks.
**Test:** (a) follower comments → guide DM immediately, no opener. (b) non-follower comments → opener, then follow, then tap → guide released. (c) Campaign edit → Follow gate tab → "Test a verification" with a known IGSID → expect confirmed/not-following/unavailable.
**Pass:** never silently fails open; every check appears in the gate report.

#### 17. Personalisation variables
**Use:** click variable chips in any message field.
**Test:** use `{username}`, `{name}`, `{keyword}`, `{link}` in one DM. Trigger it → the DM must contain the real values. Use `{name}` without collecting a name → falls back to email local part → username → "there".
**Pass:** unknown tokens stay visible (typos are obvious), never silently blanked.

#### 18. Vouchers
**Use:** insert `{voucher}` and `{voucher_url}`.
**Test:** trigger the same campaign from two accounts → two different codes. Trigger the same account twice → the **same** code (stable). Click the voucher URL → the destination receives `?voucher=CODE`.
**Pass:** codes are unique per person, stable across retries, and recorded in `dm_vouchers`.

#### 19. DM variations
**Use:** Campaign builder → DM variations → Add variation (max 10).
**Test:** add 3 variants, trigger 6 times from different accounts → no two consecutive sends use the same variant. Check `/dashboard/logs` variant column.
**Pass:** rotation survives across serverless instances; a failed send does not "burn" a variant.

#### 20. Six message formats
**Use:** Message format → Text / Audio / PDF / Image-Video / Card / Carousel. Upload goes straight to R2.
**Test:** upload a small PDF → send → expect the file in the DM. Upload an oversized file → expect a client-side rejection with the limit. With `R2_*` unset → expect an honest "R2 not configured" notice and uploads disabled.
**Pass:** a broken asset degrades to text instead of failing the send.

#### 21. Action button
**Use:** Button title + destination URL.
**Test:** send → tap the button → expect the destination to open with UTM params. With Next Post + auto link → the button opens the triggering reel.
**Pass:** button URL is always tracked, even when Smart Links is off for the body.

#### 22. Public comment replies
**Use:** Public comment reply → toggle on → variants (≥3 enforced).
**Test:** trigger 5 times → expect 5 public replies with no immediate repeats. Disable → expect no public reply but the DM still sends.
**Pass:** failures are recorded in `public_replies` with status `failed` and an error code; the DM is still counted as sent.

#### 23. Lead capture
**Use:** Collect info → name/email/phone/custom → retry/skip copy → max attempts.
**Test:** trigger → reply with an invalid email → expect the retry copy. Reply `skip` → expect the skip copy and no saved value. Reply a valid email → expect the contact's email populated and a `captured` event in the contact's lead timeline.
**Pass:** invalid input never overwrites a good value; attempts are capped.

#### 24. 24h follow-ups
**Use:** Campaign edit → Follow-ups → Add follow-up → wait amount/unit → message → Save.
**Test:** set step 1 to 1 minute for testing → trigger a DM → wait → expect the follow-up. Then click the tracked link before the step is due → expect `cancelled`, no DM. Check the Follow-ups report for sent/held-out/conversions.
**Pass:** the clock starts at opt-in (falls back to first DM); click/reply/conversion cancels.

#### 25. Phone preview
**Use:** right column of the builder.
**Test:** change message, variants, format, button, gate, collect field → the preview must update using the production formatter (same text the follower receives).
**Pass:** preview and actual DM text match character-for-character.

---

### Family 4 — Delivery & safety

#### 26. DM queue
**Use:** automatic on cap overflow; "Drain now" on Overview/Safety.
**Test:** set hourly cap to 1, trigger 3 comments → expect 1 sent, 2 queued (pending count = 2). Click Drain now after the hour → expect them delivered. Force 5 failures → expect status `failed` and a visible failed count.
**Pass:** nothing is silently dropped; backoff is 5→10→20→40→60 min.

#### 27. Caps, cooldown, dedupe
**Use:** Campaign builder → Safety & delivery → hourly cap, delay min/max.
**Test:** cap 2 → send 3 → third is queued. Same person comments twice in 24h → one DM. Manual reply from Inbox to the same person inside the cooldown → 429 with `retryAfterMs`.
**Pass:** manual sends obey the same guards as automated ones.

#### 28. Jitter
**Use:** delay min/max (ms).
**Test:** set 2000–5000 ms, trigger 3 sends → observe timestamps in the Activity Log spread across the range.
**Pass:** no burst of identical timestamps.

#### 29. Viral throttle
**Use:** automatic; visible on Safety.
**Test:** simulate 25+ comments/min (or use the throttle unit tests) → expect an `elevated` event and a 3s delay. 100+/min → `critical`, delivery paused, DMs parked ~10s.
**Pass:** events appear in "Recent safety events" with plain-English explanations.

#### 30. Account health + auto-pause
**Use:** Safety → Account safety → Pause/Resume.
**Test:** force 3 consecutive failures → expect `safety_degraded`. 5 → expect auto-pause and a `safety_auto_paused` event. Resume → sends continue.
**Pass:** pause is reversible and queued DMs wait rather than fail.

#### 31. Safety score
**Use:** `/dashboard/safety`.
**Test:** with a healthy account expect 100 / "Excellent". Trigger a breach → expect a deduction and a lower band. Every deduction must name its cause.
**Pass:** no mystery numbers; score is derived from stored events.

#### 32. Opt-out / STOP
**Use:** automatic.
**Test:** from the second account DM `stop` → expect a confirmation and `opted_out_at` set. Trigger a campaign for that person → expect no DM. DM `start` → expect resubscribe and future DMs resume.
**Pass:** opt-out survives follow-ups and re-runs.

#### 33. Spam screening
**Use:** automatic at save.
**Test:** try to save a campaign with 4 links, a 200-character all-caps block, duplicate variants, or a self-referential loop → expect field-level errors and no save.
**Pass:** invalid campaigns never reach the runtime.

#### 34. Weekly safety digest
**Use:** automatic Mondays 09:00 (needs `RESEND_API_KEY` + `ADMIN_ALERT_EMAILS`).
**Test:** call `/api/cron/safety-digest` with the cron bearer token → expect 200 and an email (or an in-app record if Resend is unset).
**Pass:** digest aggregates 7 days per workspace and uses plain-English event copy.

---

### Family 5 — Links & attribution

#### 35. Smart short links
**Use:** Campaign builder → Smart tracked links → on.
**Test:** send a DM → the link must be `…/go/XXXXXXXX` (8 chars) and clickable in Instagram. Click it → expect a 302 to the destination with UTMs.
**Pass:** long tokens are never sent (Instagram won't linkify them).

#### 36. Link rotation
**Use:** Create group → rotation style → up to 10 destinations.
**Test:** sticky: trigger from the same account twice → same destination. Round-robin: trigger from 4 accounts → destinations cycle. Disable one destination → it is skipped.
**Pass:** assignment is deterministic per person for sticky mode.

#### 37. Click tracking
**Use:** Campaign edit → Links tab.
**Test:** click a tracked link → expect clicks +1, unique people +1, last-click timestamp. Click twice from the same person → unique stays 1. Block Redis → clicks are buffered and replayed by `/api/cron/flush-link-clicks`.
**Pass:** no click is lost; bots are flagged, not counted as people.

#### 38. UTM tagging
**Use:** automatic.
**Test:** inspect the destination URL after a click → expect `utm_source=dmplease`, `utm_medium=instagram_dm`, `utm_campaign=<first 8 of automation id>`.
**Pass:** UTMs survive short-link redirects.

#### 39. Conversion ingest
**Use:** Settings → Revenue attribution → copy token → `POST /api/conversions/<token>`.
**Test:** post `{event_type:"purchase", email:"…", revenue:499, currency:"INR", external_event_id:"test-1"}` → expect 200 and revenue on Overview. Replay the same `external_event_id` → expect `duplicate: true` and no double count. Wrong token → 401.
**Pass:** idempotent, attributed to the right contact/keyword/post.

---

### Family 6 — Analytics

#### 40. Overview KPIs + funnel
**Use:** `/dashboard/overview` → 7/30/All.
**Test:** compare each tile against `/dashboard/logs` counts for the same range. Funnel steps must be monotonically decreasing.
**Pass:** every figure is query-backed; changing the range changes every tile consistently.

#### 41. Wins & Fixes
**Use:** top of Overview.
**Test:** with data, expect a top performer, a biggest leak with a %, and this-week revenue/leads. With no data, expect honest empty states.
**Pass:** each card links to the action it recommends.

#### 42. Comment keyword performance
**Use:** Campaign edit → Comments tab.
**Test:** filter by keyword chip → trend, post table and media-type chips must all narrow. Compare a tile's delta with the previous period.
**Pass:** headline tiles stay campaign-level while the drill-down narrows.

#### 43. Best-time heatmap
**Use:** Comments tab → heatmap.
**Test:** change Settings → Time zone → the heatmap buckets and row order must shift to the new clock.
**Pass:** peak insight matches the darkest cell.

#### 44. Share performance
**Use:** Campaign edit → Shares tab.
**Test:** share a post 3 times from 2 accounts → expect 3 shares, 2 unique sharers, share→DM rate, top media.
**Pass:** counts match the Activity Log.

#### 45. Follow-gate report
**Use:** Campaign edit → Follow gate tab.
**Test:** run the live "Test a verification" with a real IGSID → expect confirmed / not following / unavailable. Compare checks vs confirmed vs asked.
**Pass:** verification rate is checks-based, not guessed.

#### 46. Follow-up report
**Use:** Follow-ups tab → report.
**Test:** with a 10% holdout, expect sent vs held-out, conversions from each, revenue, and lift.
**Pass:** lift is computed from the holdout, not assumed.

#### 47. Meta Insights
**Use:** Overview → Instagram Insights → Refresh insights.
**Test:** with `instagram_manage_insights` → expect reach/impressions/profile views/story views and a 30-day trend. Remove the scope → expect the "Insights access needed" state with Reconnect/Diagnostics actions.
**Pass:** no Insights call is made without the scope.

#### 48. Campaign analytics + saved views
**Use:** campaign edit → range selector → Save view.
**Test:** set a custom range, save a named view, reload → the view restores range + tab. Delete it → it disappears.
**Pass:** saved views are per user and validated.

#### 49. Public report
**Use:** Settings → Public report link → Create → Copy.
**Test:** open `/report/<token>` in a private window → expect a read-only report. Toggle Public access off → expect 404. Revoke → expect 404 permanently. `/api/reports/<token>` returns the same JSON.
**Pass:** no dashboard session required, no write actions exposed.

---

### Family 7 — Audience

#### 50. Contacts CRM
**Use:** `/dashboard/contacts`.
**Test:** search by username/email/tag; filter by source, tag, has-email/phone → the count and "Filtered" badge update. Clear → full list returns.
**Pass:** filters compose (search + tag + has).

#### 51. Contact detail
**Use:** click a contact.
**Test:** change status, add a tag, add a custom property, write a note, Save → reload → all persisted. The conversation and lead timeline must show the real events.
**Pass:** edits are workspace-scoped; another workspace cannot open the URL.

#### 52. CSV export
**Use:** Contacts → Export CSV.
**Test:** apply a filter, export → the CSV contains only filtered rows and the visible columns.
**Pass:** export respects filters, not the whole table.

#### 53. Inbox
**Use:** `/dashboard/inbox`.
**Test:** open a conversation → send a manual reply → expect it in the thread with delivery status. Toggle "Bot paused" → trigger a keyword → expect no automated reply. Toggle back → automation resumes. Use "Ask to follow" → expect the in-chat prompt.
**Pass:** human takeover actually stops the bot; the 24h window is respected.

---

### Family 8 — Operations

#### 54. Re-run
**Use:** Campaigns list or campaign edit → Re-run last 7 days.
**Test:** pick 1/7/30 days → expect a dry-run preview with eligible/matched/already-contacted/opted-out/paused counts. Start → expect live progress (sent/skipped/failed/pending) and a Stop button. Pause the campaign mid-run → expect the job to cancel.
**Pass:** no double-sends; paused campaigns refuse to run.

#### 55. Activity log
**Use:** `/dashboard/logs`.
**Test:** every send from every feature must appear with recipient, trigger, payload, timestamp, status.
**Pass:** the log is the source of truth for "did it send?".

#### 56. Diagnostics
**Use:** `/dashboard/diagnostics`.
**Test:** expect green checks for DB, Graph API, signature, handshake, vault, cron, processing. Break one env var → expect a red check with a plain-English fix.
**Pass:** non-admins see "Managed by admin" instead of deployment internals.

#### 57. Admin capacity alerts
**Use:** `/dashboard/admin/alerts` (admin only).
**Test:** non-admin → "Admin only". Admin → envelope cards, "Send architecture brief now", alert history.
**Pass:** email sends only when `RESEND_API_KEY` is set; otherwise an in-app record.

#### 58. DLQ panel
**Use:** `/dashboard/admin/alerts` → Dead-letter queue.
**Test:** force a worker failure → expect a DLQ message. Replay → expect the job to run. Delete → expect it gone.
**Pass:** replay is idempotent (no double DM).

#### 59. Webhook ledger + replay
**Use:** admin APIs + Diagnostics.
**Test:** `POST /api/admin/webhook-replay` with `ADMIN_API_SECRET` → expect the event reprocessed. `POST /api/admin/resubscribe-webhooks` → expect missing fields re-subscribed.
**Pass:** replay never bypasses signature/dedupe.

#### 60. Workspace timezone
**Use:** Settings → Time zone & calendar.
**Test:** change timezone and week start → every analytics surface (Overview, campaign tabs, heatmap, contacts, inbox, logs, public report) must re-render in the new clock. Stored data must not change.
**Pass:** storage stays UTC; only presentation shifts.

---

## 5. End-to-end smoke test (run in this order, ~20 minutes)

| Step | Action | Expected |
|---|---|---|
| 1 | `/dashboard/diagnostics` | All core checks green |
| 2 | Settings → connect Instagram | `@handle` shown, webhook subscribed |
| 3 | Create campaign `TESTGUIDE`, Any Post, keyword `TESTGUIDE`, DM with `{username}` + button | Campaign Active |
| 4 | Comment `TESTGUIDE` from account B | DM + public reply within seconds |
| 5 | `/dashboard/logs` | One Delivered row, trigger `TESTGUIDE` |
| 6 | `/dashboard/overview` | DM count +1, funnel updated |
| 7 | Campaign → Comments tab | 1 comment, 1 matched, 100% comment→DM |
| 8 | Enable Ask for Follow, comment from a non-follower | Opening DM, guide withheld |
| 9 | Follow + tap the button | Guide DM released |
| 10 | Follow gate tab → Test a verification | Confirmed / not following |
| 11 | Add a 1-minute follow-up step, trigger, wait | Follow-up sent; click cancels the next one |
| 12 | Enable Smart Links, trigger, click the short link | 302 + UTMs, Links tab +1 |
| 13 | Settings → conversion token → POST a test purchase | Revenue on Overview; replay = duplicate |
| 14 | Contacts | Contact created with captured fields |
| 15 | Inbox → manual reply → pause bot | Reply delivered; automation stops |
| 16 | Re-run last 7 days → dry run → start | Preview counts, live progress, completes |
| 17 | Safety | Score, queue, events all populated |
| 18 | Settings → Public report → open in private window | Read-only report renders |

---

## 6. Automated test map

`npm test` → **101 files, 627 tests**. Coverage by area:

| Area | Representative files |
|---|---|
| Webhook + parsing | `webhook-events`, `webhook-processor`, `webhook-workspace-binding`, `meta-client-*` |
| Auth + security | `auth-guard`, `admin-auth`, `admin-alerts-auth`, `oauth-*`, `recovery-grant`, `password-change-signout`, `security-hardening`, `safe-*`, `turnstile` |
| DM pipeline | `dm-queue`, `dm-send-claim`, `pending-claim`, `pending-dms-scope`, `send-queued-dm`, `drain-dm-queue-action`, `dedupe`, `opt-out` |
| Composition | `dm-rules`, `dm-variants`, `public-replies`, `message-formats`, `opening-dm`, `follow-gate`, `lead-capture` |
| Links + attribution | `link-rotation`, `link-click-buffer`, `conversions`, `conversions-route`, `public-report*` |
| Analytics | `metrics`, `metrics-record`, `insights-cron`, `comment-performance` |
| Ops | `rerun-*`, `safety-retention`, `qstash-verify`, `redis-lock`, `dlq` |

**Known failure (2 tests):** `tests/metrics-record.test.ts` hardcodes the day key `2026-11-27`, so it fails on any other date (today is 2026-11-28). It is a date-brittle test, not a product bug — the fix is to derive the expected key from the same clock the code uses. Everything else passes.

---

## 7. Honest limitations

1. **No link-in-bio, digital products, forms, or AI.** These are entire product lines for Zorcha/LinkPlease, not missing settings.
2. **No Facebook/Messenger.** Instagram only.
3. **No Live automation.** Live comments are not parsed.
4. **No plan enforcement in code.** The landing page shows Free/Starter/Business/Enterprise, but no entitlement checks exist in the dashboard.
5. **No Meta Verified Tech Provider badge.** Documented process in `docs/META_TECH_PROVIDER_BADGE.md`, not yet applied for.
6. **Instagram does not expose DM opens/reads.** We measure delivered, clicked, replied — never "seen". Any "open rate" would be fabricated.
7. **Two date-brittle tests** fail outside 2026-11-27 (see §6).
8. **`prisma/schema.prisma` is stale.** Runtime uses Supabase REST; migrations are the source of truth.

---

## 8. If you want to close the gap (recommended order)

| Priority | Feature | Why | Effort |
|---|---|---|---|
| P0 | Meta Tech Provider badge | Trust; both competitors lead with it | Business |
| P0 | Fix date-brittle tests | Green suite before launch | XS |
| P1 | Link-in-bio page | Removes a competitor subscription; top-of-funnel | M |
| P1 | Facebook Page / Messenger | ~2× addressable accounts | M |
| P2 | AI FAQ on inbound | Handles unbounded questions; Zorcha's stickiest feature | M |
| P2 | Segments + broadcasts | Re-engagement without new campaigns | M |
| P3 | Live-video automation | High-intent spike capture | S |
| P3 | AI comment moderation | Agency/brand-safety ask | M |
| P4 | Visual flow builder | Only after attribution is the wedge | L |
| P4 | Digital products / checkout | Monetisation, not lead gen | L |

**Positioning that the matrix supports:** *"Stop counting clicks. Start knowing which Reel paid for itself."* We are the only one of the three that can answer revenue-per-creative, follow-up lift, and gate abandonment with stored rows.
