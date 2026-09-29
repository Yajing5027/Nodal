// ============================================================
// DB Integrity Scanner
// Detects orphaned references, broken links, and data corruption.
// Can be run in tests or as a runtime health check.
// ============================================================
import { db } from '../db/database';
import type { ID } from '../domain/types';
import { findTransclusionRefs } from '../domain/sectionTransclusion';
import { splitNotePanels } from '../domain/notePanels';

export interface IntegrityIssue {
  type: string;
  severity: 'error' | 'warning';
  description: string;
  entityType?: string;
  entityId?: ID;
  referencedType?: string;
  referencedId?: ID;
}

export interface IntegrityReport {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  issues: IntegrityIssue[];
  counts: {
    nodes: number;
    maps: number;
    occurrences: number;
    frames: number;
    relations: number;
    tags: number;
    assets: number;
    retrievalTargets: number;
    memoryStates: number;
    reviewEvents: number;
    semesterPlans: number;
    planAssignments: number;
    planExecutionStates?: number;
  };
}

/**
 * Scan the entire database for integrity issues.
 * Returns a report with all orphaned references and broken links.
 */
export async function scanIntegrity(): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];

  // Load all data
  const [nodes, maps, occurrences, frames, relations, tags, assets,
    retrievalTargets, memoryStates, reviewEvents, semesterPlans, planAssignments, planExecutionStates] = await Promise.all([
    db.nodes.toArray(),
    db.maps.toArray(),
    db.occurrences.toArray(),
    db.frames.toArray(),
    db.relations.toArray(),
    db.tags.toArray(),
    db.assets.toArray(),
    db.retrievalTargets.toArray(),
    db.memoryStates.toArray(),
    db.reviewEvents.toArray(),
    db.semesterPlans.toArray(),
    db.planAssignments.toArray(),
    db.planExecutionStates.toArray(),
  ]);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const mapIds = new Set(maps.map((m) => m.id));
  const frameIds = new Set(frames.map((f) => f.id));
  const tagIds = new Set(tags.map((t) => t.id));
  const assetIds = new Set(assets.map((a) => a.id));
  const relationIds = new Set(relations.map((relation) => relation.id));
  const targetIds = new Set(retrievalTargets.map((target) => target.id));
  const targetIdsWithState = new Set(memoryStates.map((state) => state.retrievalTargetId));
  const planIds = new Set(semesterPlans.map((plan) => plan.id));
  const assignmentById = new Map(planAssignments.map((a) => [a.id, a]));

  // Build frameId -> mapId lookup for cross-validation
  const frameToMap = new Map<ID, ID>();
  for (const f of frames) {
    frameToMap.set(f.id, f.mapId);
  }

  // ---- Check Occurrences ----
  for (const occ of occurrences) {
    // occurrence.nodeId must reference an existing node
    if (!nodeIds.has(occ.nodeId)) {
      issues.push({
        type: 'orphaned_occurrence_node',
        severity: 'error',
        description: `Occurrence ${occ.id} references non-existent Node ${occ.nodeId}`,
        entityType: 'occurrence',
        entityId: occ.id,
        referencedType: 'node',
        referencedId: occ.nodeId,
      });
    }
    // occurrence.mapId must reference an existing map
    if (!mapIds.has(occ.mapId)) {
      issues.push({
        type: 'orphaned_occurrence_map',
        severity: 'error',
        description: `Occurrence ${occ.id} references non-existent Map ${occ.mapId}`,
        entityType: 'occurrence',
        entityId: occ.id,
        referencedType: 'map',
        referencedId: occ.mapId,
      });
    }
    // occurrence.frameId (if set) must reference an existing frame
    if (occ.frameId && !frameIds.has(occ.frameId)) {
      issues.push({
        type: 'orphaned_occurrence_frame',
        severity: 'error',
        description: `Occurrence ${occ.id} references non-existent Frame ${occ.frameId}`,
        entityType: 'occurrence',
        entityId: occ.id,
        referencedType: 'frame',
        referencedId: occ.frameId,
      });
    }
    // occurrence.frameId must belong to the same map as the occurrence
    if (occ.frameId && frameToMap.has(occ.frameId)) {
      const frameMapId = frameToMap.get(occ.frameId)!;
      if (frameMapId !== occ.mapId) {
        issues.push({
          type: 'occurrence_frame_map_mismatch',
          severity: 'error',
          description: `Occurrence ${occ.id} is in Map ${occ.mapId} but Frame ${occ.frameId} belongs to Map ${frameMapId}`,
          entityType: 'occurrence',
          entityId: occ.id,
        });
      }
    }
  }

  // ---- Check Frames ----
  for (const frame of frames) {
    if (!mapIds.has(frame.mapId)) {
      issues.push({
        type: 'orphaned_frame_map',
        severity: 'error',
        description: `Frame ${frame.id} references non-existent Map ${frame.mapId}`,
        entityType: 'frame',
        entityId: frame.id,
        referencedType: 'map',
        referencedId: frame.mapId,
      });
    }
    // parentFrameId (if set) must reference an existing frame
    if (frame.parentFrameId && !frameIds.has(frame.parentFrameId)) {
      issues.push({
        type: 'orphaned_frame_parent',
        severity: 'error',
        description: `Frame ${frame.id} references non-existent parent Frame ${frame.parentFrameId}`,
        entityType: 'frame',
        entityId: frame.id,
        referencedType: 'frame',
        referencedId: frame.parentFrameId,
      });
    }
  }

  // ---- Check Relations ----
  for (const rel of relations) {
    if (!nodeIds.has(rel.sourceNodeId)) {
      issues.push({
        type: 'orphaned_relation_source',
        severity: 'error',
        description: `Relation ${rel.id} source Node ${rel.sourceNodeId} does not exist`,
        entityType: 'relation',
        entityId: rel.id,
        referencedType: 'node',
        referencedId: rel.sourceNodeId,
      });
    }
    if (!nodeIds.has(rel.targetNodeId)) {
      issues.push({
        type: 'orphaned_relation_target',
        severity: 'error',
        description: `Relation ${rel.id} target Node ${rel.targetNodeId} does not exist`,
        entityType: 'relation',
        entityId: rel.id,
        referencedType: 'node',
        referencedId: rel.targetNodeId,
      });
    }
    // scope=map relations must have a valid mapId
    if (rel.scope === 'map') {
      if (!rel.mapId) {
        issues.push({
          type: 'relation_map_missing_mapid',
          severity: 'error',
          description: `Relation ${rel.id} has scope=map but no mapId`,
          entityType: 'relation',
          entityId: rel.id,
        });
      } else if (!mapIds.has(rel.mapId)) {
        issues.push({
          type: 'orphaned_relation_map',
          severity: 'error',
          description: `Relation ${rel.id} references non-existent Map ${rel.mapId}`,
          entityType: 'relation',
          entityId: rel.id,
          referencedType: 'map',
          referencedId: rel.mapId,
        });
      }
    }
    // scope=global relations should not have a mapId (warning, not error)
    if (rel.scope === 'global' && rel.mapId) {
      issues.push({
        type: 'relation_global_has_mapid',
        severity: 'warning',
        description: `Relation ${rel.id} has scope=global but also has mapId=${rel.mapId} (mapId should be null for global relations)`,
        entityType: 'relation',
        entityId: rel.id,
      });
    }
  }

  // ---- Check Nodes ----
  for (const node of nodes) {
    // node.tagIds must reference existing tags
    for (const tagId of node.tagIds) {
      if (!tagIds.has(tagId)) {
        issues.push({
          type: 'orphaned_node_tag',
          severity: 'error',
          description: `Node ${node.id} references non-existent Tag ${tagId}`,
          entityType: 'node',
          entityId: node.id,
          referencedType: 'tag',
          referencedId: tagId,
        });
      }
    }
    // node.assetIds must reference existing assets
    for (const assetId of node.assetIds) {
      if (!assetIds.has(assetId)) {
        issues.push({
          type: 'orphaned_node_asset',
          severity: 'error',
          description: `Node ${node.id} references non-existent Asset ${assetId}`,
          entityType: 'node',
          entityId: node.id,
          referencedType: 'asset',
          referencedId: assetId,
        });
      }
    }
    // contentMarkdown should be a string (not undefined/null)
    if (typeof node.contentMarkdown !== 'string') {
      issues.push({
        type: 'node_content_invalid',
        severity: 'error',
        description: `Node ${node.id} contentMarkdown is not a string (type: ${typeof node.contentMarkdown})`,
        entityType: 'node',
        entityId: node.id,
      });
    }

    // Live Section transclusions must resolve to an existing source Node and
    // Section. Cycles are legal composition and are NOT flagged here.
    for (const ref of findTransclusionRefs(node.contentMarkdown)) {
      if (!nodeIds.has(ref.sourceNodeId)) {
        issues.push({
          type: 'transclusion_missing_source_node',
          severity: 'error',
          description: `Node ${node.id} transcludes section ${ref.sourceSectionId} from missing source Node ${ref.sourceNodeId}`,
          entityType: 'node',
          entityId: node.id,
          referencedType: 'node',
          referencedId: ref.sourceNodeId,
        });
        continue;
      }
      const source = nodeById.get(ref.sourceNodeId);
      if (source && !splitNotePanels(source.contentMarkdown).some((p) => p.id === ref.sourceSectionId)) {
        issues.push({
          type: 'transclusion_missing_source_section',
          severity: 'error',
          description: `Node ${node.id} transcludes missing section ${ref.sourceSectionId} from Node ${ref.sourceNodeId}`,
          entityType: 'node',
          entityId: node.id,
          referencedType: 'section',
          referencedId: ref.sourceSectionId,
        });
      }
    }
  }

  // ---- Check for duplicate IDs across tables ----
  // ---- Check Learning Layer ----
  for (const target of retrievalTargets) {
    const sourceExists =
      (target.sourceType === 'node' && nodeIds.has(target.sourceId)) ||
      (target.sourceType === 'map' && mapIds.has(target.sourceId)) ||
      (target.sourceType === 'frame' && frameIds.has(target.sourceId)) ||
      (target.sourceType === 'relation' && relationIds.has(target.sourceId));
    if (!sourceExists) {
      issues.push({
        type: 'orphaned_retrieval_target_source',
        severity: 'error',
        description: `Retrieval target ${target.id} references missing ${target.sourceType} ${target.sourceId}`,
        entityType: 'retrievalTarget',
        entityId: target.id,
        referencedType: target.sourceType,
        referencedId: target.sourceId,
      });
    }
    if (!targetIdsWithState.has(target.id)) {
      issues.push({
        type: 'retrieval_target_missing_state',
        severity: 'error',
        description: `Retrieval target ${target.id} has no MemoryState`,
        entityType: 'retrievalTarget',
        entityId: target.id,
      });
    }
  }
  for (const state of memoryStates) {
    if (!targetIds.has(state.retrievalTargetId)) {
      issues.push({
        type: 'orphaned_memory_state',
        severity: 'error',
        description: `MemoryState references missing target ${state.retrievalTargetId}`,
        entityType: 'memoryState',
        entityId: state.retrievalTargetId,
      });
    }
  }
  for (const event of reviewEvents) {
    if (!targetIds.has(event.retrievalTargetId)) {
      issues.push({
        type: 'orphaned_review_event',
        severity: 'error',
        description: `ReviewEvent ${event.id} references missing target ${event.retrievalTargetId}`,
        entityType: 'reviewEvent',
        entityId: event.id,
      });
    }
  }

  // ---- Check PlanAssignments ----
  const seenAssignmentSubjects = new Set<string>();
  for (const assignment of planAssignments) {
    // 1. reviewPlanId must exist if set; if null, must have planning window (deadline or startsAt)
    if (assignment.reviewPlanId !== null) {
      if (!planIds.has(assignment.reviewPlanId)) {
        issues.push({
          type: 'orphaned_assignment_plan',
          severity: 'error',
          description: `PlanAssignment ${assignment.id} references non-existent ReviewPlan ${assignment.reviewPlanId}`,
          entityType: 'planAssignment',
          entityId: assignment.id,
          referencedType: 'reviewPlan',
          referencedId: assignment.reviewPlanId,
        });
      }
    } else {
      if (assignment.startsAt == null && assignment.endsAt == null) {
        issues.push({
          type: 'invalid_baseline_assignment',
          severity: 'error',
          description: `PlanAssignment ${assignment.id} has null reviewPlanId without a deadline or start window`,
          entityType: 'planAssignment',
          entityId: assignment.id,
        });
      }
    }

    // 2. Concrete subject validation
    if (assignment.subjectType === 'node') {
      if (!nodeIds.has(assignment.subjectId)) {
        issues.push({
          type: 'orphaned_assignment_node',
          severity: 'error',
          description: `PlanAssignment ${assignment.id} references non-existent Node ${assignment.subjectId}`,
          entityType: 'planAssignment',
          entityId: assignment.id,
          referencedType: 'node',
          referencedId: assignment.subjectId,
        });
      }
    } else if (assignment.subjectType === 'retrieval_target') {
      if (!targetIds.has(assignment.subjectId)) {
        issues.push({
          type: 'orphaned_assignment_target',
          severity: 'error',
          description: `PlanAssignment ${assignment.id} references non-existent RetrievalTarget ${assignment.subjectId}`,
          entityType: 'planAssignment',
          entityId: assignment.id,
          referencedType: 'retrievalTarget',
          referencedId: assignment.subjectId,
        });
      }
    } else if (assignment.subjectType === 'section') {
      const node = nodeById.get(assignment.subjectId);
      if (!node) {
        issues.push({
          type: 'orphaned_assignment_section_node',
          severity: 'error',
          description: `PlanAssignment ${assignment.id} references non-existent Node ${assignment.subjectId} for section`,
          entityType: 'planAssignment',
          entityId: assignment.id,
          referencedType: 'node',
          referencedId: assignment.subjectId,
        });
      } else {
        const panels = splitNotePanels(node.contentMarkdown);
        const panelIds = new Set(panels.map(p => p.id));
        if (!assignment.sectionId || !panelIds.has(assignment.sectionId)) {
          issues.push({
            type: 'orphaned_assignment_section',
            severity: 'error',
            description: `PlanAssignment ${assignment.id} references non-existent Section ${assignment.sectionId} in Node ${assignment.subjectId}`,
            entityType: 'planAssignment',
            entityId: assignment.id,
            referencedType: 'section',
            referencedId: assignment.sectionId,
          });
        }
      }
    }

    // 3. Duplicate direct assignment check
    const subjectKey = `${assignment.subjectType}:${assignment.subjectId}:${assignment.sectionId ?? ''}`;
    if (seenAssignmentSubjects.has(subjectKey)) {
      issues.push({
        type: 'duplicate_plan_assignment',
        severity: 'error',
        description: `Duplicate direct PlanAssignment for subject ${subjectKey}`,
        entityType: 'planAssignment',
        entityId: assignment.id,
      });
    }
    seenAssignmentSubjects.add(subjectKey);
  }

  // ---- Check PlanExecutionStates ----
  for (const exec of planExecutionStates) {
    if (!targetIds.has(exec.retrievalTargetId)) {
      issues.push({
        type: 'orphaned_execution_state_target',
        severity: 'error',
        description: `PlanExecutionState ${exec.id} references non-existent RetrievalTarget ${exec.retrievalTargetId}`,
        entityType: 'planExecutionState',
        entityId: exec.id,
        referencedType: 'retrievalTarget',
        referencedId: exec.retrievalTargetId,
      });
    }
    if (!planIds.has(exec.reviewPlanId)) {
      issues.push({
        type: 'orphaned_execution_state_plan',
        severity: 'error',
        description: `PlanExecutionState ${exec.id} references non-existent ReviewPlan ${exec.reviewPlanId}`,
        entityType: 'planExecutionState',
        entityId: exec.id,
        referencedType: 'reviewPlan',
        referencedId: exec.reviewPlanId,
      });
    }
    const assignment = assignmentById.get(exec.effectiveAssignmentId);
    if (!assignment) {
      issues.push({
        type: 'orphaned_execution_state_assignment',
        severity: 'error',
        description: `PlanExecutionState ${exec.id} references non-existent PlanAssignment ${exec.effectiveAssignmentId}`,
        entityType: 'planExecutionState',
        entityId: exec.id,
        referencedType: 'planAssignment',
        referencedId: exec.effectiveAssignmentId,
      });
    } else if (assignment.reviewPlanId !== exec.reviewPlanId) {
      issues.push({
        type: 'mismatched_execution_state_plan',
        severity: 'error',
        description: `PlanExecutionState ${exec.id} reviewPlanId ${exec.reviewPlanId} does not match assignment ${assignment.id} reviewPlanId ${assignment.reviewPlanId}`,
        entityType: 'planExecutionState',
        entityId: exec.id,
      });
    }
  }

  // ---- Check for duplicate IDs across tables ----
  const allIds = new Map<ID, string>();
  const idTables: Array<[string, ID[]]> = [
    ['node', nodes.map((n) => n.id)],
    ['map', maps.map((m) => m.id)],
    ['occurrence', occurrences.map((o) => o.id)],
    ['frame', frames.map((f) => f.id)],
    ['relation', relations.map((r) => r.id)],
    ['tag', tags.map((t) => t.id)],
    ['asset', assets.map((a) => a.id)],
    ['retrievalTarget', retrievalTargets.map((target) => target.id)],
    ['reviewEvent', reviewEvents.map((event) => event.id)],
    ['semesterPlan', semesterPlans.map((plan) => plan.id)],
    ['planAssignment', planAssignments.map((a) => a.id)],
    ['planExecutionState', planExecutionStates.map((e) => e.id)],
  ];
  for (const [tableName, ids] of idTables) {
    for (const id of ids) {
      if (allIds.has(id) && allIds.get(id) !== tableName) {
        issues.push({
          type: 'duplicate_id_across_tables',
          severity: 'warning',
          description: `ID ${id} exists in both ${allIds.get(id)} and ${tableName} tables`,
          entityType: tableName,
          entityId: id,
        });
      }
      allIds.set(id, tableName);
    }
  }

  // ---- Check for unreferenced assets (warning — could be intentional) ----
  const referencedAssetIds = new Set<ID>();
  for (const node of nodes) {
    for (const aid of node.assetIds) {
      referencedAssetIds.add(aid);
    }
  }
  for (const asset of assets) {
    if (!referencedAssetIds.has(asset.id)) {
      issues.push({
        type: 'unreferenced_asset',
        severity: 'warning',
        description: `Asset ${asset.id} (${asset.filename}) is not referenced by any Node`,
        entityType: 'asset',
        entityId: asset.id,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    isValid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    counts: {
      nodes: nodes.length,
      maps: maps.length,
      occurrences: occurrences.length,
      frames: frames.length,
      relations: relations.length,
      tags: tags.length,
      assets: assets.length,
      retrievalTargets: retrievalTargets.length,
      memoryStates: memoryStates.length,
      reviewEvents: reviewEvents.length,
      semesterPlans: semesterPlans.length,
      planAssignments: planAssignments.length,
      planExecutionStates: planExecutionStates.length,
    },
  };
}
