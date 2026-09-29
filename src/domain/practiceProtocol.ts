import type { KnowledgeNode } from './types';
import type { NotePanel } from './notePanels';

export type PracticeCardType = 'flashcard' | 'choice' | 'cloze';

export interface PracticeFlashcard {
  id: string;
  sectionId: string | null;
  type: 'flashcard';
  frontMarkdown: string;
  backMarkdown: string;
}

export interface PracticeChoiceOption {
  id: string;
  textMarkdown: string;
}

export interface PracticeChoice {
  id: string;
  sectionId: string | null;
  type: 'choice';
  frontMarkdown: string;
  options: PracticeChoiceOption[];
  correctOptionId: string;
  explanationMarkdown: string;
}

export interface PracticeClozeBlank {
  id: string;
  answerMarkdown: string;
}

export interface PracticeCloze {
  id: string;
  sectionId: string | null;
  type: 'cloze';
  promptMarkdown: string;
  blanks: PracticeClozeBlank[];
  explanationMarkdown: string;
}

export type PracticeCard = PracticeFlashcard | PracticeChoice | PracticeCloze;

export interface PracticePackage {
  schemaVersion: 'nodal.practice.v1';
  noteId: string;
  sourceRevision: string;
  cards: PracticeCard[];
}

export interface ValidationResult {
  valid: boolean;
  package?: PracticePackage;
  errors: string[];
}

/**
 * Extracts and parses JSON from raw input string, tolerant of code fences.
 */
export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip code fences if present: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const target = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(target);
}

/**
 * Validates a practice package against the nodal.practice.v1 specification.
 */
