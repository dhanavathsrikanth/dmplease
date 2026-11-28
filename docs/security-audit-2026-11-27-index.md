# Security Audit 2026-11-27 — Section Index and Map

**Source document:** [`docs/security-audit-2026-11-27.md`](./security-audit-2026-11-27.md)
**Purpose of this file:** a navigable map of every section and subsection in the audit, with the line range and a plain-language statement of what each one covers.

---

## 1. How the document is numbered

The audit does **not** use a single flat `1.x` sequence for findings. It uses four levels:

| Level | Pattern | Meaning |
|---|---|---|
| Top-level section | `## 1.` … `## 8.` | The eight major parts of the report. |
| Finding / lead | `### 3.1` … `### 3.8`, `### 4.1` … `### 4.14`, `### 5.1` … `### 5.2` | One numbered record per finding, lead, or rejected claim. |
| Record field | `#### What it is`, `#### Root cause`, … | The fixed fields inside each record. |
| Sub-topic | `### Confirmed findings at a glance`, `### Coverage by subsystem` | A named sub-part of a top-level section. |

So when you see references like "1.11, 1.12, 1.13", the document's actual equivalents are:

- **4.11** — QStash worker verification can fall back to public development signing keys.
- **4.12** — Cross-tenant campaign content disclosure via unbound `pending_dms.automation_id`.
- **4.13** — Webhook dedupe fails open when Redis is unavailable.

There is no `1.11`/`1.12`/`1.13` in this document. Section 1 is the executive summary and has no numbered findings.

---

## 2. Top-level sections

| # | Section | Lines | What it covers |
|---|---|---|---|
| 1 | Executive summary | 11–52 | Run identity (repo, commit, profile, execution model), the counts (8 confirmed, 14 leads, 2 rejected), a short posture statement, and two at-a-glance tables: confirmed findings and leads needing validation. |
| 2 | Scope, method, and limits | 53–73 | What was reviewed, the six-phase method used to produce the findings, and an explicit statement of what the audit does **not** prove (deployment-dependent controls, partial coverage). |
| 3 | Confirmed findings | 74–837 | The eight vulnerabilities that were reproduced with bounded local checks and independently re-verified. Each has eleven fixed fields (see §4 below). |
| 4 | Leads that need validation | 838–1426 | Fourteen source-grounded leads that are blocked on one external fact. They are **not** confirmed vulnerabilities and carry no severity. Each has six fixed fields (see §5 below). |
| 5 | Claims that were rejected | 1427–1450 | Two claims that were proposed during hunting and disproved during independent validation, retained so future runs do not repeat them. |
| 6 | Hardening notes | 1451–1535 | Concrete improvements that did not meet the bar for a confirmed finding because no lower-trust principal gains a concrete capability. |
| 7 | Coverage summary | 1536–1577 | Status counts (covered / candidate / blocked / deferred / planned), the one deferred unit and why, and a per-subsystem coverage table. |
| 8 | Appendix — artifact index | 1578–end | Index of every artifact produced by the run (report, findings JSON, ledger, architecture, metadata, promoted check outputs). |

---

## 3. Section 1 and 2 sub-parts

| Ref | Sub-part | Lines | What it covers |
|---|---|---|---|
| 1 | Confirmed findings at a glance | 19–31 | Table of the 8 confirmed findings: number, severity, title, primary sink location. |
| 1 | Leads that need validation at a glance | 32–51 | Table of the 14 leads: number, title, primary sink location. |
| 2 | What was reviewed | 55–58 | The repository surfaces in scope: App Router pages and route handlers, server actions, webhook/QStash/cron/admin routes, OAuth, Supabase/Prisma/RLS, token vault, public report and conversion tokens, short links, R2, client auth and dashboard. |
| 2 | How findings were produced | 59–67 | The six phases: reconnaissance, coverage-led hunting, candidate validation, structured output, independent record verification, reporting. |
| 2 | What this audit does not prove | 68–73 | The deployment facts that remain unverified (live RLS, Supabase Auth settings, Vercel headers, Meta app mode, QStash/Redis/R2 configuration) and the partial-pass caveat. |

