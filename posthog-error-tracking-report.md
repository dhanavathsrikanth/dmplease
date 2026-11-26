# PostHog Error Tracking

> ⚠️ **Needs your attention**
> - In Vercel Project Settings → Environment Variables, add `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, and `NEXT_PUBLIC_POSTHOG_HOST`, then redeploy. Scope the variables to Production; include Preview too if preview deployments should report errors or upload source maps.

## What you still need to do

1. In the linked Vercel project (`dmplease`), open **Project Settings → Environment Variables**.
2. Add these variables for the production build and runtime:
   - `POSTHOG_API_KEY` — the personal API key used for source-map upload. Keep it sensitive.
   - `POSTHOG_PROJECT_ID` — `152538`.
   - `POSTHOG_HOST` — the configured EU PostHog host.
   - `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` — the PostHog public project token already used by the client integration.
   - `NEXT_PUBLIC_POSTHOG_HOST` — the configured EU PostHog host used by the client integration.
3. Scope them to **Production**. Add **Preview** as well if every preview deployment should upload/report. Redeploy after saving; Vercel applies changed environment variables only to new deployments. The repository has no checked-in CI file to edit because Vercel's dashboard controls this deployment.
4. After redeploying, confirm the Vercel build log reports a successful source-map upload and check the new symbol set in PostHog at `https://eu.posthog.com/project/152538/error_tracking/configuration`.

## How errors reach PostHog now

- Browser errors are captured through `capture_exceptions` in `instrumentation-client.ts`.
- Errors swallowed by Next.js's global React error boundary are captured in `app/global-error.tsx`.
- Server Component, Route Handler, and Server Action request errors are captured through `createOnRequestError(...)` in `instrumentation.ts`.
- Node-runtime exception autocapture is enabled in `lib/posthog-error-server.ts`.
- Middleware errors are covered by the `withPostHogProxy` wrapper in `proxy.ts`.

The project already had the PostHog SDK integration, so no new SDK initialization was needed in this run. The existing split remains: browser capture uses `posthog-js`, while server capture uses `posthog-node` and `@posthog/next`.

## Source-map upload

The source-map uploader is wired through these files:

- `next.config.ts`
- `package.json`
- `package-lock.json`

The production build command is:

```bash
npm run build
```

Every production build is configured to upload source maps when `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, and `POSTHOG_HOST` are available where the build runs. `deleteAfterUpload` removes uploaded maps from deployable output.

The wizard verified `npm run build` successfully on the finished code. Next.js 16.4.6 compiled, TypeScript passed, and 60 static pages were generated. The build created release `dmplease@091550eee3994211e737a05ed54a347aabdd060c` and uploaded 293 eligible chunks across six batches. The uploader found 768 source-map pairs; 0 eligible chunks were skipped. It reported non-fatal notices for 404 generated source-map pairs without a PostHog chunk/native debug ID and some duplicate chunk IDs.

Local credentials were present during that verified build. The linked Vercel environment currently lacks the five PostHog variables listed above, so Vercel uploads start only after those variables are added there and a new deployment runs.

## Release linking

Release linking was not wired as a separate deploy step. Vercel's standard Git deployment already exposes `VERCEL_GIT_REPO_SLUG` and `VERCEL_GIT_COMMIT_SHA` to the build, but no runtime `POSTHOG_RELEASE_ID` handoff was added. Therefore, this run does not claim that production exceptions will automatically include a resolved release ID.

## How to verify

Trigger an error in the deployed app and inspect:

- Errors: `https://eu.posthog.com/project/152538/error_tracking`
- Uploaded symbol sets: `https://eu.posthog.com/project/152538/error_tracking/configuration`

After the next Vercel production deployment with the required variables, confirm the build log shows a successful upload and that the resulting stack traces resolve to source locations. The first verified symbol set is already in PostHog from the wizard's credentialed build under release `dmplease@091550eee3994211e737a05ed54a347aabdd060c`.
