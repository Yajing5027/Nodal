// ============================================================
// RelationEdge — custom React Flow edge for a KnowledgeRelation
// direction=none → no arrows; forward → arrow at target;
// bidirectional → arrows both ends. Thin line, selected darker/thicker.
// Label shown in small white pill.
// Markers are defined globally in MapWorkspace (rel-arrow-normal/selected).
// ============================================================
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData } from '../../domain/types';

// FlowEdgeData is an interface without an index signature;
// @xyflow/react v12 requires data to extend Record<string, unknown>.
type EdgeData = FlowEdgeData & Record<string, unknown>;
type RelationEdgeType = Edge<EdgeData, 'relation'>;

export function RelationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationEdgeType>) {
  const strokeColor = selected ? '#8a8a87' : '#d4d4d2';
  const strokeWidth = selected ? 2.5 : 1.5;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const direction = data?.direction ?? 'none';
  const colorSuffix = selected ? 'selected' : 'normal';
  const markerEnd =
    direction === 'forward' || direction === 'bidirectional'
      ? `url(#rel-arrow-${colorSuffix})`
      : undefined;
  const markerStart =
    direction === 'bidirectional' ? `url(#rel-arrow-${colorSuffix})` : undefined;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ stroke: strokeColor, strokeWidth }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 6px',
              fontSize: 'var(--font-xs)',
              color: 'var(--text-secondary)',
              pointerEvents: 'all',
              whiteSpace: 'nowrap',
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
