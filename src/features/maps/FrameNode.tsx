// ============================================================
// FrameNode — custom React Flow node for a KnowledgeFrame
// Larger rectangle with title at top, semi-transparent fill,
// dashed border. Title editable (double-click). Resizable.
// Delete button (unassigns occurrences first — handled by parent).
// ============================================================
import { useState, useRef, useEffect } from 'react';
import { NodeResizer, Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { ID } from '../../domain/types';

export interface FrameNodeData {
  frameId: ID;
  title: string;
  onTitleChange: (frameId: ID, title: string) => void;
  onDelete: (frameId: ID) => void;
  onResizeEnd: (frameId: ID, width: number, height: number) => void;
}

// FrameNodeData is an interface without an index signature;
// @xyflow/react v12 requires data to extend Record<string, unknown>.
type FrameData = FrameNodeData & Record<string, unknown>;
type FrameNodeType = Node<FrameData, 'frame'>;

export function FrameNode({ data, selected }: NodeProps<FrameNodeType>) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(data.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = () => {
    setEditing(false);
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== data.title) {
      data.onTitleChange(data.frameId, trimmed);
    } else {
      setEditTitle(data.title);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{
          width: 10,
          height: 10,
          background: 'var(--surface)',
          border: '2px solid var(--border-strong)',
          borderRadius: '50%',
          top: -5,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{
          width: 10,
          height: 10,
          background: 'var(--surface)',
          border: '2px solid var(--border-strong)',
          borderRadius: '50%',
          right: -5,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 10,
        }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{
          width: 10,
          height: 10,
          background: 'var(--surface)',
          border: '2px solid var(--border-strong)',
          borderRadius: '50%',
          bottom: -5,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        style={{
          width: 10,
          height: 10,
          background: 'var(--surface)',
          border: '2px solid var(--border-strong)',
          borderRadius: '50%',
          left: -5,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 10,
        }}
        isConnectableStart
        isConnectableEnd
      />
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={150}
        onResizeEnd={(_e, params) => {
          data.onResizeEnd(data.frameId, params.width, params.height);
        }}
      />
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--surface-secondary)',
          border: '2px dashed var(--border-strong)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px dashed var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 32,
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditTitle(data.title);
            setEditing(true);
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  setEditing(false);
                  setEditTitle(data.title);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 'var(--font-sm)',
                fontWeight: 600,
                padding: '2px 4px',
                height: 24,
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 'var(--font-sm)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                cursor: 'text',
                userSelect: 'none',
              }}
            >
              {data.title}
            </span>
          )}
          {selected && !editing && (
            <button
              className="ghost"
              onClick={(e) => {
                e.stopPropagation();
                data.onDelete(data.frameId);
              }}
              style={{ fontSize: 'var(--font-xs)', padding: '0 4px' }}
              title="Delete frame"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
