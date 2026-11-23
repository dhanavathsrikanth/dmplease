---
version: alpha
name: Supabase Inspired
website: "https://supabase.com"
description: >-
  An inspired interpretation of Supabase's design language — an open-source database platform built on a clean white-and-near-black system with a single signature emerald-green CTA, a custom humanist sans display tier, and dense product UI mockups composited above the hero. The brand reads as quietly technical: minimal chrome, a near-monochrome palette, and the green primary acting as the only chromatic event on the page.

seo:
  title: "Supabase Design System for shadcn/ui: Emerald and Circular"
  metaDescription: "Supabase's quiet technical look: near-monochrome chrome, one emerald #3ecf8e CTA with dark text and Circular type, for React, Next.js and AI tools."
  highlights:
    - "Single emerald voltage — #3ecf8e fills CTAs, dot accents, and the wordmark; nothing else is chromatic on the page"
    - "Near-black text on green — the primary button uses #171717 ink on #3ecf8e, not white, which reads as a lit surface"
    - "Display tier at weight 500 with -1.92px tracking at 64px — Circular pulled into engineered editorial density"
    - "Composited product UI mockups are the brand's argument — dashboards and SQL editors replace illustrations and photography entirely"
    - "Square-ish 6px button radius — never pill-shaped; the brand reads as technical, not friendly"
  tags:
    - "Backend, Database & DevOps"
    - "Developer Tools & IDEs"
  lastUpdated: "2026-05-12"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    Supabase's design language is the open-source Postgres platform translated into a near-monochrome marketing surface. The canvas commits to pure white (#ffffff), text sits in near-black (#171717), and the only chromatic event across the entire page is a single emerald green (#3ecf8e) — used as the filled CTA background, the dot accent in the wordmark, and an occasional indicator. Everything else is a calibrated grey ladder from #ededed hairlines through #707070 mute text up to #171717 ink. There is no atmospheric gradient, no full-bleed photography, no dark marketing track. The brand commits to white the way Stripe commits to indigo gradients — with conviction.

    This page packages the system into a single DESIGN.md file in the Google Labs open spec. Inside: 21 color tokens (3 emerald variants, 8 accent points reserved for chart and logo work, 5 surface fills, 6 text grades), 13 typography styles running Circular at weight 500 for display and 400 for body, 6 radius tokens topping out at 16px, an 8-token spacing scale anchored at 8px, and 21 component recipes spanning the green primary button, the inverted dark pricing tier, the canvas-night code block at #1c1c1c, and the composited product UI mockup pattern that does most of the page's visual work.

    Feed the file to Claude, Cursor, or GitHub Copilot and the agent reproduces Supabase's specific restraint — square-ish 6px buttons, near-black text on emerald (never white), display tracking pulled tight at -1.92px, and a white canvas that refuses to fill itself with gradients. Reference the tokens directly inside Tailwind config or use it as a brand audit checklist. The system is worth studying because it proves a developer-facing brand can ship marketing without a single decorative flourish — the product screenshots ARE the decoration.
  related:
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "/blocks"
      title: "React blocks for shadcn/ui"
      description: "Production-ready hero, pricing, CTA, and dashboard sections built with the same Tailwind + shadcn primitives."
  questions:
    - id: "primary-color"
      title: "What is Supabase's primary brand color?"
      answer: "Supabase's signature color is an emerald green at #3ecf8e — used as the filled CTA background, the dot accent in the wordmark, and an occasional indicator. The pressed state shifts to a deeper emerald at #24b47e, and a lighter #4ade80 appears inside chart accents and product UI. Crucially the brand pairs the green with near-black #171717 text rather than white, which gives the button a 'lit surface' quality rather than a colored-chip feel. Across the entire marketing site the green is the only chromatic event — everything else is greyscale."
    - id: "dark-mode"
      title: "Does Supabase use a dark mode in its marketing?"
      answer: "The mainline marketing site commits to white. Canvas is pure #ffffff with a faintly tinted off-white #fafafa used for alternating bands. The dark palette — canvas-night at #1c1c1c and canvas-night-soft at #202020 — is reserved for code blocks, the inverted featured pricing tier, and the dashboard mockups that get composited above the hero. The product app itself defaults to dark, but the marketing surfaces stay white. This DESIGN.md captures the public marketing track."
    - id: "typography"
      title: "What font does Supabase use, and what should I use if Circular isn't licensed?"
      answer: "The system runs Circular (a proprietary geometric humanist sans by Lineto) at weight 500 for display and 400 for body, with a Helvetica Neue / Helvetica / Arial fallback chain. Display tiers stair-step 64px / 48px / 36px / 28px / 22px with negative tracking from -1.92px down to -0.42px to pull the rounded letterforms into editorial density. If Circular isn't available, use Inter at weight 500 with letter-spacing -1.92px at 64px, or Geist Sans from Vercel — both open-source. Avoid Helvetica defaults; they're heavier and lack the geometric warmth."
    - id: "shape-language"
      title: "Why are Supabase's buttons square-ish instead of pill-shaped?"
      answer: "The signature button radius is 6px (rounded.sm) — square-ish and technical, never pill-shaped. The full rounded scale runs 4px / 6px / 8px / 12px / 16px with a 9999px pill reserved for tags and avatars. Feature cards and pricing tiers sit at 12px (rounded.lg). The square-ish button reads as engineered rather than friendly, which is the right register for a developer platform — friendly pill buttons would clash with the dashboard screenshots doing the visual work nearby."
    - id: "use-in-project"
      title: "Can I use this DESIGN.md to build a React app that looks like Supabase?"
      answer: "Yes — feed the file to Claude, Cursor, or any AI agent that reads structured design tokens and it will reproduce Supabase's specific restraint: square 6px buttons, near-black text on the emerald primary, display weights capped at 500 with negative tracking, and a white canvas that refuses gradients. Reference the tokens directly inside Tailwind config or CSS variables: every hex (#3ecf8e, #171717, #1c1c1c, #ededed) is quoted so it pastes cleanly into theme files. The 21 component recipes give you the button, card, code-block, pricing-tier, and nav-bar patterns ready to map onto shadcn primitives."
    - id: "known-gaps"
      title: "What's missing from this Supabase DESIGN.md spec?"
      answer: "A handful of items the captured surfaces don't cover: the in-product dashboard chrome (table headers, SQL editor syntax highlighting, log-stream row densities), the focus-ring system on form inputs, the hover-state colors beyond the documented pressed-state #24b47e, full empty / loading / skeleton screens, and the toast / inline-alert color system. The spec captures the marketing track plus the headline product mockups composited above the hero — roughly the public surface a visitor sees before signing up."

