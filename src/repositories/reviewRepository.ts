import { Rating, State, createEmptyCard, type Card, type Grade } from 'ts-fsrs';
export { createEmptyCard };
import { createMemoryModel, DEFAULT_MEMORY_PROFILE } from '../features/review/memoryModel';
import { scheduledMemory, normalizePlan, applyCadenceAfterReview, DEADLINE_POLICY_VERSION } from '../features/review/deadlineScheduler';
import { loadResolutionContext, resolvePlanForTarget } from './planAssignmentRepository';
import { reconcilePlanExecution } from './planExecutionRepository';
import { db } from '../db/database';
import { newId, now } from '../domain/id';
import { exampleSetIdForTags } from '../domain/examples';
import {
  type ID,
  type LearningState,
  type MemoryState,
  type RetrievalTarget,
  type RetrievalTargetKind,
  type ReviewEvent,
  type ReviewResult,
  type SchedulerGrade,
  type SemesterPlan,
  type StudyPlan,
  type ReviewCadencePolicy,
  type EffectivePlanResolution,
  type PlanExecutionState,
  getTargetNodeLinks,
} from '../domain/types';

export const DEFAULT_SCHEDULER_PROFILE_ID = 'fsrs-6-default';
export const SCHEDULER_VERSION = 'fsrs-6/ts-fsrs-5.4.2';

const FSRS_TO_STATE: Record<State, LearningState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const RESULT_TO_RATING: Record<string, Grade> = {
  missed: Rating.Again,
  forgot: Rating.Again,
  Forgot: Rating.Again,
  partial: Rating.Again,
  Partial: Rating.Again,
  effortful: Rating.Hard,
  clear: Rating.Good,
  recalled: Rating.Good,
  Recalled: Rating.Good,
};

const RESULT_TO_GRADE: Record<string, SchedulerGrade> = {
  missed: 'again',
  forgot: 'again',
  Forgot: 'again',
  partial: 'again',
  Partial: 'again',
  effortful: 'hard',
  clear: 'good',
  recalled: 'good',
  Recalled: 'good',
};

export function cardToMemoryState(targetId: ID, card: Card, timestamp: number): MemoryState {
  return {
    retrievalTargetId: targetId,
    learningState: FSRS_TO_STATE[card.state],
    difficulty: card.difficulty,
    stabilityDays: card.stability,
    dueAt: card.due.getTime(),
    fsrsDueAt: card.due.getTime(),
    retrievability: card.last_review ? 1 : null,
    retrievabilityAsOf: timestamp,
    lastReviewedAt: card.last_review?.getTime() ?? null,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reviewCount: card.reps,
    lapseCount: card.lapses,
    schedulerProfileId: DEFAULT_SCHEDULER_PROFILE_ID,
    schedulerVersion: SCHEDULER_VERSION,
    updatedAt: timestamp,
  };
}

/**
 * @deprecated Legacy global active plan read. Retained for test compatibility only.
 * Production callers must use loadResolutionContext and resolvePlanForTarget.
 */
export async function getActiveStudyPlan(): Promise<StudyPlan | null> {
  const row = await db.semesterPlans.orderBy('updatedAt').last();
  return row ? normalizePlan(row) : null;
}

/** Read a specific study plan by ID. */
export async function getStudyPlan(id: ID): Promise<StudyPlan | null> {
  const row = await db.semesterPlans.get(id);
  return row ? normalizePlan(row) : null;
}

function ensureCadenceStepIds(cadence: ReviewCadencePolicy): ReviewCadencePolicy {
  if (cadence.kind !== 'interval_sequence') return cadence;
  return {
    ...cadence,
    steps: cadence.steps.map(s => ({
      ...s,
      id: s.id || newId(),
    })),
  };
}

