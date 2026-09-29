// ============================================================
// Importer — restore a full backup ZIP into the database
// Preserves original IDs for round-trip.
// Uses Dexie transaction — all or nothing.
// ============================================================
import JSZip from 'jszip';
import { db } from '../../db/database';
import { RECALL_DRAFT_KEY } from '../../repositories/recallDraftRepository';
import { validAnchor } from '../review/recallAnchors';
import { KnowledgeBaseError, ErrorCodes } from '../../utils/errors';
import type {
  KnowledgeNode,
  KnowledgeMap,
  KnowledgeRelation,
  KnowledgeTag,
  KnowledgeAsset,
  MapOccurrence,
  KnowledgeFrame,
  PortableManifest,
  PortableMap,
  NodeFrontmatter,
  ID,
  RetrievalTarget,
  MemoryState,
  ReviewEvent,
  SemesterPlan,
  PlanAssignment,
  PlanExecutionState,
  RecallDraft,
} from '../../domain/types';
import { PORTABLE_SCHEMA_VERSION } from './exporter';
import { invalidateProjectionCache } from '../../domain/contentProjection';
import { revokeAllAssetUrls } from '../nodes/assetResolver';

const LEGACY_SCHEMA = '0.1';
const CURRENT_SCHEMA = PORTABLE_SCHEMA_VERSION;

// ---------- YAML frontmatter parser (simple) ----------

interface ParsedNodeFile {
  frontmatter: NodeFrontmatter;
  content: string;
}

/**
 * Parse a node .md file with YAML frontmatter.
 * Simple parser: split at first `---`, parse key: value lines.
 */
function parseNodeMarkdown(md: string): ParsedNodeFile {
  // Find the opening ---
  const startMatch = md.match(/^---\s*\n/);
  if (!startMatch) {
    throw new KnowledgeBaseError(
      'Node file is missing YAML frontmatter.',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }

  const afterStart = md.slice(startMatch[0].length);
  // Find the closing ---
  const endMatch = afterStart.match(/\n---\s*(\n|$)/);
  if (!endMatch) {
    throw new KnowledgeBaseError(
      'Node file has malformed YAML frontmatter (missing closing ---).',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }

  const yamlBlock = afterStart.slice(0, endMatch.index);
  const content = afterStart.slice((endMatch.index ?? 0) + endMatch[0].length);

  const fm = parseYamlBlock(yamlBlock);
  return { frontmatter: fm, content };
}

function parseGuidance(value: string): NonNullable<NodeFrontmatter['aiGuidance']> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed.note !== 'string' || !parsed.sections || Array.isArray(parsed.sections) || typeof parsed.sections !== 'object' || Object.values(parsed.sections).some(text => typeof text !== 'string')) throw new Error('Invalid guidance in backup.');
  return parsed;
}

