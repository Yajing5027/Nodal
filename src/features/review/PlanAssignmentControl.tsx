import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db/database';
import {
  getAssignment, setAssignment, loadResolutionContext, resolveEffectivePlanForSubject,
} from '../../repositories/planAssignmentRepository';
import {
  dateInputToTimestamp, timestampToDateInput, describeDeadline,
} from './cadence';
import type { AssignmentSubjectType, EffectivePlanResolution, PlanAssignment, PlanResolutionSource, StudyPlan } from '../../domain/types';

interface Props {
  subjectType: AssignmentSubjectType;
  subjectId: string;
  sectionId?: string;
  /** Owning node id (for section/target inheritance display). */
  nodeId?: string;
  compact?: boolean;
}

export function provenanceInfo(source: PlanResolutionSource, currentSubjectType: AssignmentSubjectType): {
  isInherited: boolean;
  provenanceText: string;
} {
  const isDirect = (source === 'target' && currentSubjectType === 'retrieval_target')
    || (source === 'section' && currentSubjectType === 'section')
    || (source === 'node' && currentSubjectType === 'node');

  if (source === 'baseline') {
    return { isInherited: false, provenanceText: 'Baseline adaptive' };
  }
  if (isDirect) {
    const targetName = currentSubjectType === 'retrieval_target' ? 'prompt' : currentSubjectType === 'section' ? 'section' : 'note';
    return { isInherited: false, provenanceText: `Applied to this ${targetName}` };
  }
  if (source === 'section') {
    return { isInherited: true, provenanceText: 'Inherited from section' };
  }
  if (source === 'node') {
    return { isInherited: true, provenanceText: 'Inherited from note' };
  }
  return { isInherited: false, provenanceText: '' };
}

/**
 * Compact "Review plan · X" badge + apply panel. Combines an optional per-subject
 * DEADLINE with HOW to reach it: baseline adaptive FSRS, or a reusable plan.
 */
export function PlanAssignmentControl({ subjectType, subjectId, sectionId, nodeId, compact }: Props) {
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [assignment, setAssignmentState] = useState<PlanAssignment | null>(null);
  const [resolution, setResolution] = useState<EffectivePlanResolution>({ plan: null, source: 'baseline', paused: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState('');

  const refresh = async () => {
    const ctx = await loadResolutionContext();
    setPlans(Array.from(ctx.plans.values()));
    const ownAssignmentSectionId = subjectType === 'section' ? sectionId : undefined;
    const own = await getAssignment(subjectType, subjectId, ownAssignmentSectionId);
    setAssignmentState(own ?? null);
    setDeadlineValue(timestampToDateInput(own?.endsAt ?? null));
    const res = resolveEffectivePlanForSubject(subjectType, subjectId, sectionId, nodeId, ctx);
    setResolution(res);
  };

  useEffect(() => {
    void refresh();
    const s1 = liveQuery(() => db.planAssignments.toArray()).subscribe({ next: () => void refresh() });
    const s2 = liveQuery(() => db.semesterPlans.toArray()).subscribe({ next: () => void refresh() });
    return () => { s1.unsubscribe(); s2.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId, sectionId, nodeId]);

  const { isInherited, provenanceText } = provenanceInfo(resolution.source, subjectType);
  const methodTitle = resolution.plan?.title
    ?? (resolution.assignmentId ? 'Adaptive (FSRS)' : null);
  const effectiveEndsAt = assignment?.endsAt ?? resolution.plan?.endsAt ?? null;
  const paused = resolution.paused;

  const label = compact && isInherited
    ? `Plan: ${methodTitle ?? 'inherited'}`
    : `Review plan · ${methodTitle ?? 'none'}${paused ? ' (paused)' : ''}${isInherited ? ' (inherited)' : ''}`;

  const write = async (reviewPlanId: string | null, endsAt: number | null) => {
    setBusy(true);
    try {
      const ownAssignmentSectionId = subjectType === 'section' ? sectionId : undefined;
      await setAssignment({ reviewPlanId, subjectType, subjectId, sectionId: ownAssignmentSectionId, endsAt });
      setOpen(false);
      await refresh();
    } finally { setBusy(false); }
  };

  const chooseAdaptive = () => void write(null, dateInputToTimestamp(deadlineValue));
  const choosePlan = (planId: string) => void write(planId, dateInputToTimestamp(deadlineValue));
  const clearAll = () => { setDeadlineValue(''); void write(null, null); };

  const preset = (days: number) => {
    const d = new Date(Date.now() + days * 86400000);
    const p = (n: number) => String(n).padStart(2, '0');
    setDeadlineValue(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  };

  return (
    <div className="plan-assign" style={{ position: 'relative', display: 'inline-block' }}>
      <button className="ghost" disabled={busy} onClick={() => setOpen(o => !o)} title="Review plan" aria-expanded={open}>{label}</button>
      {open && (
        <div className="plan-picker" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, minWidth: 290, boxShadow: '0 12px 36px rgba(0,0,0,0.18)' }}>
          <div className="plan-picker-header" style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 13, color: 'var(--text)' }}>{methodTitle ?? 'Baseline adaptive'}</strong>
              {paused && <span className="plan-paused-badge" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Paused</span>}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{provenanceText}</p>
          </div>
          <p className="plan-picker-label">Deadline (optional)</p>
          <input type="date" className="plan-picker-date" value={deadlineValue} onChange={e => setDeadlineValue(e.target.value)} />
          <div className="plan-picker-presets">
            <button type="button" className="ghost" onClick={() => preset(7)}>1 week</button>
            <button type="button" className="ghost" onClick={() => preset(30)}>1 month</button>
            <button type="button" className="ghost" onClick={() => preset(90)}>3 months</button>
          </div>
          <p className="plan-picker-label" style={{ marginTop: 12 }}>Reach it via</p>
          <button className="ghost plan-picker-option" onClick={chooseAdaptive}>Adaptive (FSRS) — default</button>
          {plans.map(p => (
            <button key={p.id} className="ghost plan-picker-option" onClick={() => choosePlan(p.id)}>
              {p.title}{p.status === 'paused' ? ' · paused' : ''}
            </button>
          ))}
          <div className="plan-picker-foot">
            {assignment ? (
              <button type="button" className="ghost" onClick={clearAll}>Remove custom assignment</button>
            ) : isInherited ? (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>Using inherited plan. Select a plan above to override.</p>
            ) : (
              <button type="button" className="ghost" onClick={clearAll}>Reset to default</button>
            )}
          </div>
        </div>
      )}
      {methodTitle && effectiveEndsAt !== null && !open && <small className="plan-assign-deadline">{describeDeadline({ startsAt: null, endsAt: effectiveEndsAt })}</small>}
    </div>
  );
}