export async function createStudyPlan(input: {
  title: string; startsAt?: number | null; endsAt?: number | null;
  cadence: ReviewCadencePolicy; dailyStudyBudgetMinutes?: number | null;
  newTargetLimit?: number | null; targetRetention?: number | null;
}): Promise<StudyPlan> {
  const ts = now();
  const row: SemesterPlan = {
    id: newId(),
    title: input.title.trim() || 'My study plan',
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    cadence: ensureCadenceStepIds(input.cadence),
    newTargetLimit: input.newTargetLimit ?? null,
    targetRetention: input.targetRetention ?? null,
    dailyStudyBudget: input.dailyStudyBudgetMinutes ?? null,
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
  await db.semesterPlans.add(row);
  return normalizePlan(row);
}

export async function updateStudyPlan(
  id: ID,
  changes: Partial<Pick<StudyPlan, 'title' | 'startsAt' | 'endsAt' | 'cadence' | 'dailyStudyBudgetMinutes' | 'newTargetLimit' | 'targetRetention'>>,
): Promise<StudyPlan | undefined> {
  const existing = await db.semesterPlans.get(id);
  if (!existing) return undefined;
  const cadence = changes.cadence ? ensureCadenceStepIds(changes.cadence) : existing.cadence;
  const updated: SemesterPlan = { ...existing, ...changes, ...(cadence ? { cadence } : {}), id, updatedAt: now() };
  await db.semesterPlans.put(updated);
  return normalizePlan(updated);
}

export async function setPlanStatus(id: ID, status: 'active' | 'paused'): Promise<void> {
  await db.semesterPlans.update(id, { status, updatedAt: now() });
}

export async function createRetrievalTarget(data: {
  sourceType: RetrievalTarget['sourceType'];
  sourceId: ID;
  kind?: RetrievalTargetKind;
  promptMarkdown: string;
  expectedEvidenceMarkdown?: string;
  presentation?: RetrievalTarget['presentation'];
  anchor?: RetrievalTarget['anchor'];
  anchors?: RetrievalTarget['anchors'];
}): Promise<RetrievalTarget> {
  const timestamp = now();
  const source = data.sourceType === 'node' ? await db.nodes.get(data.sourceId) : undefined;
  const target: RetrievalTarget = {
    id: newId(),
    kind: data.kind ?? 'atomic_fact',
    ...(source ? { exampleSetId: exampleSetIdForTags(source.tagIds) } : {}),
    status: 'active',
    sourceType: data.sourceType,
    sourceId: data.sourceId,
    promptMarkdown: data.promptMarkdown.trim(),
    expectedEvidenceMarkdown: data.expectedEvidenceMarkdown?.trim() ?? '',
    presentation: data.presentation ?? 'question',
    ...(data.anchor ? { anchor: data.anchor } : {}),
    ...(data.anchors ? { anchors: data.anchors } : {}),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodeLinks: data.sourceType === 'node' ? [{ noteId: data.sourceId, sectionId: (data as any).sectionId ?? data.anchor?.panelId ?? null }] : [],
    ...((data as any).nodeLinks ? { nodeLinks: (data as any).nodeLinks } : {}),
  };
  const emptyCard = createEmptyCard(new Date(timestamp));
  const state = cardToMemoryState(target.id, emptyCard, timestamp);
  await db.transaction('rw', [db.retrievalTargets, db.memoryStates], async () => {
    await db.retrievalTargets.add(target);
    await db.memoryStates.add(state);
  });
  return target;
}

export async function getRetrievalTargetsForSource(
  sourceType: RetrievalTarget['sourceType'],
  sourceId: ID,
): Promise<Array<{ target: RetrievalTarget; state: MemoryState; stepLabel?: string | null }>> {
  let targets: RetrievalTarget[];
  if (sourceType === 'node') {
    // A target belongs to this node if its primary sourceId is sourceId,
    // OR if its nodeLinks collection references this noteId.
    targets = await db.retrievalTargets
      .filter((t) => {
        if (t.status === 'archived') return false;
        if (t.sourceType === 'node' && t.sourceId === sourceId) return true;
        const links = getTargetNodeLinks(t);
        return links.some((l) => l.noteId === sourceId);
      })
      .toArray();
  } else {
    targets = await db.retrievalTargets
      .where('[sourceType+sourceId]')
      .equals([sourceType, sourceId])
      .toArray();
  }

  const states = await db.memoryStates
    .where('retrievalTargetId')
    .anyOf(targets.map((target) => target.id))
    .toArray();
  const stateById = new Map(states.map((state) => [state.retrievalTargetId, state]));
  const ctx = await loadResolutionContext();
  const execStates = await db.planExecutionStates
    .where('retrievalTargetId')
    .anyOf(targets.map((target) => target.id))
    .toArray();
  const execMap = new Map(execStates.map(e => [`${e.retrievalTargetId}:${e.reviewPlanId}`, e]));

  return targets
    .filter((target) => target.status !== 'archived')
    .map((target) => {
      const stored = stateById.get(target.id);
      if (!stored) return undefined!;
      const resolved = resolvePlanForTarget(target, ctx);
      const plan = resolved?.plan ?? null;
      let stepLabel: string | null = null;
      if (plan && plan.cadence.kind === 'interval_sequence' && plan.cadence.steps.length > 0) {
        const exec = execMap.get(`${target.id}:${plan.id}`);
        const total = plan.cadence.steps.length;
        const stepNum = (exec?.stepIndex ?? 0) + 1;
        stepLabel = `${plan.title} · step ${Math.min(stepNum, total)} of ${total}`;
      }
      return {
        target,
        state: scheduledMemory(stored, plan, now()),
        stepLabel,
      };
    })
    .filter((item) => item !== undefined)
    .sort((a, b) => a.state.dueAt - b.state.dueAt);
}

/**
 * Link a RetrievalTarget to a Node (Note > Section), supporting cross-note sharing.
 * Prevents duplicate associations and maintains canonical target identity.
 */
export async function linkTargetToNode(
  targetId: ID,
  noteId: ID,
  sectionId?: string | null,
): Promise<RetrievalTarget> {
  return db.transaction('rw', db.retrievalTargets, async () => {
    const target = await db.retrievalTargets.get(targetId);
    if (!target) throw new Error('Target not found.');
    const links = getTargetNodeLinks(target);
    const key = `${noteId}:${sectionId ?? ''}`;
    if (!links.some(l => `${l.noteId}:${l.sectionId ?? ''}` === key)) {
      links.push({ noteId, sectionId: sectionId ?? null });
    }
    const updated: RetrievalTarget = {
      ...target,
      nodeLinks: links,
      revision: target.revision + 1,
      updatedAt: now(),
    };
    await db.retrievalTargets.put(updated);
    return updated;
  });
}

/**
 * Unlink a RetrievalTarget from a Node.
 * Preserves the target and all its historical ReviewEvents / MemoryState if other
 * Node links remain.
 */
export async function unlinkTargetFromNode(
  targetId: ID,
  noteId: ID,
  sectionId?: string | null,
): Promise<RetrievalTarget> {
  return db.transaction('rw', db.retrievalTargets, async () => {
    const target = await db.retrievalTargets.get(targetId);
    if (!target) throw new Error('Target not found.');
    const links = getTargetNodeLinks(target);
    const targetKey = `${noteId}:${sectionId ?? ''}`;
    const remaining = links.filter(l => `${l.noteId}:${l.sectionId ?? ''}` !== targetKey);

    let nextSourceId = target.sourceId;
    let nextSectionId = target.sectionId;
    if (target.sourceId === noteId && remaining.length > 0) {
      nextSourceId = remaining[0].noteId;
      nextSectionId = remaining[0].sectionId;
    }

    const updated: RetrievalTarget = {
      ...target,
      sourceId: nextSourceId,
      sectionId: nextSectionId,
      nodeLinks: remaining,
      revision: target.revision + 1,
      updatedAt: now(),
    };
    await db.retrievalTargets.put(updated);
    return updated;
  });
}

export async function archiveRetrievalTarget(id: ID): Promise<void> {
  const target = await db.retrievalTargets.get(id);
  if (!target) return;
  await db.retrievalTargets.put({
    ...target,
    status: 'archived',
    revision: target.revision + 1,
    updatedAt: now(),
  });
}

/**
 * Hard delete a RetrievalTarget and atomically clean up its memoryState,
 * reviewEvents, and direct target-level planAssignment.
 * (Note: Soft archive via archiveRetrievalTarget retains the target and assignment for restoration.)
 */
export async function hardDeleteRetrievalTarget(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.retrievalTargets, db.memoryStates, db.reviewEvents, db.planAssignments, db.planExecutionStates],
    async () => {
      await db.planExecutionStates.where('retrievalTargetId').equals(id).delete();
      await db.planAssignments
        .where('[subjectType+subjectId]')
        .equals(['retrieval_target', id])
        .delete();
      await db.reviewEvents.where('retrievalTargetId').equals(id).delete();
      await db.memoryStates.where('retrievalTargetId').equals(id).delete();
      await db.retrievalTargets.delete(id);
    }
  );
}

