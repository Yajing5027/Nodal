import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { AIGuidance } from './AIGuidance';
import { NoteExport } from '../export/NoteExport';
import { useApp } from '../../app/useApp';
import { resolveAssetUrl } from './assetResolver';
import { remarkNotePanels } from '../../domain/notePanels';
import { remarkRecallMarks } from '../cards/recallMarks';
import { remarkTransclude, TransclusionFrame } from './transclusion';
import { remarkNodalColumns } from '../../domain/columnLayout';
import type { RecallAnchor, KnowledgeNode } from '../../domain/types';
import { recallBlocks, type RecallBlock } from '../review/recallAnchors';

function ReadingImage({ src, alt }: { src?: string; alt?: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!src) {
      setFailed(true);
      return;
    }
    if (!src.startsWith('asset://')) {
      setResolved(src);
      return;
    }
    void resolveAssetUrl(src)
      .then(url => {
        if (cancelled) return;
        if (!url || url === src) {
          setFailed(true);
        } else {
          setResolved(url);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [src]);

  if (failed || (!resolved && !src)) {
    return (
      <span
        className="nodal-image-placeholder nodal-image-missing"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          margin: '4px 0',
          border: '1px dashed var(--border, #ccc)',
          borderRadius: '4px',
          background: 'var(--surface-secondary, #f8f9fa)',
          color: 'var(--text-faint, #888)',
          fontSize: '0.85em',
        }}
      >
        <span aria-hidden="true">🖼️</span>
        <span>Image unavailable {alt ? `(${alt})` : ''}</span>
      </span>
    );
  }

  return (
    <img
      src={resolved ?? ''}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
    />
  );
}

function PanelGuidance({ nodeId, id, onBack }: {nodeId:string; id:string; onBack:()=>void}) {
  return <div className="section-back"><header><strong>Guidance</strong><button type="button" onClick={onBack}>Back to content ↩</button></header><AIGuidance nodeId={nodeId} sectionId={id} /></div>;
}
function PanelExport({nodeId, id}: {nodeId:string;id:string}) { const {getNode}=useApp(); const node=getNode(nodeId); return node ? <NoteExport node={node} sectionId={id} /> : null; }
function PanelSectionTags({ nodeId, id }: { nodeId: string; id: string }) {
  const { getNode, tags } = useApp();
  const node = getNode(nodeId);
  const sectionSpecificTagIds = node?.sectionTagIds?.[id] || [];
  if (sectionSpecificTagIds.length === 0) return null;
  return (
    <div className="section-specific-tags" style={{ display: 'flex', alignItems: 'center', gap: '4px', marginRight: 'auto' }}>
      {sectionSpecificTagIds.map(tid => {
        const t = tags.find(x => x.id === tid);
        return t ? (
          <span
            key={t.id}
            className="section-tag-badge"
            title="Tag for this section"
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'var(--accent-subtle, rgba(59, 130, 246, 0.12))',
              color: 'var(--accent, #2563eb)',
              border: '1px solid var(--accent, #3b82f6)',
              fontWeight: 500,
            }}
          >
            #{t.name}
          </span>
        ) : null;
      })}
    </div>
  );
}

function ReadingPanel({ guidanceNodeId, id, hidden, revealed, overrides, onChange, children }: { guidanceNodeId?: string; id: string; hidden: boolean; revealed: boolean; overrides: Record<string, boolean>; onChange?: (id: string, visible: boolean) => void; children: ReactNode }) {
  const [local, setLocal] = useState<boolean | undefined>(undefined);
  const [back, setBack] = useState(false);
  const key = 'panel:' + id;
  const visible = overrides[key] ?? (onChange ? undefined : local) ?? (revealed || !hidden);
  const toggle = (value: boolean) => { setLocal(value); onChange?.(key, value); };
  return <section className="note-reading-panel" data-note-panel-id={id}>
    {guidanceNodeId && <div className="section-reading-tools" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <PanelSectionTags nodeId={guidanceNodeId} id={id} />
      <button type="button" aria-pressed={back} onClick={() => setBack(value => !value)}>{back ? 'Content ↩' : 'Guidance ↻'}</button>
      <PanelExport nodeId={guidanceNodeId} id={id} />
    </div>}
    {guidanceNodeId && back ? <PanelGuidance nodeId={guidanceNodeId} id={id} onBack={() => setBack(false)} /> : <>
    {hidden && !guidanceNodeId && <button type="button" className={visible ? 'panel-hide-button' : 'panel-reveal-button'} aria-label={visible ? 'Hide content section' : 'Reveal content section'} onClick={() => toggle(!visible)}>{visible ? 'Hide section' : 'Hidden section · Reveal'}</button>}
    {(guidanceNodeId || visible) && children}</>}
  </section>;
}

