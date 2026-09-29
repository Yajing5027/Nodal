// ============================================================
// KnowledgeNodeCard — custom React Flow node for a MapOccurrence
// Shows ONLY: title (bold), up to 2 tags, one-line summary (60 chars).
// Compact card ~200x80px. Never renders markdown content.
// ============================================================
import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { FlowNodeData } from '../../domain/types';

// FlowNodeData is an interface without an index signature;
// @xyflow/react v12 requires data to extend Record<string, unknown>.
type CardData = FlowNodeData & Record<string, unknown>;
type KnowledgeNodeType = Node<CardData, 'knowledgeNode'>;

const handleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
};

function KnowledgeNodeCardComponent({ data, selected }: NodeProps<KnowledgeNodeType>) {
  const { title, tags, summary } = data;
  const sectionTitle = (data as any).sectionTitle as string | undefined;
  const isBrokenSection = (data as any).isBrokenSection as boolean | undefined;
  const displayTags = tags.slice(0, 2);
  const displaySummary = summary.length > 60 ? summary.slice(0, 60) + '…' : summary;

  return (
    <div
      style={{
        width: 220,
        minHeight: 80,
        background: 'var(--surface)',
        border: `1px solid ${selected ? 'var(--selection-border)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2) var(--space-3)',
        boxShadow: selected ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ ...handleStyle, top: -4 }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ ...handleStyle, right: -4 }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ ...handleStyle, bottom: -4 }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        style={{ ...handleStyle, left: -4 }}
        isConnectableStart
        isConnectableEnd
      />
      <div
        style={{
          fontWeight: 600,
          fontSize: 'var(--font-sm)',
          color: 'var(--text)',
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {sectionTitle ? (
          <span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{title} &gt; </span>
            {sectionTitle}
          </span>
        ) : (
          title
        )}
      </div>
      {isBrokenSection && (
        <span style={{ fontSize: '10px', color: '#c5221f', background: 'rgba(197, 34, 31, 0.1)', padding: '1px 4px', borderRadius: '3px', alignSelf: 'flex-start' }}>
          Broken section link
        </span>
      )}
      {displayTags.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {displayTags.map((tag, i) => (
            <span key={i} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      {displaySummary && (
        <div
          style={{
            fontSize: 'var(--font-xs)',
            color: 'var(--text-muted)',
            lineHeight: 1.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displaySummary}
        </div>
      )}
    </div>
  );
}

export const KnowledgeNodeCard = memo(KnowledgeNodeCardComponent);