/** Repair the cue, not the answer or its append-only review history. */
export async function setRetrievalQuestion(id: ID, question: string, expectedRevision: number): Promise<RetrievalTarget> {
  if (!question.trim()) throw new Error('Write a specific question for this passage.');
  return db.transaction('rw', db.retrievalTargets, async () => {
    const target = await db.retrievalTargets.get(id);
    if (!target || target.revision !== expectedRevision) throw new Error('This prompt changed. Reopen it before editing.');
    const next = { ...target, promptMarkdown: question.trim(), presentation: 'question' as const, revision: target.revision + 1, updatedAt: now() };
    await db.retrievalTargets.put(next);
    return next;
  });
}

export interface ReviewQueueItem {
  target: RetrievalTarget;
  state: MemoryState;
  sourceTitle: string;
  retrievability: number | null;
  plan: StudyPlan | null;
  planResolution?: EffectivePlanResolution | null;
  executionState?: PlanExecutionState | null;
}

export function formatPlanProvenance(
  plan: StudyPlan | null,
  executionState?: PlanExecutionState | null,
): string {
  if (!plan) return 'Baseline adaptive';
  if (plan.cadence.kind === 'adaptive_fsrs') {
    return `${plan.title} · Adaptive`;
  }
  if (plan.cadence.kind === 'interval_sequence') {
    const totalSteps = plan.cadence.steps.length;
    const currentStepNum = Math.min((executionState?.stepIndex ?? 0) + 1, totalSteps);
    return `${plan.title} · step ${currentStepNum} of ${totalSteps}`;
  }
  if (plan.cadence.kind === 'fixed_interval') {
    return `${plan.title} · Fixed`;
  }
  return `${plan.title} · Custom`;
}

