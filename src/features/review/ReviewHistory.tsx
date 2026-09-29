import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { ReviewEvent } from '../../domain/types';
import { getReviewHistory } from '../../repositories/reviewRepository';
const LABELS = { missed: 'Forgot', partial: 'Partial', recalled: 'Recalled', effortful: 'Recalled · effortful (legacy)', clear: 'Recalled · clear (legacy)' };
export function ReviewHistory({ targetId }: { targetId: string }) {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const subscription = liveQuery(() => getReviewHistory(targetId)).subscribe({ next: setEvents, error: () => setError('Could not load history. Please reopen.') });
    return () => subscription.unsubscribe();
  }, [targetId]);
  return <details className="review-history"><summary>History · {events.length}</summary><div className="review-history-content">
    {error && <p role="alert">{error}</p>}
    {!events.length && <p>No ratings yet.</p>}
    <ol>{events.map(event => <li key={event.id}><div><strong>{LABELS[event.rawResult]}</strong><time>{new Date(event.reviewedAt).toLocaleString('en-US')}</time></div>
      <small>Recall time: {(event.responseTimeMs / 1000).toFixed(1)}s · Next: {new Date(event.resultingState.dueAt).toLocaleString('en-US')}</small>
      <small>Reveal: {event.answerRevealed === undefined ? 'unknown (legacy)' : event.answerRevealed ? 'yes' : 'no'} · Hint: {event.hintUsed === undefined ? 'unknown (legacy)' : event.hintUsed ? 'yes' : 'no'}</small>
      {event.schedulingDecision && <small>Schedule: {event.schedulingDecision.reason} · FSRS due: {new Date(event.schedulingDecision.fsrsDueAt).toLocaleString('en-US')}</small>}
      {!!event.interruptionCount && <small>Window was left during recall; timing is not a reliable memory signal.</small>}
      {!event.protocolVersion && <small>Legacy record: no pre-reveal rating or prompt snapshot.</small>}
      {event.initialResult && event.initialResult !== event.rawResult && <small>Before reveal: {LABELS[event.initialResult]} → corrected after reveal</small>}
      <small>Estimated stability: {event.resultingState.stabilityDays.toFixed(2)} days · Estimated difficulty: {event.resultingState.difficulty.toFixed(1)} / 10</small>
    </li>)}</ol>
  </div></details>;
}
