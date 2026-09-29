// ============================================================
// Node & Note Mastery Scoring Engine
// ============================================================
// Aggregates knowledge mastery from real flashcard ReviewEvents.
//
// Rules (Requirement 6):
// 1. Each reviewed RetrievalTarget takes the raw result of its most
//    recent valid ReviewEvent: Forgot (missed) = 0, Partial = 50, Recalled = 100.
// 2. Unreviewed targets are Unrated (null), not treated as 0.
// 3. A Node (Section) score is the average of its associated and rated
//    flashcards, displaying "ratedCards/totalCards".
// 4. A Note score deduplicates targets by retrievalTargetId across all its
//    sections so a shared card is only counted once for that note.
// 5. Node scores are for display and sorting only; FSRS scheduling is
//    driven separately by ts-fsrs on each card's single MemoryState.
// ============================================================

import type { RetrievalTarget, ReviewEvent, ReviewResult } from './types';
import { getTargetNodeLinks } from './types';

export interface CardMastery {
  targetId: string;
  score: number | null;
  rawResult: ReviewResult | null;
  reviewedAt: number | null;
}

export interface NodeMasteryScore {
  score: number | null;
  label: string;
  ratedCards: number;
  totalCards: number;
  summary: string;
}

/** Convert a raw review result into a mastery score (0-100) */
export function rawResultToMasteryScore(result: ReviewResult | string): number {
  const normalized = String(result).toLowerCase();
  switch (normalized) {
    case 'missed':
    case 'forgot':
      return 0;
    case 'partial':
      return 50;
    case 'effortful':
      return 80;
    case 'recalled':
    case 'clear':
    case 'good':
      return 100;
    default:
      return 0;
  }
}

/**
 * Compute the cumulative mastery score (0-100) for a card from its review history:
 * - 1st review: initial score = rawResultToMasteryScore(event0)
 * - Subsequent: newScore = round(0.6 * rawResult + 0.4 * oldScore)
 * Example: 0 -> 50 -> 100 yields 0 -> 30 -> 72.
 */
export function computeCardCumulativeScore(events: ReviewEvent[]): number | null {
  if (!events || events.length === 0) return null;
  const valid = events.filter(e => e && e.rawResult);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => (a.reviewedAt || 0) - (b.reviewedAt || 0));
  let score: number | null = null;
  for (const ev of sorted) {
    const raw = rawResultToMasteryScore(ev.rawResult);
    if (score === null) {
      score = raw;
    } else {
      score = Math.round(0.6 * raw + 0.4 * score);
    }
  }
  return score;
}

/** Precompute cumulative scores for all cards from all review events */
export function buildCardCumulativeScoresMap(events: ReviewEvent[]): Map<string, number> {
  const eventsByTarget = new Map<string, ReviewEvent[]>();
  for (const ev of events) {
    if (!ev || !ev.retrievalTargetId) continue;
    const list = eventsByTarget.get(ev.retrievalTargetId) ?? [];
    list.push(ev);
    eventsByTarget.set(ev.retrievalTargetId, list);
  }
  const scoreMap = new Map<string, number>();
  for (const [targetId, targetEvents] of eventsByTarget.entries()) {
    const sc = computeCardCumulativeScore(targetEvents);
    if (sc !== null) {
      scoreMap.set(targetId, sc);
    }
  }
  return scoreMap;
}

/** Build a lookup of the latest ReviewEvent for each RetrievalTarget */
export function buildLatestReviewEventsMap(events: ReviewEvent[]): Map<string, ReviewEvent> {
  const map = new Map<string, ReviewEvent>();
  for (const event of events) {
    if (!event || !event.retrievalTargetId) continue;
    const existing = map.get(event.retrievalTargetId);
    if (!existing || event.reviewedAt > existing.reviewedAt) {
      map.set(event.retrievalTargetId, event);
    }
  }
  return map;
}

function resolveTargetScore(
  targetId: string,
  eventsOrScores: Map<string, ReviewEvent> | Map<string, number> | ReviewEvent[]
): number | null {
  if (Array.isArray(eventsOrScores)) {
    const targetEvents = eventsOrScores.filter(e => e.retrievalTargetId === targetId);
    return computeCardCumulativeScore(targetEvents);
  }
  if (eventsOrScores instanceof Map) {
    const val = eventsOrScores.get(targetId);
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && 'rawResult' in val) {
      return rawResultToMasteryScore((val as ReviewEvent).rawResult);
    }
  }
  return null;
}