export async function getReviewQueue(at = now(), targetIds?: ID[], browseAll = false): Promise<ReviewQueueItem[]> {
  let targets: RetrievalTarget[];
  let states: MemoryState[];
  let executionStates: PlanExecutionState[];

  if (targetIds && targetIds.length > 0) {
    [targets, states, executionStates] = await Promise.all([
      db.retrievalTargets.where('id').anyOf(targetIds).filter(t => t.status === 'active').toArray(),
      db.memoryStates.where('retrievalTargetId').anyOf(targetIds).toArray(),
      db.planExecutionStates.where('retrievalTargetId').anyOf(targetIds).toArray(),
    ]);
  } else {
    [targets, states, executionStates] = await Promise.all([
      db.retrievalTargets.where('status').equals('active').toArray(),
      db.memoryStates.toArray(),
      db.planExecutionStates.toArray(),
    ]);
  }

  const stateById = new Map(states.map((state) => [state.retrievalTargetId, state]));
  const executionStateByTargetAndPlan = new Map(executionStates.map((es) => [`${es.retrievalTargetId}:${es.reviewPlanId}`, es]));
  const nodeIds = Array.from(new Set(targets.filter(t => t.sourceType === 'node').map(t => t.sourceId)));
  const mapIds = Array.from(new Set(targets.filter(t => t.sourceType === 'map').map(t => t.sourceId)));

  const [nodes, maps, ctx] = await Promise.all([
    targetIds && targetIds.length > 0 ? db.nodes.where('id').anyOf(nodeIds).toArray() : db.nodes.toArray(),
    targetIds && targetIds.length > 0 ? db.maps.where('id').anyOf(mapIds).toArray() : db.maps.toArray(),
    loadResolutionContext(),
  ]);

  const nodeTitle = new Map(nodes.map((node) => [node.id, node.title]));
  const mapTitle = new Map(maps.map((map) => [map.id, map.title]));
  const model = createMemoryModel();
  const ordered = targets
    .map((target): ReviewQueueItem | null => {
      const storedState = stateById.get(target.id);
      const resolved = resolvePlanForTarget(target, ctx);
      const plan = resolved?.plan ?? null;
      const state = storedState && scheduledMemory(storedState, plan, at, model);
      if (target.exampleSetId && !targetIds && !browseAll) return null;
      if (!state || (targetIds && !targetIds.includes(target.id))) return null;
      if (!targetIds && !browseAll && state.dueAt > at) return null;
      const retrievability = model.recallProbability(state, at);
      return {
        target,
        state,
        sourceTitle: target.sourceType === 'node'
          ? nodeTitle.get(target.sourceId) ?? 'Missing note'
          : target.sourceType === 'map'
            ? mapTitle.get(target.sourceId) ?? 'Missing map'
            : 'Knowledge structure',
        retrievability,
        plan,
        planResolution: resolved,
        executionState: plan ? (executionStateByTargetAndPlan.get(`${target.id}:${plan.id}`) ?? null) : null,
      };
    })
    .filter((item): item is ReviewQueueItem => item !== null)
    .sort((a, b) => {
      const aNew = a.state.learningState === 'new' ? 1 : 0;
      const bNew = b.state.learningState === 'new' ? 1 : 0;
      if (aNew !== bNew) return aNew - bNew;
      if (a.retrievability !== null && b.retrievability !== null) {
        return a.retrievability - b.retrievability;
      }
      return a.state.dueAt - b.state.dueAt;
    });
  const reviewItems = ordered.filter((item) => item.state.learningState !== 'new');
  if (targetIds || browseAll) return ordered;
  const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
  const todaysEvents = await db.reviewEvents.where('reviewedAt').between(dayStart.getTime(), at, true, true).filter(event => !event.exampleSetId).toArray();
  const learnedToday = new Set(todaysEvents.filter(event => event.previousState.learningState === 'new').map(event => event.retrievalTargetId)).size;
  // Per-plan new-prompt limits; unresolved items have no cap.
  const planNewSeen = new Map<string, number>();
  const newItems = ordered
    .filter((item) => item.state.learningState === 'new')
    .filter((item) => {
      const limit = item.plan?.newTargetLimit ?? null;
      if (limit == null) return true;
      const key = item.plan?.id ?? 'none';
      const seen = planNewSeen.get(key) ?? 0;
      if (seen + learnedToday >= limit) return false;
      planNewSeen.set(key, seen + 1);
      return true;
    });
  return [...reviewItems, ...newItems];
}

