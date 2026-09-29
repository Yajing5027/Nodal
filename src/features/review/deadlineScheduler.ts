import type { IntervalStep, MemoryState, ReviewCadencePolicy, SchedulingDecision, SemesterPlan, StudyPlan } from '../../domain/types';
import { createMemoryModel, type MemoryModel } from './memoryModel';
import { deadlineAwareDue } from './cadence';

export const DEADLINE_POLICY_VERSION = 'deadline-pressure/2';

/** Normalize a persisted (possibly legacy) SemesterPlan row into a canonical StudyPlan. */
export function normalizePlan(row: SemesterPlan): StudyPlan {
  let cadence: ReviewCadencePolicy = (row.cadence && (row.cadence as any).kind)
    ? row.cadence
    : { kind: 'adaptive_fsrs' };
  if (cadence.kind === 'interval_sequence' && cadence.steps) {
    cadence = {
      ...cadence,
      steps: cadence.steps.map((step: IntervalStep, idx: number) => ({
        ...step,
        id: step.id ?? `step_${idx}_${step.value}${step.unit}`,
      })),
    };
  }
  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? row.targetDate ?? null,
    cadence,
    dailyStudyBudgetMinutes: row.dailyStudyBudget ?? row.dailyBudgetMinutes ?? null,
    newTargetLimit: row.newTargetLimit ?? null,
    targetRetention: row.targetRetention ?? row.desiredRetention ?? null,
    status: row.status ?? 'active',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface ProjectArgs {
  state: MemoryState;
  plan: StudyPlan | null;
  at: number;
  model?: MemoryModel;
}

/**
 * Read-side projection: what is the operational dueAt right now?
 * - adaptive_fsrs: stored FSRS dueAt, optionally pulled earlier by deadline
 *   pressure when the plan has a finite end date. Open-ended = no pressure.
 * - fixed_interval / interval_sequence: the stored dueAt (set at review time
 *   from the cadence policy) is authoritative; FSRS evidence is preserved in
 *   fsrsDueAt but not used for operational due.
 */
export function projectDueAt({ state, plan, at, model }: ProjectArgs): { dueAt: number; decision: SchedulingDecision } {
  const naturalDue = state.fsrsDueAt ?? state.dueAt;
  const kind = plan?.cadence.kind ?? 'adaptive_fsrs';

  if (kind !== 'adaptive_fsrs') {
    return {
      dueAt: state.dueAt,
      decision: state.schedulingDecision ?? {
        policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: kind,
        targetDate: plan?.endsAt ?? null, targetRetention: plan?.targetRetention ?? null,
        calculatedAt: at, fsrsDueAt: naturalDue, dueAt: state.dueAt,
        predictedRecallAtDeadline: null, reason: 'cadence',
      },
    };
  }

  // adaptive_fsrs — optional deadline pressure only with a finite end date.
  if (state.lastReviewedAt === null) {
    const base: SchedulingDecision = {
      policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: 'adaptive_fsrs',
      targetDate: plan?.endsAt ?? null, targetRetention: plan?.targetRetention ?? null,
      calculatedAt: at, fsrsDueAt: naturalDue, dueAt: state.dueAt,
      predictedRecallAtDeadline: null,
      reason: 'new',
    };
    return { dueAt: state.dueAt, decision: base };
  }

  if (!plan?.endsAt) {
    const base: SchedulingDecision = {
      policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: 'adaptive_fsrs',
      targetDate: null, targetRetention: plan?.targetRetention ?? null,
      calculatedAt: at, fsrsDueAt: naturalDue, dueAt: naturalDue,
      predictedRecallAtDeadline: null,
      reason: 'long-term',
    };
    return { dueAt: naturalDue, decision: base };
  }

  if (plan.endsAt <= at) {
    const base: SchedulingDecision = {
      policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: 'adaptive_fsrs',
      targetDate: plan.endsAt, targetRetention: plan?.targetRetention ?? null,
      calculatedAt: at, fsrsDueAt: naturalDue, dueAt: naturalDue,
      predictedRecallAtDeadline: null,
      reason: 'deadline-passed',
    };
    return { dueAt: naturalDue, decision: base };
  }

  const activeModel = model ?? createMemoryModel();
  const predictedRecall = activeModel.recallProbability(state, plan.endsAt);
  const base: SchedulingDecision = {
    policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: 'adaptive_fsrs',
    targetDate: plan.endsAt, targetRetention: plan?.targetRetention ?? null,
    calculatedAt: at, fsrsDueAt: naturalDue, dueAt: naturalDue,
    predictedRecallAtDeadline: predictedRecall,
    reason: 'long-term',
  };

  const origin = state.lastReviewedAt;
  const remaining = plan.endsAt - origin;
  const interval = Math.max(0, naturalDue - origin);
  const targetRetention = plan.targetRetention ?? activeModel.profile.requestRetention;
  const risk = Math.max(0, (targetRetention - (base.predictedRecallAtDeadline ?? 0)) / targetRetention);
  const urgency = Math.max(0, Math.min(1, (2 * interval) / remaining - 1));
  if (!risk || !urgency || remaining <= 0) return { dueAt: naturalDue, decision: base };
  const threshold = activeModel.profile.requestRetention + (1 - activeModel.profile.requestRetention) * urgency * risk;
  let delayTarget = interval;
  if (threshold < 1 && state.stabilityDays > 0) {
    const decay = -(activeModel.profile.weights?.[20] ?? 0.5);
    const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
    const elapsedDays = (state.stabilityDays / factor) * (Math.pow(threshold, 1 / decay) - 1);
    delayTarget = Math.max(0, elapsedDays * 86400000);
  } else if (threshold >= 1) {
    delayTarget = 0;
  }
  const delay = Math.min(interval, delayTarget, remaining / (1 + urgency * risk));
  const dueAt = origin + Math.max(1, Math.floor(delay));
  return { dueAt, decision: { ...base, dueAt, reason: dueAt < naturalDue ? 'deadline-pressure' : 'long-term' } };
}

export function scheduledMemory(state: MemoryState, plan: StudyPlan | null, at: number, model?: MemoryModel): MemoryState {
  const { dueAt, decision } = projectDueAt({ state, plan, at, model });
  return { ...state, dueAt, schedulingDecision: decision };
}

/**
 * Review-time: after FSRS produces a fresh card, apply the cadence policy to set
 * the operational dueAt. FSRS remains the evidence; cadence only chooses when
 * the next review is due. Returns the next MemoryState (not yet persisted).
 */
export function applyCadenceAfterReview(
  fsrsState: MemoryState,
  plan: StudyPlan | null,
  reviewedAt: number,
  sequenceStepIndex?: number,
): MemoryState {
  const kind = plan?.cadence.kind ?? 'adaptive_fsrs';
  if (kind === 'adaptive_fsrs') {
    return scheduledMemory(fsrsState, plan, reviewedAt);
  }
  const stepIndex = sequenceStepIndex !== undefined ? sequenceStepIndex : Math.max(0, fsrsState.reviewCount - 1);
  const next = deadlineAwareDue(plan!.cadence, stepIndex, reviewedAt, plan!.endsAt);
  const dueAt = next ?? Number.MAX_SAFE_INTEGER; // 'stop' → no further automatic due
  const decision: SchedulingDecision = {
    policyVersion: DEADLINE_POLICY_VERSION, planId: plan?.id ?? null, policyKind: kind,
    targetDate: plan?.endsAt ?? null, targetRetention: plan?.targetRetention ?? null,
    calculatedAt: reviewedAt, fsrsDueAt: fsrsState.fsrsDueAt ?? fsrsState.dueAt, dueAt,
    predictedRecallAtDeadline: null, reason: 'cadence',
  };
  return { ...fsrsState, dueAt, schedulingDecision: decision };
}
