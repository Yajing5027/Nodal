import { db } from '../db/database';
import type {
  KnowledgeFrame,
  KnowledgeMap,
  KnowledgeNode,
  KnowledgeRelation,
  MapOccurrence,
  RetrievalTarget,
  ReviewResult,
} from '../domain/types';
import { MATH_NOTES } from '../examples/mathNotes';
import { USER_Q3_NOTE_ID } from '../examples/q3Note';
import { ARCHITECTURE_NOTE_ID, formatDisplayMath } from './starterNotes';
import { cardToMemoryState, createEmptyCard, reviewRetrievalTarget } from './reviewRepository';

const CONTENT_KEY = 'study-workspace-v1';
const MAP_ID = 'map-mathematics-connections';
const DAY = 86_400_000;

type PracticeItem = {
  id: string;
  noteId: string;
  sectionId: string;
  question: string;
  answer: string;
  result?: ReviewResult;
};

const PRACTICE: PracticeItem[] = [
  { id: 'practice-function-one-to-one', noteId: 'node-math-functions-trigonometry', sectionId: 'sec-function-basics',
    question: 'Is f(x) = x² one-to-one over all real numbers? Why?', answer: 'No. For example, f(2) = f(-2) = 4.', result: 'recalled' },
  { id: 'practice-unit-circle', noteId: 'node-math-functions-trigonometry', sectionId: 'sec-trig-functions',
    question: 'On the unit circle, what do sine and cosine represent?', answer: 'Sine is the y-coordinate; cosine is the x-coordinate.' },
  { id: 'practice-chain-rule', noteId: 'node-math-calculus-chain-rule', sectionId: 'sec-chain-rule',
    question: 'State the chain rule for f(g(x)).', answer: "Differentiate the outside at g(x), then multiply by g'(x).", result: 'partial' },
  { id: 'practice-sin-x-squared', noteId: 'node-math-calculus-chain-rule', sectionId: 'sec-chain-rule',
    question: 'Differentiate sin(x²). What factor is easy to forget?', answer: '2x cos(x²); the factor 2x comes from the inner function.' },
  { id: 'practice-matrix-dimensions', noteId: 'node-math-linear-algebra', sectionId: 'sec-matrix-transformations',
    question: 'What size vector can an m × n matrix multiply, and what size is the result?', answer: 'It takes an n-component vector and produces an m-component vector.' },
  { id: 'practice-determinant', noteId: 'node-math-linear-algebra', sectionId: 'sec-determinant',
    question: 'What does a zero determinant tell you about a matrix?', answer: 'The transformation collapses area and the matrix is not invertible.', result: 'recalled' },
  { id: 'practice-implication', noteId: 'node-math-discrete-mathematics', sectionId: 'sec-propositions',
    question: 'When is the implication P ⇒ Q false?', answer: 'Only when P is true and Q is false.', result: 'partial' },
  { id: 'practice-induction', noteId: 'node-math-discrete-mathematics', sectionId: 'sec-induction',
    question: 'What two parts must a proof by induction establish?', answer: 'A base case and an inductive step from k to k + 1.' },
  { id: 'practice-cpu-time', noteId: ARCHITECTURE_NOTE_ID, sectionId: 'sec-performance',
    question: 'How do instruction count, CPI, and clock period determine CPU time?', answer: 'CPU time = instruction count × CPI × clock period.', result: 'recalled' },
  { id: 'practice-heap-index', noteId: USER_Q3_NOTE_ID, sectionId: 'sec-height-index',
    question: 'For 0-based heap index i, how do you find its children and verify they exist?', answer: 'Left = 2i + 1; right = 2i + 2. Each candidate must be less than heap size n.' },
];