/** Check if a target is linked to a specific note and section */
export function isTargetLinkedToNode(
  target: RetrievalTarget,
  noteId: string,
  sectionId?: string | null,
): boolean {
  if (target.status === 'archived') return false;
  const links = getTargetNodeLinks(target);
  return links.some(l => {
    if (l.noteId !== noteId) return false;
    if (!sectionId || sectionId === 'main') {
      // Main section matches if sectionId is 'main' or null/empty
      return !l.sectionId || l.sectionId === 'main';
    }
    return l.sectionId === sectionId;
  });
}

/** Check if a target is linked anywhere within a note */
export function isTargetLinkedToNote(target: RetrievalTarget, noteId: string): boolean {
  if (target.status === 'archived') return false;
  const links = getTargetNodeLinks(target);
  return links.some(l => l.noteId === noteId);
}

/** Compute mastery score for a single Node (Section) */
export function computeNodeMastery(
  noteId: string,
  sectionId: string,
  targets: RetrievalTarget[],
  eventsOrScores: Map<string, ReviewEvent> | Map<string, number> | ReviewEvent[],
): NodeMasteryScore {
  const matchedTargets = targets.filter(t => isTargetLinkedToNode(t, noteId, sectionId));
  const totalCards = matchedTargets.length;

  if (totalCards === 0) {
    return {
      score: null,
      label: 'No cards',
      ratedCards: 0,
      totalCards: 0,
      summary: '0 cards',
    };
  }

  const scores: number[] = [];
  for (const target of matchedTargets) {
    const sc = resolveTargetScore(target.id, eventsOrScores);
    if (sc !== null) {
      scores.push(sc);
    }
  }

  const ratedCards = scores.length;
  if (ratedCards === 0) {
    return {
      score: null,
      label: 'Unrated',
      ratedCards: 0,
      totalCards,
      summary: `0/${totalCards} rated`,
    };
  }

  const avg = Math.round(scores.reduce((sum, s) => sum + s, 0) / ratedCards);
  const label = avg === 100 ? 'Recalled' : avg >= 50 ? 'Partial' : 'Forgot';

  return {
    score: avg,
    label,
    ratedCards,
    totalCards,
    summary: `${ratedCards}/${totalCards} rated`,
  };
}

/** Compute mastery score for an entire Note (deduplicating shared cards) */
export function computeNoteMastery(
  noteId: string,
  targets: RetrievalTarget[],
  eventsOrScores: Map<string, ReviewEvent> | Map<string, number> | ReviewEvent[],
): NodeMasteryScore {
  // Deduplicate by target.id so a shared card is only counted once for this note
  const uniqueTargetMap = new Map<string, RetrievalTarget>();
  for (const t of targets) {
    if (isTargetLinkedToNote(t, noteId)) {
      uniqueTargetMap.set(t.id, t);
    }
  }

  const totalCards = uniqueTargetMap.size;
  if (totalCards === 0) {
    return {
      score: null,
      label: 'No cards',
      ratedCards: 0,
      totalCards: 0,
      summary: '0 cards',
    };
  }

  const scores: number[] = [];
  for (const target of uniqueTargetMap.values()) {
    const sc = resolveTargetScore(target.id, eventsOrScores);
    if (sc !== null) {
      scores.push(sc);
    }
  }

  const ratedCards = scores.length;
  if (ratedCards === 0) {
    return {
      score: null,
      label: 'Unrated',
      ratedCards: 0,
      totalCards,
      summary: `0/${totalCards} rated`,
    };
  }

  const avg = Math.round(scores.reduce((sum, s) => sum + s, 0) / ratedCards);
  const label = avg === 100 ? 'Recalled' : avg >= 50 ? 'Partial' : 'Forgot';

  return {
    score: avg,
    label,
    ratedCards,
    totalCards,
    summary: `${ratedCards}/${totalCards} rated`,
  };
}
