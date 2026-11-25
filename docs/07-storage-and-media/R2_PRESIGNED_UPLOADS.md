 Show how to generate Cloudflare R2 presigned upload URLs in Next.js for creator avatars and link thumbnails.

Generating Cloudflare R2 presigned upload URLs lets your Next.js backend validate file type, size, and creator ownership up front, while allowing the browser to PUT the image directly to R2 without routing binary uploads through your Next.js server.

For a link-in-bio and Instagram DM platform, storing creator avatars under `creators/{creatorId}/avatar-{uuid}.{ext}` and link thumbnails under `creators/{creatorId}/thumbnails/{linkId}-{uuid}.{ext}` keeps keys organized, prevents filename collisions, and pairs cleanly with a custom public CDN domain ([https://cdn.yourdomain.com/](https://cdn.yourdomain.com/)...) for $0 egress.

---

### How the Presigned Upload Flow Works

1. **Request a presigned PUT URL from Next.js:** The creator's browser sends the intended asset kind (avatar or thumbnail), MIME type (image/jpeg, image/png, image/webp), and file size to your authenticated API route.
2. **Validate permissions, MIME type, and size:** Your server checks the authenticated creatorId, restricts uploads to safe image MIME types, enforces a max byte limit (e.g., 2 MB for avatars, 5 MB for thumbnails), and builds a structured object key.
3. **Sign a short-lived S3 PutObject URL for R2:** Using @aws-sdk/s3-request-presigner pointing at `https://{accountId}.r2.cloudflarestorage.com` with region: "auto", generate a presigned PUT URL (e.g., valid for 60–120 seconds) locked to that exact Key and ContentType.
4. **Upload directly from browser to R2 and save public URL:** The browser sends a PUT request with Content-Type and the raw image bytes straight to R2, then saves the final public CDN URL ([https://cdn.yourdomain.com/](https://cdn.yourdomain.com/){key}) in your database and invalidates the creator's cached bio config in Redis.

---

### 1. Dependencies & Environment Variables

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```env
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_s3_api_token_access_key
R2_SECRET_ACCESS_KEY=your_r2_s3_api_token_secret_key
R2_BUCKET_NAME=creator-media-prod
R2_PUBLIC_CDN_URL=https://cdn.yourdomain.com
```

Also configure CORS on your R2 bucket in the Cloudflare dashboard so your Next.js app origin can make browser PUT requests:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

### 2. R2 Client & Upload Validation Helper (`lib/r2-upload.ts`)

```typescript
import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type UploadAssetKind = "avatar" | "thumbnail";

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_BYTES_BY_KIND: Record<UploadAssetKind, number> = {
  avatar: 2 * 1024 * 1024,    // 2 MB
  thumbnail: 5 * 1024 * 1024, // 5 MB
};

let r2ClientSingleton: S3Client | null = null;

export function getR2Client(): S3Client {
  if (r2ClientSingleton) return r2ClientSingleton;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing Cloudflare R2 S3 credentials in environment");
  }

  r2ClientSingleton = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return r2ClientSingleton;
}

export function validateUploadRequest(params: {
  kind: UploadAssetKind;
  contentType: string;
  fileSizeBytes: number;
  linkId?: string;
}): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = ALLOWED_IMAGE_TYPES[params.contentType];
  if (!ext) {
    return {
      ok: false,
      error: "Unsupported image type. Allowed: JPEG, PNG, WebP.",
    };
  }

  const maxBytes = MAX_BYTES_BY_KIND[params.kind];
  if (!Number.isFinite(params.fileSizeBytes) || params.fileSizeBytes <= 0) {
    return { ok: false, error: "Invalid file size." };
  }
  if (params.fileSizeBytes > maxBytes) {
    return {
      ok: false,
      error: `File exceeds max size of ${Math.floor(maxBytes / (1024 * 1024))} MB for ${params.kind}.`,
    };
  }

  if (params.kind === "thumbnail" && !params.linkId) {
    return { ok: false, error: "linkId is required for link thumbnails." };
  }

  return { ok: true, ext };
}

export function buildR2ObjectKey(params: {
  creatorId: string;
  kind: UploadAssetKind;
  ext: string;
  linkId?: string;
}): string {
  const uniqueId = crypto.randomUUID();
  if (params.kind === "avatar") {
    return `creators/${params.creatorId}/avatar-${uniqueId}.${ext}`;
  }
  return `creators/${params.creatorId}/thumbnails/${params.linkId}-${uniqueId}.${ext}`;
}

export function getPublicAssetUrl(objectKey: string): string {
  const baseUrl = (process.env.R2_PUBLIC_CDN_URL || "").replace(/\/+$/, "");
  return `${baseUrl}/${objectKey}`;
}

export async function createPresignedImageUploadUrl(params: {
  objectKey: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME is required");
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.objectKey,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
    // Immutable cache header for versioned UUID filenames
    CacheControl: "public, max-age=31536000, immutable",
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: params.expiresInSeconds ?? 120,
  });
}
```

---

### 3. Next.js Route to Issue the Presigned URL (`app/api/uploads/presign/route.ts`)

Always derive creatorId from your authenticated session on the server rather than trusting a creatorId sent blindly in the request body.

```typescript
import { NextResponse } from "next/server";
import {
  buildR2ObjectKey,
  createPresignedImageUploadUrl,
  getPublicAssetUrl,
  validateUploadRequest,
  type UploadAssetKind,
} from "@/lib/r2-upload";

// Replace with your real session / auth lookup
async function getAuthenticatedCreatorId(_req: Request): Promise<string | null> {
  return null;
}

export async function POST(req: Request) {
  const creatorId = await getAuthenticatedCreatorId(req);
  if (!creatorId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    kind?: UploadAssetKind;
    contentType?: string;
    fileSizeBytes?: number;
    linkId?: string;
  };

  if (body.kind !== "avatar" && body.kind !== "thumbnail") {
    return NextResponse.json(
      { error: "kind must be 'avatar' or 'thumbnail'" },
      { status: 400 }
    );
  }

  const validation = validateUploadRequest({
    kind: body.kind,
    contentType: body.contentType ?? "",
    fileSizeBytes: Number(body.fileSizeBytes ?? 0),
    linkId: body.linkId?.trim(),
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const objectKey = buildR2ObjectKey({
    creatorId,
    kind: body.kind,
    ext: validation.ext,
    linkId: body.linkId?.trim(),
  });

  const uploadUrl = await createPresignedImageUploadUrl({
    objectKey,
    contentType: body.contentType!,
    contentLength: Number(body.fileSizeBytes),
    expiresInSeconds: 120,
  });

  const publicUrl = getPublicAssetUrl(objectKey);

  return NextResponse.json({
    uploadUrl,
    objectKey,
    publicUrl,
    expiresInSeconds: 120,
  });
}
```

---

### 4. Client Upload Helper for Avatars & Thumbnails (`lib/client-r2-upload.ts`)

The Content-Type header on the PUT request must match the exact contentType used when signing the URL.

```typescript
"use client";

import type { UploadAssetKind } from "./r2-upload";

export async function uploadCreatorAssetToR2(params: {
  file: File;
  kind: UploadAssetKind;
  linkId?: string;
}): Promise<{ publicUrl: string; objectKey: string }> {
  const presignRes = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: params.kind,
      contentType: params.file.type,
      fileSizeBytes: params.file.size,
      linkId: params.linkId,
    }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || "Failed to get upload URL");
  }

  const { uploadUrl, objectKey, publicUrl } = (await presignRes.json()) as {
    uploadUrl: string;
    objectKey: string;
    publicUrl: string;
  };

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": params.file.type,
    },
    body: params.file,
  });

  if (!putRes.ok) {
    throw new Error(`Direct upload to storage failed (${putRes.status})`);
  }

  return { publicUrl, objectKey };
}
```

---

### Practical Tips for Creator Media

* **Use Unique Keys + Long Cache TTLs:** Including a UUID in `avatar-{uuid}.webp` or `{linkId}-{uuid}.webp` lets you cache images aggressively at the edge (`max-age=31536000, immutable`) without stale-image confusion when a creator swaps their avatar or thumbnail.
* **Delete Replaced Assets Later (Optional):** When a creator replaces an avatar or thumbnail and updates their database record, you can queue an R2 `DeleteObjectCommand` in the background (or use an R2 lifecycle rule) so old unused files don't accumulate indefinitely."
