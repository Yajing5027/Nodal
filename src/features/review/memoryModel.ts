import { fsrs, default_w, State, type Card, type Grade } from 'ts-fsrs';
import type { MemoryModelProfile, MemoryState, ReviewEvent } from '../../domain/types';

export const DEFAULT_MEMORY_PROFILE: MemoryModelProfile = {
  id: 'fsrs-6-default', version: 'fsrs-6/ts-fsrs-5.4.2', weights: [...default_w],
  requestRetention: 0.9, maximumIntervalDays: 36500, trainedThrough: null,
};
const states = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
export function memoryCard(state: MemoryState): Card {
  return { due: new Date(state.fsrsDueAt ?? state.dueAt), stability: state.stabilityDays,
    difficulty: state.difficulty, elapsed_days: 0, scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps, reps: state.reviewCount, lapses: state.lapseCount,
    state: states[state.learningState], last_review: state.lastReviewedAt === null ? undefined : new Date(state.lastReviewedAt) };
}

export interface MemoryModel {
  readonly profile: MemoryModelProfile;
  recallProbability(state: MemoryState, at: number): number | null;
  review(state: MemoryState, at: number, grade: Grade): Card;
}

/** Goal dates and workload never enter this adapter. All forgetting estimates come from ts-fsrs. */
export function createMemoryModel(profile: MemoryModelProfile = DEFAULT_MEMORY_PROFILE): MemoryModel {
  const model = fsrs({ w: profile.weights, request_retention: profile.requestRetention,
    maximum_interval: profile.maximumIntervalDays, enable_fuzz: false });
  return { profile,
    recallProbability(state, at) {
      if (state.lastReviewedAt === null || state.stabilityDays <= 0) return null;
      // Use the library curve with fractional elapsed days (deadline decisions may be intraday).
      return model.forgetting_curve(Math.max(0, (at - state.lastReviewedAt) / 86400000), state.stabilityDays);
    },
    review: (state, at, grade) => model.next(memoryCard(state), new Date(at), grade).card,
  };
}

/** Future optimizer boundary. A fitter must validate held-out history before proposing a new version.
 * It must not mutate events or silently activate a profile; replay/activation is a separate migration. */
export interface PersonalMemoryOptimizer {
  fit(input: { history: readonly ReviewEvent[]; baseline: MemoryModelProfile }): Promise<{
    candidate: MemoryModelProfile; heldOutLogLoss: number; baselineLogLoss: number;
  }>;
}
