import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ui/index';
import { createStudyPlan, updateStudyPlan, setPlanStatus } from '../../repositories/reviewRepository';
import { countAssignmentsForPlan, deleteStudyPlan } from '../../repositories/planAssignmentRepository';
import type { IntervalStep, ReviewCadencePolicy, StudyPlan } from '../../domain/types';
import { describeCadence, describeDeadline, dateInputToTimestamp, timestampToDateInput } from './cadence';
import { liveQuery } from 'dexie';
import { db } from '../../db/database';

type Unit = 'day' | 'week' | 'month';

function stepSummary(steps: IntervalStep[], after: 'loop' | 'repeat_last' | 'stop'): string {
  if (!steps.length) return 'Empty sequence';
  const arrows = steps.map(s => `${s.value}${s.unit[0]}`).join(' → ');
  return arrows + (after === 'loop' ? ' ↻' : after === 'repeat_last' ? ' ↺' : ' · end');
}

function StepRow({
  index,
  step,
  totalSteps,
  onPatch,
  onRemove,
  onMove,
}: {
  index: number;
  step: IntervalStep;
  totalSteps: number;
  onPatch: (p: Partial<IntervalStep>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="seq-step" role="listitem">
      <span className="seq-num" aria-hidden="true">{index + 1}</span>
      <div className="seq-compact-unit">
        <input
          type="number"
          min={1}
          className="seq-value"
          value={step.value}
          aria-label={`Step ${index + 1} value`}
          onChange={e => onPatch({ value: Math.max(1, Number(e.target.value) || 1) })}
        />
        <ChoiceSelect
          className="seq-unit"
          aria-label={`Step ${index + 1} unit`}
          value={step.unit}
          onChange={e => onPatch({ unit: e.target.value as Unit })}
        >
          <option value="day">{step.value === 1 ? 'day' : 'days'}</option>
          <option value="week">{step.value === 1 ? 'week' : 'weeks'}</option>
          <option value="month">{step.value === 1 ? 'month' : 'months'}</option>
        </ChoiceSelect>
      </div>
      <span className="seq-relative-label">
        {index === 0 ? 'after initial study' : 'after previous review'}
      </span>
      <div className="seq-move">
        <button
          type="button"
          title="Move step up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={`Move step ${index + 1} up`}
        >
          ↑
        </button>
        <button
          type="button"
          title="Move step down"
          disabled={index === totalSteps - 1}
          onClick={() => onMove(1)}
          aria-label={`Move step ${index + 1} down`}
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        className="seq-del"
        title="Remove step"
        onClick={onRemove}
        aria-label={`Remove step ${index + 1}`}
      >
        ×
      </button>
    </div>
  );
}

function Editor({ plan, onSaved, onCancel }: { plan: StudyPlan | null; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(plan?.title ?? '');
  const [mode, setMode] = useState<'adaptive_fsrs' | 'fixed_interval' | 'interval_sequence'>(plan?.cadence.kind ?? 'adaptive_fsrs');
  const [fixedValue, setFixedValue] = useState(plan?.cadence.kind === 'fixed_interval' ? plan.cadence.interval.value : 3);
  const [fixedUnit, setFixedUnit] = useState<Unit>(plan?.cadence.kind === 'fixed_interval' ? plan.cadence.interval.unit : 'day');
  const [steps, setSteps] = useState<IntervalStep[]>(plan?.cadence.kind === 'interval_sequence' ? plan.cadence.steps : [{ value: 1, unit: 'day' }, { value: 2, unit: 'day' }, { value: 3, unit: 'day' }, { value: 4, unit: 'day' }]);
  const [after, setAfter] = useState<'stop' | 'repeat_last' | 'loop'>(plan?.cadence.kind === 'interval_sequence' ? plan.cadence.afterSequence : 'loop');
  const [retention, setRetention] = useState(plan?.targetRetention ? Math.round(plan.targetRetention * 100) : 90);
  const [startDate, setStartDate] = useState(timestampToDateInput(plan?.startsAt ?? null));
  const [endDate, setEndDate] = useState(timestampToDateInput(plan?.endsAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const deadlinePreset = (days: number) => {
    const d = new Date(Date.now() + days * 86400000);
    const p2 = (n: number) => String(n).padStart(2, '0');
    setEndDate(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  };

  const patchStep = (i: number, p: Partial<IntervalStep>) => setSteps(steps.map((s, j) => j === i ? { ...s, ...p } : s));
  const removeStep = (i: number) => setSteps(steps.filter((_, j) => j !== i));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      let cadence: ReviewCadencePolicy;
      if (mode === 'fixed_interval') {
        cadence = { kind: 'fixed_interval', interval: { value: fixedValue, unit: fixedUnit } };
      } else if (mode === 'interval_sequence') {
        if (!steps.length) {
          setError('Add at least one interval step.');
          setBusy(false);
          return;
        }
        cadence = { kind: 'interval_sequence', steps, afterSequence: after };
      } else {
        cadence = { kind: 'adaptive_fsrs' };
      }
      const startTs = dateInputToTimestamp(startDate);
      const endTs = dateInputToTimestamp(endDate);
      if (startTs !== null && endTs !== null && endTs < startTs) {
        setError('Deadline cannot be earlier than start date.');
        setBusy(false);
        return;
      }
      const changes = {
        title: title.trim() || 'Untitled plan',
        cadence,
        startsAt: startTs,
        endsAt: endTs,
        targetRetention: mode === 'adaptive_fsrs' ? retention / 100 : null,
      };
      if (plan) await updateStudyPlan(plan.id, changes);
      else await createStudyPlan(changes);
      onSaved();
    } catch {
      setError('Could not save plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plan-editor" role="region" aria-label="Plan editor">
      <div className="plan-editor-head">
        <div>
          <h2>{plan ? `Edit plan: ${plan.title}` : 'New review plan'}</h2>
          <p className="plan-editor-sub">Configure scheduling policy and optional target deadlines.</p>
        </div>
        <button className="ghost" onClick={onCancel} aria-label="Close editor">×</button>
      </div>

      <div className="plan-editor-body">
        <label className="plan-field">
          <span>Plan name</span>
          <input
            type="text"
            aria-label="Plan name"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Quiz Sprint, Semester Exam, Long-term"
            autoFocus
          />
        </label>

        <label className="plan-field">
          <span>Scheduling mode</span>
          <ChoiceSelect value={mode} onChange={e => setMode(e.target.value as typeof mode)} aria-label="Scheduling mode">
            <option value="adaptive_fsrs">Adaptive (FSRS) — memory physics & retention target</option>
            <option value="fixed_interval">Fixed interval — constant recurring cadence</option>
            <option value="interval_sequence">Interval sequence — custom relative step chain</option>
          </ChoiceSelect>
        </label>

        {/* Mode-specific controls */}
        {mode === 'adaptive_fsrs' && (
          <div className="plan-field">
            <label htmlFor="target-retention-input">Target retention: {retention}%</label>
            <div className="plan-retention-control">
              <input
                id="target-retention-input"
                type="range"
                min={70}
                max={99}
                value={retention}
                onChange={e => setRetention(Number(e.target.value))}
              />
              <input
                type="number"
                min={70}
                max={99}
                value={retention}
                onChange={e => setRetention(Number(e.target.value))}
                aria-label="Target retention %"
              />
            </div>
            <small className="plan-field-hint">FSRS dynamically schedules reviews to maintain this probability of recall.</small>
          </div>
        )}

        {mode === 'fixed_interval' && (
          <div className="plan-field">
            <span>Interval duration</span>
            <div className="inline-controls">
              <span>Every</span>
              <input
                type="number"
                min={1}
                className="seq-value"
                value={fixedValue}
                onChange={e => setFixedValue(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Interval value"
              />
              <ChoiceSelect
                value={fixedUnit}
                onChange={e => setFixedUnit(e.target.value as Unit)}
                aria-label="Interval unit"
              >
                <option value="day">{fixedValue === 1 ? 'day' : 'days'}</option>
                <option value="week">{fixedValue === 1 ? 'week' : 'weeks'}</option>
                <option value="month">{fixedValue === 1 ? 'month' : 'months'}</option>
              </ChoiceSelect>
            </div>
          </div>
        )}

        {mode === 'interval_sequence' && (
          <div className="plan-field seq-editor">
            <div className="seq-head">
              <span>Sequence progression</span>
              <span className="seq-preview" title="Live summary">
                Summary: <strong>{stepSummary(steps, after)}</strong>
              </span>
            </div>
            <div className="seq-timeline-chain">
              <div className="seq-anchor start">
                <span className="seq-anchor-dot" />
                <span>Start · Initial study</span>
              </div>
              <div className="seq-list" role="list" aria-label="Sequence steps">
                {steps.map((step, i) => (
                  <StepRow
                    key={i}
                    index={i}
                    step={step}
                    totalSteps={steps.length}
                    onPatch={p => patchStep(i, p)}
                    onRemove={() => removeStep(i)}
                    onMove={dir => moveStep(i, dir)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="ghost add-step-button"
                onClick={() => setSteps([...steps, { value: 1, unit: 'day' }])}
              >
                + Add step
              </button>
              <div className="seq-anchor end">
                <span className="seq-anchor-dot" />
                <label className="plan-field-inline">
                  <span>After sequence completes:</span>
                  <ChoiceSelect
                    value={after}
                    onChange={e => setAfter(e.target.value as typeof after)}
                    aria-label="After sequence rule"
                  >
                    <option value="loop">Loop from step 1 (↻)</option>
                    <option value="repeat_last">Repeat last interval indefinitely (↺)</option>
                    <option value="stop">Stop reviews (· end)</option>
                  </ChoiceSelect>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Planning window */}
        <details className="plan-window" open={Boolean(startDate || endDate)}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '4px 0', fontSize: '13px' }}>
            Planning window (optional)
          </summary>
          <div style={{ marginTop: '12px' }}>
            <div className="plan-window-row">
              <label className="plan-date">
                Start date
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </label>
              <label className="plan-date">
                Deadline / End date
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </label>
            </div>
            <div className="plan-window-presets">
              <button type="button" className="ghost" onClick={() => deadlinePreset(7)}>In 1 week</button>
              <button type="button" className="ghost" onClick={() => deadlinePreset(30)}>In 1 month</button>
              <button type="button" className="ghost" onClick={() => deadlinePreset(90)}>In 3 months</button>
              <button type="button" className="ghost" onClick={() => setStartDate('')}>Clear start date</button>
              <button type="button" className="ghost" onClick={() => setEndDate('')}>Clear deadline</button>
            </div>
            <p className="plan-window-hint">
              {endDate ? 'Finite window · reviews compress smoothly to complete before the deadline.' : 'Open-ended cadence · continues indefinitely.'}
            </p>
          </div>
        </details>
      </div>

      {error && <p role="alert" className="plan-status">{error}</p>}
      <div className="plan-form-row">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {plan ? 'Save changes' : 'Create plan'}
        </button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function PlansPage() {
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [editing, setEditing] = useState<StudyPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const [planToDelete, setPlanToDelete] = useState<StudyPlan | null>(null);

  const refresh = async () => {
    const rows = await db.semesterPlans.orderBy('updatedAt').reverse().toArray();
    const { normalizePlan } = await import('./deadlineScheduler');
    setPlans(rows.map(normalizePlan));
    const c: Record<string, number> = {};
    for (const r of rows) c[r.id] = await countAssignmentsForPlan(r.id);
    setCounts(c);
  };

  useEffect(() => {
    const sub1 = liveQuery(() => db.semesterPlans.toArray()).subscribe({ next: () => void refresh() });
    const sub2 = liveQuery(() => db.planAssignments.toArray()).subscribe({ next: () => void refresh() });
    void refresh();
    return () => {
      sub1.unsubscribe();
      sub2.unsubscribe();
    };
  }, []);

  const confirmDelete = async () => {
    if (!planToDelete) return;
    const target = planToDelete;
    setPlanToDelete(null);
    await deleteStudyPlan(target.id);
    setMessage(`Deleted "${target.title}".`);
    void refresh();
  };

  const togglePause = async (plan: StudyPlan) => {
    await setPlanStatus(plan.id, plan.status === 'paused' ? 'active' : 'paused');
    void refresh();
  };

  if (creating || editing) {
    return (
      <main className="plans-page">
        <div className="plan-library-head">
          <button className="ghost" onClick={() => { setCreating(false); setEditing(null); }}>
            ← Review plans
          </button>
        </div>
        <Editor
          plan={editing}
          onSaved={() => { setCreating(false); setEditing(null); void refresh(); }}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      </main>
    );
  }

  return (
    <main className="plans-page">
      <header className="plan-heading">
        <div>
          <p className="overline">REVIEW PLANS</p>
          <h1>Review plans</h1>
          <p>Reusable scheduling policies. Apply a plan to any note, section, or prompt — content stays independent.</p>
        </div>
        <button className="primary" onClick={() => { setCreating(true); setEditing(null); }}>
          + New plan
        </button>
      </header>

      {message && <p role="status" className="plan-status">{message}</p>}

      {!plans.length && (
        <p className="empty-state">
          No review plans yet. Create one — e.g. a looped quiz sprint, a fixed weekly rhythm, or an adaptive long-term plan.
        </p>
      )}

      <div className="plan-list">
        {plans.map(plan => (
          <article className={`plan-card${plan.status === 'paused' ? ' is-paused' : ''}`} key={plan.id}>
            <div className="plan-card-main">
              <div className="plan-card-header-row">
                <strong>{plan.title}</strong>
                <span className={`plan-status-pill ${plan.status === 'paused' ? 'is-paused' : 'is-active'}`}>
                  {plan.status === 'paused' ? 'Paused' : 'Active'}
                </span>
              </div>
              <span className="plan-card-cadence">{describeCadence(plan.cadence)}</span>
              <span className="plan-card-sub">
                {counts[plan.id] ?? 0} {(counts[plan.id] ?? 0) === 1 ? 'direct assignment' : 'direct assignments'} · {describeDeadline(plan)}
              </span>
              {plan.status === 'paused' && (
                <p className="plan-paused-note">
                  Paused · Custom cadence is inactive. Assignments and progress are preserved; prompts use baseline adaptive scheduling until resumed.
                </p>
              )}
            </div>
            <div className="plan-card-actions">
              <button className="ghost" onClick={() => void togglePause(plan)}>
                {plan.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="ghost" onClick={() => { setEditing(plan); setCreating(false); }}>
                Edit
              </button>
              <button className="ghost delete-action" onClick={() => setPlanToDelete(plan)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(planToDelete)}
        title="Delete Review Plan"
        danger
        confirmLabel="Delete Plan"
        message={
          <div>
            <p>
              Delete review plan <strong>{planToDelete?.title}</strong>?
            </p>
            <p style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
              This does NOT delete any notes or recall prompts. Associated notes and prompts will revert to baseline adaptive scheduling.
            </p>
          </div>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPlanToDelete(null)}
      />
    </main>
  );
}
