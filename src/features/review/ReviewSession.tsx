import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/useApp';
import { db } from '../../db/database';
import { newId } from '../../domain/id';
import type { ReviewEvent, ReviewResult } from '../../domain/types';
import { CardDocument } from '../cards/CardDocument';
import { CardSurface } from '../cards/CardSurface';
import { ReviewHistory } from './ReviewHistory';
import { needsRecallCue, resolveAnchor, targetAnchors } from './recallAnchors';
import { getReviewQueue, reviewRetrievalTarget, setRetrievalQuestion, formatPlanProvenance, type ReviewQueueItem } from '../../repositories/reviewRepository';

const FEEDBACK: Array<{ value: ReviewResult; label: string }> = [
  { value: 'missed', label: 'Forgot' },
  { value: 'partial', label: 'Partial' },
  { value: 'recalled', label: 'Recalled' },
];
const CONTINUE_AFTER_RATING_KEY = 'nodal.review.continueAfterRating';
const RATING_COOLDOWN_MS = 350;

export function ReviewSession() {
  const { setActiveView, reviewTargetIds, reviewFocusTargetId, reviewReturnView, getNode, openNode } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [repairQuestion, setRepairQuestion] = useState('');
  const [repairBusy, setRepairBusy] = useState(false);
  const repairSaving = useRef(false);
  const saving = useRef(false);
  const [saved, setSaved] = useState<ReviewEvent | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [revealOverrides, setRevealOverrides] = useState<Record<string, boolean>>({});
  const [initial, setInitial] = useState<ReviewResult | null>(null);
  const hints = useRef<number[]>([]);
  const [allowSnapshot, setAllowSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(0);
  const [pendingRetries, setPendingRetries] = useState<ReviewQueueItem[]>([]);
  const [continueAfterRating, setContinueAfterRating] = useState(() => {
    try {
      const stored = window.localStorage.getItem(CONTINUE_AFTER_RATING_KEY);
      if (stored !== null) return stored === 'true';
      return !reviewTargetIds;
    } catch {
      return !reviewTargetIds;
    }
  });
  const [ratingCooldown, setRatingCooldown] = useState(false);
  const cooldownUntil = useRef(0);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useRef(newId());
  const eventId = useRef(newId());
  const shownAt = useRef(0);
  const revealedAt = useRef<number | null>(null);
  const recallDuration = useRef(0);
  const interruptions = useRef(0);
  const retriesRef = useRef<Record<string, number>>({});
  useEffect(() => {
    const onBlur = () => { if (revealedAt.current === null) interruptions.current += 1; };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getReviewQueue(Date.now(), reviewTargetIds ?? undefined).then(items => {
      if (cancelled) return;
      if (reviewFocusTargetId && !reviewTargetIds) {
        const focusItem = items.find(it => it.target.id === reviewFocusTargetId);
        if (focusItem) {
          const rest = items.filter(it => it.target.id !== reviewFocusTargetId);
          setQueue([focusItem, ...rest]);
        } else {
          setQueue(items);
        }
      } else {
        setQueue(items);
      }
      setLoading(false);
      shownAt.current = Date.now();
    }).catch(() => { if (!cancelled) { setError('Could not load review. Go back and try again.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [reviewTargetIds, reviewFocusTargetId]);

  useEffect(() => () => { if (cooldownTimer.current) clearTimeout(cooldownTimer.current); }, []);
  const updateContinueAfterRating = (value: boolean) => {
    setContinueAfterRating(value);
    try { window.localStorage.setItem(CONTINUE_AFTER_RATING_KEY, String(value)); }
    catch { /* Preferences are optional and must not block review. */ }
  };

  const item = queue[index];
  const source = item?.target.sourceType === 'node' ? getNode(item.target.sourceId) : undefined;
  const anchors = item ? targetAnchors(item.target) : [];
  const resolved = source ? anchors.map(anchor => resolveAnchor(source.contentMarkdown, anchor)) : [];
  const stale = anchors.length > 0 && (resolved.length !== anchors.length || resolved.some(anchor => !anchor));
  const currentAnchors = !stale ? resolved.filter(anchor => anchor !== null) : anchors;
  const presentedTarget = item ? { ...item.target, ...(currentAnchors.length ? { anchor: currentAnchors[0], anchors: currentAnchors } : {}),
    expectedEvidenceMarkdown: item.target.expectedEvidenceMarkdown || source?.contentMarkdown || '' } : null;

  const reveal = () => {
    if (revealedAt.current === null) {
      revealedAt.current = Date.now(); recallDuration.current = Math.max(0, revealedAt.current - shownAt.current);
    }
    setRevealed(true); setRevealOverrides({});
  };
  const toggleBlank = (id: string, visible: boolean) => {
    if (saving.current || saved) return;
    if (visible && revealedAt.current === null) {
      revealedAt.current = Date.now(); recallDuration.current = Math.max(0, revealedAt.current - shownAt.current);
    }
    setRevealOverrides(current => ({ ...current, [id]: visible }));
  };
  const hideAll = () => { setRevealed(false); setRevealOverrides({}); };
  const beginRatingCooldown = () => {
    cooldownUntil.current = Date.now() + RATING_COOLDOWN_MS;
    setRatingCooldown(true);
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    const checkCooldown = () => {
      const remaining = cooldownUntil.current - Date.now();
      if (remaining <= 0) {
        cooldownTimer.current = null;
        setRatingCooldown(false);
      } else {
        cooldownTimer.current = setTimeout(checkCooldown, Math.max(10, remaining));
      }
    };
    cooldownTimer.current = setTimeout(checkCooldown, RATING_COOLDOWN_MS);
  };
  const submit = async (result: ReviewResult, initialOverride?: ReviewResult) => {
    if (!item || !presentedTarget || saving.current || saved || ratingCooldown || cooldownUntil.current > Date.now() || (stale && !allowSnapshot)) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const event = await reviewRetrievalTarget({ targetId: item.target.id, result,
        responseTimeMs: recallDuration.current, sessionId: sessionId.current, eventId: eventId.current,
        expectedStateUpdatedAt: item.state.updatedAt, initialResult: initialOverride ?? initial,
        answerRevealedAt: revealedAt.current, interruptionCount: interruptions.current, sourceStatus: stale ? 'snapshot' : 'current',
        startedAt: shownAt.current, hintUsedAt: hints.current,
        targetSnapshot: { promptMarkdown: presentedTarget.promptMarkdown, expectedEvidenceMarkdown: presentedTarget.expectedEvidenceMarkdown,
          presentation: presentedTarget.presentation, ...(presentedTarget.anchor ? { anchor: presentedTarget.anchor } : {}), ...(presentedTarget.anchors ? { anchors: presentedTarget.anchors } : {}) } });
      setCompleted(value => value + 1);

      // Intra-session retry on Forgot (missed)
      if (result === 'missed') {
        const targetId = item.target.id;
        const currentRetries = retriesRef.current[targetId] || 0;
        if (currentRetries < 2) {
          retriesRef.current[targetId] = currentRetries + 1;
          const remaining = queue.length - 1 - index;
          const retryItem: ReviewQueueItem = {
            ...item,
            state: event.resultingState,
          };
          if (remaining >= 3) {
            setQueue(currentQueue => {
              const nextQueue = [...currentQueue];
              nextQueue.splice(index + 4, 0, retryItem);
              return nextQueue;
            });
          } else {
            setPendingRetries(prev => prev.some(p => p.target.id === item.target.id)
              ? prev.map(p => p.target.id === item.target.id ? retryItem : p)
              : [...prev, retryItem]);
          }
        }
      } else if (result === 'recalled') {
        setPendingRetries(prev => prev.filter(p => p.target.id !== item.target.id));
      }

      if (continueAfterRating) next();
      else setSaved(event);
    } catch (cause) { setError(cause instanceof Error ? 'Not saved: ' + cause.message : 'This rating has not been saved. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const assess = (result: ReviewResult) => {
    if (saving.current || saved || ratingCooldown || cooldownUntil.current > Date.now()) return;
    const beforeFirstReveal = revealedAt.current === null;
    reveal();
    if (beforeFirstReveal) setInitial(result);
    void submit(result, beforeFirstReveal ? result : undefined);
  };
  const next = () => {
    if (cooldownUntil.current > Date.now()) return;
    beginRatingCooldown();
    hints.current = [];
    setSaved(null); setInitial(null); setRevealed(false); setRevealOverrides({}); setAllowSnapshot(false); setError('');
    revealedAt.current = null; recallDuration.current = 0; interruptions.current = 0; eventId.current = newId();
    setIndex(value => value + 1); shownAt.current = Date.now();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || busy || ratingCooldown || cooldownUntil.current > Date.now() || loading || !item || (stale && !allowSnapshot) || !presentedTarget || needsRecallCue(presentedTarget)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === ' ' && !target?.closest('button, summary')) { event.preventDefault(); if (saved) next(); else if (revealed) hideAll(); else reveal(); }
      const rating = FEEDBACK[Number(event.key) - 1];
      if (rating && !saved) { event.preventDefault(); assess(rating.value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (loading) return <main className="review-shell"><p>Preparing your review…</p></main>;
  if (!item || !presentedTarget) return <main className="review-shell review-finished">
    <p className="eyebrow">REVIEW SESSION</p><h1>{completed ? 'Completed ' + completed + ' recalls' : 'No prompts in this session'}</h1>
    <p>{completed ? 'All ratings saved.' : 'You may be up to date or at your daily limits. Check Plan for outstanding work, or open an individual prompt to practice.'}</p>
    {pendingRetries.length > 0 && (
      <div className="review-retry-notice" style={{ margin: '16px 0' }}>
        <p style={{ color: 'var(--color-text-secondary, #666)' }}>{pendingRetries.length} prompt{pendingRetries.length > 1 ? 's' : ''} marked as Forgot during this session.</p>
        <button className="primary" onClick={() => {
          setQueue([...pendingRetries]);
          setPendingRetries([]);
          setIndex(0);
          setSaved(null);
          setRevealed(false);
          setRevealOverrides({});
          shownAt.current = Date.now();
        }}>Retry {pendingRetries.length} prompt{pendingRetries.length > 1 ? 's' : ''} now</button>
      </div>
    )}
    {error && <p role="alert">{error}</p>}
    <button className={pendingRetries.length > 0 ? 'ghost' : 'primary'} onClick={() => setActiveView(reviewReturnView)}>Back to learning</button>
  </main>;

  if (needsRecallCue(presentedTarget)) return <main className="review-shell"><section className="review-stage"><p className="overline">REPAIR A LEGACY PROMPT</p><h2>This passage needs a question</h2><p>The old prompt hid its entire context. Add a specific cue before reviewing it.</p><blockquote>{presentedTarget.anchor?.context}</blockquote><input aria-label="Question for this passage" placeholder="What should you recall from this passage?" value={repairQuestion} onChange={event => setRepairQuestion(event.target.value)} /><button className="primary" disabled={repairBusy || !repairQuestion.trim()} onClick={async () => {
    if (repairSaving.current || !repairQuestion.trim()) return;
    repairSaving.current = true;
    setRepairBusy(true);
    setError('');
    try {
      const updated = await setRetrievalQuestion(item.target.id, repairQuestion, item.target.revision);
      setQueue(current => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, target: updated } : entry));
      revealedAt.current = Date.now();
      recallDuration.current = 0;
      setRepairQuestion('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the question.'); }
    finally { repairSaving.current = false; setRepairBusy(false); }
  }}>{repairBusy ? 'Saving…' : 'Save question'}</button><button disabled={repairBusy} onClick={() => setActiveView(reviewReturnView)}>Back</button><p>No rating is recorded while repairing a prompt. Existing history is preserved.</p>{error && <p role="alert">{error}</p>}</section></main>;

  return <main className="review-shell">
    <header className="review-header">
      <button className="ghost" disabled={busy} onClick={() => setActiveView(reviewReturnView)}>← End session</button>
      <div className="review-progress"><span style={{width:index / queue.length * 100 + '%'}} /></div>
      <span>{index + 1} / {queue.length}</span>
      <label className="review-auto-advance review-options" title="Continue to next recall immediately after rating" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={continueAfterRating} onChange={event => updateContinueAfterRating(event.target.checked)} />
        <span>Continue after rating</span>
      </label>
      <ReviewHistory targetId={item.target.id} />
    </header>
    {stale && !allowSnapshot ? <section className="review-stage"><h2>The source has changed</h2><p>This passage can no longer be located reliably. Your review content has not been replaced.</p>
      <button onClick={() => openNode(item.target.sourceId)}>Inspect source</button><button onClick={() => { setAllowSnapshot(true); shownAt.current = Date.now(); }}>Review saved version</button></section> : <>
    <CardSurface className="review-stage review-document-stage">
      <div className="review-stage-meta">
        <span className="review-source">{stale ? 'Saved version' : 'Review'}</span>
        <span className="review-plan-provenance">{formatPlanProvenance(item.plan, item.executionState)}</span>
      </div>
      <h1 className="review-document-title">{item.sourceTitle}</h1>
      <CardDocument key={item.target.id} markdown={!stale ? source?.contentMarkdown : undefined} target={presentedTarget} anchors={currentAnchors} revealed={revealed} revealOverrides={revealOverrides} onRevealChange={saved ? undefined : toggleBlank} />
    </CardSurface>
    <section className="review-assessment" aria-label="Recall quality">
      {saved ? <div className="review-saved" role="status"><strong>Recorded: {FEEDBACK.find(f => f.value === saved.rawResult)?.label}</strong>
        <span>Next: {new Date(saved.resultingState.dueAt).toLocaleDateString('en-US')}</span><button className="primary" onClick={next}>{index + 1 < queue.length ? 'Next →' : 'Finish session'}</button>
        </div> : <>
        <button className="reveal-button" disabled={busy || ratingCooldown} onClick={() => revealed ? hideAll() : reveal()}>{currentAnchors.length ? revealed ? 'Hide all' : 'Reveal all' : revealed ? 'Hide answer' : 'Reveal answer'}</button>
        <footer className="feedback-bar" aria-label="Rate this recall">
          {FEEDBACK.map((option, index) => (
            <button
              key={option.value}
              data-result={option.value}
              disabled={busy || ratingCooldown}
              title={`${option.label} (shortcut: ${index + 1})`}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => assess(option.value)}
            >
              <strong>{option.label}</strong>
            </button>
          ))}
        </footer>
      </>}
    </section></>}
    {error && (
      <div className="review-error-banner" role="alert" style={{ marginTop: '12px', textAlign: 'center' }}>
        <p className="review-error">{error}</p>
        {error.includes('updated elsewhere') && (
          <button
            type="button"
            className="secondary compact"
            style={{ marginTop: '6px' }}
            onClick={async () => {
              try {
                const fresh = await db.memoryStates.get(item.target.id);
                if (fresh) {
                  setQueue(q => q.map((entry, idx) => idx === index ? { ...entry, state: fresh } : entry));
                  setError('');
                }
              } catch {}
            }}
          >
            Reload prompt state
          </button>
        )}
      </div>
    )}
  </main>;
}
