import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useApp } from '../../app/useApp';
import type { RecallDraft, RecallPresentation } from '../../domain/types';
import { addPassageDrafts, getRecallDrafts, publishRecallDrafts, removeRecallDraft, updateRecallDraft } from '../../repositories/recallDraftRepository';
import { MarkdownReading } from '../nodes/MarkdownReading';
import { SelectionRecall } from './SelectionRecall';
import { maskedContext, recallBlocks, targetAnchors } from './recallAnchors';
import { db } from '../../db/database';
import { normalizePlan } from './deadlineScheduler';
import { setAssignment } from '../../repositories/planAssignmentRepository';

function DraftRow({ draft, selected, toggle, busy, onReady }: { draft: RecallDraft; selected: boolean; toggle: () => void; busy: boolean; onReady: (id: string, ready: boolean) => void }) {
  const [prompt, setPrompt] = useState(draft.prompt);
  const [error, setError] = useState('');
  const saveVersion = useRef(0);
  const save = (presentation: RecallPresentation, value: string) => {
    const version = ++saveVersion.current;
    onReady(draft.id, false); setError('');
    void updateRecallDraft(draft.id, { presentation, prompt: value }).then(() => {
      if (version === saveVersion.current) onReady(draft.id, true);
    }).catch(() => { if (version === saveVersion.current) setError('Draft could not be saved. Edit the question to retry before publishing.'); });
  };
  return <article className="batch-draft">
    <header><label><input type="checkbox" aria-label={`Select: ${draft.anchor.text}`} checked={selected} disabled={busy} onChange={toggle} />{draft.anchor.text}</label>
      <button disabled={busy} aria-label={`Remove draft: ${draft.anchor.text}`} onClick={() => void removeRecallDraft(draft.id).catch(() => setError('Could not remove draft. Try again.'))}>×</button></header>
    <p className="batch-context">{targetAnchors(draft).map(anchor => draft.presentation === 'question' || anchor.blockMarkdown !== undefined ? anchor.context : maskedContext(anchor)).join('\n\n')}</p>
    <small>{targetAnchors(draft).length} source blocks · one rating</small>
    <ChoiceSelect aria-label="Presentation" disabled={busy} value={draft.presentation} onChange={event => save(event.target.value as RecallPresentation, prompt)}>
      <option value="cloze">Cloze in context</option><option value="hidden">Hidden passage</option><option value="question">Custom question</option>
    </ChoiceSelect>
    {(draft.presentation === 'question' || targetAnchors(draft).some(a => a.blockMarkdown !== undefined)) && <input aria-label="Recall question" disabled={busy} placeholder="What should these blocks help you answer?" value={prompt} onChange={event => { setPrompt(event.target.value); save(draft.presentation, event.target.value); }} />}
    {error && <p role="alert">{error}</p>}
  </article>;
}

