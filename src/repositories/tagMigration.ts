// ============================================================
// Course Tag Hierarchy Migration & Deterministic Assignment
// ============================================================
import { db } from '../db/database';
import type { KnowledgeTag } from '../domain/types';

export const COURSE_TAG_DEFS = [
  // Tree 1: Math
  { id: 'tag-math', name: 'Math', parentId: null, order: 0, color: '#3b82f6' },
  { id: 'tag-math-linear-algebra', name: 'Linear Algebra', parentId: 'tag-math', order: 0, color: null },
  { id: 'tag-math-calculus', name: 'Calculus', parentId: 'tag-math', order: 1, color: null },
  { id: 'tag-math-functions', name: 'Functions', parentId: 'tag-math', order: 2, color: null },
  { id: 'tag-math-trigonometry', name: 'Trigonometry', parentId: 'tag-math-functions', order: 0, color: null },
  { id: 'tag-math-geometry', name: 'Geometry', parentId: 'tag-math', order: 3, color: null },
  { id: 'tag-math-solid-geometry', name: 'Solid Geometry', parentId: 'tag-math-geometry', order: 0, color: null },
  { id: 'tag-math-discrete', name: 'Discrete Mathematics', parentId: 'tag-math', order: 4, color: null },

  // Tree 2: Computer Science
  { id: 'tag-cs', name: 'Computer Science', parentId: null, order: 1, color: '#10b981' },
  { id: 'tag-cs-python', name: 'Python', parentId: 'tag-cs', order: 0, color: null },
  { id: 'tag-cs-java', name: 'Java', parentId: 'tag-cs', order: 1, color: null },
  { id: 'tag-cs-algorithms', name: 'Algorithms', parentId: 'tag-cs', order: 2, color: null },
  { id: 'tag-cs-arch', name: 'Computer Architecture', parentId: 'tag-cs', order: 3, color: null },

  // Tree 3: English
  { id: 'tag-english', name: 'English', parentId: null, order: 2, color: '#8b5cf6' },
  { id: 'tag-english-grammar', name: 'Grammar', parentId: 'tag-english', order: 0, color: null },
] as const;

export const RECONSTRUCTION_BACKUP_KEY = 'tag-reconstruction-backup-v1';
export const RECONSTRUCTION_DONE_KEY = 'tag-reconstruction-done';

export interface TagReconstructionBackup {
  createdAt: number;
  originalTags: KnowledgeTag[];
  originalNoteTags: Record<string, string[]>;
  originalMapTags: Record<string, string[]>;
}

/**
 * Deterministic assignment of a note to one of the course tags based on semantic content.
 * Preserves note content without touching markdown.
 * Returns null if no specific topic match is found (never guesses or hashes randomly).
 */
export function assignNoteToCourseTag(node: { id: string; title: string; contentMarkdown?: string }): string | null {
  const text = `${node.title} ${node.contentMarkdown || ''}`.toLowerCase();
  
  // Specific semantic matching
  if (text.includes('discrete') || text.includes('combinatorics') || text.includes('propositional') || text.includes('predicate') || text.includes('boolean algebra') || text.includes('graph theory')) {
    return 'tag-math-discrete';
  }
  if (text.includes('dijkstra') || text.includes('bellman') || text.includes('bfs') || text.includes('breadth-first') || text.includes('greedy') || text.includes('binary search')) {
    return 'tag-cs-algorithms';
  }
  if (text.includes('heap') || text.includes('tree') || text.includes('java')) {
    return 'tag-cs-java';
  }
  if (text.includes('python') || text.includes('software design')) {
    return 'tag-cs-python';
  }
  if (text.includes('operating systems') || text.includes('networking') || text.includes('architecture')) {
    return 'tag-cs-arch';
  }
  if (text.includes('linear algebra')) {
    return 'tag-math-linear-algebra';
  }
  if (text.includes('calculus')) {
    return 'tag-math-calculus';
  }
  if (text.includes('cylinder') || text.includes('solid geometry') || text.includes('volume') || text.includes('sphere')) {
    return 'tag-math-solid-geometry';
  }
  if (text.includes('trigonometry') || text.includes('sin') || text.includes('cos') || text.includes('function')) {
    return 'tag-math-trigonometry';
  }
  if (text.includes('geometry')) {
    return 'tag-math-geometry';
  }
  if (text.includes('grammar') || text.includes('english') || text.includes('learning strategies')) {
    return 'tag-english-grammar';
  }

  // Do NOT guess or hash to random tags if topic cannot be determined
  return null;
}

