import { useMemo, useRef, useState } from 'react';
import type { RecallCreated } from './SelectionRecall';
import type { RecallAnchor } from '../../domain/types';
import { addRecallDraft, publishRecallDrafts } from '../../repositories/recallDraftRepository';
import { MarkdownReading, type WordSelectionState } from '../nodes/MarkdownReading';
import { documentBlocks, wholeBlockAnchor, type RecallBlock } from './recallAnchors';
import { CardDocument } from '../cards/CardDocument';

type Selection = { text: string; start: number; end: number };
export function WordRecallPicker({ sourceId, markdown, onSaved, onClose, onCreated }: {
  sourceId: string; markdown: string; onSaved?: () => void; onClose: () => void;
  onCreated?: RecallCreated;
}) {
  const [selected, setSelected] = useState<Record<number, { block: RecallBlock; selections: Selection[] }>>({});
  const [hidden, setHidden] = useState<number[]>([]);
  const [mode, setMode] = useState<'words' | 'blocks'>('words');
  const [view, setView] = useState<'select' | 'preview' | 'practice'>('select');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [cue, setCue] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [history, setHistory] = useState<Array<{ selected: typeof selected; hidden: number[]; mode: typeof mode }>>([]);
  const remember = () => setHistory(current => [...current.slice(-49), { selected, hidden, mode }]);
  const blocks = useMemo(() => documentBlocks(markdown), [markdown]);
  const wordSelection: WordSelectionState = { blockStart: null, selections: [],
    byBlock: Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, value.selections])),
    onToggle: (block, selection) => { if (saving.current) return; remember(); setSelected(current => {
      const previous = current[block.start]?.selections ?? [];
      const selections = previous.some(s => s.start === selection.start && s.end === selection.end)
        ? previous.filter(s => s.start !== selection.start || s.end !== selection.end) : [...previous, selection];
      return { ...current, [block.start]: { block, selections } };
    }); },
  };
  const anchors: RecallAnchor[] = mode === 'blocks' ? blocks.filter(block => hidden.includes(block.start)).map(wholeBlockAnchor)
    : Object.values(selected).filter(item => item.selections.length).sort((a, b) => a.block.start - b.block.start).map(({ block, selections }) => {
      const ordered = selections.slice().sort((a, b) => a.start - b.start);
      return { ...ordered[0], context: block.text, blockStart: block.start, selections: ordered, sectionPath: block.sectionPath.filter(Boolean) };
    });
  const count = mode === 'blocks' ? anchors.length : anchors.reduce((n, anchor) => n + (anchor.selections?.length ?? 1), 0);
  const save = async (queue: boolean, practice = false) => {
    if (!anchors.length || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const draft = await addRecallDraft(sourceId, anchors[0], mode === 'blocks' ? 'hidden' : 'cloze', anchors, cue);
      const ids = queue ? [] : await publishRecallDrafts([draft.id]);
      setSelected({}); setHidden([]); setHistory([]); setCue(''); setView('select'); setOverrides({}); onSaved?.();
      if (ids.length) onCreated?.(ids, practice);
      setMessage(queue ? 'Added to Batch studio. Keep selecting.' : 'Recall prompt saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="word-recall-picker">
    <div className="word-picker-guide"><strong>Select recall content</strong>{message && <span role="status">{message}</span>}</div>
    <div className="block-mode-switch" role="group" aria-label="Selection mode">
      <button disabled={busy} aria-pressed={mode === 'words'} onClick={() => { setMode('words'); setView('select'); }}>Words across paragraphs</button>
      <button disabled={busy} aria-pressed={mode === 'blocks'} onClick={() => { setMode('blocks'); setView('select'); }}>Whole blocks</button>
      {(count > 0 || history.length > 0) && <>
        <button disabled={busy || !history.length} onClick={() => { const previous = history.at(-1)!; setSelected(previous.selected); setHidden(previous.hidden); setMode(previous.mode); setHistory(current => current.slice(0, -1)); setView('select'); }}>Undo selection</button>
        <button disabled={busy || !count} onClick={() => { remember(); if (mode === 'words') setSelected({}); else setHidden([]); setView('select'); }}>Clear selection</button>
      </>}
    </div>
    {count > 0 && <div className="selection-preview-tabs" role="group" aria-label="Selection preview">
      <button aria-pressed={view === 'select'} onClick={() => setView('select')}>Select</button>
      <button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview selection</button>
      <button aria-pressed={view === 'practice'} onClick={() => { setView('practice'); setOverrides({}); }}>Try blanks</button>
    </div>}
    {view !== 'select' ? <CardDocument markdown={markdown} anchors={anchors} preview={view === 'preview'} revealOverrides={overrides} onRevealChange={(id, visible) => setOverrides(current => ({ ...current, [id]: visible }))} /> : mode === 'words' ? <MarkdownReading wordSelection={wordSelection}>{markdown}</MarkdownReading>
      : <div className="block-selection-document">{blocks.map((block, index) => <section key={block.start} className={hidden.includes(block.start) ? 'document-block selected' : 'document-block'}>
        <button className="block-selector" aria-label={`Select block ${index + 1}: ${block.kind}`} aria-pressed={hidden.includes(block.start)}
          disabled={busy} onClick={() => { remember(); setHidden(current => current.includes(block.start) ? current.filter(start => start !== block.start) : [...current, block.start]); }}>{hidden.includes(block.start) ? '✓' : '+'}<span>{block.kind}</span></button>
        <MarkdownReading>{block.markdown}</MarkdownReading>
      </section>)}</div>}
    <div className="word-picker-dock" role="toolbar" aria-label="Selected word actions">
      <span><strong>{count}</strong> {mode === 'blocks' ? 'blocks' : 'words'} in {anchors.length} blocks</span>
      {mode === 'blocks' && <input disabled={busy} aria-label="Recall cue for hidden blocks" placeholder="Question / cue that stays visible" value={cue} onChange={event => setCue(event.target.value)} />}
      <button disabled={busy || !anchors.length || (mode === 'blocks' && !cue.trim())} onClick={() => void save(false)}>{mode === 'blocks' ? 'Hide selected blocks' : 'Create one cloze'}</button>
      {onCreated && <button disabled={busy || !anchors.length || (mode === 'blocks' && !cue.trim())} onClick={() => void save(false, true)}>Create & practice</button>}
      <button disabled={busy || !anchors.length} onClick={() => void save(true)}>Add to batch</button>
      <button disabled={busy} onClick={onClose}>Done</button>
    </div>
  </div>;
}
