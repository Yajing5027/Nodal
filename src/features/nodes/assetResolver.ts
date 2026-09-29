// ============================================================
// Asset URL Resolver — converts asset://<id> references to blob URLs
// Used by MDXEditor's imagePreviewHandler and ImageManager thumbnails.
// Caches object URLs; callers must revoke when no longer needed.
// ============================================================
import { getAsset } from '../../repositories/assetRepository';
import type { ID } from '../../domain/types';

const urlCache = new Map<ID, string>();

/**
 * Resolve an image source string. If it starts with `asset://`, fetch the
 * asset from IndexedDB, create an object URL, cache it, and return it.
 * Otherwise return the source unchanged (regular http(s) URLs, data URIs).
 */
export async function resolveAssetUrl(source: string): Promise<string> {
  if (!source.startsWith('asset://')) return source;
  const assetId = source.slice('asset://'.length) as ID;
  const cached = urlCache.get(assetId);
  if (cached) return cached;
  try {
    const asset = await getAsset(assetId);
    if (!asset) return source;
    const url = URL.createObjectURL(asset.blob);
    urlCache.set(assetId, url);
    return url;
  } catch {
    return source;
  }
}

/** Revoke a single cached asset URL by asset id. */
export function revokeAssetUrl(assetId: ID): void {
  const url = urlCache.get(assetId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(assetId);
  }
}

/** Revoke all cached asset URLs. Call on app unmount or major reset. */
export function revokeAllAssetUrls(): void {
  for (const url of urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
}