export interface WordSelectionState {
  blockStart: number | null;
  selections: Array<{ text: string; start: number; end: number }>;
  byBlock?: Record<number, Array<{ text: string; start: number; end: number }>>;
  onToggle: (block: RecallBlock, selection: { text: string; start: number; end: number }) => void;
}

function SelectableText({ block, state }: { block: RecallBlock; state: WordSelectionState }) {
  const segments = useMemo(() => {
    if (typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(block.text)].map(segment => ({
        text: segment.segment, start: segment.index, end: segment.index + segment.segment.length, selectable: segment.isWordLike,
      }));
    }
    return [...block.text.matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu)].map(match => ({
      text: match[0], start: match.index, end: match.index + match[0].length, selectable: /[\p{L}\p{N}]/u.test(match[0]),
    }));
  }, [block]);
  return <span className="word-selection-line">{segments.map((segment, index) => {
    if (!segment.selectable) return <span key={index}>{segment.text}</span>;
    const selected = (state.byBlock?.[block.start] ?? (state.blockStart === block.start ? state.selections : [])).some(item => item.start === segment.start && item.end === segment.end);
    return <button type="button" aria-pressed={selected} key={index} onClick={() => state.onToggle(block, { text: segment.text, start: segment.start, end: segment.end })}>{segment.text}</button>;
  })}</span>;
}

