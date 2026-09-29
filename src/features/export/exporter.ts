// ============================================================
// Exporter — full backup ZIP, single node markdown, map markdown
// Portable format is independent of Dexie.
// schemaVersion "0.5" introduces stable live Section transclusion directives
// (<!-- nodal-transclude:v1:... -->) stored verbatim in canonical Markdown.
// The importer remains backward compatible with 0.1 through 0.4 backups.
// ============================================================
import JSZip from 'jszip';
import { getAllNodes, getNode } from '../../repositories/nodeRepository';
import { getAllMaps, getMap, getOccurrencesForMap, getOccurrencesForNode, getFramesForMap } from '../../repositories/mapRepository';
import { getAllTags, getTag } from '../../repositories/tagRepository';
import { getAllRelations, getRelationsForNode, getRelationsForMap } from '../../repositories/relationRepository';
import { getAllAssets, getAssetsByIds } from '../../repositories/assetRepository';
import { KnowledgeBaseError, ErrorCodes } from '../../utils/errors';
import { db } from '../../db/database';
import { getRecallDrafts, RECALL_DRAFT_KEY } from '../../repositories/recallDraftRepository';
import { expandTransclusionsToMarkdown } from '../../domain/sectionTransclusion';
import type {
  KnowledgeTag,
  KnowledgeAsset,
  KnowledgeNode,
  PortableManifest,
  PortableMap,
  NodeFrontmatter,
  ID,
} from '../../domain/types';

export const PORTABLE_SCHEMA_VERSION = '0.7';
const SCHEMA_VERSION = PORTABLE_SCHEMA_VERSION;
const APP_VERSION = '0.6.0';

// ---------- helpers ----------

function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

