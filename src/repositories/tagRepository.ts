// ============================================================
// Tag Repository — data access for KnowledgeTag
// Tags are simple classification tools, not ownership.
// ============================================================
import { db } from '../db/database';
import type { KnowledgeTag, ID } from '../domain/types';
import { newId, now } from '../domain/id';

export async function getAllTags(): Promise<KnowledgeTag[]> {
  return db.tags.orderBy('name').toArray();
}

export async function getTag(id: ID): Promise<KnowledgeTag | undefined> {
  return db.tags.get(id);
}

export async function getTagByName(name: string): Promise<KnowledgeTag | undefined> {
  const lower = name.toLowerCase().trim();
  const all = await db.tags.toArray();
  return all.find((t) => t.name.toLowerCase() === lower);
}

export function wouldCreateTagCycle(tagId: ID, newParentId: ID | null, allTags: KnowledgeTag[]): boolean {
  if (!newParentId) return false;
  if (tagId === newParentId) return true;
  let curr: string | null | undefined = newParentId;
  const visited = new Set<string>([tagId]);
  while (curr) {
    if (visited.has(curr)) return true;
    visited.add(curr);
    const parent = allTags.find(t => t.id === curr);
    curr = parent?.parentId ?? null;
  }
  return false;
}

export function getDescendantTagIds(tagId: ID, allTags: KnowledgeTag[]): Set<ID> {
  const result = new Set<ID>([tagId]);
  let added = true;
  while (added) {
    added = false;
    for (const t of allTags) {
      if (t.parentId && result.has(t.parentId) && !result.has(t.id)) {
        result.add(t.id);
        added = true;
      }
    }
  }
  return result;
}

export function getTagPath(tag: KnowledgeTag, allTags: KnowledgeTag[]): string {
  const parts: string[] = [tag.name];
  let curr = tag.parentId ? allTags.find(t => t.id === tag.parentId) : undefined;
  const visited = new Set<string>([tag.id]);
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    parts.unshift(curr.name);
    curr = curr.parentId ? allTags.find(t => t.id === curr!.parentId) : undefined;
  }
  return parts.join(' / ');
}

export async function createTag(
  data: Partial<KnowledgeTag> & { name: string }
): Promise<KnowledgeTag> {
  const parentId = data.parentId ?? null;
  const all = await db.tags.toArray();
  const existing = all.find(t => (t.parentId ?? null) === parentId && t.name.toLowerCase() === data.name.trim().toLowerCase());
  if (existing) return existing;
  const maxOrder = all.filter(t => (t.parentId ?? null) === parentId).reduce((max, t) => Math.max(max, t.order ?? 0), -1);
  const tag: KnowledgeTag = {
    id: data.id ?? newId(),
    name: data.name.trim(),
    color: data.color ?? null,
    parentId,
    order: data.order ?? (maxOrder + 1),
    createdAt: data.createdAt ?? now(),
  };
  await db.tags.add(tag);
  return tag;
}

export async function updateTag(
  id: ID,
  changes: Partial<Omit<KnowledgeTag, 'id' | 'createdAt'>>
): Promise<KnowledgeTag | undefined> {
  const existing = await db.tags.get(id);
  if (!existing) return undefined;
  if (changes.parentId !== undefined && changes.parentId !== null) {
    const all = await db.tags.toArray();
    if (wouldCreateTagCycle(id, changes.parentId, all)) {
      throw new Error('Cannot set parent: cycle detected.');
    }
  }
  const updated = { ...existing, ...changes, id };
  await db.tags.put(updated);
  return updated;
}

export async function deleteTag(id: ID): Promise<void> {
  await db.transaction('rw', [db.tags, db.nodes, db.maps], async () => {
    const tagToDelete = await db.tags.get(id);
    if (!tagToDelete) return;
    const targetParent = tagToDelete.parentId ?? null;

    // Promote child tags to the parent of this tag
    const allTags = await db.tags.toArray();
    for (const t of allTags) {
      if (t.parentId === id) {
        await db.tags.update(t.id, { parentId: targetParent });
      }
    }

    // Remove tag from all nodes that reference it
    const nodes = await db.nodes.toArray();
    for (const node of nodes) {
      if (node.tagIds && node.tagIds.includes(id)) {
        await db.nodes.update(node.id, {
          tagIds: node.tagIds.filter((t) => t !== id),
        });
      }
    }

    // Remove tag from all maps that reference it
    const maps = await db.maps.toArray();
    for (const map of maps) {
      if (map.tagIds && map.tagIds.includes(id)) {
        await db.maps.update(map.id, {
          tagIds: map.tagIds.filter((t) => t !== id),
        });
      }
    }

    await db.tags.delete(id);
  });
}

export async function getNodesForTag(tagId: ID): Promise<Array<{ id: ID; title: string }>> {
  const all = await db.nodes.toArray();
  return all
    .filter((n) => n.tagIds && n.tagIds.includes(tagId))
    .map((n) => ({ id: n.id, title: n.title }));
}

export async function searchTags(query: string): Promise<KnowledgeTag[]> {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const all = await db.tags.toArray();
  return all.filter((t) => t.name.toLowerCase().includes(q));
}