---

## 4. Section 3 — Confirmed findings (3.1–3.8)

Each `3.x` record uses the same eleven fields: **What it is**, **Root cause**, **Intended behavior**, **Where it lives (source trace)**, **Who can trigger it**, **Conditions required**, **What we observed**, **Why it matters**, **Evidence**, **How to fix it**, **Reproduction inputs**.

| Ref | Title | Severity | Lines | What it talks about |
|---|---|---|---|---|
| 3.1 | Open redirect in `/auth/confirm` via protocol-relative `next` parameter | medium | 78–167 | `next.startsWith("/")` accepts `//evil.example`, `///evil.example`, and `/\evil.example`; `new URL(destinationPath, origin)` then replaces the origin, so a victim is sent off-site right after their session cookies are set. |
| 3.2 | Contact CSV export emits attacker-controlled email as a live spreadsheet formula | medium | 168–251 | `csvCell` quotes and doubles quotes but does not neutralize a leading `=`, `+`, `-`, `@`, tab, or CR. A lead-capture email can be a formula that exfiltrates exported PII when the owner opens the CSV. |
| 3.3 | Share-to-DM campaigns fire on comment events because the comment loop does not filter `trigger_type` | medium | 252–353 | The comment branch loads every active automation; `SHARE_TO_DM` campaigns have empty keywords, which `findMatchingKeyword` treats as match-all, so a share campaign replies to every commenter and can consume the 30-day reply-once slot. |
| 3.4 | OAuth state HMAC accepts hardcoded, publicly-known secrets, allowing state forgery for any user id | medium | 354–446 | `getOAuthStateSecrets()` always accepts `LEGACY_VAULT_SECRET` and `DEV_ONLY_SECRET`, both literals in source. Anyone with the repo can mint a valid state for an arbitrary `userId`; the callback never compares the state subject to the session. |
| 3.5 | Diagnostics webhook health reads the global service-role ledger and renders other tenants' job errors | medium | 447–544 | `getWebhookHealth()` queries `webhook_events` through the service-role client with no tenant predicate; any signed-in creator sees platform-wide counts and other tenants' automation names, comment ids, and Meta message ids. |
| 3.6 | One manual DM writes a non-UUID metrics target that permanently breaks the shared daily-metrics flush | medium | 545–639 | `send-dm` writes `targetId: "manual"`; the flush passes it to `increment_daily_metrics`, which casts it to `uuid`, aborts the batch, and restores the poison key, so every later flush fails. |
| 3.7 | OAuth callback redirects to an unvalidated `nextUrl` from the state, giving an unauthenticated open redirect | low | 640–723 | `nextUrl` is copied from the `next` query parameter and signed without validation; the callback resolves it with `new URL(nextTarget, origin)`, and the error branch redirects before any session check. |
| 3.8 | Opt-out is dropped for first-time story senders because `recordOptOut` only updates an existing contact row | low | 724–837 | `recordOptOut` is update-only and runs before `ensureContact`; a first-time story sender has no contact row, the update affects zero rows, the confirmation is still sent, and `isOptedOut` later reads false. |

---

## 5. Section 4 — Leads that need validation (4.1–4.14)

Each `4.x` record uses the same six fields: **What it is**, **Claimed root cause**, **Where it lives (source trace)**, **Evidence**, **Why it is not confirmed**, **How to resolve it**.