export async function getLearningOverview(at = now()): Promise<{
  due: number;
  newCount: number;
  learning: number;
  total: number;
  reviewedToday: number;
  nextDueAt: number | null;
}> {
  const startOfDay = new Date(at);
  startOfDay.setHours(0, 0, 0, 0);
  const [allStates, activeTargetsList, todaysEvents, ctx] = await Promise.all([
    db.memoryStates.toArray(),
    db.retrievalTargets.where('status').equals('active').toArray(),
    db.reviewEvents.where('reviewedAt').between(startOfDay.getTime(), at, true, true).toArray(),
    loadResolutionContext(),
  ]);

  const activeTargets = activeTargetsList.filter(target => !target.exampleSetId);
  const reviewedToday = todaysEvents.filter(event => !event.exampleSetId).length;
  const targetById = new Map(activeTargets.map(t => [t.id, t]));
  let due = 0;
  let newCount = 0;
  let learning = 0;
  let nextDueAt: number | null = null;
  const sharedModel = createMemoryModel();

  for (const state of allStates) {
    const target = targetById.get(state.retrievalTargetId);
    if (!target) continue;
    const resolved = resolvePlanForTarget(target, ctx);
    const scheduled = scheduledMemory(state, resolved?.plan ?? null, at, sharedModel);

    if (scheduled.dueAt <= at) due++;
    else if (nextDueAt === null || scheduled.dueAt < nextDueAt) nextDueAt = scheduled.dueAt;

    if (scheduled.learningState === 'new') newCount++;
    else if (scheduled.learningState === 'learning' || scheduled.learningState === 'relearning') learning++;
  }

  return {
    due,
    newCount,
    learning,
    total: activeTargets.length,
    reviewedToday,
    nextDueAt,
  };
}

