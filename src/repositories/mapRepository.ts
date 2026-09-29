// ============================================================
// Map Repository — data access for KnowledgeMap + MapOccurrence + KnowledgeFrame
// ============================================================
import { db } from '../db/database';
import type { KnowledgeMap, MapOccurrence, KnowledgeFrame, ID } from '../domain/types';
import { newId, now } from '../domain/id';

// ---------- Maps ----------

export async function getAllMaps(): Promise<KnowledgeMap[]> {
  return db.maps.orderBy('updatedAt').reverse().toArray();
}

export async function getMap(id: ID): Promise<KnowledgeMap | undefined> {
  return db.maps.get(id);
}

export async function createMap(
  data: Partial<KnowledgeMap> & { title: string }
): Promise<KnowledgeMap> {
  const ts = now();
  const map: KnowledgeMap = {
    id: data.id ?? newId(),
    title: data.title,
    description: data.description ?? '',
    tagIds: data.tagIds ?? [],
    viewportX: data.viewportX ?? 0,
    viewportY: data.viewportY ?? 0,
    viewportZoom: data.viewportZoom ?? 1,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.maps.add(map);
  return map;
}

export async function updateMap(
  id: ID,
  changes: Partial<Omit<KnowledgeMap, 'id' | 'createdAt'>>
): Promise<KnowledgeMap | undefined> {
  const existing = await db.maps.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...changes, id, updatedAt: now() };
  await db.maps.put(updated);
  return updated;
}

/**
 * Delete a Map and all its owned data.
 * Deletes: occurrences, frames, map-scope relations.
 * Does NOT delete: KnowledgeNode, global relations, Tags, Assets.
 */
export async function deleteMap(mapId: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.maps, db.occurrences, db.frames, db.relations,
      db.retrievalTargets, db.memoryStates, db.reviewEvents, db.planAssignments, db.planExecutionStates],
    async () => {
      const frames = await db.frames.where('mapId').equals(mapId).toArray();
      const mapTargetIds = await db.retrievalTargets
        .where('[sourceType+sourceId]')
        .equals(['map', mapId])
        .primaryKeys();
      const frameTargetGroups = await Promise.all(frames.map((frame) =>
        db.retrievalTargets
          .where('[sourceType+sourceId]')
          .equals(['frame', frame.id])
          .primaryKeys()
      ));
      const learningTargetIds = [...mapTargetIds, ...frameTargetGroups.flat()];
      if (learningTargetIds.length > 0) {
        await db.planExecutionStates.where('retrievalTargetId').anyOf(learningTargetIds).delete();
        await db.reviewEvents.where('retrievalTargetId').anyOf(learningTargetIds).delete();
        await db.memoryStates.where('retrievalTargetId').anyOf(learningTargetIds).delete();
        await db.planAssignments
          .where('subjectType')
          .equals('retrieval_target')
          .filter(a => learningTargetIds.includes(a.subjectId))
          .delete();
        await db.retrievalTargets.bulkDelete(learningTargetIds);
      }
      await db.maps.delete(mapId);
      await db.occurrences.where('mapId').equals(mapId).delete();
      await db.frames.where('mapId').equals(mapId).delete();
      // Delete only map-scope relations for this map
      await db.relations.where('mapId').equals(mapId).delete();
    }
  );
}

// ---------- Occurrences ----------

export async function getOccurrencesForMap(mapId: ID): Promise<MapOccurrence[]> {
  return db.occurrences.where('mapId').equals(mapId).toArray();
}

/** Number of Node occurrences in each Map, loaded in one IndexedDB scan. */
export async function getOccurrenceCountsByMap(): Promise<Record<ID, number>> {
  const occurrences = await db.occurrences.toArray();
  const counts: Record<ID, number> = {};
  for (const occurrence of occurrences) {
    counts[occurrence.mapId] = (counts[occurrence.mapId] ?? 0) + 1;
  }
  return counts;
}