| Ref | Title | Lines | What it talks about |
|---|---|---|---|
| 4.1 | Admin DLQ access is granted on an unverified email string | 842–883 | `isAdminEmail` compares the session email to `ADMIN_ALERT_EMAILS` without checking `email_confirmed_at`; a self-service signup with an admin address could pass if confirmation is disabled or the live trigger still auto-confirms. |
| 4.2 | Instagram connect binds a client-supplied `instagram_id` to the caller's workspace without proving control | 884–925 | The legacy connect branch trusts `accounts[].instagramBusinessId`; `instagram_id` is globally unique and is the webhook tenant-routing key, so a caller could pre-register another creator's account id. |
| 4.3 | Unvalidated `next` parameter reaches `window.location.href` in `LoginForm`, allowing `javascript:` navigation | 926–961 | `LoginForm` assigns the query value directly to `window.location.href`; a `javascript:` value would execute in the app origin after sign-in. Browser execution and CSP are the blockers. |
| 4.4 | Sign-up `next` parameter is used as a raw navigation target after account creation | 962–999 | `SignUpForm` does the same as 4.3; reachability depends on Supabase returning a session from `signUp` (email-confirmation setting). |
| 4.5 | Hardcoded AES-256 vault key is unconditionally accepted when decrypting Instagram access tokens | 1000–1045 | `LEGACY_VAULT_SECRET` is a literal 64-hex key; `decryptToken` always tries it. Whether any live token is legacy-encrypted is the blocker. |
| 4.6 | Re-run stuck-item recovery uses the insert timestamp as the claim time and can re-queue work whose send already reached Meta | 1046–1089 | `recoverStuckItems` compares `created_at`, which never changes on claim, so an in-flight item can be reset and re-sent. |
| 4.7 | `getToken` substitutes a process-wide `INSTAGRAM_ACCESS_TOKEN` for a tenant's missing or undecryptable token | 1090–1128 | The fallback ignores `instagramId`, breaking the credential/account binding. Whether the env var is set and what it is scoped to is the blocker. |
| 4.8 | `webhook_events` retains full Meta payloads with contact PII and has no in-repo retention or tenant-cascade path | 1129–1169 | The ledger stores the full webhook body; no code path deletes it, and it has no workspace column or FK, so disconnect does not purge it. |
| 4.9 | Pending opt-in rows are dereferenced by id alone, letting one tenant release another tenant's campaign content and write into its workspace | 1170–1216 | `consumePending` and `releasePendingOptin` load the referenced automation/rule without a workspace predicate and adopt the automation's workspace. |
| 4.10 | Cross-tenant Instagram profile read and overwrite via unscoped `syncInstagramProfile()` in `GET /api/instagram/media` | 1217–1258 | The function selects the globally most-recently-updated account when no id is passed, decrypts its token, and writes the result back. |
| 4.11 | QStash worker verification can fall back to public development signing keys | 1259–1299 | `Receiver` is constructed without `devMode: false`; a truthy `QSTASH_DEV` makes the library use its published dev keys. |
| 4.12 | Cross-tenant campaign content disclosure via unbound `pending_dms.automation_id` | 1300–1341 | The RLS insert policy checks only the row's `workspace_id`; `automation_id` is unconstrained, and the queue drain loads it without a workspace filter. |
| 4.13 | Webhook dedupe fails open when Redis is unavailable, leaving only a non-atomic DB guard against duplicate DM sends | 1342–1383 | `claimWebhookEvent` returns true on a missing/failing Redis; the fallback guards are read-before-send, so overlapping retries can double-send. |
| 4.14 | One dedupe key is claimed for a whole multi-event webhook payload, so a retried batch drops unprocessed events | 1384–1426 | The key is derived from `entry[0]` only; a retry of a multi-event batch is rejected as a unit, dropping events that were never processed. |

---

## 6. Section 5 — Rejected claims (5.1–5.2)

| Ref | Title | Lines | What it talks about |
|---|---|---|---|
| 5.1 | Recovery password page lets any authenticated session set a new password without the current one | 1431–1440 | Rejected: the reauthentication requirement is enforced by Supabase GoTrue on the ambient session, not by the form, so the recovery page grants no incremental capability in either setting state. |
| 5.2 | Mutable `latest` dependency tags feed an install-time script in the build environment | 1441–1450 | Rejected: `package-lock.json` pins exact versions with integrity hashes, and the cited `hasInstallScript` sink is the root package's own `prisma generate`, not newly resolved dependency code. |