/** Build YAML frontmatter string from a NodeFrontmatter object. */
function buildFrontmatter(fm: NodeFrontmatter): string {
  const lines = [
    '---',
    `schemaVersion: ${fm.schemaVersion}`,
    `id: ${fm.id}`,
    `title: ${JSON.stringify(fm.title)}`,
    ...(fm.overview ? [`overview: ${JSON.stringify(fm.overview)}`] : []),
    `tags: [${fm.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    ...(fm.sectionTags ? [`sectionTags: ${JSON.stringify(fm.sectionTags)}`] : []),
    `assetIds: [${fm.assetIds.map((a) => JSON.stringify(a)).join(', ')}]`,
    ...(fm.aiGuidance ? [`aiGuidance: ${JSON.stringify(fm.aiGuidance)}`] : []),
    `createdAt: ${fm.createdAt}`,
    `updatedAt: ${fm.updatedAt}`,
    '---',
  ];
  return lines.join('\n');
}

/** Trigger a browser download for a blob. */
function triggerDownload(blob: Blob, filename: string): void {
  try {
    // URL.createObjectURL may not be available or may fail in non-browser
    // environments (e.g., jsdom tests). The export data is already returned
    // to the caller, so a failed download trigger should not break the export.
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // Silently ignore download trigger failures in non-browser environments
  }
}

/**
 * Resolve asset:// references in markdown to the portable format.
 * Per PORTABLE_FORMAT.md, the asset description is
 * stored as the alt text in the markdown image reference.
 *
 * - ![alt](asset://<id>) → ![<asset.description or alt>](assets/<id>-<filename>)
 * - Bare asset://<id> → assets/<id>-<filename>
 */
function resolveAssetRefs(markdown: string, assets: KnowledgeAsset[]): string {
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Pattern 1: Full image markdown ![alt](asset://<id>)
  let result = markdown.replace(
    /!\[([^\]]*)\]\((asset:\/\/[a-zA-Z0-9-]+)\)/g,
    (match, altText: string, assetUrl: string) => {
      const assetId = assetUrl.replace('asset://', '');
      const asset = assetById.get(assetId);
      if (asset) {
        // Use asset description as alt text (per portable format spec);
        // fall back to existing alt text if description is empty
        const description = asset.description || altText;
        return `![${description}](assets/${asset.id}-${asset.filename})`;
      }
      return match;
    }
  );

  // Pattern 2: Bare asset://<id> references (not in image syntax)
  result = result.replace(/asset:\/\/([a-zA-Z0-9-]+)/g, (match, assetId: string) => {
    const asset = assetById.get(assetId);
    if (asset) {
      return `assets/${asset.id}-${asset.filename}`;
    }
    return match;
  });

  return result;
}

// ---------- 1. Full Backup ZIP ----------

export async function exportFullBackup(): Promise<Blob> {
  try {
    const [nodes, maps, relations, tags, assets, retrievalTargets, memoryStates, reviewEvents, semesterPlans, planAssignments, planExecutionStates, drafts, allOccurrences, allFrames] = await db.transaction('r', db.tables, () => Promise.all([
      getAllNodes(),
      getAllMaps(),
      getAllRelations(),
      getAllTags(),
      getAllAssets(),
      db.retrievalTargets.toArray(),
      db.memoryStates.toArray(),
      db.reviewEvents.orderBy('reviewedAt').toArray(),
      db.semesterPlans.toArray(),
      db.planAssignments.toArray(),
      db.planExecutionStates.toArray(),
      getRecallDrafts(),
      db.occurrences.toArray(),
      db.frames.toArray(),
    ]));

    const zip = new JSZip();

    // manifest.json
    const manifest: PortableManifest = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      mapCount: maps.length,
      relationCount: relations.length,
      tagCount: tags.length,
      assetCount: assets.length,
      retrievalTargetCount: retrievalTargets.length,
      reviewEventCount: reviewEvents.length,
      planAssignmentCount: planAssignments.length,
      planExecutionStateCount: planExecutionStates.length,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // tags.json
    zip.file('tags.json', JSON.stringify(tags, null, 2));

    // relations.json
    zip.file('relations.json', JSON.stringify(relations, null, 2));

    // Learning data is separate from canonical knowledge content. Review
    // events remain append-only evidence and can rebuild the current state.
    zip.file('learning/retrieval-targets.json', JSON.stringify(retrievalTargets, null, 2));
    zip.file('learning/recall-drafts.json', JSON.stringify(drafts, null, 2));
    zip.file('learning/memory-states.json', JSON.stringify(memoryStates, null, 2));
    zip.file('learning/plan-execution-states.json', JSON.stringify(planExecutionStates, null, 2));
    zip.file(
      'learning/review-events.ndjson',
      reviewEvents.map((event) => JSON.stringify(event)).join('\n') + (reviewEvents.length > 0 ? '\n' : '')
    );
    zip.file('planning/semester-plans.json', JSON.stringify(semesterPlans, null, 2));
    zip.file('planning/plan-assignments.json', JSON.stringify(planAssignments, null, 2));

    // Export meta entries (legacy ratings, drafts, etc.) excluding drafts that live in learning/recall-drafts.json
    const metaEntries = await db.meta.toArray();
    const durableMeta = metaEntries.filter((m) => m.key !== RECALL_DRAFT_KEY);
    zip.file('meta.json', JSON.stringify(durableMeta, null, 2));

    // assets.json — asset metadata (id, filename, mimeType, description, dates)
    // The actual blob data is stored as separate files in assets/ folder.
    const assetMetadata = assets.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      description: a.description,
      createdAt: toIso(a.createdAt),
      updatedAt: toIso(a.updatedAt),
    }));
    zip.file('assets.json', JSON.stringify(assetMetadata, null, 2));

    // nodes/<id>.md — YAML frontmatter + content
    const tagIdToName = new Map(tags.map((t) => [t.id, t.name]));
    for (const node of nodes) {
      const tagNames = node.tagIds
        .map((tid) => tagIdToName.get(tid))
        .filter((n): n is string => !!n);

      const sectionTags: Record<string, string[]> = {};
      if (node.sectionTagIds) {
        for (const [secId, tids] of Object.entries(node.sectionTagIds)) {
          const names = tids.map(id => tagIdToName.get(id)).filter((n): n is string => !!n);
          if (names.length > 0) sectionTags[secId] = names;
        }
      }

      const fm: NodeFrontmatter = {
        schemaVersion: SCHEMA_VERSION,
        id: node.id,
        title: node.title,
        overview: node.overview,
        aiGuidance: node.aiGuidance,
        tags: tagNames,
        ...(Object.keys(sectionTags).length > 0 ? { sectionTags } : {}),
        assetIds: node.assetIds,
        createdAt: toIso(node.createdAt),
        updatedAt: toIso(node.updatedAt),
      };

      // Resolve asset references in content
      const nodeAssets = assets.filter(asset => node.assetIds.includes(asset.id));
      const content = resolveAssetRefs(node.contentMarkdown, nodeAssets);

      const md = buildFrontmatter(fm) + '\n\n' + content + '\n';
      zip.file(`nodes/${node.id}.md`, md);
    }

    // maps/<id>.json — PortableMap with occurrences and frames
    for (const map of maps) {
      const occurrences = allOccurrences.filter(item => item.mapId === map.id);
      const frames = allFrames.filter(item => item.mapId === map.id);

      const portableMap: PortableMap = {
        id: map.id,
        title: map.title,
        description: map.description,
        tagIds: map.tagIds,
        viewportX: map.viewportX,
        viewportY: map.viewportY,
        viewportZoom: map.viewportZoom,
        occurrences: occurrences.map((o) => ({
          id: o.id,
          mapId: o.mapId,
          nodeId: o.nodeId,
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
          frameId: o.frameId,
        })),
        frames: frames.map((f) => ({
          id: f.id,
          mapId: f.mapId,
          title: f.title,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          parentFrameId: f.parentFrameId,
        })),
        createdAt: toIso(map.createdAt),
        updatedAt: toIso(map.updatedAt),
      };

      zip.file(`maps/${map.id}.json`, JSON.stringify(portableMap, null, 2));
    }

    // assets/<id>-<filename> — raw blob files
    // Convert to Uint8Array for maximum compatibility across JS realms.
    // JSZip's type detection can fail with Blob/ArrayBuffer from different
    // realms (e.g., Node Blob stored in IndexedDB via fake-indexeddb).
    // Uint8Array is universally recognized by JSZip.
    for (const asset of assets) {
      const arrayBuffer = await asset.blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      zip.file(`assets/${asset.id}-${asset.filename}`, uint8);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, `nodal-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    return blob;
  } catch (error) {
    throw new KnowledgeBaseError(
      `Failed to export backup: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCodes.ZIP_EXPORT_FAILED,
      error
    );
  }
}

/**
 * Strips internal storage directives (<!-- nodal-panel:... -->, <!-- nodal-transclude:... -->)
 * so exported human-readable Markdown contains only clean, readable content.
 */
export function stripStorageDirectives(markdown: string): string {
  const stripped = markdown
    .split('\n')
    .filter((line) => !/^<!--\s*nodal-(?:panel|transclude):.*?-->\s*$/.test(line.trim()))
    .join('\n');
  return stripped.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
}

// ---------- 2. Single Node Markdown ----------

export async function exportNodeMarkdown(nodeId: ID): Promise<string> {
  const node = await getNode(nodeId);
  if (!node) {
    throw new KnowledgeBaseError('Node not found.', ErrorCodes.NOT_FOUND);
  }

  const [tags, relations, assets, allMaps, allOccurrences, allAssets] = await Promise.all([
    Promise.all(node.tagIds.map((tid) => getTag(tid))),
    getRelationsForNode(nodeId),
    getAssetsByIds(node.assetIds),
    getAllMaps(),
    getOccurrencesForNode(nodeId),
    getAllAssets(),
  ]);

  const tagNames = tags.filter((t): t is KnowledgeTag => !!t).map((t) => t.name);

  // Build relations summary
  const allNodes = await getAllNodes();
  const findNode = (id: ID): KnowledgeNode | undefined => allNodes.find((n) => n.id === id);
  // Readable export is a projection: resolve live transclusions inline with
  // source attribution so an invisible directive does not drop their content.
  const expandedContent = expandTransclusionsToMarkdown(node.contentMarkdown, findNode);
  const cleanContent = stripStorageDirectives(expandedContent);
  const resolvedContent = resolveAssetRefs(cleanContent, allAssets);
  const nodeTitle = (id: ID): string => allNodes.find((n) => n.id === id)?.title ?? '(unknown)';

  const relationLines = relations.map((rel) => {
    const source = nodeTitle(rel.sourceNodeId);
    const target = nodeTitle(rel.targetNodeId);
    const arrow = rel.direction === 'bidirectional' ? '<-->' : rel.direction === 'forward' ? '-->' : '---';
    const label = rel.label ? ` ${rel.label} ` : ' ';
    return `- ${source} ${arrow.trim()}${label}${target}`;
  });

  // Images summary
  const imageLines = assets.map((a) => {
    const desc = a.description ? ` — ${a.description}` : '';
    return `- ${a.filename}${desc}`;
  });

  // Maps containing this node
  const mapIdsWithNode = [...new Set(allOccurrences.map((o) => o.mapId))];
  const mapTitles = allMaps
    .filter((m) => mapIdsWithNode.includes(m.id))
    .map((m) => m.title);

  const parts: string[] = [];
  parts.push(`# ${node.title}`);
  parts.push('');
  if (tagNames.length > 0) {
    parts.push(`**Tags:** ${tagNames.join(', ')}`);
    parts.push('');
  }
  parts.push('---');
  parts.push('');
  parts.push(resolvedContent);
  parts.push('');

  if (relationLines.length > 0) {
    parts.push('## Relations');
    parts.push('');
    parts.push(...relationLines);
    parts.push('');
  }

  if (imageLines.length > 0) {
    parts.push('## Images');
    parts.push('');
    parts.push(...imageLines);
    parts.push('');
  }

  if (mapTitles.length > 0) {
    parts.push('## Appears in Maps');
    parts.push('');
    mapTitles.forEach((t) => parts.push(`- ${t}`));
    parts.push('');
  }

  const md = parts.join('\n');
  triggerDownload(new Blob([md], { type: 'text/markdown' }), `${node.title.replace(/[^\w\-]+/g, '_')}.md`);
  return md;
}

// ---------- 3. Map Markdown ----------

export async function exportMapMarkdown(mapId: ID): Promise<string> {
  const map = await getMap(mapId);
  if (!map) {
    throw new KnowledgeBaseError('Map not found.', ErrorCodes.NOT_FOUND);
  }

  const [frames, occurrences, relations] = await Promise.all([
    getFramesForMap(mapId),
    getOccurrencesForMap(mapId),
    getRelationsForMap(mapId),
  ]);

  const allNodes = await getAllNodes();
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const getNodeTitle = (id: ID): string => nodeById.get(id)?.title ?? '(unknown)';
  const resolveForExport = (node: KnowledgeNode): string =>
    stripStorageDirectives(expandTransclusionsToMarkdown(node.contentMarkdown, (id) => nodeById.get(id)));

  const parts: string[] = [];
  parts.push(`# ${map.title}`);
  parts.push('');
  if (map.description) {
    parts.push(map.description);
    parts.push('');
  }
  parts.push('---');
  parts.push('');

  // Frames with nested node content
  for (const frame of frames) {
    parts.push(`## ${frame.title}`);
    parts.push('');
    const frameOccs = occurrences.filter((o) => o.frameId === frame.id);
    for (const occ of frameOccs) {
      const node = nodeById.get(occ.nodeId);
      if (node) {
        parts.push(`### ${node.title}`);
        parts.push('');
        parts.push(resolveForExport(node));
        parts.push('');
      }
    }
    if (frameOccs.length === 0) {
      parts.push('_Empty frame._');
      parts.push('');
    }
  }

  // Unassigned nodes
  const unassigned = occurrences.filter((o) => o.frameId === null);
  if (unassigned.length > 0) {
    parts.push('## Unassigned Nodes');
    parts.push('');
    for (const occ of unassigned) {
      const node = nodeById.get(occ.nodeId);
      if (node) {
        parts.push(`### ${node.title}`);
        parts.push('');
        parts.push(resolveForExport(node));
        parts.push('');
      }
    }
  }

  // Relations
  if (relations.length > 0) {
    parts.push('## Relations');
    parts.push('');
    for (const rel of relations) {
      const source = getNodeTitle(rel.sourceNodeId);
      const target = getNodeTitle(rel.targetNodeId);
      const arrow = rel.direction === 'bidirectional' ? '<-->' : rel.direction === 'forward' ? '-->' : '---';
      const label = rel.label ? ` ${rel.label} ` : ' ';
      parts.push(`- ${source} ${arrow.trim()}${label}${target}`);
    }
    parts.push('');
  }

  const md = parts.join('\n');
  triggerDownload(new Blob([md], { type: 'text/markdown' }), `${map.title.replace(/[^\w\-]+/g, '_')}.md`);
  return md;
}
