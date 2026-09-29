// ============================================================
// Dexie Database Instance — the persistent source of truth
// ============================================================
// React state = UI state
// React Flow = Map projection
// MDXEditor = Editor UI
// Dexie = persistent source of truth
//
// No component state may become the only source of user knowledge.

import Dexie, { type Table } from 'dexie';
import { DB_NAME } from './schema';
import { applyMigrations } from './migrations';
import type {
  KnowledgeNode,
  KnowledgeMap,
  MapOccurrence,
  KnowledgeFrame,
  KnowledgeRelation,
  KnowledgeTag,
  KnowledgeAsset,
  RetrievalTarget,
  MemoryState,
  ReviewEvent,
  SemesterPlan,
  PlanAssignment,
  PlanExecutionState,
} from '../domain/types';

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class KnowledgeDatabase extends Dexie {
  nodes!: Table<KnowledgeNode, string>;
  maps!: Table<KnowledgeMap, string>;
  occurrences!: Table<MapOccurrence, string>;
  frames!: Table<KnowledgeFrame, string>;
  relations!: Table<KnowledgeRelation, string>;
  tags!: Table<KnowledgeTag, string>;
  assets!: Table<KnowledgeAsset, string>;
  retrievalTargets!: Table<RetrievalTarget, string>;
  memoryStates!: Table<MemoryState, string>;
  reviewEvents!: Table<ReviewEvent, string>;
  semesterPlans!: Table<SemesterPlan, string>;
  planAssignments!: Table<PlanAssignment, string>;
  planExecutionStates!: Table<PlanExecutionState, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super(DB_NAME);
    applyMigrations(this);
  }
}

export const db = new KnowledgeDatabase();
if (typeof window !== 'undefined') {
  (window as any).__nodal_db = db;
}

/**
 * Check whether the database has any Nodes. Generic utility; startup no longer
 * auto-creates any content, so an empty workspace simply opens as empty.
 */
export async function isEmptyDatabase(): Promise<boolean> {
  const count = await db.nodes.count();
  return count === 0;
}

/**
 * Clear all data — used by import (replace strategy) and testing.
 * Must be called inside a transaction or with explicit user confirmation.
 */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.nodes, db.maps, db.occurrences, db.frames, db.relations, db.tags, db.assets,
      db.retrievalTargets, db.memoryStates, db.reviewEvents, db.semesterPlans, db.planAssignments, db.planExecutionStates, db.meta],
    async () => {
      await db.nodes.clear();
      await db.maps.clear();
      await db.occurrences.clear();
      await db.frames.clear();
      await db.relations.clear();
      await db.tags.clear();
      await db.assets.clear();
      await db.retrievalTargets.clear();
      await db.memoryStates.clear();
      await db.reviewEvents.clear();
      await db.semesterPlans.clear();
      await db.planAssignments.clear();
      await db.planExecutionStates.clear();
      await db.meta.clear();
    }
  );
}