---

## 7. Sections 6, 7, and 8

| Ref | Section | Lines | What it covers |
|---|---|---|---|
| 6 | Hardening notes | 1451–1535 | A bullet list of concrete non-findings: e.g. `isOptedOut` fail-open, `consumePending` recipient binding, `matchesRuleKeyword` empty-keyword behavior, `selectInboundRule` single-rule commitment, postback dedupe, `deliver-guide` missing send guards, shared `CRON_SECRET`, `rerun_jobs` RLS breadth, `findRerunCandidates` slice-before-filter, `withCronLock` fail-open, global token fallback, onboarding validation gap, verified-badge override, Turnstile behavior, insights error echo, unbounded click buffer, retention window mismatch. |
| 7 | Coverage summary | 1536–1547 | Status counts: covered, candidate, blocked, deferred, planned; the one deferred unit (90-day retention for `comment_events`/`messages`/`dm_logs`) and why. |
| 7.1 | Coverage by subsystem | 1548–1577 | Per-subsystem table: units, covered, candidate, deferred. |
| 8 | Appendix — artifact index | 1578–end | Table of every artifact: `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`, `architecture.md`, `run-metadata.json`, and promoted `agents/<id>/artifacts/check-output.json`. |

---

## 8. Quick lookup by topic

| If you want to read about… | Go to |
|---|---|
| Redirect / open-redirect issues | 3.1, 3.7, 4.3, 4.4 |
| CSV / export injection | 3.2 |
| Campaign trigger scoping | 3.3 |
| OAuth state and callback | 3.4, 3.7, 4.2 |
| Cross-tenant data exposure | 3.5, 4.9, 4.10, 4.12 |
| Metrics / analytics integrity | 3.6 |
| Consent / opt-out | 3.8 |
| Admin access | 4.1 |
| Token vault / secrets | 4.5, 4.7 |
| Webhook reliability and dedupe | 4.13, 4.14 |
| Retention / privacy lifecycle | 4.8 |
| Re-run / queue correctness | 4.6 |
| QStash / worker auth | 4.11 |
| Rejected claims | 5.1, 5.2 |
| Non-finding improvements | 6 |
| Coverage and artifacts | 7, 8 |

---

## 9. Record field reference

### Confirmed record (`3.x`)

1. **What it is** — plain-language description of the vulnerability.
2. **Root cause** — the specific code defect.
3. **Intended behavior** — what the code should have enforced.
4. **Where it lives (source trace)** — ordered `entrypoint → propagation → sink` with file:line.
5. **Who can trigger it** — the lower-trust principal and starting capability.
6. **Conditions required** — authentication, configuration, data state, timing, third-party dependencies.
7. **What we observed** — the bounded local result.
8. **Why it matters** — demonstrated impact and likelihood rationale.
9. **Evidence** — the specific source lines that prove the claim.
10. **How to fix it** — the smallest effective source change, with code.
11. **Reproduction inputs** — payloads and step-by-step instructions.

### Needs-validation record (`4.x`)

1. **What it is** — the source-grounded hypothesis.
2. **Claimed root cause** — the suspected defect.
3. **Where it lives (source trace)** — ordered path with file:line.
4. **Evidence** — the source lines that support the trace.
5. **Why it is not confirmed** — the exact external fact that blocks it.
6. **How to resolve it** — a bounded local check and/or an owner-observed deployment check.

### Rejected record (`5.x`)

1. **What was claimed** — the original hypothesis.
2. **Why it was rejected** — the source or behavioral fact that disproves it.

---

*This index is derived from the headings and content of `docs/security-audit-2026-11-27.md`. It does not change any verdict, severity, blocker, or demonstrated impact in the source report.*
