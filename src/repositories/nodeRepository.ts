// ============================================================
// Node Repository — data access for KnowledgeNode
// ============================================================
import { db } from '../db/database';
import { RECALL_DRAFT_KEY } from '../db/schema';
import { type KnowledgeNode, type ID, type RecallDraft, getTargetNodeLinks } from '../domain/types';
import { newId, now } from '../domain/id';
import { movePanelAnchor, splitNotePanels } from '../domain/notePanels';
import { invalidateProjectionCache } from '../domain/contentProjection';
import { reconcileOrDeleteExecutionStatesForAssignment } from './planAssignmentRepository';

export async function getAllNodes(): Promise<KnowledgeNode[]> {
  return db.nodes.orderBy('updatedAt').reverse().toArray();
}

export async function getNode(id: ID): Promise<KnowledgeNode | undefined> {
  return db.nodes.get(id);
}

export async function getNodesByIds(ids: ID[]): Promise<KnowledgeNode[]> {
  if (ids.length === 0) return [];
  return db.nodes.where('id').anyOf(ids).toArray();
}

export async function createNode(
  data: Partial<KnowledgeNode> & { title: string }
): Promise<KnowledgeNode> {
  const ts = now();
  const node: KnowledgeNode = {
    id: data.id ?? newId(),
    title: data.title,
    ...(data.overview !== undefined ? { overview: data.overview } : {}),
    ...(data.aiGuidance ? { aiGuidance: data.aiGuidance } : {}),
    contentMarkdown: data.contentMarkdown ?? '',
    tagIds: data.tagIds ?? [],
    ...(data.sectionTagIds ? { sectionTagIds: data.sectionTagIds } : {}),
    assetIds: data.assetIds ?? [],
    createdAt: ts,
    updatedAt: ts,
  };
  await db.nodes.add(node);
  invalidateProjectionCache(node.id);
  return node;
}