/**
 * Non-destructive course tag upgrade/verification.
 * Ensures the 15 standard course tags exist in db.tags.
 * Safe to call on every startup: NEVER overwrites or removes existing user tags,
 * notes, or map assignments.
 */
export async function ensureCourseTagsExist(): Promise<{ added: number }> {
  const existingTags = await db.tags.toArray();
  const existingIds = new Set(existingTags.map(t => t.id));
  const missing = COURSE_TAG_DEFS.filter(def => !existingIds.has(def.id));
  if (missing.length > 0) {
    const timestamp = Date.now();
    await db.tags.bulkPut(missing.map(def => ({
      id: def.id,
      name: def.name,
      color: def.color,
      parentId: def.parentId,
      order: def.order,
      createdAt: timestamp,
    })));
  }
  return { added: missing.length };
}

/**
 * Reconstruct course tags according to user requirement 11.
 * Safely creates a durable backup first, then replaces tags with the 3 trees
 * and reassigns notes only if clear semantic match exists.
 */
export async function executeCourseTagReconstruction(): Promise<{
  success: boolean;
  tagCount: number;
  updatedNotesCount: number;
}> {
  const timestamp = Date.now();
  const existingTags = await db.tags.toArray();
  const allNodes = await db.nodes.toArray();
  const allMaps = await db.maps.toArray();

  // 1. Create durable backup in db.meta
  const backup: TagReconstructionBackup = {
    createdAt: timestamp,
    originalTags: existingTags,
    originalNoteTags: Object.fromEntries(allNodes.map(n => [n.id, n.tagIds || []])),
    originalMapTags: Object.fromEntries(allMaps.map(m => [m.id, m.tagIds || []])),
  };

  let updatedNotesCount = 0;

  await db.transaction('rw', [db.tags, db.nodes, db.maps, db.meta], async () => {
    // Only store backup if not already present, preserving earliest true history
    const existingBackup = await db.meta.get(RECONSTRUCTION_BACKUP_KEY);
    if (!existingBackup) {
      await db.meta.put({ key: RECONSTRUCTION_BACKUP_KEY, value: backup });
    }

    // 2. Remove legacy tags and insert 3 root trees with children
    await db.tags.clear();
    const newTags: KnowledgeTag[] = COURSE_TAG_DEFS.map(def => ({
      id: def.id,
      name: def.name,
      color: def.color,
      parentId: def.parentId,
      order: def.order,
      createdAt: timestamp,
    }));
    await db.tags.bulkAdd(newTags);

    // 3. Assign notes only if a clear semantic topic matches, never guessing
    for (const node of allNodes) {
      const assignedTag = assignNoteToCourseTag(node);
      if (assignedTag) {
        await db.nodes.update(node.id, {
          tagIds: [assignedTag],
          updatedAt: timestamp,
        });
        updatedNotesCount++;
      }
    }

    // 4. Record completion flag
    await db.meta.put({ key: RECONSTRUCTION_DONE_KEY, value: true });
  });

  return {
    success: true,
    tagCount: COURSE_TAG_DEFS.length,
    updatedNotesCount,
  };
}

/**
 * Restore original tags and note/map associations from backup
 */
export async function restoreOriginalTags(): Promise<boolean> {
  const entry = await db.meta.get(RECONSTRUCTION_BACKUP_KEY);
  if (!entry || !entry.value) return false;
  const backup = entry.value as TagReconstructionBackup;

  await db.transaction('rw', [db.tags, db.nodes, db.maps, db.meta], async () => {
    await db.tags.clear();
    await db.tags.bulkAdd(backup.originalTags);

    for (const [nodeId, tagIds] of Object.entries(backup.originalNoteTags)) {
      await db.nodes.update(nodeId, { tagIds });
    }
    for (const [mapId, tagIds] of Object.entries(backup.originalMapTags)) {
      await db.maps.update(mapId, { tagIds });
    }
    await db.meta.delete(RECONSTRUCTION_DONE_KEY);
  });
  return true;
}
