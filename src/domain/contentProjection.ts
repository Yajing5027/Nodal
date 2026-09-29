import type { KnowledgeNode } from './types';
import {
  findTransclusionRefs,
  resolveSection,
} from './sectionTransclusion';

export { splitNotePanelsCached } from './notePanels';
import { invalidatePanelCache as invalidatePanels } from './notePanels';

export function invalidateProjectionCache(nodeId?: string): void {
  invalidatePanels(nodeId);
  excerptCache.clear();
}

export const invalidatePanelCache = invalidateProjectionCache;

// ============================================================
// Internal Storage Directives Stripping
// Storage directives must never leak into excerpts, previews,
// plain-text search, or reader projections.
// ============================================================
const DIRECTIVE_REGEX = /<!--\s*nodal-(?:panel|transclude)[^>]*-->/gi;
const ANY_HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;

export function stripInternalDirectives(markdown: string): string {
  if (!markdown) return '';
  return markdown.replace(DIRECTIVE_REGEX, '').replace(ANY_HTML_COMMENT_REGEX, '');
}

// ============================================================
// Plain Text Projection
// Converts canonical or composed markdown into clean readable text.
// ============================================================
export interface PlainTextOptions {
  resolveTransclusions?: boolean;
  getNode?: (id: string) => KnowledgeNode | undefined;
  path?: Array<{ nodeId: string; sectionId: string }>;
}

export function projectPlainText(markdown: string, options: PlainTextOptions = {}): string {
  if (!markdown) return '';

  const { resolveTransclusions = false, getNode, path = [] } = options;

  let text = markdown;

  // 1. Expand or strip transclusions
  if (resolveTransclusions && getNode) {
    const lines = text.split('\n');
    const expanded: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('<!-- nodal-transclude:v1:')) {
        const refs = findTransclusionRefs(line);
        if (refs.length > 0) {
          const ref = refs[0];
          const isCycle = path.some(p => p.nodeId === ref.sourceNodeId && p.sectionId === ref.sourceSectionId);
          if (isCycle) {
            expanded.push('[Circular section reference]');
            continue;
          }
          const res = resolveSection(ref, getNode, path);
          if (res.status === 'ok') {
            const nextPath = [...path, { nodeId: ref.sourceNodeId, sectionId: ref.sourceSectionId }];
            expanded.push(projectPlainText(res.markdown, { resolveTransclusions: true, getNode, path: nextPath }));
          } else if (res.status === 'missing-node') {
            expanded.push('[Missing source note]');
          } else if (res.status === 'missing-section') {
            expanded.push('[Missing section]');
          } else {
            expanded.push('[Circular section reference]');
          }
          continue;
        }
      }
      expanded.push(line);
    }
    text = expanded.join('\n');
  }

  // 2. Strip all internal directives and comments
  text = stripInternalDirectives(text);

  // 3. Strip markdown syntax
  return text
    // Remove math blocks $$...$$ and inline $...$
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]+\$/g, ' ')
    // Remove code blocks ```...```
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code `...`
    .replace(/`[^`\n]+`/g, ' ')
    // Remove headers #...
    .replace(/^#{1,6}\s+/gm, '')
    // Remove images ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove links [text](url) -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove bold/italics
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove strikethrough ~~text~~
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove blockquotes
    .replace(/^\s*>\s*/gm, '')
    // Remove list markers
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    // Normalize newlines and whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// Excerpt Cache & Strategy
// O(1) retrieval for repeated renders of 1,000–5,000 note cards.
// ============================================================
const excerptCache = new Map<string, { version: string; excerpt: string }>();

export function getTransclusionDependenciesKey(
  markdown: string,
  getNode?: (id: string) => KnowledgeNode | undefined,
  visited = new Set<string>(),
): string {
  if (!getNode || !markdown || !markdown.includes('<!-- nodal-transclude:v1:')) return '';
  const refs = findTransclusionRefs(markdown);
  if (refs.length === 0) return '';
  const parts: string[] = [];
  for (const ref of refs) {
    if (visited.has(ref.sourceNodeId)) continue;
    visited.add(ref.sourceNodeId);
    const sourceNode = getNode(ref.sourceNodeId);
    if (sourceNode) {
      parts.push(`${sourceNode.id}:${sourceNode.updatedAt ?? 0}:${sourceNode.contentMarkdown.length}`);
      const nested = getTransclusionDependenciesKey(sourceNode.contentMarkdown, getNode, visited);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${ref.sourceNodeId}:missing`);
    }
  }
  return parts.join('|');
}

export function projectExcerpt(
  nodeOrMarkdown: KnowledgeNode | string,
  getNode?: (id: string) => KnowledgeNode | undefined,
  maxLength = 220,
): string {
  const isNode = typeof nodeOrMarkdown !== 'string';
  const node = isNode ? (nodeOrMarkdown as KnowledgeNode) : undefined;
  const markdown = isNode ? (nodeOrMarkdown as KnowledgeNode).contentMarkdown : (nodeOrMarkdown as string);
  const nodeId = node?.id;
  const depsKey = getTransclusionDependenciesKey(markdown, getNode);
  const version = node ? `${node.updatedAt ?? 0}:${markdown.length}:${maxLength}:${depsKey}` : undefined;

  if (nodeId && version) {
    const cached = excerptCache.get(nodeId);
    if (cached && cached.version === version) {
      return cached.excerpt;
    }
  }

  let excerpt = '';

  // 1. Direct text in canonical markdown
  const directText = projectPlainText(markdown, { resolveTransclusions: false });

  if (directText.length > 0) {
    excerpt = directText.slice(0, maxLength);
  } else {
    // 2. Check for formulas or code blocks in canonical markdown
    const hasMath = /\$|\\\(|\\\[/.test(markdown);
    const hasCode = /```|`[^`]+`/.test(markdown);

    // 3. Check for transclusions
    const transclusionRefs = findTransclusionRefs(markdown);

    if (transclusionRefs.length > 0) {
      if (getNode) {
        // Resolve first transclusion for excerpt preview
        const firstRef = transclusionRefs[0];
        const res = resolveSection(firstRef, getNode);
        if (res.status === 'ok') {
          const transcludedPlainText = projectPlainText(res.markdown, { resolveTransclusions: false });
          if (transcludedPlainText.length > 0) {
            excerpt = transcludedPlainText.slice(0, maxLength);
          } else {
            excerpt = `Transcluded from ${res.nodeTitle}`;
          }
        } else if (res.status === 'missing-node') {
          excerpt = 'Missing source note';
        } else if (res.status === 'missing-section') {
          excerpt = 'Missing section in source note';
        } else {
          excerpt = 'Circular section reference';
        }
      } else {
        excerpt = 'Transcluded section';
      }
    } else if (hasMath) {
      excerpt = 'Formula note';
    } else if (hasCode) {
      excerpt = 'Code note';
    } else {
      excerpt = 'Empty note';
    }
  }

  if (nodeId && version) {
    excerptCache.set(nodeId, { version, excerpt });
  }

  return excerpt;
}

/** Specialized safe excerpt for Map cards (maximum 60 characters by default). */
export function projectMapExcerpt(
  nodeOrMarkdown: KnowledgeNode | string | undefined,
  getNode?: (id: string) => KnowledgeNode | undefined,
  maxLength = 60,
): string {
  if (!nodeOrMarkdown) return '';
  return projectExcerpt(nodeOrMarkdown, getNode, maxLength);
}
