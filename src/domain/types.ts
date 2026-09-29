// ============================================================
// Domain Types — Knowledge Map V0
// These are the canonical business model types.
// They MUST NOT be confused with React Flow projection types.
// ============================================================

export type ID = string;

export type RelationDirection = 'none' | 'forward' | 'bidirectional';
export type RelationScope = 'map' | 'global';

// ---------- KnowledgeNode ----------
// A globally independent knowledge object.
// Node does NOT belong to any Map, Course, Frame, or Parent.
// It can be referenced by any number of Maps via MapOccurrence.
export interface KnowledgeNode {
  id: ID;
  title: string;
  aiGuidance?: { note: string; sections: Record<string, string> };
  contentMarkdown: string; // canonical content — Markdown is the only source
  overview?: string; // Optional note-level overview (independent of sections)
  tagIds: ID[]; // 整篇标签 (Whole-note tags)
  sectionTagIds?: Record<string, ID[]>; // 本小节标签 (Section-specific tags: sectionId -> tagIds)
  assetIds: ID[];
  order?: number;
  createdAt: number;
  updatedAt: number;
  // Explicitly forbidden fields (do not add):
  // mapId, courseId, parentId, reviewScore, mastery, status
}

/**
 * Returns the effective tags for a specific section:
 * effectiveTags = wholeNoteTags ∪ sectionTags, deduplicated.
 */
export function getEffectiveSectionTags(node: KnowledgeNode, sectionId: string): ID[] {
  const wholeTags = node.tagIds || [];
  const secTags = node.sectionTagIds?.[sectionId] || [];
  return Array.from(new Set([...wholeTags, ...secTags]));
}

/**
 * Returns a summary of tags on a note:
 * wholeTags: tags applied to the whole note
 * sectionOnlyTags: tags that appear in sections but are not whole-note tags
 * allTags: deduplicated union of all tags
 */
export function getNodeTagSummary(node: KnowledgeNode): {
  wholeTags: ID[];
  sectionOnlyTags: ID[];
  allTags: ID[];
} {
  const wholeTags = node.tagIds || [];
  const allSecTags = Object.values(node.sectionTagIds || {}).flat();
  const wholeSet = new Set(wholeTags);
  const sectionOnlyTags = Array.from(new Set(allSecTags.filter(id => !wholeSet.has(id))));
  const allTags = Array.from(new Set([...wholeTags, ...allSecTags]));
  return { wholeTags, sectionOnlyTags, allTags };
}

// ---------- KnowledgeMap ----------
// A view/organization layer. Does NOT own Nodes.
// Contains occurrences, frames, map-scope relations, and viewport.
export interface KnowledgeMap {
  id: ID;
  title: string;
  description: string;
  tagIds: ID[];
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  order?: number;
  createdAt: number;
  updatedAt: number;
}

// ---------- MapOccurrence ----------
// A single appearance of a KnowledgeNode in a KnowledgeMap.
// Stores only position/dimensions/frameId.
// NEVER copies contentMarkdown.
export interface MapOccurrence {
  id: ID;
  mapId: ID;
  nodeId: ID;
  sectionId?: ID | null;
  x: number;
  y: number;
  width: number;
  height: number;
  frameId: ID | null;
  createdAt: number;
  updatedAt: number;
}

// ---------- KnowledgeFrame ----------
// A visual grouping rectangle in a Map.
// Does NOT own Nodes — Nodes are temporarily inside via occurrence.frameId.
// parentFrameId reserved for future nesting support.
export interface KnowledgeFrame {
  id: ID;
  mapId: ID;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentFrameId: ID | null; // reserved for nested frames
  createdAt: number;
  updatedAt: number;
}

// ---------- KnowledgeRelation ----------
// A semantic connection between two KnowledgeNodes.
// Business model calls it "Relation" (not "edge").
// scope=map: only meaningful within a specific Map
// scope=global: universally true between the knowledge objects
export interface KnowledgeRelation {
  id: ID;
  sourceNodeId: ID;
  targetNodeId: ID;
  sourceType?: 'node' | 'frame';
  targetType?: 'node' | 'frame';
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label: string;
  direction: RelationDirection;
  scope: RelationScope;
  mapId: ID | null; // required when scope=map
  createdAt: number;
  updatedAt: number;
}

