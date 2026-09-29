// ============================================================
// Section Mastery Rating Repository
// ============================================================
// Distinct from FSRS card review: does NOT set dueAt or schedule reviews.
// Evaluates user's subjective mastery of a note section ('Forgot' | 'Partial' | 'Recalled').
// Persisted in Dexie db.meta under key 'section-ratings-v1'.
// ============================================================

import { db } from '../db/database';
import type { KnowledgeNode } from '../domain/types';
import { splitNotePanels } from '../domain/notePanels';

export type MasteryRating = 'Forgot' | 'Partial' | 'Recalled';

export interface SectionRatingRecord {
  nodeId: string;
  sectionId: string;
  rating: MasteryRating;
  ratedAt: number;
  history?: Array<{ rating: MasteryRating; ratedAt: number }>;
}

export const SECTION_RATINGS_KEY = 'section-ratings-v1';

let inMemoryRatingsCache: Record<string, SectionRatingRecord> | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.error('Error in section rating listener', e);
    }
  }
}

export function subscribeSectionRatings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function loadAllRatings(): Promise<Record<string, SectionRatingRecord>> {
  if (inMemoryRatingsCache !== null) {
    return inMemoryRatingsCache;
  }
  try {
    const entry = await db.meta.get(SECTION_RATINGS_KEY);
    if (entry && typeof entry.value === 'object' && entry.value !== null) {
      inMemoryRatingsCache = entry.value as Record<string, SectionRatingRecord>;
    } else {
      inMemoryRatingsCache = {};
    }
  } catch (err) {
    console.error('Failed to read section ratings from db.meta', err);
    inMemoryRatingsCache = {};
  }
  return inMemoryRatingsCache;
}

async function saveAllRatings(ratings: Record<string, SectionRatingRecord>): Promise<void> {
  try {
    await db.meta.put({ key: SECTION_RATINGS_KEY, value: ratings });
    inMemoryRatingsCache = ratings;
  } catch (err) {
    console.error('Failed to persist section ratings to db.meta', err);
    throw new Error('Failed to save section rating to database: ' + (err instanceof Error ? err.message : String(err)));
  }
  notifyListeners();
}

export function getSectionRatingKey(nodeId: string, sectionId: string): string {
  return `${nodeId}:${sectionId}`;
}

export async function getSectionRating(nodeId: string, sectionId: string): Promise<SectionRatingRecord | null> {
  const all = await loadAllRatings();
  return all[getSectionRatingKey(nodeId, sectionId)] || null;
}

export async function getAllSectionRatings(): Promise<Record<string, SectionRatingRecord>> {
  return await loadAllRatings();
}

export async function setSectionRating(nodeId: string, sectionId: string, rating: MasteryRating): Promise<void> {
  const all = { ...(await loadAllRatings()) };
  const key = getSectionRatingKey(nodeId, sectionId);
  const now = Date.now();
  const existing = all[key];

  const history = existing?.history ? [...existing.history] : [];
  if (existing) {
    history.push({ rating: existing.rating, ratedAt: existing.ratedAt });
  }

  all[key] = {
    nodeId,
    sectionId,
    rating,
    ratedAt: now,
    history,
  };

  await saveAllRatings(all);
}

export async function removeSectionRating(nodeId: string, sectionId: string): Promise<void> {
  const all = { ...(await loadAllRatings()) };
  const key = getSectionRatingKey(nodeId, sectionId);
  if (all[key]) {
    delete all[key];
    await saveAllRatings(all);
  }
}

/**
 * When two sections are merged (fromSectionId merged into toSectionId),
 * migrate the rating safely to the surviving section if not already rated,
 * or merge history.
 */
export async function migrateSectionRatings(nodeId: string, fromSectionId: string, toSectionId: string): Promise<void> {
  const all = { ...(await loadAllRatings()) };
  const fromKey = getSectionRatingKey(nodeId, fromSectionId);
  const toKey = getSectionRatingKey(nodeId, toSectionId);

  const fromRecord = all[fromKey];
  if (!fromRecord) return;

  const toRecord = all[toKey];
  if (!toRecord) {
    all[toKey] = {
      ...fromRecord,
      sectionId: toSectionId,
    };
  } else {
    // Preserve history
    const mergedHistory = [...(toRecord.history || []), { rating: fromRecord.rating, ratedAt: fromRecord.ratedAt }];
    all[toKey] = {
      ...toRecord,
      history: mergedHistory,
    };
  }

  delete all[fromKey];
  await saveAllRatings(all);
}

export function ratingToScore(rating: MasteryRating): number {
  switch (rating) {
    case 'Forgot':
      return 0;
    case 'Partial':
      return 50;
    case 'Recalled':
      return 100;
  }
}

export interface NodeSummaryScore {
  score: number | null; // 0-100 or null if no sections rated
  ratedCount: number;
  totalCount: number;
  label: string;
}

export function computeScoreForRatings(ratings: MasteryRating[], totalSections: number): NodeSummaryScore {
  if (ratings.length === 0) {
    return {
      score: null,
      ratedCount: 0,
      totalCount: totalSections,
      label: 'Unrated',
    };
  }
  const sum = ratings.reduce((acc, r) => acc + ratingToScore(r), 0);
  const score = Math.round(sum / ratings.length);
  return {
    score,
    ratedCount: ratings.length,
    totalCount: totalSections,
    label: `${score}% (${ratings.length}/${totalSections})`,
  };
}

export function computeNodeScore(node: KnowledgeNode, allRatings: Record<string, SectionRatingRecord>): NodeSummaryScore {
  const panels = splitNotePanels(node.contentMarkdown || '');
  const totalSections = Math.max(1, panels.length);
  const ratings: MasteryRating[] = [];
  for (const panel of panels) {
    const key = getSectionRatingKey(node.id, panel.id);
    const rec = allRatings[key];
    if (rec) {
      ratings.push(rec.rating);
    }
  }
  return computeScoreForRatings(ratings, totalSections);
}

