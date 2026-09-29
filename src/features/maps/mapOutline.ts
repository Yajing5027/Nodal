// ============================================================
// Map Outline Generator — for the left navigator
// Returns frames with their occurrences + unassigned occurrences.
// ============================================================
import type { ID, KnowledgeFrame, MapOccurrence } from '../../domain/types';
import { getFramesForMap, getOccurrencesForMap } from '../../repositories/mapRepository';
import { getNodesByIds } from '../../repositories/nodeRepository';

export interface OccurrenceOutline {
  occurrence: MapOccurrence;
  nodeTitle: string;
}

export interface FrameOutline {
  frame: KnowledgeFrame;
  occurrences: OccurrenceOutline[];
}

export interface MapOutline {
  frames: FrameOutline[];
  unassigned: OccurrenceOutline[];
}

export async function getMapOutline(mapId: ID): Promise<MapOutline> {
  const [frames, occurrences] = await Promise.all([
    getFramesForMap(mapId),
    getOccurrencesForMap(mapId),
  ]);

  const nodeIds = [...new Set(occurrences.map((o) => o.nodeId))];
  const nodes = await getNodesByIds(nodeIds);
  const titleById = new Map(nodes.map((n) => [n.id, n.title]));

  const outlined: OccurrenceOutline[] = occurrences.map((occ) => ({
    occurrence: occ,
    nodeTitle: titleById.get(occ.nodeId) ?? 'Untitled',
  }));

  const framesOutline: FrameOutline[] = frames.map((frame) => ({
    frame,
    occurrences: outlined.filter((o) => o.occurrence.frameId === frame.id),
  }));

  const unassigned = outlined.filter((o) => o.occurrence.frameId === null);

  return { frames: framesOutline, unassigned };
}
