// ============================================================
// Relation Repository — data access for KnowledgeRelation
// ============================================================
import { db } from '../db/database';
import type { KnowledgeRelation, ID, RelationDirection, RelationScope } from '../domain/types';
import { newId, now } from '../domain/id';

export async function getAllRelations(): Promise<KnowledgeRelation[]> {
  return db.relations.toArray();
}

export async function getRelationsForMap(mapId: ID): Promise<KnowledgeRelation[]> {
  // Map-scope relations for this map + all global relations
  const [mapRelations, globalRelations] = await Promise.all([
    db.relations.where('mapId').equals(mapId).toArray(),
    db.relations.where('scope').equals('global').toArray(),
  ]);
  return [...mapRelations, ...globalRelations];
}

export async function getRelationsForNode(nodeId: ID): Promise<KnowledgeRelation[]> {
  return db.relations
    .where('sourceNodeId')
    .equals(nodeId)
    .or('targetNodeId')
    .equals(nodeId)
    .toArray();
}

export async function getRelation(id: ID): Promise<KnowledgeRelation | undefined> {
  return db.relations.get(id);
}

export async function createRelation(
  data: Partial<KnowledgeRelation> & { sourceNodeId: ID; targetNodeId: ID }
): Promise<KnowledgeRelation> {
  const ts = now();
  const relation: KnowledgeRelation = {
    id: data.id ?? newId(),
    sourceNodeId: data.sourceNodeId,
    targetNodeId: data.targetNodeId,
    sourceType: data.sourceType ?? 'node',
    targetType: data.targetType ?? 'node',
    sourceHandle: data.sourceHandle ?? null,
    targetHandle: data.targetHandle ?? null,
    label: data.label ?? '',
    direction: data.direction ?? 'none',
    scope: data.scope ?? 'map',
    mapId: data.mapId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.relations.add(relation);
  return relation;
}

export async function updateRelation(
  id: ID,
  changes: Partial<Omit<KnowledgeRelation, 'id' | 'createdAt'>>
): Promise<KnowledgeRelation | undefined> {
  const existing = await db.relations.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...changes, id, updatedAt: now() };
  await db.relations.put(updated);
  return updated;
}

export async function deleteRelation(id: ID): Promise<void> {
  await db.relations.delete(id);
}

export type { RelationDirection, RelationScope };