export async function updateNode(
  id: ID,
  changes: Partial<Omit<KnowledgeNode, 'id' | 'createdAt'>>
): Promise<KnowledgeNode | undefined> {
  // Title and body flush together when switching from edit to reading.
  // Serialize their read/modify/write so neither can overwrite the other.
  return db.transaction('rw', [db.nodes, db.occurrences, db.retrievalTargets, db.planAssignments, db.planExecutionStates, db.semesterPlans, db.meta], async () => {
    const existing = await db.nodes.get(id);
    if (!existing) return undefined;
    const updated: KnowledgeNode = { ...existing, ...changes, id, updatedAt: now() };
    if (changes.contentMarkdown !== undefined && changes.contentMarkdown !== existing.contentMarkdown) {
      const oldPanels = splitNotePanels(existing.contentMarkdown);
      const newPanels = splitNotePanels(updated.contentMarkdown);
      const newPanelIds = new Set(newPanels.map(p => p.id));
      const removedPanelIds = oldPanels.map(p => p.id).filter(pid => !newPanelIds.has(pid));
      if (removedPanelIds.length > 0) {
        const survivorId = newPanels.length > 0 ? newPanels[0].id : 'main';
        const removedAssignments = await db.planAssignments
          .where('[subjectType+subjectId]')
          .equals(['section', id])
          .filter(a => a.sectionId !== undefined && removedPanelIds.includes(a.sectionId))
          .toArray();
        if (removedAssignments.length > 0) {
          const removedIds = removedAssignments.map(a => a.id);
          const allAssignments = await db.planAssignments.toArray();
          const remaining = allAssignments.filter(a => !removedIds.includes(a.id));
          for (const remId of removedIds) {
            await reconcileOrDeleteExecutionStatesForAssignment(remId, remaining);
          }
          await db.planAssignments.bulkDelete(removedIds);
        }

        // Migrate guidance from removed sections to survivor
        if (updated.aiGuidance?.sections) {
          const secGuidance = { ...updated.aiGuidance.sections };
          let guidanceChanged = false;
          for (const remId of removedPanelIds) {
            if (secGuidance[remId]) {
              secGuidance[survivorId] = secGuidance[survivorId]
                ? `${secGuidance[survivorId]}\n\n${secGuidance[remId]}`
                : secGuidance[remId];
              delete secGuidance[remId];
              guidanceChanged = true;
            }
          }
          if (guidanceChanged) {
            updated.aiGuidance = { ...updated.aiGuidance, sections: secGuidance };
          }
        }

        // Clean up section tags for removed sections
        if (updated.sectionTagIds) {
          const secTags = { ...updated.sectionTagIds };
          let tagsChanged = false;
          for (const remId of Object.keys(secTags)) {
            if (!newPanelIds.has(remId)) {
              delete secTags[remId];
              tagsChanged = true;
            }
          }
          if (tagsChanged) {
            updated.sectionTagIds = secTags;
          }
        }

        // Migrate map occurrences from removed sections
        const occurrences = await db.occurrences.where('nodeId').equals(id).toArray();
        for (const occ of occurrences) {
          if (occ.sectionId && removedPanelIds.includes(occ.sectionId)) {
            await db.occurrences.put({
              ...occ,
              sectionId: survivorId === 'main' ? null : survivorId,
              updatedAt: now(),
            });
          }
        }

        // Migrate retrieval targets from removed sections
        const targetsToMigrate = await db.retrievalTargets.where('[sourceType+sourceId]').equals(['node', id]).toArray();
        for (const target of targetsToMigrate) {
          if (target.sectionId && removedPanelIds.includes(target.sectionId)) {
            await db.retrievalTargets.put({
              ...target,
              sectionId: survivorId === 'main' ? undefined : survivorId,
              updatedAt: now(),
            });
          }
        }
      }

      const rebase = (value: { anchor?: import('../domain/types').RecallAnchor; anchors?: import('../domain/types').RecallAnchor[] }) => {
        const anchors = (value.anchors?.length ? value.anchors : value.anchor ? [value.anchor] : [])
          .map(anchor => movePanelAnchor(anchor, existing.contentMarkdown, updated.contentMarkdown)).sort((a, b) => a.blockStart - b.blockStart);
        return anchors.length ? { anchor: anchors[0], ...(value.anchors ? { anchors } : {}) } : {};
      };
      const targets = await db.retrievalTargets.where('[sourceType+sourceId]').equals(['node', id]).toArray();
      for (const target of targets) {
        const next = { ...target, ...rebase(target) };
        if (JSON.stringify(next) !== JSON.stringify(target)) await db.retrievalTargets.put({ ...next, revision: target.revision + 1, updatedAt: now() });
      }
      const drafts = (await db.meta.get(RECALL_DRAFT_KEY))?.value as RecallDraft[] | undefined;
      if (drafts?.some(draft => draft.sourceId === id)) await db.meta.put({ key: RECALL_DRAFT_KEY, value: drafts.map(draft => draft.sourceId === id ? { ...draft, ...rebase(draft) } : draft) });
    }
    await db.nodes.put(updated);
    invalidateProjectionCache(id);
    return updated;
  });
}

/**
 * Delete a KnowledgeNode and clean up all references.
 * DANGEROUS: This is a destructive operation.
 * - Removes all MapOccurrences referencing this node
 * - Removes all Relations referencing this node (as source or target)
 * - Does NOT delete Assets (they may be referenced by other nodes)
 * - Does NOT delete Tags (they are shared classification)
 */
