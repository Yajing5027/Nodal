import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { recallPrompt } from './recallAnchors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { ID, RetrievalTargetKind } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { CardDocument } from '../cards/CardDocument';
import { ReviewHistory } from './ReviewHistory';
import { PlanAssignmentControl } from './PlanAssignmentControl';
import { TargetNodeLinksEditor } from './TargetNodeLinksEditor';
import {
  createRetrievalTarget,
  archiveRetrievalTarget,
  getRetrievalTargetsForSource,
} from '../../repositories/reviewRepository';

const KINDS: Array<{ value: RetrievalTargetKind; label: string }> = [
  { value: 'atomic_fact', label: 'Recall a fact' },
  { value: 'explanation', label: 'Explain why / how' },
  { value: 'application', label: 'Apply it' },
  { value: 'discrimination', label: 'Tell apart' },
  { value: 'example_generation', label: 'Generate an example' },
];

function dueLabel(dueAt: number, learningState: string): string {
  if (learningState === 'new') return 'New';
  const delta = dueAt - Date.now();
  if (delta <= 0) return 'Due now';
  const minutes = Math.ceil(delta / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 36) return `in ${hours}h`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(dueAt);
}

export function RecallTargetsPanel({ nodeId }: { nodeId: ID }) {
  const { startReview, setActiveView, getNode } = useApp();
  const [expanded, setExpanded] = useState<ID | null>(null);
  const [items, setItems] = useState<Awaited<ReturnType<typeof getRetrievalTargetsForSource>>>([]);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<RetrievalTargetKind>('atomic_fact');
  const [prompt, setPrompt] = useState('');
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    setItems(await getRetrievalTargetsForSource('node', nodeId));
  }, [nodeId]);

  useEffect(() => {
    const subscription = liveQuery(() => getRetrievalTargetsForSource('node', nodeId)).subscribe({ next: setItems });
    return () => subscription.unsubscribe();
  }, [nodeId]);

  const save = async () => {
    if (!prompt.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await createRetrievalTarget({
        sourceType: 'node',
        sourceId: nodeId,
        kind,
        promptMarkdown: prompt,
        expectedEvidenceMarkdown: evidence,
      });
      setPrompt('');
      setEvidence('');
      setCreating(false);
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the prompt. Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="recall-panel">
      <div className="recall-panel-heading">
        <div>
          <strong>Recall from this note</strong>
          
        </div>
        <div className="recall-actions">
          <button className="ghost" onClick={() => setActiveView('cards')}>All prompts</button>
          <button className="ghost" onClick={() => setActiveView('batch')}>Batch studio</button>
          <button onClick={() => setCreating((value) => !value)}>＋ Add question</button>
        </div>
      </div>

      {creating && (
        <div className="recall-composer">
          <ChoiceSelect aria-label="Question type" value={kind} onChange={(event) => setKind(event.target.value as RetrievalTargetKind)}>
            {KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </ChoiceSelect>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What would you like to recall without looking?"
            rows={2}
            autoFocus
          />
          <textarea
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="Answer or key points (hidden until you reveal)"
            rows={3}
          />
          <div className="composer-actions">
            <button className="ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="primary" disabled={saving || !prompt.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save prompt'}</button>
          </div>
          {saveError && <p role="alert">{saveError}</p>}
        </div>
      )}

      <div className="recall-unit-list">
        {items.length === 0 ? (
          <button className="recall-empty" onClick={() => setCreating(true)}>
            ＋ Add the first recall question
          </button>
        ) : items.map(({ target, state, stepLabel }) => (
          <div className="recall-unit" key={target.id}>
            <span className={`memory-dot is-${state.learningState}`} aria-hidden="true" />
            <div className="recall-unit-content">
              <button className="recall-open" onClick={() => { setExpanded(expanded === target.id ? null : target.id); }}>{recallPrompt(target)}<span>Preview ↗</span></button>
              <small>{dueLabel(state.dueAt, state.learningState)}{stepLabel ? ` · ${stepLabel}` : ''} · {state.reviewCount} reviews</small>
              {expanded === target.id && (
                <div className="inline-card-answer">
                  <TargetNodeLinksEditor target={target} compact />
                  <CardDocument markdown={getNode(nodeId)?.contentMarkdown} target={target} preview />
                  <div className="card-plan-line">
                    <PlanAssignmentControl
                      subjectType="retrieval_target"
                      subjectId={target.id}
                      sectionId={target.anchor?.panelId ?? target.anchors?.[0]?.panelId}
                      nodeId={nodeId}
                    />
                  </div>
                  <ReviewHistory targetId={target.id} />
                </div>
              )}
            </div>
            <button className="recall-review" onClick={() => startReview([target.id])}>Review →</button>
            <button
              className="ghost recall-delete"
              aria-label="Archive recall prompt"
              title="Archive recall prompt"
              onClick={async () => { await archiveRetrievalTarget(target.id); await refresh(); }}
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
