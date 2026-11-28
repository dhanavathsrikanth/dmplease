/**
 * Cloudflare R2 asset storage.
 *
 * Browser uploads go straight to R2 with a short-lived presigned PUT URL, so
 * binary data never touches the Next.js server. The resulting public CDN URL
 * is what Meta receives in a message attachment. R2 has no egress fees, which
 * makes it the right backend for high-volume media DMs.
 */

import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { cleanEnv } from "@/lib/config";
import {
  validateAsset,
  type MessageFormat,
} from "@/lib/message-formats";

let client: S3Client | null = null;

export function hasR2(): boolean {
  return Boolean(
    cleanEnv("R2_ACCOUNT_ID") &&
      cleanEnv("R2_ACCESS_KEY_ID") &&
      cleanEnv("R2_SECRET_ACCESS_KEY") &&
      cleanEnv("R2_BUCKET_NAME") &&
      cleanEnv("R2_PUBLIC_CDN_URL")
  );
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cleanEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cleanEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: cleanEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export function getPublicAssetUrl(objectKey: string): string {
  return `${cleanEnv("R2_PUBLIC_CDN_URL").replace(/\/+$/, "")}/${objectKey}`;
}

/**
 * Exact shape of a key produced by `createAssetUpload`:
 *   workspaces/<workspace uuid>/messages/<format>/<asset uuid>.<ext>
 *
 * R2 keys are opaque, so a prefix check is already safe, but matching the
 * generated shape keeps traversal-ish input (`..`, `//`, `\`, `%`) out of the
 * delete path as defense in depth.
 */
const ASSET_KEY_RE =
  /^workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/messages\/[a-z0-9_-]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

export function isWorkspaceAssetKey(
  workspaceId: string,
  objectKey: string
): boolean {
  if (!ASSET_KEY_RE.test(objectKey)) return false;
  if (
    objectKey.includes("..") ||
    objectKey.includes("//") ||
    objectKey.includes("\\") ||
    objectKey.includes("%")
  ) {
    return false;
  }
  return objectKey.startsWith(`workspaces/${workspaceId}/messages/`);
}

export interface AssetUploadTicket {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresInSeconds: number;
}

export async function createAssetUpload(input: {
  workspaceId: string;
  format: MessageFormat;
  mimeType: string;
  sizeBytes: number;
}): Promise<AssetUploadTicket> {
  if (!hasR2()) {
    throw new Error(
      "Cloudflare R2 is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_CDN_URL."
    );
  }
  const validation = validateAsset(
    input.format,
    input.mimeType,
    input.sizeBytes
  );
  if (!validation.ok) throw new Error(validation.error ?? "Invalid asset");

  const objectKey = `workspaces/${input.workspaceId}/messages/${input.format}/${randomUUID()}.${validation.ext}`;
  const command = new PutObjectCommand({
    Bucket: cleanEnv("R2_BUCKET_NAME"),
    Key: objectKey,
    ContentType: input.mimeType,
    ContentLength: input.sizeBytes,
    CacheControl: "public, max-age=31536000, immutable",
  });
  const expiresInSeconds = 120;
  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    objectKey,
    publicUrl: getPublicAssetUrl(objectKey),
    expiresInSeconds,
  };
}

export async function deleteAsset(objectKey: string): Promise<void> {
  if (!hasR2()) return;
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: cleanEnv("R2_BUCKET_NAME"),
      Key: objectKey,
    })
  );
}
