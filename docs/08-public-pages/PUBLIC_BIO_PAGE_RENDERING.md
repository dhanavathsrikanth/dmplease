 Show how to render a cached public creator link-in-bio page in Next.js App Router using Upstash Redis and Cloudflare R2 image URLs.

To render a fast public creator link-in-bio page (such as app/[handle]/page.tsx) in Next.js App Router for a LinkPlease / Zorcha alternative, combine:

* Upstash Redis cache-aside (`getCachedBioConfig`) so sub-10ms profile/link lookups avoid repeated database hits during viral Instagram reel traffic.
* Cloudflare R2 CDN image URLs ([https://cdn.yourdomain.com/](https://cdn.yourdomain.com/)...) for avatars and link thumbnails, configured in `next.config.ts` (`images.remotePatterns`) and rendered cleanly via `next/image` with safe fallbacks.
* Click tracking via `/go/[linkId]` (from your Redis counter + periodic flush pipeline) rather than mutating analytics counters on page render.

---

### 1. Allow Your Cloudflare R2 CDN Domain in next.config.ts

Add your R2 custom domain (and optionally images.unsplash.com or fallback origins if needed) to `images.remotePatterns` so `next/image` can optimize and serve creator avatars and thumbnails:

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.yourdomain.com",
        pathname: "/creators/**",
      },
    ],
  },
};

export default nextConfig;
```

---

### 2. Helper to Validate R2 Image URLs (`lib/asset-url.ts`)

Creators may leave a link thumbnail blank or paste an untrusted URL. Helper functions let you normalize or safely check R2 CDN URLs before passing them to `next/image`.

```typescript
// lib/asset-url.ts
export function isAllowedCreatorImageUrl(url?: string | null): url is string {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const cdnOrigin = process.env.NEXT_PUBLIC_R2_CDN_URL
      ? new URL(process.env.NEXT_PUBLIC_R2_CDN_URL).origin
      : null;

    if (parsed.protocol !== "https:") return false;
    if (cdnOrigin && parsed.origin === cdnOrigin) return true;

    // Fallback allowlist if a creator uses a verified R2/CDN hostname
    return parsed.hostname.startsWith("cdn.");
  } catch {
    return false;
  }
}
```

---

### 3. Dynamic SEO Metadata & Public Link-in-Bio Page (`app/[handle]/page.tsx`)

Using `generateMetadata` alongside the Server Component page lets social previews (Instagram bio links, WhatsApp, X) render rich titles and avatar images while the page itself reads the cached `CreatorBioConfig` from Upstash Redis (`getCachedBioConfig(handle)`).

Note: Place `app/[handle]/page.tsx` only after any static top-level routes (like `/dashboard`, `/login`, `/api`) so Next.js routes static paths cleanly first.

```typescript
// app/[handle]/page.tsx
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getCachedBioConfig } from "@/lib/creator-cache";
import { isAllowedCreatorImageUrl } from "@/lib/asset-url";

// Ensure dynamic per-handle requests read live Redis cache and honor cache invalidation
export const dynamic = "force-dynamic";

interface BioPageProps {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({
  params,
}: BioPageProps): Promise<Metadata> {
  const { handle } = await params;
  const config = await getCachedBioConfig(handle);

  if (!config) {
    return {
      title: "Creator Not Found",
    };
  }

  const avatar = isAllowedCreatorImageUrl(config.avatarUrl)
    ? config.avatarUrl
    : undefined;

  return {
    title: `${config.displayName} (@${config.handle}) | Links`,
    description: config.bio || `Explore links and resources from ${config.displayName}.`,
    openGraph: {
      title: `${config.displayName} (@${config.handle})`,
      description: config.bio || `Explore links and resources from ${config.displayName}.`,
      images: avatar ? [{ url: avatar, width: 400, height: 400, alt: config.displayName }] : [],
    },
  };
}

export default async function CreatorBioPage({ params }: BioPageProps) {
  const { handle } = await params;
  const config = await getCachedBioConfig(handle);

  if (!config) {
    notFound();
  }

  const isDark = config.theme === "dark";
  const pageSurfaceClass = isDark
    ? "bg-neutral-950 text-neutral-100"
    : "bg-stone-50 text-neutral-900";

  const cardClass = isDark
    ? "border-neutral-800 bg-neutral-900/80 hover:border-neutral-700 hover:bg-neutral-900"
    : "border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm";

  const subtleTextClass = isDark ? "text-neutral-400" : "text-stone-600";
  const hasValidAvatar = isAllowedCreatorImageUrl(config.avatarUrl);

  return (
    <main className={`min-h-screen px-4 py-10 ${pageSurfaceClass}`}>
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        {/* Creator Avatar from Cloudflare R2 CDN */}
        <div className="relative h-24 w-24 overflow-hidden rounded-full border border-black/10 shadow-sm">
          {hasValidAvatar ? (
            <Image
              src={config.avatarUrl}
              alt={`${config.displayName} avatar`}
              fill
              sizes="96px"
              priority
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-stone-200 text-2xl font-semibold text-stone-700">
              {config.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        {/* Handle & Bio */}
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {config.displayName}
        </h1>
        <p className={`text-sm ${subtleTextClass}`}>@{config.handle}</p>

        {config.bio ? (
          <p className={`mt-3 text-center text-sm leading-relaxed ${subtleTextClass}`}>
            {config.bio}
          </p>
        ) : null}

        {/* Links List routed through /go/[linkId] for Redis click tracking */}
        <div className="mt-7 flex w-full flex-col gap-3">
          {config.links.map((link) => {
            const hasThumb = isAllowedCreatorImageUrl(link.thumbnailUrl);

            return (
              <a
                key={link.id}
                href={`/go/${encodeURIComponent(link.id)}`}
                rel="noopener noreferrer"
                className={`group flex items-center gap-3.5 rounded-xl border p-3 transition ${cardClass}`}
              >
                {hasThumb ? (
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-black/5">
                    <Image
                      src={link.thumbnailUrl!}
                      alt={link.label}
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  </div>
                ) : null}

                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {link.label}
                </span>

                <span className={`text-xs transition-transform group-hover:translate-x-0.5 ${subtleTextClass}`}>
                  →
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </main>
  );
}
```

---

### 4. Custom 404 Page for Unclaimed Handles (`app/[handle]/not-found.tsx`)

```typescript
// app/[handle]/not-found.tsx
import Link from "next/link";

export default function CreatorNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 text-center text-stone-900">
      <h1 className="text-xl font-semibold">This creator page doesn&apos;t exist yet</h1>
      <p className="mt-2 max-w-sm text-sm text-stone-600">
        Check the handle in your link or claim it for your own Instagram link-in-bio page.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
      >
        Back to Home
      </Link>
    </main>
  );
}
```

---

### Key Design Choices for High-Traffic Bio Pages

* **Track Clicks on `/go/[linkId]`, Not on Page Load:** Rendering the bio page only reads the cached config from Redis and serves R2 images via CDN, while `/go/[linkId]` records `bio_click` in Redis and 302-redirects to the destination URL—preventing accidental double-counts or bot prefetch inflation on page views.
* **Mark Avatar With priority and Small sizes:** Setting `sizes="96px"` on the avatar and `sizes="44px"` on thumbnails ensures Next.js serves compact mobile image variants rather than oversized images inside Instagram's in-app browser."
