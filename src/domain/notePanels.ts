import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent } from 'mdast';
import type { RecallAnchor } from './types';

export interface NotePanel {
  id: string;
  markdown: string;
  hidden: boolean;
  start: number;
  end: number;
  parentId?: string | null;
  title?: string;
}
const marker = /^<!-- nodal-panel:([a-zA-Z0-9_-]+):(hidden|visible)(.*?)-->$/;
const parser = unified().use(remarkParse);

/**
 * Splits raw markdown text on >= 3 consecutive newlines outside of
 * fenced code blocks, math blocks, and indented code blocks.
 * Lines containing only whitespace (spaces, tabs, NBSP) are treated as empty lines.
 * Returns chunks with start/end offset or single chunk if no split needed.
 */
export function splitByConsecutiveNewlines(text: string): Array<{ markdown: string; start: number; end: number }> {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const protectedRanges: Array<{ start: number; end: number }> = [];

  // Fenced code blocks (``` or ~~~)
  const fenceRegex = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(normalized)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Math blocks ($$ ... $$)
  const mathRegex = /\$\$[\s\S]*?\$\$/g;
  while ((match = mathRegex.exec(normalized)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  const isProtected = (idx: number) => protectedRanges.some(r => idx >= r.start && idx < r.end);

  // >= 3 newlines separated only by spaces, tabs, or NBSP
  const splitRegex = /\n(?:[ \t\u00A0]*\n){2,}/g;
  const cuts: Array<{ start: number; end: number }> = [];
  while ((match = splitRegex.exec(normalized)) !== null) {
    if (!isProtected(match.index)) {
      cuts.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  if (cuts.length === 0) {
    return [{ markdown: normalized, start: 0, end: normalized.length }];
  }

  const sections: Array<{ markdown: string; start: number; end: number }> = [];
  let lastEnd = 0;
  for (const cut of cuts) {
    const chunk = normalized.slice(lastEnd, cut.start);
    if (chunk.trim()) {
      sections.push({ markdown: chunk.trim(), start: lastEnd, end: cut.start });
    }
    lastEnd = cut.end;
  }
  const lastChunk = normalized.slice(lastEnd);
  if (lastChunk.trim()) {
    sections.push({ markdown: lastChunk.trim(), start: lastEnd, end: normalized.length });
  }

  return sections.length > 0 ? sections : [{ markdown: normalized, start: 0, end: normalized.length }];
}

export function isAutoPanelId(id: string): boolean {
  return id === 'main' || /^sec-\d+$/.test(id);
}

export function splitNotePanels(markdown: string): NotePanel[] {
  const boundaries = parser.parse(markdown).children.flatMap(node => {
    const match = node.type === 'html' ? marker.exec(node.value.trim()) : null;
    if (!match) return [];
    const extra = match[3] || '';
    const pMatch = extra.match(/:parent=([a-zA-Z0-9_-]+)/);
    const tMatch = extra.match(/:title=([^:]+)/);
    let title: string | undefined;
    if (tMatch) {
      try { title = decodeURIComponent(tMatch[1].trim()); } catch { title = tMatch[1].trim(); }
    }
    return [{
      id: match[1],
      hidden: match[2] === 'hidden',
      parentId: pMatch ? pMatch[1] : null,
      title: title || undefined,
      start: node.position!.start.offset!,
      end: node.position!.end.offset!,
    }];
  });

  // Filter boundaries: if a boundary is an auto-split marker (id /^sec-\d+$/)
  // and there are not >= 3 newlines separating it from previous content/boundary,
  // it means the user merged the sections, so the boundary no longer divides panels.
  const activeBoundaries: typeof boundaries = [];
  boundaries.forEach((b, idx) => {
    if (!isAutoPanelId(b.id) || b.hidden || b.parentId || b.title) {
      activeBoundaries.push(b);
    } else {
      const prevEnd = idx > 0 ? boundaries[idx - 1].end : 0;
      const textBetween = markdown.slice(prevEnd, b.start);
      if (idx === 0 || /\n(?:[ \t\u00A0]*\n){2,}/.test(textBetween)) {
        activeBoundaries.push(b);
      }
    }
  });

  if (activeBoundaries.length > 0 && new Set(activeBoundaries.map(item => item.id)).size === activeBoundaries.length) {
    const panels: NotePanel[] = [];
    if (markdown.slice(0, activeBoundaries[0].start).trim()) panels.push({ id: 'main', markdown: markdown.slice(0, activeBoundaries[0].start), hidden: false, start: 0, end: activeBoundaries[0].start });
    activeBoundaries.forEach((item, index) => {
      const start = item.end + (markdown.slice(item.end, item.end + 2) === '\n\n' ? 2 : 0);
      let end = activeBoundaries[index + 1]?.start ?? markdown.length;
      if (index + 1 < activeBoundaries.length && markdown.slice(end - 2, end) === '\n\n') end -= 2;
      end = Math.max(start, end);
      panels.push({
        id: item.id,
        hidden: item.hidden,
        start,
        end,
        markdown: markdown.slice(start, end),
        parentId: item.parentId,
        title: item.title,
      });
    });
    return panels;
  }

  // Fallback: check 3+ newlines outside protected blocks
  const newlineSections = splitByConsecutiveNewlines(markdown);
  if (newlineSections.length > 1) {
    return newlineSections.map((sec, idx) => ({
      id: `sec-${idx + 1}`,
      markdown: sec.markdown,
      hidden: false,
      start: sec.start,
      end: sec.end,
    }));
  }

  return [{ id: 'main', markdown, hidden: false, start: 0, end: markdown.length }];
}

interface PanelCacheEntry {
  version: string;
  panels: NotePanel[];
}
const panelParseCache = new Map<string, PanelCacheEntry>();

export function splitNotePanelsCached(nodeId: string, markdown: string, updatedAt?: number): NotePanel[] {
  const version = `${updatedAt ?? 0}:${markdown.length}`;
  const existing = panelParseCache.get(nodeId);
  if (existing && existing.version === version) {
    return existing.panels;
  }
  const panels = splitNotePanels(markdown);
  panelParseCache.set(nodeId, { version, panels });
  return panels;
}

export function invalidatePanelCache(nodeId?: string): void {
  if (nodeId) panelParseCache.delete(nodeId);
  else panelParseCache.clear();
}

export function joinNotePanels(panels: Array<Pick<NotePanel, 'id' | 'markdown' | 'hidden'> & { parentId?: string | null; title?: string }>, structured = true): string {
  if (panels.length === 0) return '';
  if (!structured && panels.length === 1 && !panels[0].hidden && !panels[0].parentId && !panels[0].title) return panels[0].markdown;

  // If all panels are auto-split panels (id is 'main' or 'sec-*') and none are hidden or have parent/title:
  // Join them with 4 newlines so that standard consecutive newline parsing recognizes them as sections,
  // and deleting the 3 empty lines merges them back!
  const allAuto = panels.every(p => isAutoPanelId(p.id) && !p.hidden && !p.parentId && !p.title);
  if (allAuto) {
    return panels.map(p => p.markdown.trim()).filter(Boolean).join('\n\n\n\n');
  }

  return panels.map(panel => {
    let tag = `<!-- nodal-panel:${panel.id}:${panel.hidden ? 'hidden' : 'visible'}`;
    if (panel.parentId) tag += `:parent=${panel.parentId}`;
    if (panel.title?.trim()) tag += `:title=${encodeURIComponent(panel.title.trim())}`;
    tag += ' -->';
    return `${tag}\n\n${panel.markdown}`;
  }).join('\n\n');
}
/** Reordering unchanged panels moves anchors by the same offset, including duplicate paragraphs. */
export function movePanelAnchor(anchor: RecallAnchor, before: string, after: string): RecallAnchor {
  const old = splitNotePanels(before).find(panel => anchor.panelId ? panel.id === anchor.panelId : anchor.blockStart >= panel.start && anchor.blockStart < panel.end);
  const next = old && splitNotePanels(after).find(panel => panel.id === old.id);
  if (!old || !next) return anchor;
  return { ...anchor, panelId: old.id, ...(old.markdown === next.markdown ? { blockStart: anchor.blockStart + next.start - old.start } : {}) };
}
/** Group after recall annotation so blank IDs and Markdown references remain document-wide. */
export function remarkNotePanels() {
  return (tree: Root) => {
    const markers = tree.children.filter(node => node.type === 'html' && marker.test(node.value.trim()));
    const ids = markers.map(node => marker.exec((node as { value: string }).value.trim())![1]);
    if (!markers.length || new Set(ids).size !== ids.length) return;
    const result: RootContent[] = [];
    let group: RootContent[] | null = null;
    for (const node of tree.children) {
      const match = node.type === 'html' ? marker.exec(node.value.trim()) : null;
      if (match) {
        group = [];
        const extra = match[3] || '';
        const pMatch = extra.match(/:parent=([a-zA-Z0-9_-]+)/);
        const tMatch = extra.match(/:title=([^:]+)/);
        let title: string | undefined;
        if (tMatch) {
          try { title = decodeURIComponent(tMatch[1].trim()); } catch { title = tMatch[1].trim(); }
        }
        result.push({
          type: 'blockquote',
          children: group,
          data: {
            hName: 'section',
            hProperties: {
              'data-note-panel': match[1],
              'data-panel-hidden': match[2] === 'hidden' ? 'true' : 'false',
              'data-panel-parent': pMatch ? pMatch[1] : undefined,
              'data-panel-title': title || undefined,
            }
          }
        } as RootContent);
      } else if (group) group.push(node); else result.push(node);
    }
    tree.children = result;
  };
}
