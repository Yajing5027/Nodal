// ============================================================
// Section transclusion — live composition metadata.
//
// A transclusion is a standalone HTML-comment directive inside a Node's
// canonical Markdown that points at a Section (the internally named
// NotePanel) owned by another Node. It is NOT a KnowledgeRelation and does
// NOT create ownership. The destination never copies source Markdown.
//
// V1 syntax:
//   <!-- nodal-transclude:v1:<sourceNodeId>:<sourceSectionId> -->
//
// sourceSectionId is an existing NotePanel stable ID. The legacy
// unstructured one-body note resolves to the deterministic id "main".
// ============================================================
import { splitNotePanelsCached, type NotePanel } from './notePanels';
import type { KnowledgeNode } from './types';

export interface TransclusionRef {
  sourceNodeId: string;
  sourceSectionId: string;
}

// Node IDs are UUIDs (hyphen-safe) and section IDs are [a-zA-Z0-9_-]+.
// Allow a permissive but colon-free body so unusual IDs still round-trip.
const directive = /^<!-- nodal-transclude:v1:([^:\s]+):([^:\s]+) -->$/;

/** Parse a single HTML-comment node value. Returns null when it is not a directive. */
export function parseTransclusionDirective(value: string): TransclusionRef | null {
  const match = directive.exec(value.trim());
  if (!match) return null;
  return { sourceNodeId: match[1], sourceSectionId: match[2] };
}

/** Serialize a reference into the canonical Markdown directive. */
export function stringifyTransclusionDirective(ref: TransclusionRef): string {
  return `<!-- nodal-transclude:v1:${ref.sourceNodeId}:${ref.sourceSectionId} -->`;
}

/** True when the raw Markdown text contains any standalone transclusion directive. */
export function containsTransclusion(markdown: string): boolean {
  return findTransclusionRefs(markdown).length > 0;
}

/**
 * Find every transclusion reference in a Node's canonical Markdown.
 * Used by integrity scanning and deletion-impact reporting. Identity is
 * sourceNodeId + sourceSectionId only — never heading text or array index.
 */
export function findTransclusionRefs(markdown: string): TransclusionRef[] {
  const refs: TransclusionRef[] = [];
  for (const line of markdown.split('\n')) {
    const ref = parseTransclusionDirective(line);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** Readable label for a Section: custom title if present, first heading, else short text preview, else fallback. */
export function sectionLabel(markdown: string, fallbackIndex?: number, customTitle?: string): string {
  if (customTitle && customTitle.trim()) return customTitle.trim();
  const lines = markdown.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('<!--')) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return heading[1].trim();
    const preview = line.replace(/[*_`[\]()~]/g, '').trim();
    if (preview) return preview.length > 48 ? preview.slice(0, 48).trimEnd() + '…' : preview;
  }
  return fallbackIndex === undefined ? 'Section' : `Section ${fallbackIndex + 1}`;
}

export type SectionResolution =
  | { status: 'ok'; markdown: string; nodeTitle: string; label: string }
  | { status: 'missing-node' }
  | { status: 'missing-section' }
  | { status: 'cycle' };

interface PathItem {
  nodeId: string;
  sectionId: string;
}

/**
 * Resolve a source Section to its canonical Markdown with path-based cycle
 * detection. The source hidden flag is NOT applied — hidden state is source-note
 * presentation only, and transcluded content renders as normal content.
 */
export function resolveSection(
  ref: TransclusionRef,
  getNode: (id: string) => KnowledgeNode | undefined,
  path: PathItem[] = [],
): SectionResolution {
  if (path.some((p) => p.nodeId === ref.sourceNodeId && p.sectionId === ref.sourceSectionId)) {
    return { status: 'cycle' };
  }
  const node = getNode(ref.sourceNodeId);
  if (!node) return { status: 'missing-node' };
  const panels = splitNotePanelsCached(node.id, node.contentMarkdown, node.updatedAt);
  const panel = panels.find((p: NotePanel) => p.id === ref.sourceSectionId);
  if (!panel) return { status: 'missing-section' };
  const index = panels.findIndex((p: NotePanel) => p.id === ref.sourceSectionId);
  return {
    status: 'ok',
    markdown: panel.markdown,
    nodeTitle: node.title || 'Untitled note',
    label: sectionLabel(panel.markdown, index, panel.title),
  };
}

/**
 * Expand transclusion directives in Markdown into readable, resolved content.
 * Cycle-safe and unresolved-safe. Used by readable exports (NOT the canonical
 * full backup, which preserves the directive verbatim).
 */
export function expandTransclusionsToMarkdown(
  markdown: string,
  getNode: (id: string) => KnowledgeNode | undefined,
  path: PathItem[] = [],
): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const ref = parseTransclusionDirective(line);
    if (!ref) {
      out.push(line);
      continue;
    }
    const result = resolveSection(ref, getNode, path);
    if (result.status === 'missing-node') {
      out.push('> _Missing source note._');
      continue;
    }
    if (result.status === 'missing-section') {
      out.push('> _Missing section in source note._');
      continue;
    }
    if (result.status === 'cycle') {
      out.push('> _Circular section reference._');
      continue;
    }
    const nextPath = [...path, { nodeId: ref.sourceNodeId, sectionId: ref.sourceSectionId }];
    out.push(`> From ${result.nodeTitle} · ${result.label}`);
    out.push('');
    out.push(expandTransclusionsToMarkdown(result.markdown, getNode, nextPath));
  }
  return out.join('\n');
}