export async function deleteNode(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.nodes, db.occurrences, db.relations, db.retrievalTargets, db.memoryStates, db.reviewEvents, db.planAssignments, db.planExecutionStates, db.meta],
    async () => {
      const allLinkedTargets = await db.retrievalTargets
        .filter(t => t.sourceType === 'node' && (t.sourceId === id || Boolean(t.nodeLinks && t.nodeLinks.some(l => l.noteId === id))))
        .toArray();
      const trulyDeleteTargetIds: ID[] = [];
      for (const target of allLinkedTargets) {
        const links = getTargetNodeLinks(target);
        const remaining = links.filter(l => l.noteId !== id);
        if (remaining.length > 0) {
          // Other nodes still reference this card: preserve it and update primary link
          await db.retrievalTargets.put({
            ...target,
            sourceId: remaining[0].noteId,
            sectionId: remaining[0].sectionId,
            nodeLinks: remaining,
            revision: target.revision + 1,
            updatedAt: now(),
          });
        } else {
          trulyDeleteTargetIds.push(target.id);
        }
      }
      if (trulyDeleteTargetIds.length > 0) {
        await db.planExecutionStates.where('retrievalTargetId').anyOf(trulyDeleteTargetIds).delete();
        await db.reviewEvents.where('retrievalTargetId').anyOf(trulyDeleteTargetIds).delete();
        await db.memoryStates.where('retrievalTargetId').anyOf(trulyDeleteTargetIds).delete();
        await db.planAssignments
          .where('subjectType')
          .equals('retrieval_target')
          .filter(a => trulyDeleteTargetIds.includes(a.subjectId))
          .delete();
        await db.retrievalTargets.bulkDelete(trulyDeleteTargetIds);
      }
      // Delete node-level and section-level assignments for this node and cascade execution states
      const nodeAndSecAssignments = await db.planAssignments
        .where('[subjectType+subjectId]')
        .equals(['node', id])
        .or('[subjectType+subjectId]')
        .equals(['section', id])
        .toArray();
      if (nodeAndSecAssignments.length > 0) {
        const removedIds = nodeAndSecAssignments.map(a => a.id);
        await db.planExecutionStates.where('effectiveAssignmentId').anyOf(removedIds).delete();
        await db.planAssignments.bulkDelete(removedIds);
      }
      const drafts = (await db.meta.get(RECALL_DRAFT_KEY))?.value as RecallDraft[] | undefined;
      if (drafts) await db.meta.put({ key: RECALL_DRAFT_KEY, value: drafts.filter(draft => draft.sourceId !== id) });
      await db.nodes.delete(id);
      await db.occurrences.where('nodeId').equals(id).delete();
      await db.relations
        .where('sourceNodeId')
        .equals(id)
        .or('targetNodeId')
        .equals(id)
        .delete();
    }
  );
  invalidateProjectionCache(id);
}

/**
 * Get all Maps where this node appears.
 * Used for delete confirmation dialog.
 */
export async function getMapsContainingNode(nodeId: ID): Promise<Array<{ mapId: ID; mapTitle: string }>> {
  const occurrences = await db.occurrences.where('nodeId').equals(nodeId).toArray();
  const mapIds = [...new Set(occurrences.map((o) => o.mapId))];
  const maps = await db.maps.where('id').anyOf(mapIds).toArray();
  return maps.map((m) => ({ mapId: m.id, mapTitle: m.title }));
}

/** Number of distinct Maps containing each Node. */
export async function getMapCountsByNode(): Promise<Record<ID, number>> {
  const occurrences = await db.occurrences.toArray();
  const mapIdsByNode = new Map<ID, Set<ID>>();
  for (const occurrence of occurrences) {
    const mapIds = mapIdsByNode.get(occurrence.nodeId) ?? new Set<ID>();
    mapIds.add(occurrence.mapId);
    mapIdsByNode.set(occurrence.nodeId, mapIds);
  }
  return Object.fromEntries(
    [...mapIdsByNode].map(([nodeId, mapIds]) => [nodeId, mapIds.size])
  );
}

export async function searchNodes(query: string): Promise<KnowledgeNode[]> {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const all = await db.nodes.toArray();
  return all.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      n.contentMarkdown.toLowerCase().includes(q)
  );
}