// ---------- KnowledgeTag ----------
// A simple classification tool. Does NOT establish ownership.
export interface KnowledgeTag {
  id: ID;
  name: string;
  color: string | null;
  parentId?: ID | null;
  order?: number;
  createdAt: number;
}

// ---------- KnowledgeAsset ----------
// Primarily images in V0. Stored as blob.
// description is critical — AI may read it when it can't read the image.
export interface KnowledgeAsset {
  id: ID;
  filename: string;
  mimeType: string;
  blob: Blob;
  description: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- Learning layer ----------
// Knowledge content remains in KnowledgeNode / Relation / Frame / Map.
// A RetrievalTarget only defines what the learner must actively recall.
export type RetrievalTargetKind =
  | 'atomic_fact'
  | 'relation'
  | 'explanation'
  | 'application'
  | 'discrimination'
  | 'example_generation'
  | 'framework_reconstruction';

export type RetrievalSourceType = 'node' | 'relation' | 'frame' | 'map';
export type RetrievalTargetStatus = 'active' | 'suspended' | 'archived';

// A text quote anchored to one rendered Markdown block, not another knowledge object.
export interface RecallAnchor {
  /** Stable note panel identity; absent on legacy single-body notes. */
  panelId?: string;
  text: string;
  context: string;
  start: number;
  end: number;
  blockStart: number;
  /** Optional non-contiguous selections in the same source block. */
  selections?: Array<{ text: string; start: number; end: number }>;
  /** Heading trail is presentation context, not part of the answer. */
  sectionPath?: string[];
  /** Whole Markdown block snapshot; never flatten formulas, lists or code. */
  blockMarkdown?: string;
  blockKind?: string;
}
export type RecallPresentation = 'question' | 'cloze' | 'hidden';
export interface RecallDraft {
  id: ID;
  sourceId: ID;
  anchor: RecallAnchor;
  anchors?: RecallAnchor[];
  presentation: RecallPresentation;
  prompt: string;
  createdAt: number;
}

export interface TargetNodeLink {
  noteId: string;
  sectionId?: string | null;
}

export function getTargetNodeLinks(target: {
  sourceType?: RetrievalSourceType;
  sourceId?: ID;
  sectionId?: string | null;
  anchor?: RecallAnchor;
  nodeLinks?: TargetNodeLink[];
}): TargetNodeLink[] {
  if (target.nodeLinks && Array.isArray(target.nodeLinks) && target.nodeLinks.length > 0) {
    const seen = new Set<string>();
    const res: TargetNodeLink[] = [];
    for (const l of target.nodeLinks) {
      if (!l || !l.noteId) continue;
      const key = `${l.noteId}:${l.sectionId ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        res.push({ noteId: l.noteId, sectionId: l.sectionId ?? null });
      }
    }
    if (res.length > 0) return res;
  }
  if (target.sourceType === 'node' && target.sourceId) {
    const secId = target.sectionId ?? target.anchor?.panelId ?? null;
    return [{ noteId: target.sourceId, sectionId: secId }];
  }
  return [];
}

export interface RetrievalTarget {
  /** Explicit example provenance; never use in personal calibration. */
  exampleSetId?: string;
  id: ID;
  kind: RetrievalTargetKind;
  status: RetrievalTargetStatus;
  sourceType: RetrievalSourceType;
  sourceId: ID;
  promptMarkdown: string;
  expectedEvidenceMarkdown: string;
  presentation?: RecallPresentation;
  anchor?: RecallAnchor;
  /** One independently rated target may span multiple source blocks. */
  anchors?: RecallAnchor[];
  revision: number;
  createdAt: number;
  updatedAt: number;
  // Multi-node association across notes (one card, many nodes)
  nodeLinks?: TargetNodeLink[];
  // Practice v1 fields
  practiceType?: 'flashcard' | 'choice' | 'cloze';
  sectionId?: string | null;
  options?: Array<{ id: string; textMarkdown: string }>;
  correctOptionId?: string;
  correctOptionIds?: string[];
  explanationMarkdown?: string;
  blanks?: Array<{ id: string; answerMarkdown: string }>;
}

export type LearningState = 'new' | 'learning' | 'review' | 'relearning';

// A serializable projection of the FSRS card. Keeping the full scheduling
// state lets the algorithm evolve without putting memory fields on Nodes.
export interface MemoryState {
  retrievalTargetId: ID;
  learningState: LearningState;
  difficulty: number;
  stabilityDays: number;
  dueAt: number;
  /** FSRS recommendation, before any goal-date policy. */
  fsrsDueAt?: number;
  retrievability?: number | null;
  retrievabilityAsOf?: number;
  schedulingDecision?: SchedulingDecision;
  lastReviewedAt: number | null;
  scheduledDays: number;
  learningSteps: number;
  reviewCount: number;
  lapseCount: number;
  schedulerProfileId: ID;
  schedulerVersion: string;
  updatedAt: number;
}

// Historical effortful/clear values are retained verbatim, not rewritten.
export type ReviewResult = 'missed' | 'partial' | 'recalled' | 'effortful' | 'clear';
export type SchedulerGrade = 'again' | 'hard' | 'good';

export interface ReviewEvent {
  exampleSetId?: string;
  id: ID;
  retrievalTargetId: ID;
  targetRevision: number;
  sessionId: ID;
  reviewedAt: number;
  responseTimeMs: number;
  rawResult: ReviewResult;
  schedulerGrade: SchedulerGrade;
  scheduledDueAtBefore: number;
  previousState: MemoryState;
  resultingState: MemoryState;
  schedulerProfileId: ID;
  schedulerVersion: string;
  // Optional only for legacy records. New submissions always store these.
  protocolVersion?: string;
  presentation?: RecallPresentation;
  initialResult?: ReviewResult | null;
  answerRevealedAt?: number | null;
  startedAt?: number;
  hintUsedAt?: number[];
  answerRevealed?: boolean;
  hintUsed?: boolean;
  memoryProfile?: MemoryModelProfile;
  schedulingDecision?: SchedulingDecision;
  interruptionCount?: number;
  sourceStatus?: 'current' | 'snapshot';
  targetSnapshot?: Pick<RetrievalTarget, 'promptMarkdown' | 'expectedEvidenceMarkdown' | 'anchor' | 'anchors' | 'presentation'>;
  schedulerConfig?: { desiredRetention: number; maximumIntervalDays: number; enableFuzz: boolean };
}

/** A reusable calendar interval for user-defined cadence policies. */
export type IntervalUnit = 'day' | 'week' | 'month';
export interface IntervalStep { id?: string; value: number; unit: IntervalUnit }

/** How the next due date is chosen. MemoryState/FSRS evidence is never destroyed. */
export type ReviewCadencePolicy =
  | { kind: 'adaptive_fsrs' }
  | { kind: 'fixed_interval'; interval: IntervalStep }
  | { kind: 'interval_sequence'; steps: IntervalStep[]; afterSequence: 'stop' | 'repeat_last' | 'loop' };

/** The canonical, user-facing study plan. Independent of any academic semester. */
export interface StudyPlan {
  id: ID;
  title: string;
  /** Optional planning window. null = open-ended / not set. */
  startsAt: number | null;
  endsAt: number | null;
  cadence: ReviewCadencePolicy;
  /** Soft workload display limit (minutes/day). null = unset. Not a memory parameter. */
  dailyStudyBudgetMinutes: number | null;
  /** Max new prompts introduced per day. null = unset. */
  newTargetLimit: number | null;
  /** Only meaningful for adaptive_fsrs. null = use the FSRS default. */
  targetRetention: number | null;
  /** Plan-level pause. Paused plans do not produce custom cadence scheduling. */
  status: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted row in the `semesterPlans` table. The table name is legacy and kept
 * for backup compatibility; rows may carry either legacy semester fields or the
 * new cadence fields. Read through `normalizePlan` to obtain a StudyPlan.
 */
/** A reusable scheduling policy applied to reviewable content (PlanAssignment). */
export type ReviewPlanRow = SemesterPlan;

export type AssignmentSubjectType = 'retrieval_target' | 'node' | 'section';
export type AssignmentStatus = 'active' | 'paused';

/** Explicit, persistent binding between a ReviewPlan and reviewable knowledge.
 *  NOT a KnowledgeRelation, NOT Node ownership. Changing it never copies content. */
export interface PlanAssignment {
  id: ID;
  reviewPlanId: ID | null;
  subjectType: AssignmentSubjectType;
  subjectId: ID;
  /** Set when subjectType === 'section' (the nodal-panel id inside subjectId node). */
  sectionId?: ID;
  status: AssignmentStatus;
  /** Optional per-subject deadline, overriding the plan's own endsAt when set. */
  startsAt?: number | null;
  endsAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export type PlanResolutionSource = 'target' | 'section' | 'node' | 'baseline';

export interface EffectivePlanResolution {
  plan: StudyPlan | null;
  source: PlanResolutionSource;
  assignmentId?: string;
  paused?: boolean;
}

/**
 * Persisted execution cursor for a specific RetrievalTarget under a specific
 * effective ReviewPlan. Decouples sequence step progression from FSRS reps/reviewCount.
 */
export interface PlanExecutionState {
  id: ID;
  retrievalTargetId: ID;
  reviewPlanId: ID;
  effectiveAssignmentId: ID;
  currentStepId?: string;
  stepIndex: number;
  startedAt: number;
  lastAdvancedAt?: number | null;
  completedAt?: number | null;
  updatedAt: number;
}

export interface SemesterPlan {
  id: ID;
  title: string;
  startsAt: number | null;
  endsAt: number | null;
  dailyBudgetMinutes?: number | null;
  newTargetLimit?: number | null;
  desiredRetention?: number | null;
  targetDate?: number | null;
  targetRetention?: number | null;
  dailyStudyBudget?: number | null;
  /** New cadence policy, absent on legacy rows (interpreted as adaptive_fsrs). */
  cadence?: ReviewCadencePolicy;
  status?: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
}

export interface MemoryModelProfile {
  id: ID;
  version: string;
  weights: number[];
  requestRetention: number;
  maximumIntervalDays: number;
  trainedThrough: number | null;
}

export interface SchedulingDecision {
  policyVersion: string;
  planId: ID | null;
  policyKind: 'adaptive_fsrs' | 'fixed_interval' | 'interval_sequence';
  targetDate: number | null;
  targetRetention: number | null;
  calculatedAt: number;
  fsrsDueAt: number;
  dueAt: number;
  predictedRecallAtDeadline: number | null;
  reason: 'new' | 'long-term' | 'deadline-pressure' | 'deadline-passed' | 'cadence';
}

// ---------- Flow Projection Types (React Flow) ----------
// These are UI projection types, separate from domain types.
// FlowNode = React Flow node that projects a MapOccurrence + its KnowledgeNode.
export interface FlowNodeData {
  occurrenceId: ID;
  nodeId: ID;
  title: string;
  tags: string[];
  summary: string;
  frameId: ID | null;
}

export interface FlowEdgeData {
  relationId: ID;
  label: string;
  direction: RelationDirection;
  scope: RelationScope;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

// ---------- Export Format ----------
export interface PortableManifest {
  schemaVersion: string;
  appVersion: string;
  exportedAt: string;
  nodeCount: number;
  mapCount: number;
  relationCount: number;
  tagCount: number;
  assetCount: number;
  retrievalTargetCount?: number;
  reviewEventCount?: number;
  planAssignmentCount?: number;
  planExecutionStateCount?: number;
}

export interface NodeFrontmatter {
  aiGuidance?: KnowledgeNode['aiGuidance'];
  schemaVersion: string;
  id: ID;
  title: string;
  overview?: string;
  tags: string[];
  sectionTags?: Record<string, string[]>;
  assetIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface PortableMap {
  id: ID;
  title: string;
  description: string;
  tagIds: ID[];
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  occurrences: Array<Omit<MapOccurrence, 'createdAt' | 'updatedAt'>>;
  frames: Array<Omit<KnowledgeFrame, 'createdAt' | 'updatedAt'>>;
  createdAt: string;
  updatedAt: string;
}
