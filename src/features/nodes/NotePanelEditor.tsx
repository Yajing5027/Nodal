import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { useMemo, useRef, useState } from 'react';
import { AIGuidance } from './AIGuidance';
import { NoteExport } from '../export/NoteExport';
import { newId } from '../../domain/id';
import { joinNotePanels, splitNotePanels, type NotePanel } from '../../domain/notePanels';
import { sectionLabel, stringifyTransclusionDirective, parseTransclusionDirective } from '../../domain/sectionTransclusion';
import { useApp } from '../../app/useApp';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownReading } from './MarkdownReading';
import { SectionMasteryControl } from './SectionMasteryControl';
import { updateNode } from '../../repositories/nodeRepository';
import { createTag } from '../../repositories/tagRepository';

function SectionTagBar({
  nodeId,
  sectionId,
}: {
  nodeId: string;
  sectionId: string;
}) {
  const { nodes, tags, refreshTags, refreshNodes } = useApp();
  const [adding, setAdding] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const wholeTagIds = node.tagIds || [];
  const sectionTagIds = node.sectionTagIds?.[sectionId] || [];

  const handleAdd = async (tagId: string) => {
    if (sectionTagIds.includes(tagId)) return;
    const nextMap = { ...(node.sectionTagIds || {}), [sectionId]: [...sectionTagIds, tagId] };
    await updateNode(node.id, { sectionTagIds: nextMap });
    await refreshNodes();
    setAdding(false);
    setTagInput('');
  };

  const handleCreate = async () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    let tag = tags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (!tag) {
      tag = await createTag({ name: trimmed });
      await refreshTags();
    }
    await handleAdd(tag.id);
  };

  const handleRemove = async (tagId: string) => {
    const nextList = sectionTagIds.filter(id => id !== tagId);
    const nextMap = { ...(node.sectionTagIds || {}) };
    if (nextList.length > 0) {
      nextMap[sectionId] = nextList;
    } else {
      delete nextMap[sectionId];
    }
    await updateNode(node.id, { sectionTagIds: nextMap });
    await refreshNodes();
  };

  const availableTags = tags.filter(t => !wholeTagIds.includes(t.id) && !sectionTagIds.includes(t.id));

  return (
    <div
      className="section-tag-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        padding: '3px 12px 6px',
        fontSize: '11px',
      }}
    >
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tags:</span>

      {/* Whole note inherited tags */}
      {wholeTagIds.map(tid => {
        const t = tags.find(x => x.id === tid);
        if (!t) return null;
        return (
          <span
            key={t.id}
            title="Inherited from whole note"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'var(--surface-tertiary, rgba(0,0,0,0.05))',
              color: 'var(--text-muted)',
              border: '1px solid var(--border, #ddd)',
              fontSize: '11px',
            }}
          >
            #{t.name}
          </span>
        );
      })}

      {/* Section-specific tags */}
      {sectionTagIds.map(tid => {
        const t = tags.find(x => x.id === tid);
        if (!t) return null;
        return (
          <span
            key={t.id}
            title="Tag specific to this section"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '1px 6px',
              borderRadius: '4px',
              background: 'var(--accent-subtle, rgba(59, 130, 246, 0.12))',
              color: 'var(--accent, #2563eb)',
              border: '1px solid var(--accent, #3b82f6)',
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            #{t.name}
            <button
              type="button"
              className="ghost"
              title={`Remove tag ${t.name} from section`}
              onClick={() => handleRemove(t.id)}
              style={{ padding: 0, minWidth: 0, height: 'auto', fontSize: '11px', lineHeight: 1, color: 'inherit' }}
            >
              ×
            </button>
          </span>
        );
      })}

      {/* Add tag button / input */}
      {adding ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            autoFocus
            list={`sec-tag-suggestions-${sectionId}`}
            placeholder="Tag name…"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              } else if (e.key === 'Escape') {
                setAdding(false);
                setTagInput('');
              }
            }}
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '4px',
              border: '1px solid var(--accent, #3b82f6)',
              outline: 'none',
              width: '100px',
              height: '20px',
            }}
          />
          <datalist id={`sec-tag-suggestions-${sectionId}`}>
            {availableTags.map(t => <option key={t.id} value={t.name} />)}
          </datalist>
          <button
            type="button"
            className="ghost"
            onClick={handleCreate}
            style={{ fontSize: '10px', padding: '1px 4px', height: '20px' }}
          >
            Add
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => { setAdding(false); setTagInput(''); }}
            style={{ fontSize: '10px', padding: '1px 4px', height: '20px' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ghost"
          onClick={() => setAdding(true)}
          title="Add tag to this section"
          style={{ fontSize: '10.5px', padding: '1px 6px', height: '20px', borderRadius: '4px', border: '1px dashed var(--border)' }}
        >
          ＋ Tag
        </button>
      )}
    </div>
  );
}

