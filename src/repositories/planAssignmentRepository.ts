import { db } from '../db/database';
import { normalizePlan } from '../features/review/deadlineScheduler';
import { newId, now } from '../domain/id';
import type {
  AssignmentSubjectType, EffectivePlanResolution, PlanAssignment, PlanResolutionSource, RetrievalTarget, SemesterPlan, StudyPlan,
} from '../domain/types';

export async function listAssignments(): Promise<PlanAssignment[]> {
  return db.planAssignments.toArray();
}

export async function getAssignment(subjectType: AssignmentSubjectType, subjectId: string, sectionId?: string): Promise<PlanAssignment | undefined> {
  const all = await db.planAssignments.where('[subjectType+subjectId]').equals([subjectType, subjectId]).toArray();
  return all.find(a => (a.sectionId ?? undefined) === (sectionId ?? undefined));
}

/**
 * When an assignment is removed or changed, checks if any affected PlanExecutionStates
 * still resolve to the same reviewPlanId under remaining assignments (e.g. falling back
 * from Section to Node assignment). If so, updates effectiveAssignmentId to preserve progress;
 * otherwise deletes the execution state to prevent orphans.
 */
export async function reconcileOrDeleteExecutionStatesForAssignment(
  assignmentId: string,
  remainingAssignments: PlanAssignment[],
): Promise<void> {
  const affected = await db.planExecutionStates.where('effectiveAssignmentId').equals(assignmentId).toArray();
  if (affected.length === 0) return;

  const plansRows = await db.semesterPlans.toArray();
  const plans = new Map(plansRows.map(p => [p.id, normalizePlan(p)]));

  for (const exec of affected) {
    const target = await db.retrievalTargets.get(exec.retrievalTargetId);
    if (!target) {
      await db.planExecutionStates.delete(exec.id);
      continue;
    }
    const resolution = resolveEffectivePlan(target, remainingAssignments, plans);
    if (resolution.plan && resolution.plan.id === exec.reviewPlanId && resolution.assignmentId) {
      // Re-link to surviving assignment that shares the same effective plan, preserving progress!
      exec.effectiveAssignmentId = resolution.assignmentId;
      await db.planExecutionStates.put(exec);
    } else {
      await db.planExecutionStates.delete(exec.id);
    }
  }
}

