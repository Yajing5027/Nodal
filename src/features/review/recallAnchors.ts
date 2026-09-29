import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toString } from 'mdast-util-to-string';
import type { Root, RootContent } from 'mdast';
import type { RecallAnchor, RetrievalTarget } from '../../domain/types';
import { splitNotePanels } from '../../domain/notePanels';
import { parseTransclusionDirective } from '../../domain/sectionTransclusion';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export interface DocumentBlock extends RecallBlock { end: number; markdown: string }
/** Non-overlapping top-level units. Lists, tables, equations and code stay intact. */
export function documentBlocks(markdown: string): DocumentBlock[] {
  const headings: string[] = [];
  return parser.parse(markdown).children.filter(node => node.type !== 'definition' && !(node.type === 'html' && (/^<!-- nodal-panel:[a-zA-Z0-9_-]+:(hidden|visible) -->$/.test(node.value.trim()) || parseTransclusionDirective(node.value.trim())))).map(node => {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    const text = toString(node) || markdown.slice(start, end);
    const block = { text, start, end, markdown: markdown.slice(start, end), kind: node.type, sectionPath: headings.filter(Boolean) };
    if (node.type === 'heading') { headings.splice(node.depth - 1); headings[node.depth - 1] = text; }
    return block;
  });
}
export function wholeBlockAnchor(block: DocumentBlock): RecallAnchor {
  return { text: block.text, context: block.text, start: 0, end: block.text.length,
    blockStart: block.start, blockMarkdown: block.markdown, blockKind: block.kind, sectionPath: block.sectionPath };
}
export function targetAnchors(target: Pick<RetrievalTarget, 'anchor' | 'anchors'>): RecallAnchor[] {
  return target.anchors?.length ? target.anchors : target.anchor ? [target.anchor] : [];
}
export interface RecallBlock { text: string; start: number; kind: string; sectionPath: string[] }
export function recallBlocks(markdown: string): RecallBlock[] {
  const raw: Array<{ text: string; start: number; kind: string; depth?: number }> = [];
  const walk = (node: Root | RootContent) => {
    if (['paragraph', 'heading', 'listItem', 'tableCell'].includes(node.type)) {
      raw.push({ text: toString(node), start: node.position?.start.offset ?? 0, kind: node.type,
        ...('depth' in node && typeof node.depth === 'number' ? { depth: node.depth } : {}) });
    }
    if ('children' in node) node.children.forEach(child => walk(child as RootContent));
  };
  walk(parser.parse(markdown));
  const headings: string[] = [];
  return raw.sort((a, b) => a.start - b.start).map(block => {
    const sectionPath = [...headings];
    if (block.kind === 'heading') {
      const depth = block.depth ?? 1;
      headings.splice(depth - 1);
      headings[depth - 1] = block.text;
    }
    return { text: block.text, start: block.start, kind: block.kind, sectionPath };
  });
}

export function anchorSelections(anchor: RecallAnchor) {
  return (anchor.selections?.length ? anchor.selections : [{ text: anchor.text, start: anchor.start, end: anchor.end }])
    .slice().sort((a, b) => a.start - b.start);
}
export function validAnchor(anchor: RecallAnchor): boolean {
  if (!anchor || typeof anchor.context !== 'string' ||
      (anchor.selections !== undefined && (!Array.isArray(anchor.selections) || anchor.selections.some(s => !s)))) return false;
  if (anchor.blockMarkdown !== undefined && (typeof anchor.blockMarkdown !== 'string' || !anchor.blockMarkdown.trim() ||
      typeof anchor.blockKind !== 'string' || anchor.start !== 0 || anchor.end !== anchor.context.length || anchor.text !== anchor.context || anchor.selections !== undefined)) return false;
  const selections = anchorSelections(anchor);
  return typeof anchor.text === 'string' && !!anchor.text.trim() && typeof anchor.context === 'string' &&
    Number.isInteger(anchor.blockStart) && anchor.blockStart >= 0 &&
    Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 &&
    anchor.end > anchor.start && anchor.context.slice(anchor.start, anchor.end) === anchor.text &&
    selections.length > 0 && selections.every((selection, index) => Number.isInteger(selection.start) &&
      Number.isInteger(selection.end) && selection.start >= 0 && selection.end > selection.start &&
      anchor.context.slice(selection.start, selection.end) === selection.text &&
      (index === 0 || selections[index - 1].end <= selection.start));
}

// Do not silently bind a quote to a different occurrence after an edit.
// Identical blocks are disambiguated by their original Markdown position.
export function resolveAnchor(markdown: string, anchor: RecallAnchor): RecallAnchor | null {
  if (!validAnchor(anchor)) return null;
  const panels = splitNotePanels(markdown);
  const panel = anchor.panelId ? panels.find(item => item.id === anchor.panelId) : undefined;
  if (anchor.panelId && !panel) return null;
  const candidates = anchor.blockMarkdown !== undefined
    ? documentBlocks(markdown).filter(block => block.markdown === anchor.blockMarkdown)
    : recallBlocks(markdown).filter(block => block.text === anchor.context);
  const matches = candidates.filter(block => !panel || (block.start >= panel.start && block.start < panel.end));
  const block = matches.length === 1 ? matches[0] : matches.find(item => item.start === anchor.blockStart);
  const owner = block && markdown.includes('<!-- nodal-panel:') ? panels.find(item => block.start >= item.start && block.start < item.end) : undefined;
  return block ? { ...anchor, blockStart: block.start,
    ...(owner ? { panelId: owner.id } : {}),
    ...(block.sectionPath.length ? { sectionPath: block.sectionPath.filter(Boolean) } : {}) } : null;
}

export function maskedContext(anchor: RecallAnchor): string {
  return anchorSelections(anchor).slice().reverse().reduce((context, selection) =>
    context.slice(0, selection.start) + '［ … ］' + context.slice(selection.end), anchor.context);
}

export function needsRecallCue(target: RetrievalTarget): boolean {
  if (target.presentation === 'question' || !targetAnchors(target).length) return false;
  if (targetAnchors(target).some(anchor => anchor.blockMarkdown !== undefined)) return !target.promptMarkdown.trim();
  return !targetAnchors(target).some(hasVisibleRecallContext);
}
export function hasVisibleRecallContext(anchor: RecallAnchor): boolean {
  const selections = anchorSelections(anchor);
  const visible = selections.slice().reverse().reduce((context, selection) =>
    context.slice(0, selection.start) + context.slice(selection.end), anchor.context);
  return /[\p{L}\p{N}]/u.test(visible);
}
export function recallPrompt(target: RetrievalTarget): string {
  if (needsRecallCue(target)) return 'Add a question for this passage';
  if (targetAnchors(target).some(anchor => anchor.blockMarkdown !== undefined)) return target.promptMarkdown;
  if (targetAnchors(target).length && (target.presentation === 'cloze' || target.presentation === 'hidden')) return targetAnchors(target).map(maskedContext).join('\n\n');
  return target.promptMarkdown;
}