export async function getOccurrence(id: ID): Promise<MapOccurrence | undefined> {
  return db.occurrences.get(id);
}

export async function getOccurrencesForNode(nodeId: ID): Promise<MapOccurrence[]> {
  return db.occurrences.where('nodeId').equals(nodeId).toArray();
}

export async function nodeExistsInMap(mapId: ID, nodeId: ID): Promise<boolean> {
  const count = await db.occurrences
    .where('[mapId+nodeId]')
    .equals([mapId, nodeId])
    .count();
  return count > 0;
}

export async function createOccurrence(
  data: Partial<MapOccurrence> & { mapId: ID; nodeId: ID; x: number; y: number }
): Promise<MapOccurrence> {
  const ts = now();
  const occurrence: MapOccurrence = {
    id: data.id ?? newId(),
    mapId: data.mapId,
    nodeId: data.nodeId,
    x: data.x,
    y: data.y,
    width: data.width ?? 200,
    height: data.height ?? 80,
    frameId: data.frameId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.occurrences.add(occurrence);
  return occurrence;
}

export async function updateOccurrence(
  id: ID,
  changes: Partial<Omit<MapOccurrence, 'id' | 'mapId' | 'nodeId' | 'createdAt'>>
): Promise<MapOccurrence | undefined> {
  const existing = await db.occurrences.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...changes, id, updatedAt: now() };
  await db.occurrences.put(updated);
  return updated;
}

/**
 * Delete a MapOccurrence — only removes from this Map.
 * Does NOT delete the KnowledgeNode.
 */
export async function deleteOccurrence(id: ID): Promise<void> {
  await db.occurrences.delete(id);
}

// ---------- Frames ----------

export async function getFramesForMap(mapId: ID): Promise<KnowledgeFrame[]> {
  return db.frames.where('mapId').equals(mapId).toArray();
}

export async function createFrame(
  data: Partial<KnowledgeFrame> & { mapId: ID; title: string; x: number; y: number }
): Promise<KnowledgeFrame> {
  const ts = now();
  const frame: KnowledgeFrame = {
    id: data.id ?? newId(),
    mapId: data.mapId,
    title: data.title,
    x: data.x,
    y: data.y,
    width: data.width ?? 300,
    height: data.height ?? 200,
    parentFrameId: data.parentFrameId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.frames.add(frame);
  return frame;
}

export async function updateFrame(
  id: ID,
  changes: Partial<Omit<KnowledgeFrame, 'id' | 'mapId' | 'createdAt'>>
): Promise<KnowledgeFrame | undefined> {
  const existing = await db.frames.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...changes, id, updatedAt: now() };
  await db.frames.put(updated);
  return updated;
}

export async function deleteFrame(id: ID): Promise<void> {
  // Unassign any occurrences inside this frame before deleting
  const occurrences = await db.occurrences.where('frameId').equals(id).toArray();
  await db.transaction(
    'rw',
    [db.frames, db.occurrences, db.retrievalTargets, db.memoryStates, db.reviewEvents, db.planAssignments, db.planExecutionStates],
    async () => {
    const targetIds = await db.retrievalTargets
      .where('[sourceType+sourceId]')
      .equals(['frame', id])
      .primaryKeys();
    if (targetIds.length > 0) {
      await db.planExecutionStates.where('retrievalTargetId').anyOf(targetIds).delete();
      await db.reviewEvents.where('retrievalTargetId').anyOf(targetIds).delete();
      await db.memoryStates.where('retrievalTargetId').anyOf(targetIds).delete();
      await db.planAssignments
        .where('subjectType')
        .equals('retrieval_target')
        .filter(a => targetIds.includes(a.subjectId))
        .delete();
      await db.retrievalTargets.bulkDelete(targetIds);
    }
    for (const occ of occurrences) {
      await db.occurrences.update(occ.id, { frameId: null });
    }
    await db.frames.delete(id);
    }
  );
}
