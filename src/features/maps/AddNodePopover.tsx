import { useState, useMemo, useCallback } from 'react';
import type { KnowledgeNode, ID } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { nodeExistsInMap } from '../../repositories/mapRepository';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';

interface AddNodePopoverProps {
  mapId: ID;
  x: number;
  y: number;
  onAdd: (node: KnowledgeNode, sectionId?: string | null) => void;
  onClose: () => void;
}

export function AddNodePopover({ mapId, x, y, onAdd, onClose }: AddNodePopoverProps) {
  const { nodes } = useApp();
  const [query, setQuery] = useState('');
  const [existingMap, setExistingMap] = useState<Map<ID, boolean>>(new Map());

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return nodes.slice(0, 20);
    return nodes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 20);
  }, [nodes, query]);

  const checkExists = useCallback(
    async (nodeId: ID) => {
      if (existingMap.has(nodeId)) return;
      const exists = await nodeExistsInMap(mapId, nodeId);
      setExistingMap((prev) => {
        const next = new Map(prev);
        next.set(nodeId, exists);
        return next;
      });
    },
    [mapId, existingMap]
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 100,
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--space-2)',
        width: 320,
        maxHeight: 380,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        aria-label="Search notes or sections"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        style={{ fontSize: 'var(--font-sm)', marginBottom: 'var(--space-2)', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}
      />
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: 'var(--space-3)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-xs)',
            }}
          >
            No notes found
          </div>
        )}
        {filtered.map((node) => {
          const exists = existingMap.get(node.id);
          const panels = splitNotePanels(node.contentMarkdown);
          return (
            <div
              key={node.id}
              onMouseEnter={() => checkExists(node.id)}
              style={{
                marginBottom: '6px',
                borderBottom: '1px solid var(--border-subtle, #eee)',
                paddingBottom: '4px',
              }}
            >
              <div
                className="add-node-whole-note-option"
                onClick={() => onAdd(node, null)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
                title="Add entire note"
              >
                <div>
                  <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>
                    📄 {node.title}
                  </div>
                  {exists && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Already in this map
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                  Whole note →
                </span>
              </div>

              {panels.length > 0 && (
                <div style={{ marginLeft: '12px', borderLeft: '2px solid var(--border)', paddingLeft: '8px' }}>
                  {panels.map((panel, idx) => {
                    const sName = sectionLabel(panel.markdown, idx);
                    const snippet = panel.markdown.replace(/^#+\s+[^\n]+\n*/, '').slice(0, 45).trim();
                    return (
                      <div
                        key={panel.id}
                        className="add-node-section-option"
                        onClick={() => onAdd(node, panel.id)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          margin: '2px 0',
                        }}
                        onMouseOver={(e) => {
                          (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
                        }}
                        onMouseOut={(e) => {
                          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        }}
                        title={`Add section "${sName}" only`}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: '6px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text)' }}>
                            § {sName}
                          </div>
                          {snippet && (
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {snippet}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                          Section →
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
