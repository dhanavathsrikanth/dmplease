# Story-to-DM — what Meta actually exposes

Status: **complete** for every per-user signal Meta provides.

## Supported signals

| Signal | Webhook shape | Product behaviour |
|---|---|---|
| Story reply | `message.reply_to.story` (current) or `message.reply_to_story` (legacy) | `STORY_REPLY` rule |
| Story mention | `changes.field = 'story_mentions'` / `'mentions'`, or `message.attachments[].type = 'story_mention'` | `STORY_MENTION` rule |
| Reaction to our DM | `message_reactions` (`messaging[].message_reactions` or `changes.field`) | `MESSAGE_REACTION` rule |
| Aggregate story engagement | `changes.field = 'story_insights'` (after expiry) | Stored as `insight_snapshots` metrics (`story_replies`, `story_taps_forward`, …) |

**Constraint:** Meta does **not** expose individual story-tap reactions (the emoji reaction on a story). There is no webhook field or Graph API edge that identifies who reacted. The honest equivalent is a reaction to a DM we sent (`message_reactions`), which does carry the person's IGSID and emoji. The UI labels this "Reaction to your DM" and says so explicitly. Story-tap totals are available only as the aggregate `story_insights` metrics.

## Double-fire prevention

A story reply arrives both as a story interaction and as an inbound message. `isStoryInteraction()` in `lib/meta/webhook.ts` excludes story replies and story-mention attachments from `parseMessageEvents()` (and `parseMessagingInteractions()`), so exactly one rule path handles them.

## Configuration

`Dashboard → Automation → Story to DM` is a dedicated builder for `STORY_REPLY`, `STORY_MENTION` and `MESSAGE_REACTION` rules. It includes the same verified **Ask for Follow** gate (`FollowGateSettings`, hard gate) used by campaigns and auto-replies, plus keyword/reaction filters, button, lead capture, throttling and a live preview. Rules are stored in `dm_rules`; migration `20261126_story_to_dm.sql` adds `MESSAGE_REACTION` to the trigger constraint.