/** Minimal source picker: choose a source Node, then one or more of its Sections. */
function SectionReferencePicker({ onAdd }: { onAdd: (refs: Array<{ sourceNodeId: string; sourceSectionId: string }>) => void }) {
  const { nodes } = useApp();
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const source = nodes.find(node => node.id === sourceNodeId);
  const sections = useMemo(() => source ? splitNotePanels(source.contentMarkdown) : [], [source]);
  const add = () => {
    const refs = sections.filter((_, index) => checked[String(index)]).map(panel => ({ sourceNodeId, sourceSectionId: panel.id }));
    if (refs.length) onAdd(refs);
  };
  return <div className="section-reference-picker">
    <label>Reference a section from another note
      <ChoiceSelect aria-label="Source note" value={sourceNodeId} onChange={event => { setSourceNodeId(event.target.value); setChecked({}); }}>
        <option value="">Choose a note…</option>
        {nodes.map(node => <option key={node.id} value={node.id}>{node.title || 'Untitled note'}</option>)}
      </ChoiceSelect>
    </label>
    {source && <div className="section-reference-list">
      {sections.map((panel, index) => <label key={panel.id}><input type="checkbox" checked={!!checked[String(index)]} onChange={event => setChecked(current => ({ ...current, [String(index)]: event.target.checked }))} />{sectionLabel(panel.markdown, index)}{panel.hidden ? ' · hidden in source' : ''}</label>)}
    </div>}
    <button type="button" className="primary" onClick={add} disabled={!sections.some((_, index) => checked[String(index)])}>Add selected sections</button>
  </div>;
}

