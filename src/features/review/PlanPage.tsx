import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { recallPrompt } from './recallAnchors';
import { scheduledMemory } from './deadlineScheduler';
import { describeCadence } from './cadence';
import { createMemoryModel } from './memoryModel';
import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db/database';
import { useApp } from '../../app/useApp';
import {
  loadResolutionContext,
  resolvePlanForTarget,
  listStudyPlans,
  type ResolutionContext,
} from '../../repositories/planAssignmentRepository';
import type { StudyPlan, ReviewEvent } from '../../domain/types';
import {
  buildTimeline,
  OUTCOMES,
  OUTCOME_LABELS,
  VIEWPORT_CENTER,
  TIMELINE_VIEWPORT,
  periodStart,
  shiftPeriod,
  type PlanData,
  type PlanPeriod,
} from './planTimeline';

const EMPTY: PlanData = { nodes: [], targets: [], states: [], events: [] };
const dateLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fullDateLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function PlanPage() {
  const { openNode, startReview, setActiveView } = useApp();
  const [data, setData] = useState<PlanData>(EMPTY);
  const [todayEvents, setTodayEvents] = useState<ReviewEvent[]>([]);
  const [context, setContext] = useState<ResolutionContext | null>(null);
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('all');
  const [period, setPeriod] = useState<PlanPeriod>('day');
  const [metric, setMetric] = useState<'reviews' | 'notes'>('reviews');
  const [offset, setOffset] = useState(0);
  const [at, setAt] = useState(() => Date.now());
  const [message, setMessage] = useState('');
  const center = VIEWPORT_CENTER(period);
  const [selected, setSelected] = useState(center);

  useEffect(() => {
    const viewport = TIMELINE_VIEWPORT[period];
    const centerTs = shiftPeriod(periodStart(at, period), offset * viewport, period);
    const minViewport = shiftPeriod(centerTs, -Math.floor(viewport / 2), period);
    const maxViewport = shiftPeriod(centerTs, viewport - Math.floor(viewport / 2), period);
    const todayStart = new Date(at);
    todayStart.setHours(0, 0, 0, 0);

    const subscription = liveQuery(async () => {
      const [nodes, targets, states, events, todaysReviewEvents, ctx, allPlans] = await Promise.all([
        db.nodes.toArray(),
        db.retrievalTargets.toArray(),
        db.memoryStates.toArray(),
        db.reviewEvents.where('reviewedAt').between(minViewport, maxViewport, true, true).toArray(),
        db.reviewEvents.where('reviewedAt').between(+todayStart, at, true, true).toArray(),
        loadResolutionContext(),
        listStudyPlans(),
      ]);
      return { nodes, targets, states, events, todaysReviewEvents, ctx, allPlans };
    }).subscribe({
      next: value => {
        setData({ nodes: value.nodes, targets: value.targets, states: value.states, events: value.events });
        setTodayEvents(value.todaysReviewEvents);
        setContext(value.ctx);
        setPlans(value.allPlans);
      },
      error: () => setMessage('Could not load your timeline. Please reopen Plan.'),
    });

    return () => { subscription.unsubscribe(); };
  }, [period, offset, at]);

  useEffect(() => {
    const timer = window.setInterval(() => setAt(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setSelected(VIEWPORT_CENTER(period)), [period]);

  const targetById = useMemo(() => new Map(data.targets.map(t => [t.id, t])), [data.targets]);

  const activeFilteredPlan = useMemo(() => {
    if (selectedPlanId === 'all') return null;
    return plans.find(p => p.id === selectedPlanId) ?? null;
  }, [plans, selectedPlanId]);

  const projectedData = useMemo(() => {
    if (!context) return data;
    const model = createMemoryModel();
    const states = data.states
      .filter(s => {
        if (selectedPlanId === 'all') return true;
        const target = targetById.get(s.retrievalTargetId);
        if (!target) return false;
        const resolved = resolvePlanForTarget(target, context);
        return resolved?.plan?.id === selectedPlanId;
      })
      .map(state => {
        const target = targetById.get(state.retrievalTargetId);
        const resolved = target ? resolvePlanForTarget(target, context) : null;
        return scheduledMemory(state, resolved?.plan ?? null, at, model);
      });

    const events = selectedPlanId === 'all'
      ? data.events
      : data.events.filter(e => {
          if (e.schedulingDecision?.planId !== undefined) {
            return e.schedulingDecision.planId === selectedPlanId;
          }
          const target = targetById.get(e.retrievalTargetId);
          if (!target) return false;
          const resolved = resolvePlanForTarget(target, context);
          return resolved?.plan?.id === selectedPlanId;
        });

    return { ...data, states, events };
  }, [data, context, selectedPlanId, at, targetById]);

  const buckets = buildTimeline(projectedData, at, period, offset);
  const todayStart = new Date(at); todayStart.setHours(0, 0, 0, 0);
  const usedMinutes = todayEvents.filter(event => !event.exampleSetId && event.reviewedAt >= +todayStart && event.reviewedAt <= at)
    .reduce((sum, event) => sum + Math.max(event.responseTimeMs, event.startedAt ? event.reviewedAt - event.startedAt : 0) / 60000, 0);
  const personalDue = projectedData.states.filter(state => {
    if (state.dueAt > at) return false;
    const target = targetById.get(state.retrievalTargetId);
    return target && !target.exampleSetId && target.status === 'active';
  }).length;
  const current = buckets[selected] ?? buckets[0];
  const maximum = Math.max(4, Math.ceil(Math.max(...buckets.map(b => metric === 'reviews' ? b.total : b.notes.length)) / 4) * 4);
  const total = buckets.reduce((n, b) => n + b.events.length, 0);
  const pending = buckets.reduce((n, b) => n + b.scheduled.length, 0);

  const daysLeft = activeFilteredPlan?.endsAt ? Math.max(0, Math.ceil((activeFilteredPlan.endsAt - at) / 86400000)) : null;

  return <main className="plan-page">
    <header className="plan-heading"><div><h1>Plan</h1></div></header>

    <div className="plan-filter-row" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 16px' }}>
      <label htmlFor="plan-scope-select" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Plan scope:</label>
      <ChoiceSelect
        id="plan-scope-select"
        value={selectedPlanId}
        onChange={e => setSelectedPlanId(e.target.value)}
        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)' }}
      >
        <option value="all">All plans &amp; baseline</option>
        {plans.map(p => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </ChoiceSelect>
    </div>

    {activeFilteredPlan
      ? <p className="plan-footnow">{describeCadence(activeFilteredPlan.cadence)}{activeFilteredPlan.endsAt ? ` · Ends ${fullDateLabel(activeFilteredPlan.endsAt)} · ${daysLeft}d left` : ' · Open-ended'}{activeFilteredPlan.dailyStudyBudgetMinutes ? ` · ${(activeFilteredPlan.dailyStudyBudgetMinutes - usedMinutes).toFixed(0)} min left today` : ''} · {personalDue} due</p>
      : <p className="plan-footnow">Personal study timeline · Each prompt scheduled by its effective plan · {personalDue} due</p>}

    <div className="plan-summary"><div><strong>{metric === 'reviews' ? total : buckets.reduce((n, b) => n + b.notes.length, 0)}</strong><span>{metric === 'reviews' ? 'ratings in view' : 'notes created in view'}</span></div><div><strong>{pending}</strong><span>outstanding prompts in view</span></div><div><strong>{daysLeft ?? '∞'}</strong><span>{activeFilteredPlan?.endsAt ? 'days left' : activeFilteredPlan ? 'open-ended' : 'all plans'}</span></div></div>

    <section className="plan-timeline" aria-label="Learning timeline">
      <header className="plan-controls"><div className="mode-toggle"><button className={metric === 'reviews' ? 'selected' : ''} onClick={() => setMetric('reviews')}>Review activity</button><button className={metric === 'notes' ? 'selected' : ''} onClick={() => setMetric('notes')}>Notes created</button></div><div className="mode-toggle">{(['day', 'week', 'month'] as const).map(p => <button key={p} aria-pressed={period === p} className={period === p ? 'selected' : ''} onClick={() => { setPeriod(p); setOffset(0); }}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div></header>
      <div className="plan-range"><button aria-label="Earlier periods" onClick={() => { setOffset(n => n - 1); setSelected(VIEWPORT_CENTER(period)); }}>←</button><span>{fullDateLabel(buckets[0].start)} – {fullDateLabel(buckets[buckets.length - 1].end - 1)}</span><button onClick={() => { setOffset(0); setSelected(VIEWPORT_CENTER(period)); }}>Today</button><button aria-label="Later periods" onClick={() => { setOffset(n => n + 1); setSelected(VIEWPORT_CENTER(period)); }}>→</button></div>
      <div className="plan-chart-scroll"><div className="plan-chart"><div className="plan-axis"><span>{maximum}</span><span>{Math.round(maximum / 2)}</span><span>0</span></div><div className="plan-bars">{buckets.map((b, index) => <button className={`plan-bar-column${selected === index ? ' is-selected' : ''}${b.current ? ' is-current' : ''}`} key={b.start} onClick={() => setSelected(index)} aria-pressed={selected === index} aria-label={`${dateLabel(b.start)}: ${b.events.length} ratings, ${b.scheduled.length} outstanding, ${b.notes.length} notes created`}>
        <span className="plan-bar-total">{metric === 'reviews' ? b.total || '' : b.notes.length || ''}</span><span className="plan-bar-stack">{metric === 'reviews' ? <>{OUTCOMES.map(result => <span key={result} className={`plan-segment is-${result}`} style={{ height: `${b.counts[result] / maximum * 100}%` }} />)}<span className="plan-segment is-pending" style={{ height: `${b.scheduled.length / maximum * 100}%` }} /></> : <span className="plan-segment is-clear" style={{ height: `${b.notes.length / maximum * 100}%` }} />}</span>
        <span className="plan-bar-date">{period === 'month' ? new Date(b.start).toLocaleDateString('en-US', { month: 'short' }) : dateLabel(b.start)}</span><small>{b.current ? period === 'day' ? 'Today' : 'Current' : '\u00a0'}</small>
      </button>)}</div></div></div>
      <div className="plan-legend">{metric === 'reviews' ? <>{OUTCOMES.map(result => <span key={result}><i className={`is-${result}`} />{OUTCOME_LABELS[result]}</span>)}<span><i className="is-pending" />Scheduled / new</span></> : <span><i className="is-clear" />Notes created</span>}</div>
    </section>

    <section className="plan-detail"><header><div><p className="overline">{period === 'day' ? 'DAY' : period.toUpperCase()} DETAILS</p><h2>{dateLabel(current.start)}{period !== 'day' ? ` – ${dateLabel(current.end - 1)}` : ''}</h2></div><span>{current.events.length} ratings · {current.scheduled.length} outstanding · {current.notes.length} notes</span></header>
      {metric === 'notes' ? current.notes.map(n => <button className="plan-detail-row" key={n.id} onClick={() => openNode(n.id)}><span>{n.title}</span><small>Created {dateLabel(n.createdAt)} →</small></button>) : <>
        {current.scheduled.map(s => { const t = data.targets.find(t => t.id === s.retrievalTargetId)!; return <button className="plan-detail-row" key={s.retrievalTargetId} onClick={() => startReview([t.id])}><span>{recallPrompt(t)}</span><small>{s.dueAt < at ? 'Overdue' : s.learningState === 'new' ? 'New' : 'Scheduled'} · {dateLabel(s.dueAt)} →</small></button>; })}
        {current.events.map(e => <div className="plan-detail-row" key={e.id}><span>{data.targets.find(t => t.id === e.retrievalTargetId)?.promptMarkdown ?? 'Archived prompt'}</span><small>{OUTCOME_LABELS[e.rawResult]} · {new Date(e.reviewedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></div>)}
      </>}
      {(metric === 'notes' ? current.notes.length === 0 : current.total === 0) && <p className="plan-footnote">{metric === 'notes' ? 'No notes created in this period.' : 'Nothing recorded or scheduled in this period.'}</p>}
    </section>

    {message && <p role="status" className="plan-status">{message}</p>}

    <div className="plan-actions" style={{ marginTop: 24, textAlign: 'right' }}>
      <button className="ghost" onClick={() => setActiveView('plans')}>
        Manage review plans →
      </button>
    </div>
  </main>;
}
