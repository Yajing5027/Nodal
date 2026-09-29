import type { Table } from 'dexie';
import { db } from '../db/database';
import { RECALL_DRAFT_KEY } from '../db/schema';
import { COURSE_TAG_DEFS } from './tagMigration';

const KEY = 'workspace-cleanup-archive-v1';
const tables = (): Table<object, string>[] => [
  db.nodes,
  db.maps,
  db.occurrences,
  db.frames,
  db.relations,
  db.assets,
  db.retrievalTargets,
  db.memoryStates,
  db.reviewEvents,
  db.semesterPlans,
  db.planAssignments,
  db.planExecutionStates,
];
interface Archive { createdAt:number; rows:Record<string, object[]>; drafts:unknown }
export async function hasCleanupArchive() { return !!(await db.meta.get(KEY)); }

/**
 * Formal Workspace Clean Sweep:
 * Clears notes, maps, occurrences, frames, relations, assets,
 * retrievalTargets, memoryStates, reviewEvents, planAssignments, planExecutionStates,
 * and demo semesterPlans.
 * Clears temporary meta keys (drafts, archive records, etc.).
 * Guarantees that the 15 Course Tags (with Discrete Mathematics) remain intact in db.tags.
 */
export async function executeFormalWorkspaceCleanSweep(): Promise<{
  success: boolean;
  clearedTables: string[];
  tagCount: number;
}> {
  const contentTables = tables();

  await db.transaction('rw', [...contentTables, db.tags, db.meta], async () => {
    // 1. Clear all user content tables
    for (const table of contentTables) {
      await table.clear();
    }

    // 2. Clear transient meta entries like drafts, ratings cache, cleanup archive keys
    await db.meta.delete(RECALL_DRAFT_KEY);
    await db.meta.delete(KEY);
    await db.meta.delete('section-ratings-v1');

    // 3. Ensure the 15 standard course tags exist and are preserved
    const existingTags = await db.tags.toArray();
    const existingIds = new Set(existingTags.map(t => t.id));
    const timestamp = Date.now();
    for (const def of COURSE_TAG_DEFS) {
      if (!existingIds.has(def.id)) {
        await db.tags.add({
          id: def.id,
          name: def.name,
          color: def.color,
          parentId: def.parentId,
          order: def.order,
          createdAt: timestamp,
        });
      }
    }
  });

  const finalTagCount = await db.tags.count();
  return {
    success: true,
    clearedTables: contentTables.map(t => t.name),
    tagCount: finalTagCount,
  };
}

/** Reversible, atomic cleanup. Preserves course tags while clearing content. */
export async function archiveWorkspaceContent() {
  const archiveTables = [...tables(), db.tags];
  await db.transaction('rw', [...archiveTables, db.meta], async () => {
    if (await db.meta.get(KEY)) throw new Error('A previous cleanup is still available to restore. Restore it before cleaning again.');
    const rows:Record<string, object[]> = {};
    for (const table of archiveTables) rows[table.name] = await table.toArray();
    const drafts = (await db.meta.get(RECALL_DRAFT_KEY))?.value;
    await db.meta.put({key:KEY, value:{createdAt:Date.now(),rows,drafts} satisfies Archive});
    for (const table of archiveTables) await table.clear();
    await db.meta.delete(RECALL_DRAFT_KEY);
  });
}
/** Restore missing original IDs only: notes created/edited since cleanup are preserved. */
export async function restoreWorkspaceContent() {
  const archiveTables = [...tables(), db.tags];
  await db.transaction('rw', [...archiveTables, db.meta], async () => {
    const archive = (await db.meta.get(KEY))?.value as Archive | undefined;
    if (!archive) return;
    for (const table of archiveTables) {
      for (const row of archive.rows[table.name] ?? []) {
        const value = row as Record<string, unknown>;
        const id = (value.id ?? value.retrievalTargetId) as string;
        if (!(await table.get(id))) await table.add(row);
      }
    }
    const current = (await db.meta.get(RECALL_DRAFT_KEY))?.value as Array<{id:string}> | undefined;
    const drafts = archive.drafts as Array<{id:string}> | undefined;
    if (drafts) await db.meta.put({key:RECALL_DRAFT_KEY,value:[...(current ?? []), ...drafts.filter(d => !current?.some(item => item.id === d.id))]});
    await db.meta.delete(KEY);
  });
}



