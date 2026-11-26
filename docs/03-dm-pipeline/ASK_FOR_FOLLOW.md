# Ask for Follow — implementation notes

Status: **complete** (campaigns, inbox/story/share rules, opt-in postbacks, verification ledger, UI).

## Why the old implementation was wrong

The previous check called `GET /{ig-account}/followers?user_id={igsid}` and treated any non-empty response as "follower", failing open on errors. Meta does **not** expose a reliable per-user filter on that edge, and Page-linked tokens cannot enumerate followers. That meant a non-follower could receive the gated DM whenever the lookup failed or returned unrelated followers.

The supported signal is Meta's **User Profile API** field `is_user_follow_business`:

```
GET graph.facebook.com/<API_VERSION>/<IGSID>?fields=is_user_follow_business,username
Authorization: Bearer <PAGE_ACCESS_TOKEN>
```

(Instagram-Login tokens use `graph.instagram.com`.) Meta requires **user consent** — the person must have messaged the business or tapped one of our buttons. See the [Meta User Profile API docs](https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/).

## Runtime flow

1. Trigger fires (comment automation, DM keyword rule, story reply/mention, share-to-DM).
2. `verifyFollowership()` (`lib/meta/follow-gate.ts`) calls the User Profile API with the person's IGSID and compares the exact boolean returned by Meta. It retries transient Meta errors, never throws, and caches definitive answers in Upstash Redis for 15 minutes (follower) / 2 minutes (non-follower). Concurrent checks for the same account+recipient are coalesced.
3. `applyFollowGate()` (`lib/meta/webhook-processor.ts`) decides:
   - confirmed follower → deliver immediately;
   - confirmed non-follower → send an opening DM with an `OPTIN:<pendingId>` button and stop;
   - `unavailable` → follow the creator's policy: **hold** (send the opener, ask them to tap again — default) or **deliver** (log a `follow_gate_exception` safety event and release the content).
4. The person taps the button **or replies to the DM** (both grant consent). The postback/inbound handler re-verifies, stamps `contacts.opted_in_at` and `follow_verified_at`, and releases the gated content through one shared `releasePendingOptin()` path. If still not confirmed, they get a nudge; after 3 checks the pending record expires.
5. Every check is written to `follow_checks` for diagnostics and rate limits. PostHog receives `follow_gate_checked` and `follow_gate_opening_sent` events.

## Configuration

- Campaigns: `automations.follow_gate_enabled`, `opening_message`, `follow_gate_button_label`, `follow_gate_on_unavailable`.
- Rules: the same four columns on `dm_rules`.
- Migration: `supabase/migrations/20261126_follow_gate.sql` (additive, re-runnable). Prisma models are updated in `prisma/schema.prisma`.
- UI: one reusable `FollowGateSettings` component is used by the campaign builder and the rule manager. The phone preview renders both steps of the gate; the campaign editor shows a `FollowGateReport` with verification counts and reasons.

## Guardrails

- No silent fail-open. Outages, consent errors and invalid tokens produce an explicit `unavailable` status and an operator-chosen policy.
- Meta code 190 marks the account as needing reconnection.
- The gate is not applied to manual agent replies (human replies are not gated).
- Use the gate only for content people asked for; do not gate purchases, bookings or support responses.

## In-chat "Ask to follow" prompt & follower-growth analytics

The Direct Inbox composer has an **Ask to follow** action. It sends a follow card to the current conversation with a hard gate — the promised content (typed in the composer, optional) is released only after Meta confirms the follow. A DM reply also counts as consent and can confirm the prompt.

Because the person has already messaged the business, Meta can answer `is_user_follow_business` **before** the prompt. That snapshot (`follow_prompts.prior_follower`) is what makes the growth number incremental: only people who were *not* following before the prompt and are verified afterwards count as **new followers from this feature**. Already-following people are delivered their content but do not inflate growth.

Prompt state is stored in `follow_prompts` (`status`, `prior_follower`, `tapped_at`, `resolved_at`, `delivered_at`) and each verification writes a `follow_checks` row with `prompt_id`. `lib/follow-analytics.ts` aggregates these into: prompts sent, taps, attributed new followers, already-following, unverified, expired, delivered, tap rate and a daily series. The card is shown in **Direct Inbox** and **Analytics & Performance (Overview)**.

API: `POST /api/inbox/follow-prompt` returns `already_follower` (no prompt sent) when Meta confirms the relationship up front, otherwise `prompt_sent` with the opening copy. Migration: `supabase/migrations/20261126_follow_prompts.sql`.