export async function reviewRetrievalTarget(data: {
  targetId: ID;
  result: ReviewResult;
  responseTimeMs: number;
  sessionId: ID;
  reviewedAt?: number;
  eventId?: ID;
  expectedStateUpdatedAt?: number;
  initialResult?: ReviewResult | null;
  answerRevealedAt?: number | null;
  startedAt?: number;
  hintUsedAt?: number[];
  interruptionCount?: number;
  sourceStatus?: 'current' | 'snapshot';
  targetSnapshot?: ReviewEvent['targetSnapshot'];
}): Promise<ReviewEvent> {
  const reviewedAt = data.reviewedAt ?? now();
  return db.transaction('rw', [db.retrievalTargets, db.memoryStates, db.reviewEvents, db.semesterPlans, db.planAssignments, db.planExecutionStates], async () => {
    const resTarget = await db.retrievalTargets.get(data.targetId);
    const ctx = await loadResolutionContext();
    const resolved = resTarget ? resolvePlanForTarget(resTarget, ctx) : null;
    const plan = resolved?.plan ?? null;
    if (data.eventId) {
      const existing = await db.reviewEvents.get(data.eventId);
      if (existing) {
        if (existing.retrievalTargetId !== data.targetId || existing.sessionId !== data.sessionId) throw new Error('Review submission ID conflicts.');
        return existing;
      }
    }
    const [target, previousState] = await Promise.all([
      db.retrievalTargets.get(data.targetId),
      db.memoryStates.get(data.targetId),
    ]);
    if (!target || !previousState) throw new Error('Review target is missing its learning state.');
    if (target.status !== 'active') throw new Error('This recall prompt is paused or archived.');
    if (data.expectedStateUpdatedAt !== undefined && data.expectedStateUpdatedAt !== previousState.updatedAt) throw new Error('This prompt was updated elsewhere. Reopen or reload to review the latest state.');
    if (!(data.result in RESULT_TO_RATING) || !Number.isFinite(data.responseTimeMs) || data.responseTimeMs < 0 || !Number.isFinite(reviewedAt)) throw new Error('Invalid review feedback.');
    if (data.startedAt !== undefined && (!Number.isFinite(data.startedAt) || data.startedAt > reviewedAt)) throw new Error('Invalid review start time.');
    const hintTimes = data.hintUsedAt ?? [];
    if (hintTimes.some(time => !Number.isFinite(time) || time > reviewedAt || (data.startedAt !== undefined && time < data.startedAt))) throw new Error('Invalid hint time.');
    if (data.answerRevealedAt != null && (!Number.isFinite(data.answerRevealedAt) || data.answerRevealedAt > reviewedAt || (data.startedAt !== undefined && data.answerRevealedAt < data.startedAt))) throw new Error('Invalid reveal time.');
    if (previousState.lastReviewedAt !== null && reviewedAt < previousState.lastReviewedAt) throw new Error('Review time cannot precede the previous review.');
    const model = createMemoryModel();
    // Partial means incomplete / assisted recall, not FSRS Hard (successful effortful recall).
    const grade = RESULT_TO_GRADE[data.result];
    const rating = RESULT_TO_RATING[data.result];
    const card = model.review(previousState, reviewedAt, rating);

    let resultingState: MemoryState;
    if (plan && plan.cadence.kind === 'interval_sequence' && resolved?.assignmentId && plan.cadence.steps.length > 0) {
      let execState = await db.planExecutionStates
        .where('[retrievalTargetId+reviewPlanId]')
        .equals([target.id, plan.id])
        .first();

      if (!execState) {
        const firstStep = plan.cadence.steps[0];
        execState = {
          id: newId(),
          retrievalTargetId: target.id,
          reviewPlanId: plan.id,
          effectiveAssignmentId: resolved.assignmentId,
          currentStepId: firstStep?.id,
          stepIndex: 0,
          startedAt: reviewedAt,
          lastAdvancedAt: null,
          completedAt: null,
          updatedAt: reviewedAt,
        };
      } else {
        execState = reconcilePlanExecution(execState, plan);
        if (execState.effectiveAssignmentId !== resolved.assignmentId) {
          execState.effectiveAssignmentId = resolved.assignmentId;
        }
      }

      const isLapse = data.result === 'missed';
      const isPartial = data.result === 'partial' || (hintTimes.length > 0 && data.result === 'recalled');
      const isSuccess = !isLapse && !isPartial && (data.result === 'recalled' || data.result === 'clear' || data.result === 'effortful');

      if (execState.completedAt && plan.cadence.afterSequence === 'stop') {
        // Stop sequence already completed: no further automatic due
        execState.updatedAt = reviewedAt;
        await db.planExecutionStates.put(execState);
        const fsrsState = cardToMemoryState(target.id, card, reviewedAt);
        resultingState = {
          ...fsrsState,
          dueAt: Number.MAX_SAFE_INTEGER,
          schedulingDecision: {
            policyVersion: DEADLINE_POLICY_VERSION,
            planId: plan.id,
            policyKind: 'interval_sequence',
            targetDate: plan.endsAt ?? null,
            targetRetention: plan.targetRetention ?? null,
            calculatedAt: reviewedAt,
            fsrsDueAt: fsrsState.fsrsDueAt ?? fsrsState.dueAt,
            dueAt: Number.MAX_SAFE_INTEGER,
            predictedRecallAtDeadline: null,
            reason: 'cadence',
          },
        };
      } else if (isLapse || isPartial) {
        // Lapse or assisted recall: cursor NEVER advances. In FSRS relearning, card.due is the immediate micro-step
        execState.updatedAt = reviewedAt;
        await db.planExecutionStates.put(execState);
        const fsrsState = cardToMemoryState(target.id, card, reviewedAt);
        const dueAt = card.due.getTime();
        resultingState = {
          ...fsrsState,
          dueAt,
          schedulingDecision: {
            policyVersion: DEADLINE_POLICY_VERSION,
            planId: plan.id,
            policyKind: 'interval_sequence',
            targetDate: plan.endsAt ?? null,
            targetRetention: plan.targetRetention ?? null,
            calculatedAt: reviewedAt,
            fsrsDueAt: fsrsState.fsrsDueAt ?? fsrsState.dueAt,
            dueAt,
            predictedRecallAtDeadline: null,
            reason: 'cadence',
          },
        };
      } else if (isSuccess) {
        // Successful macro review
        const isEarly = previousState.learningState !== 'new' && (previousState.dueAt - reviewedAt > 4 * 3600 * 1000);
        if (isEarly) {
          // Same-day early review before due: does not advance sequence step
          execState.updatedAt = reviewedAt;
          await db.planExecutionStates.put(execState);
          resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, execState.stepIndex);
        } else if (execState.lastAdvancedAt === null) {
          // First macro review under this sequence: schedule step 0
          execState.stepIndex = 0;
          execState.currentStepId = plan.cadence.steps[0]?.id;
          execState.lastAdvancedAt = reviewedAt;
          execState.updatedAt = reviewedAt;
          await db.planExecutionStates.put(execState);
          resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, 0);
        } else {
          // Completed the current step: advance cursor
          const nextIndex = execState.stepIndex + 1;
          if (nextIndex < plan.cadence.steps.length) {
            execState.stepIndex = nextIndex;
            execState.currentStepId = plan.cadence.steps[nextIndex].id;
            execState.lastAdvancedAt = reviewedAt;
            execState.updatedAt = reviewedAt;
            await db.planExecutionStates.put(execState);
            resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, nextIndex);
          } else {
            // Reached end of sequence
            if (plan.cadence.afterSequence === 'stop') {
              execState.completedAt = reviewedAt;
              execState.lastAdvancedAt = reviewedAt;
              execState.updatedAt = reviewedAt;
              await db.planExecutionStates.put(execState);
              const fsrsState = cardToMemoryState(target.id, card, reviewedAt);
              resultingState = {
                ...fsrsState,
                dueAt: Number.MAX_SAFE_INTEGER,
                schedulingDecision: {
                  policyVersion: DEADLINE_POLICY_VERSION,
                  planId: plan.id,
                  policyKind: 'interval_sequence',
                  targetDate: plan.endsAt ?? null,
                  targetRetention: plan.targetRetention ?? null,
                  calculatedAt: reviewedAt,
                  fsrsDueAt: fsrsState.fsrsDueAt ?? fsrsState.dueAt,
                  dueAt: Number.MAX_SAFE_INTEGER,
                  predictedRecallAtDeadline: null,
                  reason: 'cadence',
                },
              };
            } else if (plan.cadence.afterSequence === 'repeat_last') {
              const lastIdx = plan.cadence.steps.length - 1;
              execState.stepIndex = lastIdx;
              execState.currentStepId = plan.cadence.steps[lastIdx].id;
              execState.lastAdvancedAt = reviewedAt;
              execState.updatedAt = reviewedAt;
              await db.planExecutionStates.put(execState);
              resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, lastIdx);
            } else {
              // loop
              execState.stepIndex = 0;
              execState.currentStepId = plan.cadence.steps[0].id;
              execState.lastAdvancedAt = reviewedAt;
              execState.updatedAt = reviewedAt;
              await db.planExecutionStates.put(execState);
              resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, 0);
            }
          }
        }
      } else {
        resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt, execState.stepIndex);
      }
    } else {
      resultingState = applyCadenceAfterReview(cardToMemoryState(target.id, card, reviewedAt), plan, reviewedAt);
    }
    const event: ReviewEvent = {
      id: data.eventId ?? newId(),
      ...(target.exampleSetId ? { exampleSetId: target.exampleSetId } : {}),
      retrievalTargetId: target.id,
      targetRevision: target.revision,
      sessionId: data.sessionId,
      reviewedAt,
      responseTimeMs: Math.max(0, data.responseTimeMs),
      rawResult: data.result,
      schedulerGrade: grade,
      scheduledDueAtBefore: scheduledMemory(previousState, plan, reviewedAt).dueAt,
      previousState,
      resultingState,
      schedulerProfileId: DEFAULT_SCHEDULER_PROFILE_ID,
      schedulerVersion: SCHEDULER_VERSION,
      protocolVersion: 'recall-self-assessment/3',
      presentation: target.presentation ?? 'question',
      initialResult: data.initialResult ?? null,
      answerRevealedAt: data.answerRevealedAt ?? null,
      ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
      hintUsedAt: hintTimes,
      hintUsed: hintTimes.length > 0,
      answerRevealed: data.answerRevealedAt != null,
      memoryProfile: structuredClone(DEFAULT_MEMORY_PROFILE),
      schedulingDecision: resultingState.schedulingDecision,
      interruptionCount: Math.max(0, data.interruptionCount ?? 0),
      sourceStatus: data.sourceStatus ?? 'current',
      targetSnapshot: data.targetSnapshot ?? { promptMarkdown: target.promptMarkdown, expectedEvidenceMarkdown: target.expectedEvidenceMarkdown, presentation: target.presentation, ...(target.anchor ? { anchor: target.anchor } : {}), ...(target.anchors ? { anchors: target.anchors } : {}) },
      schedulerConfig: { desiredRetention: model.profile.requestRetention, maximumIntervalDays: model.profile.maximumIntervalDays, enableFuzz: false },
    };
    await db.reviewEvents.add(event);
    await db.memoryStates.put(resultingState);
    return event;
  });
}

