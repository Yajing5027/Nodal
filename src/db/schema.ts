// ============================================================
// Dexie Schema — centralized table definitions
// ============================================================
// Schema version 1. Each table lists indexed fields (not all fields).
// Blob fields (asset.blob) are stored but not indexed.

export const DB_NAME = 'nodal-knowledge-base';
export const DB_VERSION = 4;
export const RECALL_DRAFT_KEY = 'recall-drafts-v1';

export interface TableSchemas {
  [version: number]: Record<string, string>;
}

export const schemas: TableSchemas = {
  1: {
    nodes: 'id, title, createdAt, updatedAt',
    maps: 'id, title, createdAt, updatedAt',
    occurrences: 'id, mapId, nodeId, [mapId+nodeId], frameId',
    frames: 'id, mapId, parentFrameId',
    relations: 'id, sourceNodeId, targetNodeId, scope, mapId, [sourceNodeId+targetNodeId]',
    tags: 'id, name',
    assets: 'id, filename, mimeType, createdAt',
    meta: 'key',
  },
  2: {
    nodes: 'id, title, createdAt, updatedAt',
    maps: 'id, title, createdAt, updatedAt',
    occurrences: 'id, mapId, nodeId, [mapId+nodeId], frameId',
    frames: 'id, mapId, parentFrameId',
    relations: 'id, sourceNodeId, targetNodeId, scope, mapId, [sourceNodeId+targetNodeId]',
    tags: 'id, name',
    assets: 'id, filename, mimeType, createdAt',
    retrievalTargets: 'id, kind, status, sourceType, sourceId, [sourceType+sourceId], updatedAt',
    memoryStates: 'retrievalTargetId, dueAt, learningState, schedulerProfileId',
    reviewEvents: 'id, retrievalTargetId, reviewedAt, [retrievalTargetId+reviewedAt], sessionId',
    semesterPlans: 'id, startsAt, endsAt, updatedAt',
    meta: 'key',
  },
  3: {
    nodes: 'id, title, createdAt, updatedAt',
    maps: 'id, title, createdAt, updatedAt',
    occurrences: 'id, mapId, nodeId, [mapId+nodeId], frameId',
    frames: 'id, mapId, parentFrameId',
    relations: 'id, sourceNodeId, targetNodeId, scope, mapId, [sourceNodeId+targetNodeId]',
    tags: 'id, name',
    assets: 'id, filename, mimeType, createdAt',
    retrievalTargets: 'id, kind, status, sourceType, sourceId, [sourceType+sourceId], updatedAt',
    memoryStates: 'retrievalTargetId, dueAt, learningState, schedulerProfileId',
    reviewEvents: 'id, retrievalTargetId, reviewedAt, [retrievalTargetId+reviewedAt], sessionId',
    semesterPlans: 'id, startsAt, endsAt, updatedAt',
    planAssignments: 'id, reviewPlanId, subjectType, subjectId, [subjectType+subjectId], updatedAt',
    meta: 'key',
  },
  4: {
    nodes: 'id, title, createdAt, updatedAt',
    maps: 'id, title, createdAt, updatedAt',
    occurrences: 'id, mapId, nodeId, [mapId+nodeId], frameId',
    frames: 'id, mapId, parentFrameId',
    relations: 'id, sourceNodeId, targetNodeId, scope, mapId, [sourceNodeId+targetNodeId]',
    tags: 'id, name',
    assets: 'id, filename, mimeType, createdAt',
    retrievalTargets: 'id, kind, status, sourceType, sourceId, [sourceType+sourceId], updatedAt',
    memoryStates: 'retrievalTargetId, dueAt, learningState, schedulerProfileId',
    reviewEvents: 'id, retrievalTargetId, reviewedAt, [retrievalTargetId+reviewedAt], sessionId',
    semesterPlans: 'id, startsAt, endsAt, updatedAt',
    planAssignments: 'id, reviewPlanId, subjectType, subjectId, [subjectType+subjectId], updatedAt',
    planExecutionStates: 'id, retrievalTargetId, reviewPlanId, effectiveAssignmentId, [retrievalTargetId+reviewPlanId], updatedAt',
    meta: 'key',
  },
};
