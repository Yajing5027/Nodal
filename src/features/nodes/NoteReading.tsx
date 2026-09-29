import { lazy, Suspense, useState } from 'react';
import type { KnowledgeNode } from '../../domain/types';
import { getNodeTagSummary } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { MarkdownReading } from './MarkdownReading';
import { RecallTargetsPanel } from '../review/RecallTargetsPanel';
import { SelectionRecall } from '../review/SelectionRecall';
import { WordRecallPicker } from '../review/WordRecallPicker';
import { PlanAssignmentControl } from '../review/PlanAssignmentControl';
import { getFeatureFlags } from '../../domain/featureFlags';
const Editor = lazy(() => import('./NodeInspector').then(module => ({ default: module.NodeInspector })));

export function NoteReading({ node, onShowNotes }: { node: KnowledgeNode; onShowNotes?: () => void }) {
  const { tags, setActiveView, setSelectedNodeId, getNode } = useApp();
  const [recallVersion, setRecallVersion] = useState(0);
  const [editing, setEditing] = useState(!node.contentMarkdown.trim());
  const [selectingWords, setSelectingWords] = useState(false);
  const flags = getFeatureFlags();

  const summary = getNodeTagSummary(node);
  const wholeTags = tags.filter(tag => summary.wholeTags.includes(tag.id));
  const sectionOnlyTags = tags.filter(tag => summary.sectionOnlyTags.includes(tag.id));

  return <div className="note-document">
    <div className="document-toolbar">{onShowNotes && <button className="note-list-toggle ghost" onClick={onShowNotes}>← Notes</button>}<span>{selectingWords ? 'Select words or blocks' : editing ? 'Editing' : 'Note'}</span><div className="document-actions">
      {!editing && flags.enableClozeTools && <button className={selectingWords ? 'selected-action' : ''} aria-pressed={selectingWords} onClick={() => setSelectingWords(value => !value)}>{selectingWords ? 'Done selecting' : 'Make cards'}</button>}
      <PlanAssignmentControl subjectType="node" subjectId={node.id} />
      {flags.enableBatchRecallHeader && <button className="ghost" onClick={() => { setSelectedNodeId(node.id); setActiveView('batch'); }}>Batch studio</button>}
      <button className={editing ? 'primary' : ''} onClick={() => { setSelectingWords(false); setEditing(value => !value); }}>{editing ? 'Done' : 'Edit'}</button>
    </div></div>
    {editing ? <Suspense fallback={<p>Opening editor…</p>}><Editor context="library" /></Suspense> :
      <div className="document-scroll"><article className="note-reading">
        <div className="reading-tags">
          {wholeTags.map(tag => <span key={tag.id} className="tag-pill tag-whole">#{tag.name}</span>)}
          {sectionOnlyTags.map(tag => (
            <span
              key={tag.id}
              className="tag-pill tag-section-only"
              title="Tag appears in specific section(s)"
              aria-label={`${tag.name}, section tag`}
              style={{ borderStyle: 'dashed', opacity: 0.85 }}
            >
              #{tag.name}
            </span>
          ))}
        </div>
        <h1>{node.title}</h1>
        {node.overview && (
          <div
            className="note-overview-block"
            style={{
              margin: '12px 0 16px',
              padding: '10px 14px',
              background: 'var(--surface-secondary)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: '6px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '4px' }}>Overview</div>
            <div>{node.overview}</div>
          </div>
        )}
        {selectingWords ? <WordRecallPicker sourceId={node.id} markdown={node.contentMarkdown} onClose={() => setSelectingWords(false)} onSaved={() => setRecallVersion(v => v + 1)} /> :
          <SelectionRecall sourceId={node.id} onSaved={() => setRecallVersion(v => v + 1)}><MarkdownReading guidanceNodeId={node.id} transcludeGetNode={getNode}>{node.contentMarkdown || 'This note is empty. Choose Edit to start writing.'}</MarkdownReading></SelectionRecall>}
      </article><details className="note-disclosure"><summary>Recall cards</summary><RecallTargetsPanel key={`${node.id}-${recallVersion}`} nodeId={node.id} /></details></div>}
  </div>;
}