colors:
  primary: "#3ecf8e"
  primary-deep: "#24b47e"
  primary-soft: "#4ade80"
  ink: "#171717"
  ink-secondary: "#212121"
  ink-mute: "#707070"
  ink-mute-2: "#9a9a9a"
  ink-faint: "#b2b2b2"
  on-primary: "#171717"
  on-dark: "#ffffff"
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  canvas-night: "#1c1c1c"
  canvas-night-soft: "#202020"
  hairline: "#dfdfdf"
  hairline-strong: "#c7c7c7"
  hairline-cool: "#ededed"
  hairline-cool-2: "#efefef"
  hairline-cool-3: "#d4d4d4"
  accent-purple: "#6b01c2"
  accent-violet: "#644fc1"
  accent-purple-soft: "#eddbf9"
  accent-yellow: "#ffdb13"
  accent-tomato: "#ff2201"
  accent-pink: "#c7007e"
  accent-indigo: "#054cff"
  accent-crimson: "#e2005a"

typography:
  display-xxl:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 64px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -1.92px
  display-xl:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 48px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -1.44px
  display-lg:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -0.72px
  display-md:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 28px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.42px
  heading-lg:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
  heading-md:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  body-lg:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-md:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  button-md:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: 0
  caption:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  micro:
    fontFamily: "Circular, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  code:
    fontFamily: "ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  huge: 64px