/** Add a connected, partly reviewed study workspace without replacing user content. */
export async function ensureStudyWorkspace(): Promise<void> {
  if (await db.meta.get(CONTENT_KEY)) return;
  const sourceNotes = await db.nodes.toArray();
  if (!sourceNotes.some(note => note.id === USER_Q3_NOTE_ID || note.id === ARCHITECTURE_NOTE_ID)) {
    await db.meta.put({ key: CONTENT_KEY, value: true });
    return;
  }

  await db.transaction('rw', [db.nodes, db.maps, db.occurrences, db.frames, db.relations], async () => {
    const timestamp = Date.now();
    for (const item of MATH_NOTES) {
      if (await db.nodes.get(item.id)) continue;
      const note: KnowledgeNode = {
        id: item.id,
        title: item.title,
        contentMarkdown: item.markdown,
        tagIds: item.tagIds,
        ...(item.sectionTagIds ? { sectionTagIds: item.sectionTagIds } : {}),
        assetIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.nodes.add(note);
    }

    const architecture = await db.nodes.get(ARCHITECTURE_NOTE_ID);
    if (architecture) {
      const contentMarkdown = formatDisplayMath(architecture.contentMarkdown);
      if (contentMarkdown !== architecture.contentMarkdown) {
        await db.nodes.update(architecture.id, { contentMarkdown, updatedAt: timestamp });
      }
    }

    if (!(await db.maps.get(MAP_ID))) {
      const map: KnowledgeMap = {
        id: MAP_ID, title: 'Mathematics · Connections', description: 'Functions, change, structure, and proof.',
        tagIds: ['tag-math'], viewportX: 0, viewportY: 0, viewportZoom: 0.9,
        createdAt: timestamp, updatedAt: timestamp,
      };
      await db.maps.add(map);
    }
    const frames: KnowledgeFrame[] = [
      { id: 'frame-math-continuous', mapId: MAP_ID, title: 'Functions and change',
        x: 35, y: 35, width: 660, height: 275, parentFrameId: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'frame-math-structure', mapId: MAP_ID, title: 'Structure and proof',
        x: 35, y: 375, width: 660, height: 275, parentFrameId: null, createdAt: timestamp, updatedAt: timestamp },
    ];
    for (const frame of frames) if (!(await db.frames.get(frame.id))) await db.frames.add(frame);
    const positions = [
      { id: 'node-math-functions-trigonometry', x: 70, y: 100, frameId: frames[0].id },
      { id: 'node-math-calculus-chain-rule', x: 375, y: 100, frameId: frames[0].id },
      { id: 'node-math-discrete-mathematics', x: 70, y: 445, frameId: frames[1].id },
      { id: 'node-math-linear-algebra', x: 375, y: 445, frameId: frames[1].id },
    ];
    for (const position of positions) {
      const id = `occ-math-${position.id}`;
      if (await db.occurrences.get(id)) continue;
      const occurrence: MapOccurrence = {
        id, mapId: MAP_ID, nodeId: position.id, x: position.x, y: position.y,
        width: 250, height: 110, frameId: position.frameId, createdAt: timestamp, updatedAt: timestamp,
      };
      await db.occurrences.add(occurrence);
    }
    const relations: Array<Pick<KnowledgeRelation, 'id' | 'sourceNodeId' | 'targetNodeId' | 'label'>> = [
      { id: 'rel-functions-to-calculus', sourceNodeId: 'node-math-functions-trigonometry',
        targetNodeId: 'node-math-calculus-chain-rule', label: 'functions change' },
      { id: 'rel-discrete-to-linear', sourceNodeId: 'node-math-discrete-mathematics',
        targetNodeId: 'node-math-linear-algebra', label: 'reason about structure' },
    ];
    for (const relation of relations) {
      if (await db.relations.get(relation.id)) continue;
      await db.relations.add({
        ...relation, direction: 'forward', scope: 'map', mapId: MAP_ID,
        createdAt: timestamp, updatedAt: timestamp,
      });
    }
  });

  const reviewBase = Date.now() - 3 * DAY;
  for (const [index, item] of PRACTICE.entries()) {
    const existing = await db.retrievalTargets.get(item.id);
    if (!existing) {
      const createdAt = reviewBase - 60_000 + index * 1000;
      const target: RetrievalTarget = {
        id: item.id, kind: 'explanation', status: 'active',
        sourceType: 'node', sourceId: item.noteId, sectionId: item.sectionId,
        nodeLinks: [{ noteId: item.noteId, sectionId: item.sectionId }],
        promptMarkdown: item.question, expectedEvidenceMarkdown: item.answer,
        presentation: 'question', practiceType: 'flashcard', revision: 1,
        createdAt, updatedAt: createdAt,
      };
      const state = cardToMemoryState(target.id, createEmptyCard(new Date(createdAt)), createdAt);
      await db.transaction('rw', [db.retrievalTargets, db.memoryStates], async () => {
        if (!(await db.retrievalTargets.get(target.id))) {
          await db.retrievalTargets.add(target);
          await db.memoryStates.add(state);
        }
      });
    }
    if (item.result) {
      await reviewRetrievalTarget({
        targetId: item.id, result: item.result, responseTimeMs: 12_000 + index * 1000,
        sessionId: 'study-workspace-first-pass', eventId: `event-${item.id}`,
        reviewedAt: reviewBase + index * 60_000,
      });
    }
  }
  await db.meta.put({ key: CONTENT_KEY, value: true });
}
