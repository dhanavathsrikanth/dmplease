# Applying for the Meta Verified Tech Provider badge

> Business action, not code. Required to close the trust gap with LinkPlease
> ("Meta Verified Tech Provider").

## Why it matters

LinkPlease's homepage and comparison pages lead with the **Meta Verified Tech
Provider** badge and "100% Safe & Verified by Meta" copy. For a safety-focused
product, not having this badge is a credibility gap. It is a free application;
the badge is awarded by Meta, not purchased.

## Prerequisites (must all be true before applying)

1. A **Meta Business Portfolio** (Business Manager) verified with a real business.
2. A **Facebook App** with the Instagram Messaging / Graph API products added.
3. At least one **Instagram Business or Creator account** connected and sending
   live traffic through the app (Meta wants to see real usage).
4. A **privacy policy URL** and **terms of service URL** on a public domain.
5. A **data deletion callback URL** (we have `/api/...`? verify; add one if
   missing).
6. App Review completed for the permissions we use:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `instagram_manage_comments`
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`
   - `business_management` (if applicable)

## Application steps

1. Go to **Meta for Developers → your app → App Dashboard → Settings → Basic**.
2. Under **"App Verification"** / **"Business Verification"**, submit the
   business documents Meta requests (business registration, tax ID, etc.).
3. Once business verification is approved, request **Tech Provider** status from
   the **"Tech Provider"** section of the app dashboard (or via Meta's partner
   portal: partners.facebook.com).
4. Provide:
   - Company name, website, description of the integration.
   - The Instagram accounts the app manages (screenshots acceptable).
   - A demo video (2–3 min) showing the OAuth flow, a comment → DM, and the
     safety dashboard.
   - Privacy policy and terms URLs.
5. Wait for review (typically 1–4 weeks). Meta may request changes.

## What to show in the demo video

1. Creator signs up and connects Instagram via OAuth (no password sharing).
2. A commenter types a keyword; the DM is delivered; a public reply appears.
3. The safety dashboard shows real numbers (sends, breaches, queue, score).
4. A viral spike is simulated (optional) showing throttling and queueing.
5. Opt-out ("STOP") handling.

## After approval

1. Add the badge asset to the marketing site (`app/page.tsx` hero and footer).
2. Add "Meta Verified Tech Provider" to comparison pages.
3. Update `LINKPLEASE_FEATURE_ANALYSIS.md` gap table (Trust row → parity).
4. Update `PRODUCT_DEVELOPMENT_TIERS.md` trust section.

## Where the badge lives in code (after approval)

- `app/page.tsx` — hero trust strip and footer (replace the text badge).
- `app/pricing` if we add a pricing page.
- `components/marketing/*` if any.

## Notes

- Meta Tech Provider status is **free**; it is awarded, not purchased.
- Do not claim the badge before approval — Meta's brand guidelines prohibit it.
- Re-verify annually; Meta re-checks active usage.