export function NotePanelEditor({ markdown, onChange, onAssetCreated, nodeId }: { markdown: string; onChange: (value: string) => void; onAssetCreated?: (id: string) => void; nodeId?: string }) {
  const { nodes, refreshNodes } = useApp();
  const transcludeGetNode = useMemo(() => (id: string) => nodes.find(n => n.id === id), [nodes]);
  const [panels, setPanels] = useState(() => splitNotePanels(markdown));
  const [serialized, setSerialized] = useState(markdown);
  const [editorMode, setEditorMode] = useState<'sections' | 'continuous'>('sections');
  const [undoNotice, setUndoNotice] = useState<string | null>(null);
  const undoSnapshot = useRef<NotePanel[] | null>(null);
  const current = useRef(panels);
  const structured = useRef(panels.length > 1 || markdown.includes('<!-- nodal-panel:'));
  const [active, setActive] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [backs, setBacks] = useState<Record<string, boolean>>({});
  const owningNode = nodes.find(node => node.id === nodeId);
  const drag = useRef<string | null>(null);

  const commit = (next: NotePanel[]) => {
    current.current = next; setPanels(next);
    const value = joinNotePanels(next, structured.current);
    setSerialized(value); onChange(value);
  };
  const move = (id: string, target: string) => {
    const next = [...current.current]; const from = next.findIndex(panel => panel.id === id), to = next.findIndex(panel => panel.id === target);
    if (from < 0 || to < 0 || from === to) return;
    next.splice(to, 0, next.splice(from, 1)[0]); structured.current = true; commit(next);
  };
  const addSubsection = (parentId: string) => {
    structured.current = true;
    const parentIdx = current.current.findIndex(p => p.id === parentId);
    if (parentIdx < 0) return;
    let insertIdx = parentIdx + 1;
    while (insertIdx < current.current.length && current.current[insertIdx].parentId === parentId) {
      insertIdx++;
    }
    const newSub: NotePanel = {
      id: newId(),
      markdown: '',
      hidden: false,
      start: 0,
      end: 0,
      parentId,
    };
    const next = [...current.current];
    next.splice(insertIdx, 0, newSub);
    commit(next);
    setActive(newSub.id);
  };
  const appendReference = (refs: Array<{ sourceNodeId: string; sourceSectionId: string }>) => {
    structured.current = true;
    const appended = refs.map(ref => ({ id: newId(), markdown: stringifyTransclusionDirective(ref), hidden: false, start: 0, end: 0 }));
    commit([...current.current, ...appended]);
    setActive(appended[0].id);
    setPickerOpen(false);
  };
  const removePanel = (id: string) => {
    let next = current.current.filter(item => item.id !== id && item.parentId !== id);
    if (next.length === 0) next = [{ id: newId(), markdown: '', hidden: false, start: 0, end: 0 }];
    structured.current = true;
    commit(next);
    if (owningNode?.sectionTagIds?.[id]) {
      const updated = { ...owningNode.sectionTagIds };
      delete updated[id];
      updateNode(owningNode.id, { sectionTagIds: updated }).then(() => refreshNodes());
    }
    if (active === id) setActive(next[0].id);
  };

  const handleContinuousChange = (value: string) => {
    setSerialized(value);
    const parsed = splitNotePanels(value);
    current.current = parsed;
    setPanels(parsed);
    structured.current = parsed.length > 1 || value.includes('<!-- nodal-panel:');
    onChange(value);
  };

  const handleContainerPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const splitMatches = text.match(/\n(?:[ \t\u00A0]*\n){2,}/g);
    if (splitMatches && splitMatches.length > 0) {
      undoSnapshot.current = [...current.current];
      setUndoNotice(`Pasted content was split by ≥ 3 newlines.`);
    }
  };

  const positions = splitNotePanels(serialized);
  return (
    <div className="note-panel-editor" onPasteCapture={handleContainerPaste}>
      {/* View mode toggle & rule indicator */}
      <div className="note-editor-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 var(--space-2) var(--space-2)', borderBottom: '1px solid var(--border-light, #eee)', marginBottom: 'var(--space-3)' }}>
        <div className="note-view-switcher" style={{ display: 'inline-flex', gap: '4px', background: 'var(--surface-secondary, rgba(0,0,0,0.04))', padding: '2px', borderRadius: '8px' }}>
          <button
            type="button"
            className={editorMode === 'sections' ? 'primary' : 'ghost'}
            style={{ fontSize: '12px', padding: '4px 10px', height: 'auto', minHeight: 'unset' }}
            onClick={() => {
              setEditorMode('sections');
              const parsed = splitNotePanels(serialized);
              current.current = parsed;
              setPanels(parsed);
            }}
            aria-pressed={editorMode === 'sections'}
          >
            Sections ({panels.length})
          </button>
          <button
            type="button"
            className={editorMode === 'continuous' ? 'primary' : 'ghost'}
            style={{ fontSize: '12px', padding: '4px 10px', height: 'auto', minHeight: 'unset' }}
            onClick={() => setEditorMode('continuous')}
            aria-pressed={editorMode === 'continuous'}
          >
            Full note
          </button>
        </div>
      </div>

      {/* Undo split notification */}
      {undoNotice && (
        <div className="split-undo-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--surface-secondary, #f0f7f4)', border: '1px solid var(--border, #a4c2b8)', borderRadius: '8px', marginBottom: '10px', fontSize: '12px' }}>
          <span>{undoNotice}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="ghost"
              style={{ fontSize: '12px', padding: '2px 8px', height: 'auto', minHeight: 'unset' }}
              onClick={() => {
                if (undoSnapshot.current) {
                  commit(undoSnapshot.current);
                  undoSnapshot.current = null;
                  setUndoNotice(null);
                }
              }}
            >
              Undo split
            </button>
            <button
              type="button"
              className="ghost"
              style={{ fontSize: '12px', padding: '2px 8px', height: 'auto', minHeight: 'unset' }}
              onClick={() => setUndoNotice(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {editorMode === 'continuous' ? (
        <div className="full-note-continuous-editor">
          <MarkdownEditor
            key="continuous-editor"
            markdown={serialized}
            onChange={handleContinuousChange}
            onAssetCreated={onAssetCreated}
          />
        </div>
      ) : (
        <>
          {panels.map((panel, index) => <section key={panel.id} data-panel-id={panel.id} data-panel-start={positions[index]?.start ?? 0} data-panel-end={positions[index]?.end ?? 0} className={`note-edit-panel${active === panel.id ? ' is-active' : ''}${over === panel.id && dragging !== panel.id ? ' is-drop-target' : ''}${panel.parentId ? ' is-subsection' : ''}`} style={panel.parentId ? { marginLeft: '28px', borderLeft: '3px solid var(--accent, #3b82f6)', paddingLeft: '14px', background: 'var(--surface-secondary, rgba(0,0,0,0.02))', borderRadius: '0 8px 8px 0', marginTop: '8px', marginBottom: '8px' } : undefined}>
            <header className="note-panel-controls">
              <button type="button" aria-label={`Move section ${index + 1}`} title="Drag to reorder · Arrow keys move up or down" className="panel-drag-handle"
                onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = panel.id; setDragging(panel.id); }}
                onPointerMove={event => { if (!drag.current) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-panel-id]'); setOver(target?.dataset.panelId ?? null); }}
                onPointerUp={event => { const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-panel-id]'); if (drag.current && target?.dataset.panelId) move(drag.current, target.dataset.panelId); drag.current = null; setDragging(null); setOver(null); }}
                onPointerCancel={() => { drag.current = null; setDragging(null); setOver(null); }}
                onKeyDown={event => { const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0; if (offset && panels[index + offset]) { event.preventDefault(); move(panel.id, panels[index + offset].id); } }}>⠿</button>
              {editingTitleId === panel.id ? (
                <input
                  type="text"
                  className="panel-title-inline-input"
                  autoFocus
                  defaultValue={panel.title || ''}
                  placeholder={sectionLabel(panel.markdown, index)}
                  onBlur={e => {
                    const val = e.target.value.trim();
                    const updated = current.current.map(p => p.id === panel.id ? { ...p, title: val || undefined } : p);
                    structured.current = true;
                    commit(updated);
                    setEditingTitleId(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingTitleId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid var(--accent, #3b82f6)',
                    outline: 'none',
                    background: 'var(--surface-primary)',
                    color: 'var(--text)',
                    maxWidth: '180px',
                  }}
                />
              ) : (
                <>
                  {panel.parentId && (
                    <span
                      className="subsection-badge"
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: 'var(--surface-secondary, rgba(0,0,0,0.06))',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Sub
                    </span>
                  )}
                  <span
                    className="section-label-heading"
                    title="Click to edit section title"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setEditingTitleId(panel.id)}
                  >
                    {sectionLabel(panel.markdown, index, panel.title)}
                  </span>
                  <button
                    type="button"
                    className="ghost panel-title-edit-btn"
                    title="Edit section title"
                    onClick={() => setEditingTitleId(panel.id)}
                    style={{ fontSize: '11px', padding: '1px 4px', height: 'auto', minHeight: 'unset', opacity: 0.6 }}
                  >
                    ✎
                  </button>
                </>
              )}
              <button type="button" aria-label={`Move section ${index + 1} up`} disabled={!index} onClick={() => move(panel.id, panels[index - 1].id)}>↑</button>
              <button type="button" aria-label={`Move section ${index + 1} down`} disabled={index === panels.length - 1} onClick={() => move(panel.id, panels[index + 1].id)}>↓</button>
              {!panel.parentId && (
                <button
                  type="button"
                  className="ghost"
                  title="Add subsection under this section"
                  onClick={() => addSubsection(panel.id)}
                  style={{ fontSize: '11px', padding: '2px 6px' }}
                >
                  ＋ Subsection
                </button>
              )}
              {nodeId && <button type="button" aria-pressed={!!backs[panel.id]} onClick={() => setBacks(value => ({...value, [panel.id]:!value[panel.id]}))}>{backs[panel.id] ? 'Content ↩' : 'Guidance ↻'}</button>}
              {owningNode && <NoteExport node={{...owningNode, contentMarkdown:serialized}} sectionId={panel.id} />}
              {active === panel.id && <button type="button" className="ghost" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }} onClick={() => setActive(null)}>Done</button>}
              <button
                type="button"
                className="ghost"
                title="Delete this section"
                onClick={() => {
                  if (!panel.markdown.trim() || confirm('Delete this section?')) {
                    removePanel(panel.id);
                  }
                }}
                style={{ fontSize: '11px', padding: '2px 6px', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
              {nodeId && <SectionMasteryControl nodeId={nodeId} sectionId={panel.id} />}
            </header>
            {nodeId && <SectionTagBar nodeId={nodeId} sectionId={panel.id} />}
            {nodeId && backs[panel.id] ? <div className="section-back"><AIGuidance nodeId={nodeId} sectionId={panel.id} /></div> : active === panel.id ? (parseTransclusionDirective(panel.markdown.trim())
              ? <div className="note-panel-reading note-reference-card"><p className="note-reference-card-hint">Live reference — source content is canonical at the source note and shown read-only here. Use “Remove reference” to detach this section, then “Reference section” to add a different one.</p><MarkdownReading transcludeGetNode={transcludeGetNode}>{panel.markdown}</MarkdownReading><button type="button" className="ghost note-remove-reference" onClick={() => removePanel(panel.id)}>Remove reference</button></div>
              : <MarkdownEditor key={panel.id} markdown={panel.markdown} onChange={value => commit(current.current.map(item => item.id === panel.id ? { ...item, markdown: value } : item))} onAssetCreated={onAssetCreated} />) : <div className="note-panel-reading" onClick={() => setActive(panel.id)} title="Click to edit section" style={{ cursor: 'pointer' }}><MarkdownReading transcludeGetNode={transcludeGetNode}>{panel.markdown || 'Empty section'}</MarkdownReading></div>}
          </section>)}
          <div className="note-panel-actions">
            <button type="button" className="add-note-panel" onClick={() => { const id = newId(); structured.current = true; commit([...current.current, { id, markdown: '', hidden: false, start: 0, end: 0 }]); setActive(id); }}>＋ Add section</button>
            <button type="button" className="ghost" aria-pressed={pickerOpen} onClick={() => setPickerOpen(value => !value)}>＋ Reference section</button>
          </div>
          {pickerOpen && <SectionReferencePicker onAdd={appendReference} />}
        </>
      )}
    </div>
  );
}
