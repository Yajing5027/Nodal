import type { KnowledgeNode, MemoryState, RetrievalTarget, ReviewEvent, ReviewResult } from '../../domain/types';
import { isExampleNode } from '../../domain/examples';

export type PlanPeriod = 'day' | 'week' | 'month';
export interface PlanData { nodes: KnowledgeNode[]; targets: RetrievalTarget[]; states: MemoryState[]; events: ReviewEvent[] }
export const OUTCOMES: ReviewResult[] = ['recalled', 'partial', 'missed'];
export const OUTCOME_LABELS: Record<ReviewResult, string> = { recalled: 'Recalled', clear: 'Recalled (legacy)', effortful: 'Recalled (legacy)', partial: 'Partial', missed: 'Forgot' };
export function dayStart(at: number): number { const d = new Date(at); d.setHours(0, 0, 0, 0); return +d; }
export function shiftDay(at: number, offset: number): number { const d = new Date(at); d.setDate(d.getDate() + offset); return +d; }
export function periodStart(at: number, period: PlanPeriod): number {
  const d = new Date(dayStart(at));
  if (period === 'week') d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  if (period === 'month') d.setDate(1);
  return +d;
}
export function shiftPeriod(at: number, offset: number, period: PlanPeriod): number {
  const d = new Date(at);
  if (period === 'month') d.setMonth(d.getMonth() + offset);
  else d.setDate(d.getDate() + offset * (period === 'week' ? 7 : 1));
  return +d;
}
// The Plan timeline represents personal learning data only. Records created by
// legacy demo/example builds (exampleSetId on targets/events, or the legacy
// example-set node tags) are excluded internally until the user deletes them.
/** Visible number of buckets per period viewport. Not a business constant — it
 * is a display-level window. Navigation pages by the whole viewport. */
export const TIMELINE_VIEWPORT: Record<PlanPeriod, number> = {
  day: 14,
  week: 8,
  month: 12,
};
export const VIEWPORT_CENTER = (period: PlanPeriod) => Math.floor(TIMELINE_VIEWPORT[period] / 2);

export function buildTimeline(data: PlanData, at: number, period: PlanPeriod, offset = 0) {
  const targetById = new Map(data.targets.map(t => [t.id, t]));
  const isPersonalTarget = (t: RetrievalTarget | undefined): t is RetrievalTarget => !!t && !t.exampleSetId;
  const viewport = TIMELINE_VIEWPORT[period];
  const center = shiftPeriod(periodStart(at, period), offset * viewport, period);
  return Array.from({ length: viewport }, (_, index) => {
    const start = shiftPeriod(center, index - Math.floor(viewport / 2), period), end = shiftPeriod(start, 1, period);
    const events = data.events.filter(e => e.reviewedAt >= start && e.reviewedAt < end && !e.exampleSetId && isPersonalTarget(targetById.get(e.retrievalTargetId)));
    const scheduled = data.states.filter(s => {
      const t = targetById.get(s.retrievalTargetId);
      const due = Math.max(s.dueAt, dayStart(at));
      return t?.status === 'active' && isPersonalTarget(t) && due >= start && due < end;
    });
    const notes = data.nodes.filter(n => n.createdAt >= start && n.createdAt < end && !isExampleNode(n.tagIds));
    events.sort((a, b) => b.reviewedAt - a.reviewedAt);
    scheduled.sort((a, b) => a.dueAt - b.dueAt);
    notes.sort((a, b) => a.createdAt - b.createdAt);
    const counts = Object.fromEntries(OUTCOMES.map(result => [result, events.filter(e => (['clear', 'effortful'].includes(e.rawResult) ? 'recalled' : e.rawResult) === result).length])) as Record<ReviewResult, number>;
    return { start, end, events, scheduled, notes, counts, current: at >= start && at < end, total: events.length + scheduled.length };
  });
}