components:
  button-primary-green:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  button-primary-green-pressed:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  button-secondary-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  button-on-dark:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-dark}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
  button-link:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 8px 12px
  card-feature-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 32px
  card-pricing:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 32px
  card-pricing-featured:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 32px
  card-feature-dark:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 32px
  code-block:
    backgroundColor: "{colors.canvas-night}"
    textColor: "{colors.on-dark}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
    padding: 16px
  pill-tag-green:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  pill-tag-soft:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  nav-bar-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 16px 24px
  link-on-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: 0px
  footer-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-mute}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 64px 24px
---

## Overview

Supabase's design language is engineered for clarity above all else. The marketing surfaces sit on `{colors.canvas}` (pure white `#ffffff`), with text rendered in `{colors.ink}` (`#171717` — near-black, never pure black). Across the entire system the only consistent chromatic event is the **emerald green primary** (`{colors.primary}` — `#3ecf8e`) — used as the filled CTA, occasional accent dot, and the signature highlight color in the wordmark. Everything else is a calibrated grey ladder from `#ededed` hairline-cool to `#171717` ink, with thin black-on-white typography doing most of the visual work.

Typography runs **Circular** at weight 500 for display and 400 for body. The display tier uses tight negative letter-spacing (`-1.92px` at 64px) to pull the rounded humanist letterforms into editorial density. There's no atmospheric gradient, no full-bleed photography, no dark-canvas marketing track — the brand commits to white.

The product itself appears as composited UI screenshots on every page: dashboard tables, SQL editors, query builders, log streams. These screenshots are the brand's argument. They sit inside `{rounded.lg}` 12px containers with subtle 1px hairlines, often arranged 2-up or in a floating "stacked panes" composition above the hero band.

**Key Characteristics:**

- Single emerald primary (`{colors.primary}` `#3ecf8e`) as the only chromatic event; everything else is monochrome.
- White canvas marketing track with greyscale hierarchy from `{colors.hairline-cool}` (`#ededed`) to `{colors.ink}` (`#171717`).
- Custom humanist sans display tier at weight 500 with negative letter-spacing of `-1.92px` to `-0.42px`.
- Composited product UI screenshots (dashboard, SQL editor, log stream) are the dominant decorative element — never photography, never illustrations.
- Tight 6px / 8px button radii — square-ish, technical, never pill-shaped.
- Code blocks rendered in deep `{colors.canvas-night}` (`#1c1c1c`) with monospace inline code; the brand's developer DNA is visible in every snippet.
- Pricing tiers use a dark inverted `{colors.canvas-night}` featured tier, not a green one — the green is reserved for buttons and dot accents.
- Near-black `#171717` text on the emerald button (not white) — the green reads as a "lit" surface with dark type, which is the brand's idiosyncratic choice.

## Known Gaps

- **In-product dashboard chrome:** table header densities, SQL-editor syntax-highlighting palette, and log-stream row treatments live inside the product app and weren't captured on the public marketing surfaces.
- **Focus rings:** form inputs document the border and padding but not the focus-ring color, width, or offset on `:focus-visible`.
- **Hover-state colors:** beyond the documented pressed state at `{colors.primary-deep}` (`#24b47e`), hover-state lifts on cards and link rows were not consistently observable.
- **Empty / loading / skeleton screens:** not visible on the captured marketing pages.
- **Toast and inline-alert system:** semantic info / success / warning / error treatments aren't represented in the marketing track.
- **Dark-mode marketing variant:** the product app defaults to dark but the marketing site commits to white; the inverse mapping (which tokens swap in a dark marketing build) isn't captured.
