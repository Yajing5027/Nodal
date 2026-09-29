// ============================================================
// Outline Tab — current map outline (frames → occurrences)
// Uses getMapOutline from features/maps/mapOutline.ts.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../app/useApp';
import { getMapOutline } from '../maps/mapOutline';
import type { ID } from '../../domain/types';

interface OutlineItem {
  occurrenceId: ID;
  nodeId: ID;
  nodeTitle: string;
}

interface OutlineFrame {
  frameId: ID;
  frameTitle: string;
  items: OutlineItem[];
}

interface OutlineData {
  frames: OutlineFrame[];
  unassigned: OutlineItem[];
}

export function OutlineTab() {
  const { currentMapId, mapContentVersion, nodes, setSelectedNodeId, setSelectedOccurrenceId } = useApp();
  const [outline, setOutline] = useState<OutlineData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadOutline = useCallback(async (mapId: ID) => {
    setLoading(true);
    try {
      const result = await getMapOutline(mapId);
      const frames: OutlineFrame[] = result.frames.map((f) => ({
        frameId: f.frame.id,
        frameTitle: f.frame.title,
        items: f.occurrences.map((o) => ({
          occurrenceId: o.occurrence.id,
          nodeId: o.occurrence.nodeId,
          nodeTitle: o.nodeTitle,
        })),
      }));
      const unassigned: OutlineItem[] = result.unassigned.map((o) => ({
        occurrenceId: o.occurrence.id,
        nodeId: o.occurrence.nodeId,
        nodeTitle: o.nodeTitle,
      }));
      setOutline({ frames, unassigned });
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh when currentMapId changes
  useEffect(() => {
    if (!currentMapId) {
      setOutline(null);
      return;
    }
    loadOutline(currentMapId);
  }, [currentMapId, mapContentVersion, nodes, loadOutline]);

  if (!currentMapId) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span>Select a map to see its outline.</span>
      </div>
    );
  }

  const renderItem = (item: OutlineItem) => (
    <div
      key={item.occurrenceId}
      style={{
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontSize: 'var(--font-sm)',
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginBottom: 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      onClick={() => {
        setSelectedOccurrenceId(item.occurrenceId);
        setSelectedNodeId(item.nodeId);
      }}
    >
      {item.nodeTitle}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>
        {loading && (
          <div style={{ padding: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>
            Loading outline…
          </div>
        )}

        {!loading && outline && outline.frames.length === 0 && outline.unassigned.length === 0 && (
          <div className="empty-state">
            <span>This map has no nodes yet.</span>
          </div>
        )}

        {/* Frames with nested occurrences */}
        {outline?.frames.map((frame) => (
          <div key={frame.frameId} style={{ marginBottom: 'var(--space-3)' }}>
            <div
              style={{
                fontSize: 'var(--font-xs)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                padding: 'var(--space-2)',
                borderBottom: '1px solid var(--border)',
                marginBottom: 2,
              }}
            >
              {frame.frameTitle}
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 'var(--space-2)' }}>
                ({frame.items.length})
              </span>
            </div>
            {frame.items.map(renderItem)}
            {frame.items.length === 0 && (
              <div style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>
                Empty
              </div>
            )}
          </div>
        ))}

        {/* Unassigned occurrences */}
        {outline && outline.unassigned.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div
              style={{
                fontSize: 'var(--font-xs)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                padding: 'var(--space-2)',
                borderBottom: '1px solid var(--border)',
                marginBottom: 2,
              }}
            >
              Unassigned
              <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 'var(--space-2)' }}>
                ({outline.unassigned.length})
              </span>
            </div>
            {outline.unassigned.map(renderItem)}
          </div>
        )}
      </div>
    </div>
  );
}