export function BatchRecall() {
  const { nodes, selectedNodeId, startReview, setActiveView } = useApp();
  const [sourceId, setSourceId] = useState(selectedNodeId ?? nodes[0]?.id ?? '');
  const [drafts, setDrafts] = useState<RecallDraft[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [plans, setPlans] = useState<Array<{ id: string; title: string }>>([]);
  const [batchPlanId, setBatchPlanId] = useState('');
  const [appliedMsg, setAppliedMsg] = useState('');
  const [passageMode, setPassageMode] = useState(false);
  const [passageIds, setPassageIds] = useState<number[]>([]);
  const [unready, setUnready] = useState<string[]>([]);
  const onReady = (id: string, ready: boolean) => setUnready(ids => ready ? ids.filter(value => value !== id) : [...new Set([...ids, id])]);

  useEffect(() => {
    if (selectedNodeId) setSourceId(selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    const subP = liveQuery(() => db.semesterPlans.orderBy('updatedAt').reverse().toArray()).subscribe({ next: rows => setPlans(rows.map(normalizePlan).map(p => ({ id: p.id, title: p.title }))) });
    const subscription = liveQuery(getRecallDrafts).subscribe({ next: setDrafts, error: () => setMessage('Could not load drafts.') });
    return () => { subscription.unsubscribe(); subP.unsubscribe(); };
  }, []);

  const source = nodes.find(n => n.id === sourceId);
  // Isolate drafts strictly to this source note so other notes never appear in this note's editor
  const noteDrafts = drafts.filter(d => d.sourceId === sourceId);
  const selected = noteDrafts.filter(d => !excluded.includes(d.id));
  const missingCues = selected.filter(d => (d.presentation === 'question' || targetAnchors(d).some(a => a.blockMarkdown !== undefined)) && !d.prompt.trim()).length;
  const passages = recallBlocks(source?.contentMarkdown ?? '').filter(b => (b.kind === 'paragraph' || b.kind === 'tableCell') && b.text.length > 30);
  const collect = async () => {
    if (!source || busy) return;
    setBusy(true);
    try { await addPassageDrafts(source.id, passages.filter(b => passageIds.includes(b.start)).map(b => ({ text: b.text, context: b.text, start: 0, end: b.text.length, blockStart: b.start }))); setPassageIds([]); setMessage('Passages added. Write a recall question for each in the draft tray, then publish together.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not collect passages. Try again.'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (busy || selected.some(d => unready.includes(d.id))) return;
    setBusy(true); setMessage('');
    try { const ids = await publishRecallDrafts(selected.map(d => d.id)); setSaved(ids); setMessage(`Saved ${ids.length} recall prompts. Duplicates were merged.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed. This batch has not been written.'); }
    finally { setBusy(false); }
  };
  const applyBatchPlan = async () => {
    if (!batchPlanId || !saved.length) return;
    for (const tid of saved) await setAssignment({ reviewPlanId: batchPlanId, subjectType: 'retrieval_target', subjectId: tid });
    setAppliedMsg(`Applied plan to ${saved.length} prompts.`);
  };
  return <main className="batch-workspace">
    <header className="batch-heading"><div><button className="ghost" onClick={() => setActiveView('nodes')}>← Back to notes</button><h1>Batch recall: {source?.title || 'Note'}</h1><p>1. Select words or passages in your note. 2. Write a question for each passage. 3. Publish the selected drafts as recall prompts.</p></div>
      <div><button className="primary" disabled={busy || !selected.length || !!missingCues || selected.some(d => unready.includes(d.id))} onClick={() => void publish()}>{busy ? 'Saving…' : `Publish ${selected.length} selected`}</button>{missingCues > 0 && <small>{missingCues} passages need a question below</small>}{saved.length > 0 && <button onClick={() => startReview(saved)}>Review published prompts →</button>}
      {saved.length > 0 && <span className="batch-plan-apply"><ChoiceSelect aria-label="Plan to apply" value={batchPlanId} onChange={e => setBatchPlanId(e.target.value)}><option value="">Apply plan to these…</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</ChoiceSelect><button className="ghost" disabled={!batchPlanId} onClick={() => void applyBatchPlan()}>Apply</button></span>}
      {appliedMsg && <small>{appliedMsg}</small>}</div></header>
    {message && <p className="batch-message" role="status">{message}</p>}
    <div className="batch-columns"><section className="batch-source">
      <div className="batch-source-context" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--surface-secondary)', borderRadius: '10px', marginBottom: '14px', border: '1px solid var(--border)' }}>
        <div>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Current Note</span>
          <strong style={{ display: 'block', fontSize: '15px' }}>{source?.title || 'Untitled note'}</strong>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{noteDrafts.length} drafts</span>
      </div>
      <div className="batch-source-tools mode-toggle"><button className={!passageMode ? 'selected' : ''} onClick={() => setPassageMode(false)}>Select words</button><button className={passageMode ? 'selected' : ''} onClick={() => setPassageMode(true)}>Select passages</button></div>
      {passageMode ? <div className="passage-picker"><p>Select several passages at once. Each will need its own question, not an empty cloze.</p><button disabled={busy || !passages.length} onClick={() => setPassageIds(passageIds.length === passages.length ? [] : passages.map(b => b.start))}>{passageIds.length === passages.length ? 'Deselect passages' : 'Select all passages'}</button>{passages.map(b => <label key={b.start}><input type="checkbox" disabled={busy} checked={passageIds.includes(b.start)} onChange={() => setPassageIds(ids => ids.includes(b.start) ? ids.filter(id => id !== b.start) : [...ids, b.start])} /><span>{b.text}</span></label>)}<button className="primary" disabled={busy || !passageIds.length} onClick={() => void collect()}>Add {passageIds.length} passages to batch</button></div> : source ? <SelectionRecall key={source.id} sourceId={source.id} batch><h2>{source.title}</h2><MarkdownReading transcludeGetNode={(id) => nodes.find(n => n.id === id)}>{source.contentMarkdown}</MarkdownReading></SelectionRecall> : <p>Create a note first.</p>}
    </section><aside className="batch-tray"><header><h2>Drafts · {noteDrafts.length}</h2><button disabled={busy} onClick={() => setExcluded(selected.length === noteDrafts.length ? noteDrafts.map(d => d.id) : [])}>{selected.length === noteDrafts.length ? 'Deselect all' : 'Select all'}</button></header>
      <p>Drafts are saved locally for this note.</p>
      {!noteDrafts.length && <p className="empty-state">Select words and choose Add to batch, or select passages on the left.</p>}
      {noteDrafts.map(draft => <div key={draft.id}><DraftRow draft={draft} selected={!excluded.includes(draft.id)} busy={busy} onReady={onReady} toggle={() => setExcluded(ids => ids.includes(draft.id) ? ids.filter(id => id !== draft.id) : [...ids, draft.id])} /></div>)}
    </aside></div>
  </main>;
}
