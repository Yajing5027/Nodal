// ============================================================
// SectionMasteryControl — Read-only section mastery badge
// ============================================================
// Displays mastery score calculated from real flashcard ReviewEvents.
// No manual rating buttons; actual ratings occur in Practice/Review.
// ============================================================

import { useState, useEffect } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db/database';
import { computeNodeMastery, buildLatestReviewEventsMap, type NodeMasteryScore } from '../../domain/nodeScoring';

interface SectionMasteryControlProps {
  nodeId: string;
  sectionId: string;
}

export function SectionMasteryControl({ nodeId, sectionId }: SectionMasteryControlProps) {
  const [mastery, setMastery] = useState<NodeMasteryScore | null>(null);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [targets, events] = await Promise.all([
        db.retrievalTargets.toArray(),
        db.reviewEvents.toArray(),
      ]);
      const eventsMap = buildLatestReviewEventsMap(events);
      return computeNodeMastery(nodeId, sectionId, targets, eventsMap);
    }).subscribe({
      next: res => setMastery(res),
      error: err => console.error('Error computing section mastery', err),
    });
    return () => sub.unsubscribe();
  }, [nodeId, sectionId]);

  if (!mastery || mastery.totalCards === 0) {
    return (
      <span
        style={{
          fontSize: '11px',
          padding: '2px 8px',
          borderRadius: '12px',
          color: 'var(--text-muted)',
          border: '1px solid var(--border)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
        title="No flashcards linked to this section"
      >
        <span>○</span>
        <span>No cards</span>
      </span>
    );
  }

  const getBadgeStyle = () => {
    if (mastery.score === 100) {
      return { background: 'rgba(34, 197, 94, 0.12)', color: '#16a34a', border: '1px solid rgba(34, 197, 94, 0.3)' };
    }
    if (mastery.score !== null && mastery.score >= 50) {
      return { background: 'rgba(245, 158, 11, 0.12)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.3)' };
    }
    if (mastery.score !== null && mastery.score < 50) {
      return { background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626', border: '1px solid rgba(239, 68, 68, 0.3)' };
    }
    return { background: 'var(--surface-secondary, rgba(0,0,0,0.04))', color: 'var(--text-muted)', border: '1px solid var(--border)' };
  };

  const displayText = mastery.score !== null
    ? `${mastery.score}%`
    : (mastery.totalCards > 0 ? 'Unrated' : 'No cards');

  return (
    <span
      style={{
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontWeight: mastery.score !== null ? 600 : 400,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        ...getBadgeStyle(),
      }}
      title={`Section mastery: ${mastery.label} (${mastery.summary})`}
    >
      <span>●</span>
      <span>{displayText}</span>
    </span>
  );
}