function parseYamlBlock(block: string): NodeFrontmatter {
  const lines = block.split('\n');
  const data: Record<string, string | string[]> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    if (value.startsWith('"') || value.startsWith('[')) {
      try { const parsed = JSON.parse(value); if (typeof parsed === 'string' || (Array.isArray(parsed) && parsed.every(item => typeof item === 'string'))) { data[key] = parsed; continue; } } catch { /* Accept older YAML-style values below. */ }
    }
    // Parse inline array: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      if (inner === '') {
        data[key] = [];
      } else {
        // Split by comma, but respect quoted strings
        const items: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i];
          if (ch === '"' || ch === "'") {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            items.push(current.trim().replace(/^["']|["']$/g, ''));
            current = '';
          } else {
            current += ch;
          }
        }
        if (current.trim()) {
          items.push(current.trim().replace(/^["']|["']$/g, ''));
        }
        data[key] = items;
      }
    } else {
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }

  // Validate required fields
  const id = data.id;
  const title = data.title;
  if (typeof id !== 'string' || !id) {
    throw new KnowledgeBaseError(
      'Node frontmatter is missing required field: id',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }
  if (typeof title !== 'string' || !title) {
    throw new KnowledgeBaseError(
      'Node frontmatter is missing required field: title',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }

  let sectionTags: Record<string, string[]> | undefined;
  if (data.sectionTags) {
    try {
      const parsed = typeof data.sectionTags === 'string' ? JSON.parse(data.sectionTags) : data.sectionTags;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        sectionTags = parsed as Record<string, string[]>;
      }
    } catch { /* ignore */ }
  }

  return {
    schemaVersion: typeof data.schemaVersion === 'string' ? data.schemaVersion : LEGACY_SCHEMA,
    id,
    title,
    tags: Array.isArray(data.tags) ? data.tags : [],
    ...(sectionTags ? { sectionTags } : {}),
    assetIds: Array.isArray(data.assetIds) ? data.assetIds : [],
    ...(typeof data.aiGuidance === 'string' ? { aiGuidance: parseGuidance(data.aiGuidance) } : {}),
    ...(typeof data.overview === 'string' ? { overview: data.overview } : {}),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date(0).toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date(0).toISOString(),
  };
}

// ---------- JSON parse helper ----------

function safeJsonParse<T>(text: string, context: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new KnowledgeBaseError(
      `Failed to parse JSON in ${context}.`,
      ErrorCodes.IMPORT_JSON_PARSE
    );
  }
}

// ---------- Main import function ----------

export async function importBackup(file: File, strategy: 'replace'): Promise<void> {
  if (strategy !== 'replace') {
    throw new KnowledgeBaseError(
      `Unsupported import strategy: ${strategy}`,
      ErrorCodes.VALIDATION
    );
  }

  let zip: JSZip;
  try {
    const data = typeof (file as any)?.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new KnowledgeBaseError(
      'Failed to read ZIP file. The file may be corrupted.',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }

  // 1. Parse and validate manifest
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new KnowledgeBaseError(
      'Backup is missing manifest.json.',
      ErrorCodes.IMPORT_FILE_CORRUPT
    );
  }
  const manifestText = await manifestFile.async('string');
  const manifest = safeJsonParse<PortableManifest>(manifestText, 'manifest.json');

  if (![LEGACY_SCHEMA, '0.2', '0.3', '0.4', '0.5', '0.6', CURRENT_SCHEMA].includes(manifest.schemaVersion)) {
    throw new KnowledgeBaseError(
      `Unsupported schema version: ${manifest.schemaVersion}. Expected ${LEGACY_SCHEMA} through ${CURRENT_SCHEMA}.`,
      ErrorCodes.IMPORT_SCHEMA_UNSUPPORTED
    );
  }

  // 1b. Learning/planning files were introduced in schema 0.2. Importing a
  // 0.1 backup intentionally creates an empty learning layer without touching
  // the restored knowledge content.
  let retrievalTargets: RetrievalTarget[] = [];
  let memoryStates: MemoryState[] = [];
  let reviewEvents: ReviewEvent[] = [];
  let semesterPlans: SemesterPlan[] = [];
  let planAssignments: PlanAssignment[] = [];
  let planExecutionStates: PlanExecutionState[] = [];
  let recallDrafts: RecallDraft[] = [];
  let importedMeta: Array<{ key: string; value: unknown }> = [];
  if (manifest.schemaVersion !== LEGACY_SCHEMA) {
    const targetsFile = zip.file('learning/retrieval-targets.json');
    const statesFile = zip.file('learning/memory-states.json');
    const eventsFile = zip.file('learning/review-events.ndjson');
    const plansFile = zip.file('planning/semester-plans.json');
    if (!targetsFile || !statesFile || !eventsFile) {
      throw new KnowledgeBaseError(
        'Learning backup is missing required files.',
        ErrorCodes.IMPORT_FILE_CORRUPT
      );
    }
    retrievalTargets = safeJsonParse<RetrievalTarget[]>(await targetsFile.async('string'), 'learning/retrieval-targets.json');
    memoryStates = safeJsonParse<MemoryState[]>(await statesFile.async('string'), 'learning/memory-states.json');
    const eventLines = (await eventsFile.async('string')).split('\n').filter((line) => line.trim());
    reviewEvents = eventLines.map((line, index) => safeJsonParse<ReviewEvent>(line, `learning/review-events.ndjson:${index + 1}`));
    const draftsFile = zip.file('learning/recall-drafts.json');
    if (draftsFile) recallDrafts = safeJsonParse<RecallDraft[]>(await draftsFile.async('string'), 'learning/recall-drafts.json');
    if (!Array.isArray(recallDrafts) || recallDrafts.some(d => !d || typeof d.id !== 'string' || typeof d.sourceId !== 'string' ||
      !d.anchor || !validAnchor(d.anchor) || (d.anchors !== undefined && (!Array.isArray(d.anchors) || !d.anchors.length || !d.anchors.every(validAnchor))) || !['cloze', 'hidden', 'question'].includes(d.presentation) || typeof d.prompt !== 'string') ||
      !Array.isArray(retrievalTargets) || retrievalTargets.some(t => !t || (t.anchor && !validAnchor(t.anchor)) || (t.anchors !== undefined && (!Array.isArray(t.anchors) || !t.anchors.length || !t.anchors.every(validAnchor))))) {
      throw new KnowledgeBaseError('Backup contains an invalid recall selection.', ErrorCodes.IMPORT_FILE_CORRUPT);
    }
    const assignmentsFile = zip.file('planning/plan-assignments.json');
    if (assignmentsFile) {
      planAssignments = safeJsonParse<PlanAssignment[]>(await assignmentsFile.async('string'), 'planning/plan-assignments.json');
      if (
        !Array.isArray(planAssignments) ||
        planAssignments.some(
          a =>
            !a ||
            typeof a.id !== 'string' ||
            (a.reviewPlanId !== null && typeof a.reviewPlanId !== 'string') ||
            (a.reviewPlanId === null && a.startsAt == null && a.endsAt == null) ||
            !['node', 'section', 'retrieval_target'].includes(a.subjectType) ||
            typeof a.subjectId !== 'string'
        )
      ) {
        throw new KnowledgeBaseError('Backup contains an invalid plan assignment.', ErrorCodes.IMPORT_FILE_CORRUPT);
      }
    }
    const execStatesFile = zip.file('learning/plan-execution-states.json');
    if (execStatesFile) {
      planExecutionStates = safeJsonParse<PlanExecutionState[]>(await execStatesFile.async('string'), 'learning/plan-execution-states.json');
      if (!Array.isArray(planExecutionStates) || planExecutionStates.some(e => !e || typeof e.id !== 'string' || typeof e.retrievalTargetId !== 'string' || typeof e.reviewPlanId !== 'string' || typeof e.stepIndex !== 'number')) {
        throw new KnowledgeBaseError('Backup contains an invalid plan execution state.', ErrorCodes.IMPORT_FILE_CORRUPT);
      }
    }
    if (plansFile) {
      semesterPlans = safeJsonParse<SemesterPlan[]>(await plansFile.async('string'), 'planning/semester-plans.json');
    }

    const targetIds = new Set(retrievalTargets.map((target) => target.id));
    if (memoryStates.some((state) => !targetIds.has(state.retrievalTargetId))) {
      throw new KnowledgeBaseError(
        'Learning backup contains memory records without a retrieval target.',
        ErrorCodes.IMPORT_FILE_CORRUPT
      );
    }
    const metaFile = zip.file('meta.json');
    if (metaFile) {
      importedMeta = safeJsonParse<Array<{ key: string; value: unknown }>>(await metaFile.async('string'), 'meta.json');
    }
  }

  // 2. Parse tags.json
  let tags: KnowledgeTag[] = [];
  const tagsFile = zip.file('tags.json');
  if (tagsFile) {
    const tagsText = await tagsFile.async('string');
    tags = safeJsonParse<KnowledgeTag[]>(tagsText, 'tags.json');
  }

  // 3. Parse relations.json
  let relations: KnowledgeRelation[] = [];
  const relationsFile = zip.file('relations.json');
  if (relationsFile) {
    const relationsText = await relationsFile.async('string');
    relations = safeJsonParse<KnowledgeRelation[]>(relationsText, 'relations.json');
  }

  // 3b. Parse assets.json (asset metadata: id, filename, mimeType, description, dates)
  // The actual blob data is in assets/ folder files. assets.json may not exist
  // in older backups (schemaVersion 0.1 initial), in which case we infer metadata
  // from filenames.
  interface AssetMetadata {
    id: string;
    filename: string;
    mimeType: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }
  let assetMetadataMap = new Map<string, AssetMetadata>();
  const assetsJsonFile = zip.file('assets.json');
  if (assetsJsonFile) {
    const assetsText = await assetsJsonFile.async('string');
    const assetMetadatas = safeJsonParse<AssetMetadata[]>(assetsText, 'assets.json');
    for (const am of assetMetadatas) {
      assetMetadataMap.set(am.id, am);
    }
  }

  // 4. Parse all node .md files
  const nodes: KnowledgeNode[] = [];
  const tagNameToId = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));

  const nodeFiles = zip.folder('nodes');
  if (nodeFiles) {
    const nodeFileList: string[] = [];
    nodeFiles.forEach((relativePath) => {
      if (relativePath.endsWith('.md')) {
        nodeFileList.push(relativePath);
      }
    });

    for (const relPath of nodeFileList) {
      const fileObj = nodeFiles.file(relPath);
      if (!fileObj) continue;
      const mdText = await fileObj.async('string');
      const { frontmatter, content } = parseNodeMarkdown(mdText);

      // Resolve tag names to tag IDs
      const tagIds: ID[] = frontmatter.tags
        .map((name) => tagNameToId.get(name.toLowerCase()))
        .filter((id): id is ID => !!id);

      // Resolve section tag names to section tag IDs
      const sectionTagIds: Record<string, ID[]> = {};
      if (frontmatter.sectionTags) {
        for (const [secId, names] of Object.entries(frontmatter.sectionTags)) {
          if (Array.isArray(names)) {
            const ids = names.map(n => tagNameToId.get(n.toLowerCase())).filter((id): id is ID => !!id);
            if (ids.length > 0) sectionTagIds[secId] = ids;
          }
        }
      }

      const createdAt = Date.parse(frontmatter.createdAt) || Date.now();
      const updatedAt = Date.parse(frontmatter.updatedAt) || createdAt;

      nodes.push({
        id: frontmatter.id,
        title: frontmatter.title,
        contentMarkdown: content,
        tagIds,
        ...(Object.keys(sectionTagIds).length > 0 ? { sectionTagIds } : {}),
        assetIds: frontmatter.assetIds,
        ...(frontmatter.aiGuidance ? { aiGuidance: frontmatter.aiGuidance } : {}),
        ...(frontmatter.overview ? { overview: frontmatter.overview } : {}),
        createdAt,
        updatedAt,
      });
    }
  }

  // 5. Parse all map .json files
  const maps: KnowledgeMap[] = [];
  const allOccurrences: MapOccurrence[] = [];
  const allFrames: KnowledgeFrame[] = [];

  const mapsFolder = zip.folder('maps');
  if (mapsFolder) {
    const mapFileList: string[] = [];
    mapsFolder.forEach((relativePath) => {
      if (relativePath.endsWith('.json')) {
        mapFileList.push(relativePath);
      }
    });

    for (const relPath of mapFileList) {
      const fileObj = mapsFolder.file(relPath);
      if (!fileObj) continue;
      const mapText = await fileObj.async('string');
      const portableMap = safeJsonParse<PortableMap>(mapText, `maps/${relPath}`);

      const createdAt = Date.parse(portableMap.createdAt) || Date.now();
      const updatedAt = Date.parse(portableMap.updatedAt) || createdAt;

      maps.push({
        id: portableMap.id,
        title: portableMap.title,
        description: portableMap.description,
        tagIds: portableMap.tagIds,
        viewportX: portableMap.viewportX,
        viewportY: portableMap.viewportY,
        viewportZoom: portableMap.viewportZoom,
        createdAt,
        updatedAt,
      });

      // Collect occurrences with timestamps
      for (const occ of portableMap.occurrences) {
        allOccurrences.push({
          ...occ,
          createdAt,
          updatedAt,
        });
      }

      // Collect frames with timestamps
      for (const frame of portableMap.frames) {
        allFrames.push({
          ...frame,
          createdAt,
          updatedAt,
        });
      }
    }
  }

  // 6. Read all asset files as blobs, keyed by full relative path.
  // We do NOT parse asset IDs from filenames here (UUIDs contain dashes,
  // making first-dash splitting unreliable). Instead, asset IDs are extracted
  // from markdown image references in step 7, where the full path is known.
  const assetBlobs = new Map<string, Blob>(); // fullPath -> Blob
  const assetsFolder = zip.folder('assets');
  if (assetsFolder) {
    const assetFileList: string[] = [];
    assetsFolder.forEach((relativePath) => {
      assetFileList.push(relativePath);
    });
    for (const relPath of assetFileList) {
      const fileObj = assetsFolder.file(relPath);
      if (!fileObj) continue;
      const blob = await fileObj.async('blob');
      assetBlobs.set(`assets/${relPath}`, blob);
    }
  }

  // Helper: extract asset ID and filename from a path like "assets/<id>-<filename>".
  // Tries UUID pattern first (app-generated IDs), then falls back to first-dash split.
  function parseAssetPath(fullPath: string): { assetId: string; filename: string } | null {
    // fullPath is like "assets/550e8400-...-image.png" or "assets/asset_001-diagram.png"
    const inner = fullPath.startsWith('assets/') ? fullPath.slice(7) : fullPath;
    // Try UUID pattern: <uuid>-<filename>
    const uuidMatch = inner.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i);
    if (uuidMatch) {
      return { assetId: uuidMatch[1], filename: uuidMatch[2] };
    }
    // Fallback: split at first dash
    const firstDash = inner.indexOf('-');
    if (firstDash > 0) {
      return { assetId: inner.slice(0, firstDash), filename: inner.slice(firstDash + 1) };
    }
    return null;
  }

  // Determine MIME type from filename extension
  function mimeFromFilename(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      pdf: 'application/pdf',
    };
    return mimeMap[ext] ?? 'application/octet-stream';
  }

  // 7. Import ALL assets from the ZIP's assets/ folder.
  // Assets are stored as separate files in the backup. We create a
  // KnowledgeAsset for every file found, regardless of whether it's
  // referenced in node content. Node assetIds come from the YAML frontmatter.
  // Content processing below only updates descriptions from alt text and
  // converts assets/ URLs to asset:// format.
  const assets: KnowledgeAsset[] = [];
  const assetById = new Map<string, KnowledgeAsset>();
  const now = Date.now();

  for (const [fullPath, blob] of assetBlobs) {
    const parsed = parseAssetPath(fullPath);
    if (!parsed) continue;
    const { assetId, filename } = parsed;
    if (assetById.has(assetId)) continue;

    // Use metadata from assets.json if available (description, mimeType, dates)
    const meta = assetMetadataMap.get(assetId);
    const asset: KnowledgeAsset = {
      id: assetId,
      filename: meta?.filename ?? filename,
      mimeType: meta?.mimeType ?? mimeFromFilename(filename),
      blob,
      description: meta?.description ?? '',
      createdAt: meta?.createdAt ? Date.parse(meta.createdAt) || now : now,
      updatedAt: meta?.updatedAt ? Date.parse(meta.updatedAt) || now : now,
    };
    assetById.set(assetId, asset);
    assets.push(asset);
  }

  // 7b. Process node content: convert assets/ URLs to asset:// format
  // and extract descriptions from image alt text.
  for (const node of nodes) {
    let content = node.contentMarkdown;

    // Pattern 1: Full image markdown ![alt](assets/<id>-<filename>)
    // Extract alt text as description, convert URL to asset://<id>
    content = content.replace(
      /!\[([^\]]*)\]\((assets\/[^)\s]+)\)/g,
      (match, altText: string, fullPath: string) => {
        const parsed = parseAssetPath(fullPath);
        if (!parsed || !assetById.has(parsed.assetId)) return match;

        const { assetId } = parsed;
        // Update description from alt text if not already set
        if (altText && !assetById.get(assetId)!.description) {
          assetById.get(assetId)!.description = altText;
        }

        return `![${altText}](asset://${assetId})`;
      }
    );

    // Pattern 2: Bare assets/<id>-<filename> references (not in image syntax)
    content = content.replace(
      /assets\/[^)\s]+/g,
      (match: string) => {
        const parsed = parseAssetPath(match);
        if (parsed && assetById.has(parsed.assetId)) {
          return `asset://${parsed.assetId}`;
        }
        return match;
      }
    );

    node.contentMarkdown = content;
    // NOTE: node.assetIds is preserved from the YAML frontmatter (set in step 4).
    // We do NOT overwrite it from content references.
  }

  // 8. Replace strategy: clear + bulk insert in a SINGLE transaction.
  // Per PORTABLE_FORMAT.md, the clear must be inside the transaction so that
  // if any bulk insert fails, Dexie rolls back and the original data survives.
  // Invalid import must NEVER corrupt the existing knowledge base.
  try {
    await db.transaction(
      'rw',
      [db.tags, db.nodes, db.maps, db.occurrences, db.frames, db.relations, db.assets,
        db.retrievalTargets, db.memoryStates, db.reviewEvents, db.semesterPlans, db.planAssignments, db.planExecutionStates, db.meta],
      async () => {
        // Clear all existing data (inside transaction for rollback safety)
        await db.tags.clear();
        await db.nodes.clear();
        await db.maps.clear();
        await db.occurrences.clear();
        await db.frames.clear();
        await db.relations.clear();
        await db.assets.clear();
        await db.retrievalTargets.clear();
        await db.memoryStates.clear();
        await db.reviewEvents.clear();
        await db.semesterPlans.clear();
        await db.planAssignments.clear();
        await db.planExecutionStates.clear();
        await db.meta.clear();

        // Bulk insert imported data
        if (tags.length > 0) await db.tags.bulkAdd(tags);
        if (nodes.length > 0) await db.nodes.bulkAdd(nodes);
        if (maps.length > 0) await db.maps.bulkAdd(maps);
        if (allFrames.length > 0) await db.frames.bulkAdd(allFrames);
        if (allOccurrences.length > 0) await db.occurrences.bulkAdd(allOccurrences);
        if (relations.length > 0) await db.relations.bulkAdd(relations);
        if (assets.length > 0) await db.assets.bulkAdd(assets);
        if (retrievalTargets.length > 0) await db.retrievalTargets.bulkAdd(retrievalTargets);
        if (memoryStates.length > 0) await db.memoryStates.bulkAdd(memoryStates);
        if (reviewEvents.length > 0) await db.reviewEvents.bulkAdd(reviewEvents);
        if (semesterPlans.length > 0) await db.semesterPlans.bulkAdd(semesterPlans);
        if (planAssignments.length > 0) await db.planAssignments.bulkAdd(planAssignments);
        if (planExecutionStates.length > 0) await db.planExecutionStates.bulkAdd(planExecutionStates);
        if (importedMeta.length > 0) {
          await db.meta.bulkAdd(importedMeta);
        } else if (recallDrafts.length > 0) {
          await db.meta.put({ key: RECALL_DRAFT_KEY, value: recallDrafts });
        }
      }
    );
    // Invalidate all derived content caches only after the transaction succeeds.
    invalidateProjectionCache();
    revokeAllAssetUrls();
  } catch (error) {
    // Transaction rolled back automatically by Dexie
    throw new KnowledgeBaseError(
      'Failed to import backup. Database transaction rolled back.',
      ErrorCodes.DB_WRITE_FAILED,
      error
    );
  }
}