/** Apply (or replace) a plan binding for a subject. Pass reviewPlanId=null to remove. */
export async function setAssignment(input: {
  reviewPlanId: string | null;
  subjectType: AssignmentSubjectType;
  subjectId: string;
  sectionId?: string;
  status?: 'active' | 'paused';
  startsAt?: number | null;
  endsAt?: number | null;
}): Promise<PlanAssignment | undefined> {
  return db.transaction('rw', [db.planAssignments, db.planExecutionStates, db.retrievalTargets, db.semesterPlans], async () => {
    const all = await db.planAssignments
      .where('[subjectType+subjectId]')
      .equals([input.subjectType, input.subjectId])
      .toArray();
    const matches = all.filter(a => (a.sectionId ?? undefined) === (input.sectionId ?? undefined));
    const existing = matches[0];

    // Clean up any extraneous duplicate matches for this concrete subject
    if (matches.length > 1) {
      const dupIds = matches.slice(1).map(m => m.id);
      const remaining = (await db.planAssignments.toArray()).filter(a => !dupIds.includes(a.id));
      for (const dupId of dupIds) {
        await reconcileOrDeleteExecutionStatesForAssignment(dupId, remaining);
      }
      await db.planAssignments.bulkDelete(dupIds);
    }

    const nextStartsAt = input.startsAt !== undefined ? input.startsAt : (existing?.startsAt ?? null);
    const nextEndsAt = input.endsAt !== undefined ? input.endsAt : (existing?.endsAt ?? null);
    const hasDeadline = nextStartsAt != null || nextEndsAt != null;
    const newReviewPlanId = input.reviewPlanId !== undefined ? input.reviewPlanId : (existing?.reviewPlanId ?? null);

    // If reviewPlanId is null and no local planning fields (deadline/startsAt), no assignment row should exist
    if (!newReviewPlanId && !hasDeadline) {
      if (existing) {
        const remaining = (await db.planAssignments.toArray()).filter(a => a.id !== existing.id);
        await reconcileOrDeleteExecutionStatesForAssignment(existing.id, remaining);
        await db.planAssignments.delete(existing.id);
      }
      return undefined;
    }

    if (existing) {
      // If replacing the plan on an existing assignment (reviewPlanId changed),
      // reconcile or delete PlanExecutionState rows referencing this assignment.
      if (existing.reviewPlanId !== newReviewPlanId) {
        const allAssignments = await db.planAssignments.toArray();
        const updatedMock: PlanAssignment = { ...existing, reviewPlanId: newReviewPlanId };
        const remaining = allAssignments.map(a => a.id === existing.id ? updatedMock : a);
        await reconcileOrDeleteExecutionStatesForAssignment(existing.id, remaining);
      }

      const updated: PlanAssignment = {
        ...existing,
        reviewPlanId: newReviewPlanId,
        status: input.status ?? existing.status,
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        updatedAt: now(),
      };
      await db.planAssignments.put(updated);
      
      if (newReviewPlanId) {
        const allAssignments = await db.planAssignments.toArray();
        const plansRows = await db.semesterPlans.toArray();
        const plansMap = new Map(plansRows.map(p => [p.id, normalizePlan(p)]));
        const targetExecs = await db.planExecutionStates.where('reviewPlanId').equals(newReviewPlanId).toArray();
        for (const exec of targetExecs) {
          const target = await db.retrievalTargets.get(exec.retrievalTargetId);
          if (target) {
            const res = resolveEffectivePlan(target, allAssignments, plansMap);
            if (res.assignmentId && exec.effectiveAssignmentId !== res.assignmentId && res.plan?.id === exec.reviewPlanId) {
              exec.effectiveAssignmentId = res.assignmentId;
              await db.planExecutionStates.put(exec);
            }
          }
        }
      }
      return updated;
    }

    const row: PlanAssignment = {
      id: newId(),
      reviewPlanId: newReviewPlanId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      sectionId: input.sectionId,
      status: input.status ?? 'active',
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.planAssignments.add(row);

    if (newReviewPlanId) {
      const allAssignments = await db.planAssignments.toArray();
      const plansRows = await db.semesterPlans.toArray();
      const plansMap = new Map(plansRows.map(p => [p.id, normalizePlan(p)]));
      const targetExecs = await db.planExecutionStates.where('reviewPlanId').equals(newReviewPlanId).toArray();
      for (const exec of targetExecs) {
        const target = await db.retrievalTargets.get(exec.retrievalTargetId);
        if (target) {
          const res = resolveEffectivePlan(target, allAssignments, plansMap);
          if (res.assignmentId && exec.effectiveAssignmentId !== res.assignmentId && res.plan?.id === exec.reviewPlanId) {
            exec.effectiveAssignmentId = res.assignmentId;
            await db.planExecutionStates.put(exec);
          }
        }
      }
    }
    return row;
  });
}

export async function setAssignmentStatus(id: string, status: 'active' | 'paused'): Promise<void> {
  await db.planAssignments.update(id, { status, updatedAt: now() });
}

export async function deleteAssignmentsForPlan(reviewPlanId: string): Promise<void> {
  await db.transaction('rw', [db.planAssignments, db.planExecutionStates], async () => {
    const assignments = await db.planAssignments.where('reviewPlanId').equals(reviewPlanId).toArray();
    const assignmentIds = assignments.map(a => a.id);
    if (assignmentIds.length > 0) {
      await db.planExecutionStates.where('effectiveAssignmentId').anyOf(assignmentIds).delete();
    }
    await db.planExecutionStates.where('reviewPlanId').equals(reviewPlanId).delete();
    await db.planAssignments.where('reviewPlanId').equals(reviewPlanId).delete();
  });
}

/** Atomically delete a review plan and all its assignments and execution states in a single transaction. */
export async function deleteStudyPlan(reviewPlanId: string): Promise<void> {
  await db.transaction('rw', [db.semesterPlans, db.planAssignments, db.planExecutionStates], async () => {
    const assignments = await db.planAssignments.where('reviewPlanId').equals(reviewPlanId).toArray();
    const assignmentIds = assignments.map(a => a.id);
    if (assignmentIds.length > 0) {
      await db.planExecutionStates.where('effectiveAssignmentId').anyOf(assignmentIds).delete();
    }
    await db.planExecutionStates.where('reviewPlanId').equals(reviewPlanId).delete();
    await db.planAssignments.where('reviewPlanId').equals(reviewPlanId).delete();
    await db.semesterPlans.delete(reviewPlanId);
  });
}

export async function countAssignmentsForPlan(reviewPlanId: string): Promise<number> {
  return db.planAssignments.where('reviewPlanId').equals(reviewPlanId).count();
}

/** Load all plans (the reusable library). */
export async function listStudyPlans(): Promise<StudyPlan[]> {
  const rows = await db.semesterPlans.orderBy('updatedAt').reverse().toArray();
  return rows.map(normalizePlan);
}

/** Get a single study plan by ID. */
export async function getStudyPlan(id: string): Promise<StudyPlan | null> {
  const row = await db.semesterPlans.get(id);
  return row ? normalizePlan(row) : null;
}

// ---------------------------------------------------------------------------
// Resolution: retrieval target → at most one operational plan.
// Precedence: retrieval_target assignment > section assignment > node assignment
// > none (baseline adaptive FSRS). Paused assignments do not schedule.
// Indexed in-memory context ensures O(T + A) rather than O(T * A) resolution.
// ---------------------------------------------------------------------------

export interface ResolvedPlan {
  plan: StudyPlan;
  assignmentId: string;
  source?: PlanResolutionSource;
  paused?: boolean;
}

export interface ResolutionContext {
  assignments: PlanAssignment[];
  plans: Map<string, StudyPlan>;
  targetAssignments: Map<string, PlanAssignment>;
  sectionAssignments: Map<string, PlanAssignment>;
  nodeAssignments: Map<string, PlanAssignment>;
}

export function buildResolutionContext(
  assignments: PlanAssignment[],
  plansInput: Map<string, StudyPlan> | SemesterPlan[],
): ResolutionContext {
  let plans: Map<string, StudyPlan>;
  if (plansInput instanceof Map) {
    plans = plansInput;
  } else {
    plans = new Map<string, StudyPlan>();
    for (const r of plansInput) {
      plans.set(r.id, normalizePlan(r));
    }
  }

  const targetAssignments = new Map<string, PlanAssignment>();
  const sectionAssignments = new Map<string, PlanAssignment>();
  const nodeAssignments = new Map<string, PlanAssignment>();

  for (const a of assignments) {
    if (a.subjectType === 'retrieval_target') {
      targetAssignments.set(a.subjectId, a);
    } else if (a.subjectType === 'section' && a.sectionId) {
      sectionAssignments.set(`${a.subjectId}:${a.sectionId}`, a);
    } else if (a.subjectType === 'node') {
      nodeAssignments.set(a.subjectId, a);
    }
  }

  return {
    assignments,
    plans,
    targetAssignments,
    sectionAssignments,
    nodeAssignments,
  };
}

export async function loadResolutionContext(): Promise<ResolutionContext> {
  const [rows, assignments] = await Promise.all([
    db.semesterPlans.toArray(),
    db.planAssignments.toArray(),
  ]);
  return buildResolutionContext(assignments, rows as SemesterPlan[]);
}

function baselineAdaptivePlan(assignmentId: string, endsAt: number | null, startsAt: number | null): StudyPlan {
  const ts = now();
  return {
    id: assignmentId, title: 'Adaptive (FSRS)', startsAt, endsAt,
    cadence: { kind: 'adaptive_fsrs' }, dailyStudyBudgetMinutes: null, newTargetLimit: null,
    targetRetention: null, status: 'active', createdAt: ts, updatedAt: ts,
  };
}

function resolveAssignmentCandidate(
  assignment: PlanAssignment | undefined,
  plans: Map<string, StudyPlan>,
  source: PlanResolutionSource,
): EffectivePlanResolution | null {
  if (!assignment) return null;
  const isAssignmentPaused = assignment.status === 'paused';
  const stored = assignment.reviewPlanId ? plans.get(assignment.reviewPlanId) : undefined;
  const isPlanPaused = stored ? stored.status === 'paused' : false;
  const paused = isAssignmentPaused || isPlanPaused;

  const endsAt = assignment.endsAt !== undefined && assignment.endsAt !== null ? assignment.endsAt : (stored?.endsAt ?? null);
  const startsAt = assignment.startsAt !== undefined && assignment.startsAt !== null ? assignment.startsAt : (stored?.startsAt ?? null);

  if (!stored) {
    if (endsAt === null && startsAt === null) {
      return {
        plan: null,
        source,
        assignmentId: assignment.id,
        paused,
      };
    }
    return {
      plan: baselineAdaptivePlan(assignment.id, endsAt, startsAt),
      source,
      assignmentId: assignment.id,
      paused,
    };
  }

  const plan: StudyPlan = { ...stored, startsAt, endsAt };
  return {
    plan,
    source,
    assignmentId: assignment.id,
    paused,
  };
}

export function resolveEffectivePlan(
  target: RetrievalTarget,
  contextOrAssignments: ResolutionContext | PlanAssignment[],
  maybePlans?: Map<string, StudyPlan>,
): EffectivePlanResolution {
  if (target.sourceType !== 'node') {
    return { plan: null, source: 'baseline', paused: false };
  }

  const ctx = Array.isArray(contextOrAssignments)
    ? buildResolutionContext(contextOrAssignments, maybePlans ?? new Map())
    : contextOrAssignments;

  // 1. Direct retrieval_target assignment
  const targetMatch = resolveAssignmentCandidate(ctx.targetAssignments.get(target.id), ctx.plans, 'target');
  if (targetMatch) return targetMatch;

  // 2. Section assignment
  const panelId = target.anchor?.panelId ?? target.anchors?.[0]?.panelId;
  if (panelId) {
    const sectionMatch = resolveAssignmentCandidate(
      ctx.sectionAssignments.get(`${target.sourceId}:${panelId}`),
      ctx.plans,
      'section',
    );
    if (sectionMatch) return sectionMatch;
  }

  // 3. Node assignment
  const nodeMatch = resolveAssignmentCandidate(
    ctx.nodeAssignments.get(target.sourceId),
    ctx.plans,
    'node',
  );
  if (nodeMatch) return nodeMatch;

  // 4. Baseline
  return { plan: null, source: 'baseline', paused: false };
}

export function resolveEffectivePlanForSubject(
  subjectType: AssignmentSubjectType,
  subjectId: string,
  sectionId?: string,
  nodeId?: string,
  contextOrAssignments?: ResolutionContext | PlanAssignment[],
  maybePlans?: Map<string, StudyPlan>,
): EffectivePlanResolution {
  if (!contextOrAssignments) {
    return { plan: null, source: 'baseline', paused: false };
  }
  const ctx = Array.isArray(contextOrAssignments)
    ? buildResolutionContext(contextOrAssignments, maybePlans ?? new Map())
    : contextOrAssignments;

  if (subjectType === 'retrieval_target') {
    const targetMatch = resolveAssignmentCandidate(ctx.targetAssignments.get(subjectId), ctx.plans, 'target');
    if (targetMatch) return targetMatch;
    if (nodeId && sectionId) {
      const sectionMatch = resolveAssignmentCandidate(ctx.sectionAssignments.get(`${nodeId}:${sectionId}`), ctx.plans, 'section');
      if (sectionMatch) return sectionMatch;
    }
    if (nodeId) {
      const nodeMatch = resolveAssignmentCandidate(ctx.nodeAssignments.get(nodeId), ctx.plans, 'node');
      if (nodeMatch) return nodeMatch;
    }
    return { plan: null, source: 'baseline', paused: false };
  }

  if (subjectType === 'section') {
    if (sectionId) {
      const sectionMatch = resolveAssignmentCandidate(ctx.sectionAssignments.get(`${subjectId}:${sectionId}`), ctx.plans, 'section');
      if (sectionMatch) return sectionMatch;
    }
    const nodeMatch = resolveAssignmentCandidate(ctx.nodeAssignments.get(subjectId), ctx.plans, 'node');
    if (nodeMatch) return nodeMatch;
    return { plan: null, source: 'baseline', paused: false };
  }

  if (subjectType === 'node') {
    const nodeMatch = resolveAssignmentCandidate(ctx.nodeAssignments.get(subjectId), ctx.plans, 'node');
    if (nodeMatch) return nodeMatch;
    return { plan: null, source: 'baseline', paused: false };
  }

  return { plan: null, source: 'baseline', paused: false };
}

export function resolvePlanForTarget(
  target: RetrievalTarget,
  contextOrAssignments: ResolutionContext | PlanAssignment[],
  maybePlans?: Map<string, StudyPlan>,
): (ResolvedPlan & { source: PlanResolutionSource; paused?: boolean }) | null {
  const effective = resolveEffectivePlan(target, contextOrAssignments, maybePlans);
  if (effective.paused || !effective.plan) return null;
  return {
    plan: effective.plan,
    assignmentId: effective.assignmentId ?? 'baseline',
    source: effective.source,
    paused: effective.paused,
  };
}

/** Resolve the plan governing a whole node (for UI display / inheritance). */
export function resolvePlanForNode(
  nodeId: string,
  contextOrAssignments: ResolutionContext | PlanAssignment[],
  maybePlans?: Map<string, StudyPlan>,
): (ResolvedPlan & { source: PlanResolutionSource; paused?: boolean }) | null {
  const ctx = Array.isArray(contextOrAssignments)
    ? buildResolutionContext(contextOrAssignments, maybePlans ?? new Map())
    : contextOrAssignments;
  const match = resolveAssignmentCandidate(ctx.nodeAssignments.get(nodeId), ctx.plans, 'node');
  if (!match || match.paused || !match.plan) return null;
  return {
    plan: match.plan,
    assignmentId: match.assignmentId ?? 'baseline',
    source: match.source,
    paused: match.paused,
  };
}
