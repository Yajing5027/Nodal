import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hasVisibleRecallContext, recallBlocks } from './recallAnchors';
import type { RecallAnchor, RecallPresentation } from '../../domain/types';
import { addRecallDraft, publishRecallDrafts } from '../../repositories/recallDraftRepository';

export type RecallCreated = (targetIds: string[], practice: boolean) => void;

export function SelectionRecall({ sourceId, children, batch = false, onSaved, onCreated, getMarkdown, beforeSave }: {
  sourceId: string; children: ReactNode; batch?: boolean; onSaved?: () => void;
  onCreated?: RecallCreated;
  getMarkdown?: () => string; beforeSave?: () => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ anchor: RecallAnchor; anchors: RecallAnchor[]; x: number; y: number } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const capture = () => {
    const value = window.getSelection();
    if (!value || value.isCollapsed || !value.rangeCount) { setSelection(null); return; }
    const range = value.getRangeAt(0);
    if (!root.current?.contains(range.startContainer) || !root.current.contains(range.endContainer)) { setSelection(null); return; }
    // Transcluded text is a live projection from another Node; the destination
    // Markdown does not canonically contain it, so recall must be created at the
    // source Section, not anchored here.
    const ancestor = (range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer) as HTMLElement | null;
    if (ancestor?.closest?.('[data-transclusion-projection]')) {
      setSelection(null);
      setMessage('This is a live reference to another note. Open the source section (From… button) to create recall material there.');
      return;
    }
    const selector = getMarkdown ? 'p,li,h1,h2,h3,h4,h5,h6,td,th' : '[data-recall-start]';
    const candidates = [...root.current.querySelectorAll<HTMLElement>(selector)].filter(block => range.intersectsNode(block));
    const blocks = candidates.filter(block => !/^H[1-6]$/.test(block.tagName) && !candidates.some(other => other !== block && block.contains(other)));
    const anchors: RecallAnchor[] = [];
    for (const block of blocks) {
      const clipped = document.createRange(); clipped.selectNodeContents(block);
      if (clipped.compareBoundaryPoints(Range.START_TO_START, range) < 0) clipped.setStart(range.startContainer, range.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, range) > 0) clipped.setEnd(range.endContainer, range.endOffset);
      const text = clipped.toString();
      if (!text.trim()) continue;
      const prefix = document.createRange(); prefix.selectNodeContents(block); prefix.setEnd(clipped.startContainer, clipped.startOffset);
      const start = prefix.toString().length, context = block.textContent ?? '';
      let blockStart = Number(block.dataset.recallStart);
      if (getMarkdown) {
        const kind = block.tagName === 'LI' ? 'listItem' : ['TD','TH'].includes(block.tagName) ? 'tableCell' : 'paragraph';
        const panel = block.closest<HTMLElement>('[data-panel-start]');
        const matches = recallBlocks(getMarkdown()).filter(item => item.text === context && item.kind === kind && (!panel || (item.start >= Number(panel.dataset.panelStart) && item.start < Number(panel.dataset.panelEnd))));
        const peers = [...(panel ?? root.current).querySelectorAll(selector)].filter(item => item.tagName === block.tagName && item.textContent === context);
        const match = matches.filter((item, index, all) => all.findIndex(other => other.start === item.start) === index)[peers.indexOf(block)];
        if (!match) { setSelection(null); setMessage('This selection could not be matched reliably. Use whole-block selection in Read mode for formulas or code.'); return; }
        blockStart = match.start;
      }
      anchors.push({ text, context, start, end: start + text.length, blockStart });
    }
    if (!anchors.length) { setSelection(null); setMessage('Headings provide context. Select source text or use Whole blocks.'); return; }
    const rect = range.getBoundingClientRect();
    setSelection({ anchor: anchors[0], anchors, x: Math.max(12, Math.min(rect.left, window.innerWidth - 390)), y: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 90)) });
    setMessage('');
  };
  const captureRef = useRef(capture);
  useEffect(() => { captureRef.current = capture; });
  useEffect(() => {
    const changed = () => captureRef.current();
    const dismiss = () => setSelection(null);
    document.addEventListener('selectionchange', changed);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('selectionchange', changed); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, []);
  const add = async (presentation: RecallPresentation, queue: boolean, practice = false) => {
    if (!selection || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await beforeSave?.();
      const draft = await addRecallDraft(sourceId, selection.anchor, presentation, selection.anchors.length > 1 ? selection.anchors : undefined);
      const ids = queue ? [] : await publishRecallDrafts([draft.id]);
      setMessage(queue ? 'Added to Batch studio.' : 'Recall prompt saved.');
      setSelection(null); window.getSelection()?.removeAllRanges(); onSaved?.();
      if (ids.length) onCreated?.(ids, practice);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed. Please try again.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="selection-recall" ref={root} onMouseUp={capture} onKeyUp={capture}>
    {children}
    {selection && createPortal(<div role="toolbar" aria-label="Selection recall actions" className="selection-toolbar" style={{left:selection.x, top:selection.y}} onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()}>
      {selection.anchors.length > 1 && <small>{selection.anchors.length} source blocks</small>}
      <button disabled={busy || !selection.anchors.some(hasVisibleRecallContext)} onClick={() => void add('cloze', batch)}>Create cloze</button>
      {onCreated && !batch && <button disabled={busy || !selection.anchors.some(hasVisibleRecallContext)} onClick={() => void add('cloze', false, true)}>Create & practice</button>}
      <button disabled={busy} onClick={() => void add(!selection.anchors.some(hasVisibleRecallContext) ? 'question' : 'cloze', true)}>Add to batch</button>
      <button disabled={busy} onClick={() => void add('question', true)}>Add question</button>
      {!selection.anchors.some(hasVisibleRecallContext) && <small>Add a question to give these blocks a cue.</small>}
      <button aria-label="Close selection actions" onClick={() => setSelection(null)}>×</button>
    </div>, document.body)}
    {message && <p className="selection-status" role="status">{message}</p>}
  </div>;
}
