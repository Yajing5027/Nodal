// ============================================================
// Live Section transclusion rendering.
//
// A remark transform replaces `<!-- nodal-transclude:v1:... -->` HTML-comment
// nodes with a container div that holds the live source Section content,
// recursively and cycle-safely. The container carries data attributes the
// reading layer turns into a clickable provenance control.
//
// Canonical Markdown is never mutated; this only affects the reading projection.
// ============================================================
import { useCallback, useContext } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Node, Root, RootContent } from 'mdast';
import type { KnowledgeNode } from '../../domain/types';
import {
  parseTransclusionDirective,
  resolveSection,
  type TransclusionRef,
} from '../../domain/sectionTransclusion';
import { AppStateContext } from '../../app/AppState';

type GetNode = (id: string) => KnowledgeNode | undefined;
interface PathItem { nodeId: string; sectionId: string }

const sourceParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function container(props: Record<string, string>, children: RootContent[]): RootContent {
  return {
    type: 'blockquote',
    data: { hName: 'div', hProperties: props },
    children,
  } as unknown as RootContent;
}

function paragraph(text: string): RootContent {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] } as unknown as RootContent;
}

function walk(children: RootContent[], path: PathItem[], getNode: GetNode): RootContent[] {
  const out: RootContent[] = [];
  for (const child of children) {
    const ref = child.type === 'html' ? parseTransclusionDirective((child as { value: string }).value) : null;
    if (!ref) {
      out.push(child);
      continue;
    }
    out.push(build(ref, getNode, path));
  }
  return out;
}

function build(ref: TransclusionRef, getNode: GetNode, path: PathItem[]): RootContent {
  const status = path.some((p) => p.nodeId === ref.sourceNodeId && p.sectionId === ref.sourceSectionId)
    ? 'cycle'
    : null;
  const base: Record<string, string> = {
    'data-transclusion-projection': 'true',
    'data-transclude-node': ref.sourceNodeId,
    'data-transclude-section': ref.sourceSectionId,
  };
  if (status === 'cycle') {
    base['data-transclude-status'] = 'cycle';
    return container({ ...base, className: 'transclusion is-broken' }, [paragraph('Circular section reference.')]);
  }
  const resolved = resolveSection(ref, getNode, path);
  if (resolved.status === 'missing-node') {
    base['data-transclude-status'] = 'missing-node';
    return container({ ...base, className: 'transclusion is-broken' }, [paragraph('Missing source note.')]);
  }
  if (resolved.status === 'missing-section') {
    base['data-transclude-status'] = 'missing-section';
    return container({ ...base, className: 'transclusion is-broken' }, [paragraph('Section not found in source note.')]);
  }
  if (resolved.status === 'cycle') {
    base['data-transclude-status'] = 'cycle';
    return container({ ...base, className: 'transclusion is-broken' }, [paragraph('Circular section reference.')]);
  }
  base['data-transclude-title'] = resolved.nodeTitle;
  base['data-transclude-label'] = resolved.label;
  base['data-transclude-status'] = 'ok';
  const sourceTree = sourceParser.parse(resolved.markdown) as Root;
  const nextPath = [...path, { nodeId: ref.sourceNodeId, sectionId: ref.sourceSectionId }];
  return container({ ...base, className: 'transclusion' }, walk(sourceTree.children, nextPath, getNode));
}

/** remark plugin: resolve transclusion directives into live source content. */
export function remarkTransclude({ getNode }: { getNode: GetNode }) {
  return (tree: Node) => {
    const root = tree as Root;
    root.children = walk(root.children, [], getNode);
  };
}

/**
 * React wrapper rendered for a transclusion container. Shows a small provenance
 * control that jumps to the canonical source Section, plus unresolved notices.
 */
export function TransclusionFrame({ nodeId, sectionId, title, label, status, children }: {
  nodeId: string; sectionId: string; title?: string; label?: string; status?: string; children?: React.ReactNode;
}) {
  const app = useContext(AppStateContext);
  const openSource = useCallback(() => app?.openNodeSection(nodeId, sectionId), [app, nodeId, sectionId]);
  if (status && status !== 'ok') {
    return <div className="transclusion is-broken">
      <button type="button" className="transclusion-source" onClick={openSource}
        title="Open source note">
        {status === 'cycle' ? 'Circular section reference' : status === 'missing-node' ? 'Missing source note' : 'Missing section in source note'}
      </button>
    </div>;
  }
  return <div className="transclusion" data-transclusion-projection="true">
    <button type="button" className="transclusion-source" onClick={openSource} title="Open source section">
      From {title || 'Untitled note'} · {label || 'Section'}
    </button>
    <div className="transclusion-body">{children}</div>
  </div>;
}
