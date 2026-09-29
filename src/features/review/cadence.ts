import type { IntervalStep, ReviewCadencePolicy } from '../../domain/types';

/** Calendar-aware interval arithmetic. A month is NOT 30 days. */
export function addInterval(from: number, step: IntervalStep): number {
  const d = new Date(from);
  if (step.unit === 'day') d.setDate(d.getDate() + step.value);
  else if (step.unit === 'week') d.setDate(d.getDate() + step.value * 7);
  else d.setMonth(d.getMonth() + step.value);
  return +d;
}

/**
 * The next due time for a card just reviewed at `reviewedAt`, given the active
 * cadence policy and current sequence `stepIndex` (0-indexed).
 * Returns null for `stop` after the sequence ends (no further automatic due).
 */
export function nextCadenceDue(policy: ReviewCadencePolicy, stepIndex: number, reviewedAt: number): number | null {
  if (policy.kind === 'fixed_interval') {
    return addInterval(reviewedAt, policy.interval);
  }
  if (policy.kind === 'interval_sequence') {
    const { steps, afterSequence } = policy;
    if (steps.length === 0) return null;
    if (stepIndex < steps.length) {
      return addInterval(reviewedAt, steps[stepIndex]);
    }
    if (afterSequence === 'stop') return null;
    if (afterSequence === 'repeat_last') return addInterval(reviewedAt, steps[steps.length - 1]);
    // loop
    return addInterval(reviewedAt, steps[stepIndex % steps.length]);
  }
  return null;
}

/** Human-readable cadence summary for the Plan status line. */
export function describeCadence(policy: ReviewCadencePolicy): string {
  if (!policy || policy.kind === 'adaptive_fsrs') return 'Adaptive';
  if (policy.kind === 'fixed_interval') return `Fixed · every ${policy.interval.value} ${policy.interval.unit}${policy.interval.value === 1 ? '' : 's'}`;
  if (policy.kind === 'interval_sequence' && Array.isArray(policy.steps)) {
    const seq = policy.steps.map(s => `${s.value}${s.unit === 'day' ? 'd' : s.unit === 'week' ? 'w' : 'm'}`).join(' → ');
    const tail = policy.afterSequence === 'loop' ? ' ↻' : policy.afterSequence === 'repeat_last' ? ' · repeat last' : ' · stop';
    return `Sequence · ${seq}${tail}`;
  }
  return 'Adaptive';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deadline-aware next due for fixed/sequence cadences.
 * - No deadline: behaves exactly like nextCadenceDue.
 * - Next step lands on/before the deadline: use it.
 * - Next step would land after the deadline but at least a day remains: schedule
 *   one final review ON the deadline.
 * - Less than a day remains (or deadline passed): stop (null).
 */
export function deadlineAwareDue(
  policy: ReviewCadencePolicy,
  stepIndex: number,
  reviewedAt: number,
  endsAt: number | null,
): number | null {
  const raw = nextCadenceDue(policy, stepIndex, reviewedAt);
  if (raw === null) return null;
  if (!endsAt) return raw;
  if (raw <= endsAt) return raw;
  if (endsAt >= reviewedAt + DAY_MS) return endsAt; // final pass on the deadline
  return null;
}

/** Short human status for the plan's planning window. */
export function describeDeadline(plan: { startsAt: number | null; endsAt: number | null }, at = Date.now()): string {
  if (!plan.endsAt) return 'Open-ended';
  const days = Math.round((plan.endsAt - at) / DAY_MS);
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(plan.endsAt);
  if (days < 0) return `Ended ${date}`;
  if (days === 0) return `Ends today (${date})`;
  return `Ends ${date} · ${days}d left`;
}

/** Convert an <input type=date> value (YYYY-MM-DD) to an end-of-day timestamp. */
export function dateInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59`);
  return Number.isNaN(+d) ? null : +d;
}

/** Convert a timestamp to the YYYY-MM-DD value used by <input type=date>. */
export function timestampToDateInput(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
