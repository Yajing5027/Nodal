import { db } from '../db/database';
import { RECALL_DRAFT_KEY } from '../db/schema';
export { RECALL_DRAFT_KEY } from '../db/schema';
import { newId, now } from '../domain/id';
import type { RecallDraft, RecallAnchor, RecallPresentation } from '../domain/types';
import { anchorSelections, resolveAnchor, validAnchor, maskedContext, hasVisibleRecallContext, targetAnchors } from '../features/review/recallAnchors';
import { createRetrievalTarget } from './reviewRepository';

export async function getRecallDrafts(): Promise<RecallDraft[]> {
  return (await db.meta.get(RECALL_DRAFT_KEY))?.value as RecallDraft[] ?? [];
}
export async function addPassageDrafts(sourceId: string, anchors: RecallAnchor[]) {
  return db.transaction('rw', [db.meta, db.nodes], async () => {
    for (const anchor of anchors) await addRecallDraft(sourceId, anchor, 'question');
  });
}
export async function addRecallDraft(sourceId: string, anchor: RecallAnchor, presentation: RecallPresentation, anchors?: RecallAnchor[], prompt = '') {
  const all = anchors?.length ? anchors : [anchor];
  if (!all.every(validAnchor) || new Set(all.map(a => a.blockStart)).size !== all.length) throw new Error('Select valid, distinct source blocks.');
  return db.transaction('rw', [db.meta, db.nodes], async () => {
    const node = await db.nodes.get(sourceId);
    if (!node || !all.every(a => resolveAnchor(node.contentMarkdown, a))) throw new Error('The source changed. Please select the passage again.');
    const drafts = await getRecallDrafts();
    const signature = JSON.stringify(all);
    const existing = drafts.find(d => d.sourceId === sourceId && d.presentation === presentation &&
      JSON.stringify(targetAnchors(d)) === signature && d.prompt === prompt);
    if (existing) return existing;
    const draft: RecallDraft = { id: newId(), sourceId, anchor, ...(anchors ? { anchors } : {}), presentation, prompt, createdAt: now() };
    await db.meta.put({ key: RECALL_DRAFT_KEY, value: [...drafts, draft] });
    return draft;
  });
}
export async function updateRecallDraft(id: string, changes: Pick<RecallDraft, 'prompt' | 'presentation'>) {
  await db.transaction('rw', db.meta, async () => {
    const drafts = await getRecallDrafts();
    await db.meta.put({ key: RECALL_DRAFT_KEY, value: drafts.map(d => d.id === id ? { ...d, ...changes } : d) });
  });
}
export async function removeRecallDraft(id: string) {
  await db.transaction('rw', db.meta, async () => {
    await db.meta.put({ key: RECALL_DRAFT_KEY, value: (await getRecallDrafts()).filter(d => d.id !== id) });
  });
}
export async function publishRecallDrafts(ids: string[]): Promise<string[]> {
  return db.transaction('rw', [db.meta, db.nodes, db.retrievalTargets, db.memoryStates], async () => {
    const drafts = await getRecallDrafts();
    const selected = drafts.filter(d => ids.includes(d.id));
    if (!selected.length) throw new Error('Select at least one draft.');
    const result: string[] = [];
    for (const draft of selected) {
      const node = await db.nodes.get(draft.sourceId);
      const resolved = node ? targetAnchors(draft).map(a => resolveAnchor(node.contentMarkdown, a)) : [];
      if (!node || !resolved.length || resolved.some(a => !a)) throw new Error('A source changed or was deleted. Select it again; this batch has not been saved.');
      const anchors = resolved as RecallAnchor[];
      const anchor = anchors[0];
      const wholeBlocks = anchors.some(a => a.blockMarkdown !== undefined);
      if (draft.presentation === 'question' && !draft.prompt.trim()) throw new Error('Add a question, or select Cloze / Hidden passage.');
      if (wholeBlocks && draft.presentation !== 'question' && !draft.prompt.trim()) throw new Error('Add a visible question or cue for the hidden blocks.');
      if (!wholeBlocks && draft.presentation !== 'question' && !anchors.some(hasVisibleRecallContext)) throw new Error('This would hide the entire context. Choose Custom question and add a cue, or select fewer words.');
      const prompt = wholeBlocks ? draft.prompt.trim() : draft.presentation === 'cloze' ? anchors.map(maskedContext).join('\n\n') : draft.presentation === 'hidden' ? 'Recall this passage' : draft.prompt.trim();
      const signature = JSON.stringify(anchors);
      const existing = (await db.retrievalTargets.where('[sourceType+sourceId]').equals(['node', node.id]).toArray()).find(t =>
        t.status !== 'archived' && t.presentation === draft.presentation && JSON.stringify(targetAnchors(t)) === signature && t.promptMarkdown === prompt);
      if (existing) { result.push(existing.id); continue; }
      const target = await createRetrievalTarget({ sourceType: 'node', sourceId: node.id, promptMarkdown: prompt,
        expectedEvidenceMarkdown: anchors.map(a => a.blockMarkdown ?? anchorSelections(a).map(selection => selection.text).join(' · ')).join('\n\n'),
        presentation: draft.presentation, anchor, ...(draft.anchors ? { anchors } : {}) });
      result.push(target.id);
    }
    await db.meta.put({ key: RECALL_DRAFT_KEY, value: drafts.filter(d => !ids.includes(d.id)) });
    return result;
  });
}
