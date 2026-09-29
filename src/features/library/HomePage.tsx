import { recallPrompt } from '../review/recallAnchors';
import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { useApp } from '../../app/useApp';
import { createNode } from '../../repositories/nodeRepository';
import {
  getLearningOverview,
  getReviewQueue,
  formatPlanProvenance,
  type ReviewQueueItem,
} from '../../repositories/reviewRepository';
import { relativeTime } from '../navigator/utils';
import { cardExcerpt } from '../cards/cardExcerpt';
export function HomePage() {
  const { nodes, getNode, openNode, setActiveView, setLibraryTagId, startReview, refreshAll } = useApp();
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getLearningOverview>> | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const recentNodes = useMemo(() => [...nodes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [nodes]);

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [nextOverview, nextQueue] = await Promise.all([
        getLearningOverview(),
        getReviewQueue(),
      ]);
      return { nextOverview, nextQueue };
    }).subscribe({
      next: ({ nextOverview, nextQueue }) => {
        setOverview(nextOverview);
        setQueue(nextQueue);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleNewNote = async () => {
    const node = await createNode({ title: 'Untitled note' });
    await refreshAll();
    openNode(node.id);
  };

  const todayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date());

  return (
    <main className="today-page">
      <section className="today-hero">
        <p className="today-date">{todayLabel}</p>
        <div className="today-title-row">
          <div>
            <h1>Today</h1>
          </div>
          <button className="quiet-capture" onClick={handleNewNote}><span>＋</span> New note</button>
        </div>
      </section>

      <section className={`review-invitation${(overview?.due ?? 0) > 0 ? ' has-work' : ''}`}>
        <div className="review-invitation-copy">
          <p className="eyebrow">TODAY’S REVIEW</p>
          <h2>{queue.length ? `${queue.length} cards ready` : (overview?.due ?? 0) > 0 ? 'Your daily session limit is reached' : overview?.total ? 'You are up to date' : 'Start with one recall prompt'}</h2>
          <p>
            {(overview?.due ?? 0) > 0
              ? `${overview?.reviewedToday ?? 0} completed today`
              : overview?.nextDueAt
                ? `Next review: ${new Date(overview.nextDueAt).toLocaleString('en-US')}`
                : 'Select a passage in a note or add a question to begin.'}
          </p>
        </div>
        <button className="start-review" onClick={() => queue.length ? startReview() : setActiveView('cards')}>
          {queue.length ? 'Review' : 'Recall prompts'}
        </button>
      </section>

      {queue.length > 0 && (
        <section className="due-preview">
          <div className="today-section-heading"><h2>Ready to revisit</h2><button className="ghost" onClick={() => setActiveView('cards')}>View all prompts →</button></div>
          <div className="memory-strip-list">
            {queue.slice(0, 4).map((item) => (
              <button className="memory-strip" key={item.target.id} onClick={() => startReview(undefined, { focusTargetId: item.target.id })}>
                <span className={`memory-dot is-${item.state.learningState}`} />
                <div><strong>{recallPrompt(item.target)}</strong><small>{item.sourceTitle}</small><div className="today-plan-provenance">{formatPlanProvenance(item.plan, item.executionState)}</div></div>
                <span>Review →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="today-lower-grid">
        <div>
          <div className="today-section-heading"><h2>Recent notes</h2><button className="ghost" onClick={() => { setLibraryTagId(null); setActiveView('nodes'); }}>View all →</button></div>
          <div className="recent-note-list">
            {recentNodes.map((node) => (
              <button key={node.id} onClick={() => openNode(node.id)}>
                <span><strong>{node.title || 'Untitled note'}</strong><small>{cardExcerpt(node, getNode)}</small></span>
                <time>{relativeTime(node.updatedAt)}</time>
              </button>
            ))}
            {recentNodes.length === 0 && (
              <button className="primary" onClick={handleNewNote} style={{ alignSelf: 'flex-start', padding: '8px 16px', fontSize: '13px' }}>
                Create your first note →
              </button>
            )}
          </div>
        </div>


      </section>
    </main>
  );
}
