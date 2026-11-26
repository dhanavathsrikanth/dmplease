# DM keywords & "Respond to all DMs"

Status: **complete** — deterministic, throttled, testable, and gated.

## Rule resolution (every inbound DM)

`lib/dm-rules.ts` owns the decision layer; the webhook processor only executes it.

1. **Specific keyword rules first.** Keyword matching is case-insensitive, whole-token for single words and whitespace-tolerant for phrases (`price list` matches `PRICE  LIST`). `pricing` does not match `price`.
2. **Priority breaks ties.** Higher `priority` wins; ties fall back to creation order. Priority is editable in the rule manager.
3. **Catch-all rules next.** A rule with blank keywords is a catch-all. It can never outrank a specific keyword match, no matter how high its priority.
4. **Account fallback last.** `Respond to all DMs` is configured per Instagram account in **Settings**. It runs only when no rule matched, and its virtual rule has `priority = -1` so it is always last.
5. **Nothing configured** → the event is recorded as ignored; the system never invents a reply.

## Production guardrails

- `once_per_days` throttles every rule and the fallback per recipient via `safety_events`.
- Message **variants** are editable (one per line) and rotated at send time for rules, story rules and the fallback.
- Button URLs go through `linkForMessage()` so UTM attribution is consistent with campaigns.
- The same verified **Ask for Follow** gate applies to rules and the fallback.
- **Lead answers never trigger a rule** — after capturing an email/phone/name the handler stops.
- **Human takeover wins**: an agent reply sets `conversations.is_bot_active = false`; the processor skips all automation until the agent clicks **Resume automation** in the Inbox header.
- Every decision helper is pure and unit-tested (`tests/dm-rules.test.ts`).

## Configuration surfaces

- **Dashboard → Automation → Auto-replies**: keyword, story, share and reaction rules with priority, variants, throttle, follow gate and preview.
- **Dashboard → Settings → Respond to all DMs**: per-account fallback message, variants, throttle, optional button, optional verified follow gate. Off by default.

Migration: `20261126_dm_rules_hardening.sql` adds the fallback columns and the rule-ordering index.
