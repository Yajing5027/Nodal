import type { RecallAnchor } from '../../domain/types';
import { anchorSelections } from '../review/recallAnchors';

export const blankId = (anchor: RecallAnchor, start: number, end: number) => `${anchor.blockStart}:${start}:${end}`;
export const blockId = (anchor: RecallAnchor) => `block:${anchor.blockStart}`;

/** Several prompts can mark the same note. Render overlapping annotations once. */
export function mergeRecallAnchors(anchors: RecallAnchor[]): RecallAnchor[] {
  const groups = new Map<number, RecallAnchor>();
  for (const anchor of anchors) {
    const previous = groups.get(anchor.blockStart);
    if (previous?.blockMarkdown !== undefined) continue;
    if (!previous || anchor.blockMarkdown !== undefined) { groups.set(anchor.blockStart, { ...anchor }); continue; }
    const selections = [...anchorSelections(previous), ...anchorSelections(anchor)].sort((a, b) => a.start - b.start);
    const merged: typeof selections = [];
    for (const selection of selections) {
      const last = merged.at(-1);
      if (last && selection.start < last.end) { last.end = Math.max(last.end, selection.end); last.text = anchor.context.slice(last.start, last.end); }
      else merged.push({ ...selection });
    }
    groups.set(anchor.blockStart, { ...anchor, ...merged[0], selections: merged });
  }
  return [...groups.values()].sort((a, b) => a.blockStart - b.blockStart);
}

interface AstNode {
  type: string;
  value?: string;
  children?: AstNode[];
  position?: { start: { offset?: number } };
  data?: Record<string, unknown>;
}

/** Mark the Markdown tree before KaTeX/highlighting, preserving inline formatting. */
export function remarkRecallMarks({ anchors }: { anchors: RecallAnchor[] }) {
  return (tree: AstNode) => {
    const byStart = new Map(anchors.filter(anchor => anchor.blockMarkdown === undefined).map(anchor => [anchor.blockStart, anchor]));
    const wholeBlocks = new Map(anchors.filter(anchor => anchor.blockMarkdown !== undefined).map(anchor => [anchor.blockStart, anchor]));
    let number = 0;
    const numbers = new Map<string, number>();
    for (const anchor of anchors) for (const selection of anchorSelections(anchor)) numbers.set(blankId(anchor, selection.start, selection.end), ++number);
    const visit = (node: AstNode) => {
      const anchor = byStart.get(node.position?.start.offset ?? -1);
      if (anchor && node.children && ['paragraph', 'heading', 'listItem', 'tableCell'].includes(node.type)) {
        let cursor = 0;
        const selections = anchorSelections(anchor);
        const annotate = (parent: AstNode) => {
          parent.children = parent.children?.flatMap(child => {
            if (child.children) { annotate(child); return [child]; }
            if (child.value === undefined) return [child];
            const start = cursor; cursor += child.value.length;
            const cuts = selections.filter(selection => selection.start < cursor && selection.end > start);
            if (!cuts.length) return [child];
            const result: AstNode[] = []; let offset = 0;
            for (const selection of cuts) {
              const from = Math.max(0, selection.start - start); const to = Math.min(child.value.length, selection.end - start);
              if (from > offset) result.push({ ...child, value: child.value.slice(offset, from) });
              const id = blankId(anchor, selection.start, selection.end);
              result.push({ type: 'recallMark', data: { hName: 'span', hProperties: { 'data-recall-id': id, 'data-recall-number': numbers.get(id), 'data-recall-first': selection.start >= start } },
                children: [{ ...child, value: child.value.slice(from, to) }] });
              offset = to;
            }
            if (offset < child.value.length) result.push({ ...child, value: child.value.slice(offset) });
            return result;
          });
        };
        annotate(node);
      } else if (node.children) node.children = node.children.map(child => {
        const whole = wholeBlocks.get(child.position?.start.offset ?? -1);
        if (whole) return { type: 'recallBlock', data: { hName: 'section', hProperties: { 'data-recall-block': blockId(whole), 'data-block-kind': whole.blockKind } }, children: [child] };
        visit(child); return child;
      });
    };
    visit(tree);
  };
}