export function MarkdownReading({ guidanceNodeId, children, maskAnchor, maskAnchors, revealed = false, wordSelection, revealOverrides = {}, onRevealChange, preview = false, interactivePanels = false, transcludeGetNode }: {
  guidanceNodeId?: string; children: string; maskAnchor?: RecallAnchor; maskAnchors?: RecallAnchor[]; revealed?: boolean; wordSelection?: WordSelectionState; revealOverrides?: Record<string, boolean>; onRevealChange?: (id: string, visible: boolean) => void; preview?: boolean; interactivePanels?: boolean; transcludeGetNode?: (id: string) => KnowledgeNode | undefined;
}) {
  const blockByStart = useMemo(() => {
    if (!wordSelection) return null;
    return new Map(recallBlocks(children).map(block => [block.start, block]));
  }, [children, wordSelection]);
  const blockContent = (start: number | undefined, content: ReactNode) => {
    if (!wordSelection || start === undefined || !blockByStart) return content;
    const block = blockByStart.get(start);
    if (block && block.kind !== 'heading') return <SelectableText block={block} state={wordSelection} />;
    return content;
  };
  const remarkPlugins = useMemo(() => {
    const plugins: any[] = [remarkGfm, remarkMath, remarkNodalColumns];
    if (transcludeGetNode) plugins.push([remarkTransclude, { getNode: transcludeGetNode }]);
    plugins.push([remarkRecallMarks, { anchors: maskAnchors ?? (maskAnchor ? [maskAnchor] : []) }], remarkNotePanels);
    return plugins;
  }, [maskAnchor, maskAnchors, transcludeGetNode]);
  const body = <div className={`reading-prose${wordSelection ? ' is-word-selecting' : ''}`}><Markdown remarkPlugins={remarkPlugins} rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false }]]}
    urlTransform={(url, key) => key === 'src' && url.startsWith('asset://') ? url : defaultUrlTransform(url)}
    components={{ section: ({node, children: content}) => {
      const panelId = node?.properties?.['data-note-panel'] as string | undefined;
      const parentId = node?.properties?.['data-panel-parent'] as string | undefined;
      if (panelId) {
        const panelElement = <ReadingPanel key={panelId} guidanceNodeId={guidanceNodeId} id={panelId} hidden={interactivePanels && node?.properties?.['data-panel-hidden'] === 'true'} revealed={revealed} overrides={revealOverrides} onChange={onRevealChange}>{content}</ReadingPanel>;
        if (parentId) {
          return (
            <div
              className="note-reading-subsection"
              style={{
                marginLeft: '24px',
                paddingLeft: '14px',
                borderLeft: '2px solid var(--border-light, #e0e0e0)',
                marginTop: '8px',
                marginBottom: '8px',
              }}
            >
              {panelElement}
            </div>
          );
        }
        return panelElement;
      }
      const id = node?.properties?.['data-recall-block'] as string | undefined;
      if (!id) return <section>{content}</section>;
      const visible = preview || (revealOverrides[id] ?? revealed);
      return <section className="recall-block-mark" data-blank-id={id}>{visible ? <>{!preview && onRevealChange && <button className="block-hide-control" onClick={() => onRevealChange(id, false)}>Hide block</button>}{content}</> : <button className="whole-block-blank" aria-label="Reveal hidden block" onClick={() => onRevealChange?.(id, true)}>Reveal {String(node?.properties?.['data-block-kind'] ?? 'block')}</button>}</section>;
    }, div: ({node, children: content}) => {
      if (node?.properties?.['data-transclusion-projection']) {
        return <TransclusionFrame
          nodeId={String(node.properties['data-transclude-node'] ?? '')}
          sectionId={String(node.properties['data-transclude-section'] ?? '')}
          title={node.properties['data-transclude-title'] as string | undefined}
          label={node.properties['data-transclude-label'] as string | undefined}
          status={node.properties['data-transclude-status'] as string | undefined}>{content}</TransclusionFrame>;
      }
      const rawClass = node?.properties?.className;
      const className = Array.isArray(rawClass) ? rawClass.join(' ') : (rawClass as string | undefined);
      return <div className={className}>{content}</div>;
    }, span: ({node, children: content, ...props}) => {
      const id = node?.properties?.['data-recall-id'] as string | undefined;
      if (!id) return <span {...props}>{content}</span>;
      const number = node?.properties?.['data-recall-number'];
      const first = node?.properties?.['data-recall-first'] === true || node?.properties?.['data-recall-first'] === 'true';
      const visible = preview || (revealOverrides[id] ?? revealed);
      if (preview) return <mark className="recall-mark" data-blank-id={id}>{content}</mark>;
      if (!visible && !first) return null;
      return onRevealChange ? <button type="button" className={visible ? 'recall-token is-revealed' : 'recall-token'} data-blank-id={id} aria-label={`${visible ? 'Hide' : 'Reveal'} blank ${number}`} aria-pressed={visible} onClick={event => { event.preventDefault(); event.stopPropagation(); onRevealChange(id, !visible); }}>{visible ? content : ` ${number} `}</button>
        : visible ? <mark>{content}</mark> : <span className="recall-blank" aria-label="Hidden answer">［ {number} ］</span>;
    }, img: ({ src, alt }) => <ReadingImage src={src} alt={alt} />,
      table: ({ children: content }) => <div className="reading-table-scroll"><table>{content}</table></div>,
      p: ({node, children: content}) => <p data-recall-start={node?.position?.start.offset}>{blockContent(node?.position?.start.offset, content)}</p>,
      li: ({node, children: content}) => <li data-recall-start={node?.position?.start.offset}>{blockContent(node?.position?.start.offset, content)}</li>,
      h1: ({node, children: content}) => <h1 data-recall-start={node?.position?.start.offset}>{content}</h1>,
      h2: ({node, children: content}) => <h2 data-recall-start={node?.position?.start.offset}>{content}</h2>,
      h3: ({node, children: content}) => <h3 data-recall-start={node?.position?.start.offset}>{content}</h3>,
      td: ({node, children: content}) => <td data-recall-start={node?.position?.start.offset}>{blockContent(node?.position?.start.offset, content)}</td>,
      a: ({ href, children: content }) => <a href={href} target="_blank" rel="noreferrer">{content}</a> }}
  >{children}</Markdown></div>;
  return guidanceNodeId && !children.includes('<!-- nodal-panel:') ? <ReadingPanel guidanceNodeId={guidanceNodeId} id="main" hidden={false} revealed={true} overrides={{}}>{body}</ReadingPanel> : body;
}