export function validatePracticePackage(input: string | unknown, expectedNoteId?: string): ValidationResult {
  const errors: string[] = [];
  let data: any;

  if (typeof input === 'string') {
    try {
      data = extractJsonFromText(input);
    } catch (e) {
      return { valid: false, errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
  } else {
    data = input;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Expected root JSON object.'] };
  }

  if (data.schemaVersion !== 'nodal.practice.v1') {
    errors.push(`Invalid schemaVersion: expected "nodal.practice.v1", got "${data.schemaVersion}"`);
  }

  if (!data.noteId || typeof data.noteId !== 'string') {
    errors.push('Missing or invalid "noteId" field (must be non-empty string).');
  } else if (expectedNoteId && data.noteId !== expectedNoteId) {
    errors.push(`Target noteId mismatch: package has "${data.noteId}", expected "${expectedNoteId}".`);
  }

  if (typeof data.sourceRevision !== 'string') {
    errors.push('Missing "sourceRevision" field (must be string).');
  }

  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    errors.push('Missing or empty "cards" array.');
    return { valid: false, errors };
  }

  const seenIds = new Set<string>();

  data.cards.forEach((card: any, idx: number) => {
    const cardLoc = `Card #${idx + 1} (${card.id ?? 'unnamed'})`;

    if (!card || typeof card !== 'object') {
      errors.push(`${cardLoc}: must be an object.`);
      return;
    }

    if (!card.id || typeof card.id !== 'string') {
      errors.push(`${cardLoc}: missing or invalid "id".`);
    } else {
      if (seenIds.has(card.id)) {
        errors.push(`${cardLoc}: duplicate card id "${card.id}".`);
      }
      seenIds.add(card.id);
    }

    if (card.sectionId !== null && typeof card.sectionId !== 'string') {
      errors.push(`${cardLoc}: "sectionId" must be null or string.`);
    }

    if (!['flashcard', 'choice', 'cloze'].includes(card.type)) {
      errors.push(`${cardLoc}: invalid type "${card.type}". Must be "flashcard", "choice", or "cloze".`);
      return;
    }

    if (card.type === 'flashcard') {
      if (!card.frontMarkdown || typeof card.frontMarkdown !== 'string' || !card.frontMarkdown.trim()) {
        errors.push(`${cardLoc}: flashcard missing "frontMarkdown".`);
      }
      if (!card.backMarkdown || typeof card.backMarkdown !== 'string' || !card.backMarkdown.trim()) {
        errors.push(`${cardLoc}: flashcard missing "backMarkdown".`);
      }
    } else if (card.type === 'choice') {
      if (!card.frontMarkdown || typeof card.frontMarkdown !== 'string' || !card.frontMarkdown.trim()) {
        errors.push(`${cardLoc}: choice question missing "frontMarkdown".`);
      }
      if (!Array.isArray(card.options) || card.options.length < 2) {
        errors.push(`${cardLoc}: choice question must have at least 2 options in "options" array.`);
      } else {
        const optionIds = new Set<string>();
        card.options.forEach((opt: any, optIdx: number) => {
          if (!opt || typeof opt !== 'object') {
            errors.push(`${cardLoc} option #${optIdx + 1}: must be an object.`);
            return;
          }
          if (!opt.id || typeof opt.id !== 'string') {
            errors.push(`${cardLoc} option #${optIdx + 1}: missing option "id".`);
          } else {
            optionIds.add(opt.id);
          }
          if (!opt.textMarkdown || typeof opt.textMarkdown !== 'string' || !opt.textMarkdown.trim()) {
            errors.push(`${cardLoc} option #${optIdx + 1}: missing "textMarkdown".`);
          }
        });

        if (!card.correctOptionId || !optionIds.has(card.correctOptionId)) {
          errors.push(`${cardLoc}: "correctOptionId" ("${card.correctOptionId}") must match an existing option id.`);
        }
      }
    } else if (card.type === 'cloze') {
      if (!card.promptMarkdown || typeof card.promptMarkdown !== 'string' || !card.promptMarkdown.trim()) {
        errors.push(`${cardLoc}: cloze missing "promptMarkdown".`);
      } else if (!card.promptMarkdown.includes('{{blank:')) {
        errors.push(`${cardLoc}: cloze "promptMarkdown" must contain at least one "{{blank:ID}}" placeholder.`);
      }

      if (!Array.isArray(card.blanks) || card.blanks.length === 0) {
        errors.push(`${cardLoc}: cloze must have at least one blank in "blanks" array.`);
      } else {
        card.blanks.forEach((b: any, bIdx: number) => {
          if (!b || typeof b !== 'object') {
            errors.push(`${cardLoc} blank #${bIdx + 1}: must be an object.`);
            return;
          }
          if (!b.id || typeof b.id !== 'string') {
            errors.push(`${cardLoc} blank #${bIdx + 1}: missing "id".`);
          } else if (card.promptMarkdown && !card.promptMarkdown.includes(`{{blank:${b.id}}}`)) {
            errors.push(`${cardLoc}: blank id "${b.id}" not found in promptMarkdown as "{{blank:${b.id}}}".`);
          }
          if (!b.answerMarkdown || typeof b.answerMarkdown !== 'string' || !b.answerMarkdown.trim()) {
            errors.push(`${cardLoc} blank #${bIdx + 1}: missing "answerMarkdown".`);
          }
        });
      }
    }
  });

  return {
    valid: errors.length === 0,
    package: errors.length === 0 ? (data as PracticePackage) : undefined,
    errors,
  };
}

export interface GeneratePracticePromptOptions {
  questionCount?: number | null;
  targetSectionId?: string | null;
}

/**
 * Generates an LLM prompt for generating practice cards from a note.
 */
export function generatePracticePrompt(
  note: KnowledgeNode,
  sections: NotePanel[],
  options?: GeneratePracticePromptOptions
): string {
  const noteGuidance = note.aiGuidance?.note ? `\n[Note-Level Guidance]:\n${note.aiGuidance.note}` : '';

  let relevantSections = sections;
  let scopeNotice = '';

  if (options?.targetSectionId && options.targetSectionId !== 'all') {
    if (options.targetSectionId === 'global') {
      scopeNotice = '\nScope constraint: Generate questions covering the overall concepts across the whole note ("sectionId": null).\n';
    } else {
      const match = sections.find(s => s.id === options.targetSectionId);
      if (match) {
        relevantSections = [match];
        scopeNotice = `\nScope constraint: Focus specifically on section "${match.id}". Set "sectionId": "${match.id}" on generated cards.\n`;
      }
    }
  }

  const sectionsText = relevantSections.map((s, idx) => {
    const secGuidance = note.aiGuidance?.sections?.[s.id] ? `\n  Guidance: ${note.aiGuidance.sections[s.id]}` : '';
    return `### Section ID: "${s.id}" (Section ${idx + 1})\n${s.markdown}${secGuidance}`;
  }).join('\n\n');

  const countInstruction = options?.questionCount && options.questionCount > 0
    ? `Produce exactly ${options.questionCount} practice items in total.`
    : 'Produce a balanced set of practice items:';

  return `You are generating retrieval practice questions for the note titled "${note.title || 'Untitled Note'}".
Target noteId: "${note.id}"
Source revision: "${note.updatedAt || Date.now()}"
${scopeNotice}
${noteGuidance}

Source Content:
${sectionsText}

Instructions:
1. Output ONLY a single JSON object conforming to the "nodal.practice.v1" schema.
2. ${countInstruction}
   - "flashcard": conceptual recall questions (frontMarkdown & backMarkdown).
   - "choice": multiple choice questions with at least 2 options, correctOptionId (or correctOptionIds array for multi-select), and explanationMarkdown.
   - "cloze": fill-in-the-blank statements with {{blank:ID}} markers and matching blanks array.
3. Every card must have a unique "id".
4. If a card covers the whole note, set "sectionId": null.
   If a card tests a specific section, set "sectionId" to the exact section ID quoted above.
5. All markdown must be valid UTF-8 strings. Do not invent timestamps, review intervals, or FSRS states.

Output JSON schema structure:
{
  "schemaVersion": "nodal.practice.v1",
  "noteId": "${note.id}",
  "sourceRevision": "${note.updatedAt || Date.now()}",
  "cards": [
    {
      "id": "q1",
      "sectionId": null,
      "type": "flashcard",
      "frontMarkdown": "...",
      "backMarkdown": "..."
    },
    {
      "id": "q2",
      "sectionId": "${sections[0]?.id ?? 'sec-1'}",
      "type": "choice",
      "frontMarkdown": "...",
      "options": [
        { "id": "a", "textMarkdown": "..." },
        { "id": "b", "textMarkdown": "..." }
      ],
      "correctOptionId": "a",
      "explanationMarkdown": "..."
    },
    {
      "id": "q3",
      "sectionId": "${sections[0]?.id ?? 'sec-1'}",
      "type": "cloze",
      "promptMarkdown": "In a 0-indexed heap, the left child is at {{blank:b1}}.",
      "blanks": [
        { "id": "b1", "answerMarkdown": "2i + 1" }
      ],
      "explanationMarkdown": "..."
    }
  ]
}`;
}
