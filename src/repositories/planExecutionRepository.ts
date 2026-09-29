import { db } from '../db/database';
import { newId, now } from '../domain/id';
import type { ID, PlanExecutionState, StudyPlan } from '../domain/types';

/** Load all execution state records. */
export async function listPlanExecutionStates(): Promise<PlanExecutionState[]> {
  return db.planExecutionStates.toArray();
}

/** Get the execution state for a specific target under a specific plan. */
export async function getPlanExecutionState(
  retrievalTargetId: ID,
  reviewPlanId: ID,
): Promise<PlanExecutionState | undefined> {
  return db.planExecutionStates
    .where('[retrievalTargetId+reviewPlanId]')
    .equals([retrievalTargetId, reviewPlanId])
    .first();
}

/** Get all execution states for a specific target across plans. */
export async function getExecutionStatesForTarget(retrievalTargetId: ID): Promise<PlanExecutionState[]> {
  return db.planExecutionStates.where('retrievalTargetId').equals(retrievalTargetId).toArray();
}

/**
 * Reconciles an existing PlanExecutionState against a potentially edited ReviewPlan.
 * - Uses stable step identity (currentStepId) so prepending/reordering steps does not teleport targets.
 * - If currentStepId was deleted or missing, snaps deterministically to a valid step boundary.
 */
export function reconcilePlanExecution(
  state: PlanExecutionState,
  plan: StudyPlan,
): PlanExecutionState {
  if (plan.cadence.kind !== 'interval_sequence') return state;
  const steps = plan.cadence.steps;
  if (!steps || steps.length === 0) {
    return { ...state, stepIndex: 0, currentStepId: undefined };
  }

  // 1. Match by stable step ID
  if (state.currentStepId) {
    const idx = steps.findIndex(s => s.id === state.currentStepId);
    if (idx !== -1) {
      if (state.stepIndex !== idx) {
        return { ...state, stepIndex: idx };
      }
      return state;
    }
  }

  // 2. Deterministic fallback if step was deleted or ID unset: clamp to valid index
  const safeIndex = Math.min(Math.max(0, state.stepIndex), steps.length - 1);
  return {
    ...state,
    stepIndex: safeIndex,
    currentStepId: steps[safeIndex]?.id,
  };
}

/**
 * Get or initialize the execution state for a target under an effective plan.
 * A new assignment always starts at stepIndex = 0 regardless of historical FSRS reps.
 */
export async function getOrCreateExecutionState(
  retrievalTargetId: ID,
  plan: StudyPlan,
  assignmentId: ID,
  nowTs = now(),
): Promise<PlanExecutionState> {
  const existing = await db.planExecutionStates
    .where('[retrievalTargetId+reviewPlanId]')
    .equals([retrievalTargetId, plan.id])
    .first();

  if (existing) {
    const reconciled = reconcilePlanExecution(existing, plan);
    if (reconciled.effectiveAssignmentId !== assignmentId) {
      reconciled.effectiveAssignmentId = assignmentId;
      reconciled.updatedAt = nowTs;
      await db.planExecutionStates.put(reconciled);
    }
    return reconciled;
  }

  const steps = plan.cadence.kind === 'interval_sequence' ? plan.cadence.steps : [];
  const firstStep = steps[0];
  const newState: PlanExecutionState = {
    id: newId(),
    retrievalTargetId,
    reviewPlanId: plan.id,
    effectiveAssignmentId: assignmentId,
    currentStepId: firstStep?.id,
    stepIndex: 0,
    startedAt: nowTs,
    lastAdvancedAt: null,
    completedAt: null,
    updatedAt: nowTs,
  };
  await db.planExecutionStates.add(newState);
  return newState;
}

/** Reset execution state to start of sequence (e.g. On explicit restart). */
export async function resetExecutionState(
  retrievalTargetId: ID,
  plan: StudyPlan,
  assignmentId: ID,
  nowTs = now(),
): Promise<PlanExecutionState> {
  const steps = plan.cadence.kind === 'interval_sequence' ? plan.cadence.steps : [];
  const firstStep = steps[0];
  const existing = await getPlanExecutionState(retrievalTargetId, plan.id);
  const updated: PlanExecutionState = {
    id: existing?.id ?? newId(),
    retrievalTargetId,
    reviewPlanId: plan.id,
    effectiveAssignmentId: assignmentId,
    currentStepId: firstStep?.id,
    stepIndex: 0,
    startedAt: nowTs,
    lastAdvancedAt: null,
    completedAt: null,
    updatedAt: nowTs,
  };
  await db.planExecutionStates.put(updated);
  return updated;
}

/** Save an execution state row. */
export async function saveExecutionState(state: PlanExecutionState): Promise<void> {
  await db.planExecutionStates.put(state);
}

/** Delete all execution states for a specific retrieval target. */
export async function deleteExecutionStatesForTarget(retrievalTargetId: ID): Promise<void> {
  await db.planExecutionStates.where('retrievalTargetId').equals(retrievalTargetId).delete();
}

/** Delete all execution states for multiple retrieval targets. */
export async function deleteExecutionStatesForTargets(retrievalTargetIds: ID[]): Promise<void> {
  if (retrievalTargetIds.length === 0) return;
  await db.planExecutionStates.where('retrievalTargetId').anyOf(retrievalTargetIds).delete();
}

/** Delete all execution states associated with a deleted review plan. */
export async function deleteExecutionStatesForPlan(reviewPlanId: ID): Promise<void> {
  await db.planExecutionStates.where('reviewPlanId').equals(reviewPlanId).delete();
}
