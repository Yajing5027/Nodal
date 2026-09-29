// ============================================================
// Asset Repository — data access for KnowledgeAsset
// Primarily images in V0. Blob stored in IndexedDB.
// description is critical for AI readability on export.
// ============================================================
import { db } from '../db/database';
import type { KnowledgeAsset, ID } from '../domain/types';
import { newId, now } from '../domain/id';

export async function getAllAssets(): Promise<KnowledgeAsset[]> {
  return db.assets.orderBy('createdAt').reverse().toArray();
}

export async function getAsset(id: ID): Promise<KnowledgeAsset | undefined> {
  return db.assets.get(id);
}

export async function getAssetsByIds(ids: ID[]): Promise<KnowledgeAsset[]> {
  if (ids.length === 0) return [];
  return db.assets.where('id').anyOf(ids).toArray();
}

export async function createAsset(
  data: Partial<KnowledgeAsset> & { filename: string; mimeType: string; blob: Blob }
): Promise<KnowledgeAsset> {
  const ts = now();
  const asset: KnowledgeAsset = {
    id: data.id ?? newId(),
    filename: data.filename,
    mimeType: data.mimeType,
    blob: data.blob,
    description: data.description ?? '',
    createdAt: ts,
    updatedAt: ts,
  };
  await db.assets.add(asset);
  return asset;
}

export async function updateAsset(
  id: ID,
  changes: Partial<Omit<KnowledgeAsset, 'id' | 'createdAt' | 'blob' | 'mimeType' | 'filename'>>
): Promise<KnowledgeAsset | undefined> {
  const existing = await db.assets.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...changes, id, updatedAt: now() };
  await db.assets.put(updated);
  return updated;
}

export async function deleteAsset(id: ID): Promise<void> {
  // Remove asset reference from all nodes
  const nodes = await db.nodes.toArray();
  await db.transaction('rw', [db.assets, db.nodes], async () => {
    for (const node of nodes) {
      if (node.assetIds.includes(id)) {
        await db.nodes.update(node.id, {
          assetIds: node.assetIds.filter((a) => a !== id),
        });
      }
    }
    await db.assets.delete(id);
  });
}

/**
 * Create an object URL for an asset blob.
 * Caller must revoke the URL when done.
 */
export function assetToUrl(asset: KnowledgeAsset): string {
  return URL.createObjectURL(asset.blob);
}
