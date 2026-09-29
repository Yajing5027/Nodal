// ============================================================
// RelationList — display all relations involving the selected node.
// Each row shows source -- label --> target with direction and scope.
// Click navigates to the other node; delete removes the relation.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import type { KnowledgeRelation, KnowledgeNode, ID } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { getRelationsForNode, deleteRelation } from '../../repositories/relationRepository';
import { ConfirmDialog } from '../../components/ui';

interface RelationListProps {
  nodeId: ID;
}

interface EnrichedRelation {
  relation: KnowledgeRelation;
  otherNode: KnowledgeNode | undefined;
  isOutgoing: boolean; // true if this node is the source
}

export function RelationList({ nodeId }: RelationListProps) {
  const { getNode, setSelectedNodeId, refreshAll } = useApp();
  const [relations, setRelations] = useState<EnrichedRelation[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<ID | null>(null);

  const fetchRelations = useCallback(async () => {
    const list = await getRelationsForNode(nodeId);
    const enriched: EnrichedRelation[] = list.map((rel) => {
      const isOutgoing = rel.sourceNodeId === nodeId;
      const otherId = isOutgoing ? rel.targetNodeId : rel.sourceNodeId;
      return {
        relation: rel,
        otherNode: getNode(otherId),
        isOutgoing,
      };
    });
    setRelations(enriched);
  }, [nodeId, getNode]);

  useEffect(() => {
    fetchRelations();
  }, [fetchRelations]);

  const handleDelete = useCallback(
    async (relationId: ID) => {
      await deleteRelation(relationId);
      setConfirmDeleteId(null);
      refreshAll();
      // Re-fetch local list immediately
      const list = await getRelationsForNode(nodeId);
      const enriched: EnrichedRelation[] = list.map((rel) => {
        const isOutgoing = rel.sourceNodeId === nodeId;
        const otherId = isOutgoing ? rel.targetNodeId : rel.sourceNodeId;
        return { relation: rel, otherNode: getNode(otherId), isOutgoing };
      });
      setRelations(enriched);
    },
    [nodeId, getNode, refreshAll]
  );

  const handleNavigate = useCallback(
    (otherId: ID) => {
      setSelectedNodeId(otherId);
    },
    [setSelectedNodeId]
  );

  const directionArrow = (rel: KnowledgeRelation, isOutgoing: boolean): string => {
    if (rel.direction === 'bidirectional') return '↔';
    if (rel.direction === 'none') return '—';
    return isOutgoing ? '→' : '←';
  };

  if (relations.length === 0) {
    return (
      <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>
        No relations
      </span>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {relations.map(({ relation, otherNode, isOutgoing }) => {
          const arrow = directionArrow(relation, isOutgoing);
          const sourceTitle = isOutgoing ? 'This node' : (otherNode?.title ?? 'Unknown');
          const targetTitle = isOutgoing ? (otherNode?.title ?? 'Unknown') : 'This node';
          return (
            <div
              key={relation.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-secondary)',
                fontSize: 'var(--font-xs)',
              }}
            >
              {/* Source */}
              <span
                onClick={() => !isOutgoing && otherNode && handleNavigate(otherNode.id)}
                style={{
                  color: isOutgoing ? 'var(--text-muted)' : 'var(--text)',
                  cursor: !isOutgoing && otherNode ? 'pointer' : 'default',
                  fontWeight: isOutgoing ? 400 : 600,
                  maxWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={sourceTitle}
              >
                {sourceTitle}
              </span>

              {/* Arrow + label */}
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{arrow}</span>
              <span
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 'var(--font-xs)',
                  color: 'var(--text-secondary)',
                  fontStyle: 'italic',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={relation.label || '(no label)'}
              >
                {relation.label || '—'}
              </span>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{arrow}</span>

              {/* Target */}
              <span
                onClick={() => isOutgoing && otherNode && handleNavigate(otherNode.id)}
                style={{
                  color: isOutgoing ? 'var(--text)' : 'var(--text-muted)',
                  cursor: isOutgoing && otherNode ? 'pointer' : 'default',
                  fontWeight: isOutgoing ? 600 : 400,
                  maxWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={targetTitle}
              >
                {targetTitle}
              </span>

              {/* Scope badge */}
              <span
                style={{
                  fontSize: '9px',
                  padding: '1px 4px',
                  borderRadius: 'var(--radius-sm)',
                  background: relation.scope === 'global' ? 'var(--accent-bg)' : 'var(--surface-tertiary)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}
              >
                {relation.scope}
              </span>

              {/* Delete */}
              <button
                className="ghost"
                onClick={() => setConfirmDeleteId(relation.id)}
                aria-label="Delete relation"
                style={{ padding: '2px 4px', fontSize: 'var(--font-xs)', color: 'var(--text-muted)', flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Relation"
        message="This will permanently remove the relation between these nodes. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}