export async function getReviewHistory(targetId: ID): Promise<ReviewEvent[]> {
  const events = await db.reviewEvents.where('retrievalTargetId').equals(targetId).toArray();
  return events.sort((a, b) => b.reviewedAt - a.reviewedAt);
}

export interface HistoryQueryOptions {
  since?: number;
  until?: number;
  limit?: number;
}

/** The only history feed intended for future personal parameter fitting. */
export async function getPersonalizationHistory(options?: HistoryQueryOptions): Promise<ReviewEvent[]> {
  const exampleTargets = await db.retrievalTargets.filter(target => !!target.exampleSetId).toArray();
  const exampleTargetIds = exampleTargets.length > 0 ? new Set(exampleTargets.map(target => target.id)) : null;

  let events: ReviewEvent[];
  if (options?.since !== undefined && options?.until !== undefined) {
    events = await db.reviewEvents.where('reviewedAt').between(options.since, options.until, true, true).toArray();
  } else if (options?.since !== undefined) {
    events = await db.reviewEvents.where('reviewedAt').aboveOrEqual(options.since).toArray();
  } else if (options?.until !== undefined) {
    events = await db.reviewEvents.where('reviewedAt').belowOrEqual(options.until).toArray();
  } else {
    // Unbounded: use orderBy('reviewedAt') index directly
    events = await db.reviewEvents.orderBy('reviewedAt').toArray();
  }

  const filtered = events
    .filter(event => !event.exampleSetId && (!exampleTargetIds || !exampleTargetIds.has(event.retrievalTargetId)))
    .sort((a, b) => a.reviewedAt - b.reviewedAt);

  if (options?.limit) return filtered.slice(-options.limit);
  return filtered;
}
