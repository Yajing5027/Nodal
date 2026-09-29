// ============================================================
// TargetNodeLinksEditor — Manage multi-node associations for a card
// ============================================================
// Supports cross-note sharing: one card, many nodes.
// Prevents duplicate associations and cycles.
// ============================================================

import { useState, useMemo } from 'react';
import { useApp } from '../../app/useApp';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';
import type { RetrievalTarget, TargetNodeLink } from '../../domain/types';
import { getTargetNodeLinks } from '../../domain/types';
import { linkTargetToNode, unlinkTargetFromNode } from '../../repositories/reviewRepository';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';

interface TargetNodeLinksEditorProps {
  target: RetrievalTarget;
  onUpdate?: (updated: RetrievalTarget) => void;
  compact?: boolean;
}

export function TargetNodeLinksEditor({ target, onUpdate, compact = false }: TargetNodeLinksEditorProps) {
  const app = useApp();
  const nodes = app?.nodes || [];
  const [adding, setAdding] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const links = useMemo(() => getTargetNodeLinks(target), [target]);

  const targetNote = useMemo(() => {
    return nodes.find(n => n.id === selectedNoteId);
  }, [nodes, selectedNoteId]);

  const noteSections = useMemo(() => {
    if (!targetNote) return [];
    return splitNotePanels(targetNote.contentMarkdown || '');
  }, [targetNote]);

  const handleAddLink = async () => {
    if (!selectedNoteId) {
      setErrorMessage('Please select a note.');
      return;
    }
    const secId = selectedSectionId.trim() ? selectedSectionId : null;
    const isDuplicate = links.some(
      l => l.noteId === selectedNoteId && (l.sectionId ?? null) === secId,
    );
    if (isDuplicate) {
      setErrorMessage('This card is already linked to that note and section.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      const updated = await linkTargetToNode(target.id, selectedNoteId, secId);
      onUpdate?.(updated);
      setAdding(false);
      setSelectedNoteId('');
      setSelectedSectionId('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not add link.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async (link: TargetNodeLink) => {
    if (links.length <= 1) {
      setErrorMessage('A card must remain linked to at least one note. To remove it entirely, archive the card.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      const updated = await unlinkTargetFromNode(target.id, link.noteId, link.sectionId);
      onUpdate?.(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not unlink node.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="target-node-links-editor" style={{ margin: compact ? '4px 0' : '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
          Associated nodes:
        </span>
        {links.map((link) => {
          const note = nodes.find(n => n.id === link.noteId);
          const noteTitle = note?.title || 'Untitled Note';
          let secTitle = 'Whole note';
          if (link.sectionId && note) {
            const panels = splitNotePanels(note.contentMarkdown || '');
            const idx = panels.findIndex(p => p.id === link.sectionId);
            if (idx >= 0) secTitle = sectionLabel(panels[idx].markdown, idx, panels[idx].title);
            else secTitle = link.sectionId;
          }

          return (
            <span
              key={`${link.noteId}:${link.sectionId ?? ''}`}
              className="target-node-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11.5px',
                padding: '2px 8px',
                background: 'var(--surface-secondary, rgba(0,0,0,0.04))',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                color: 'var(--text)',
              }}
            >
              <span>{noteTitle} &gt; {secTitle}</span>
              {links.length > 1 && (
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Unlink from ${noteTitle} > ${secTitle}`}
                  title="Unlink this node"
                  disabled={busy}
                  style={{
                    padding: '0 2px',
                    minWidth: '14px',
                    height: '14px',
                    lineHeight: 1,
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleUnlink(link)}
                >
                  ✕
                </button>
              )}
            </span>
          );
        })}

        {!adding && (
          <button
            type="button"
            className="ghost"
            style={{ fontSize: '11px', padding: '2px 6px', height: '22px' }}
            onClick={() => { setAdding(true); setErrorMessage(''); }}
          >
            ＋ Link to another node
          </button>
        )}
      </div>

      {adding && (
        <div
          style={{
            marginTop: '8px',
            padding: '10px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: 420,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600 }}>1. Choose target note:</label>
            <ChoiceSelect
              aria-label="Select note to link"
              value={selectedNoteId}
              onChange={e => {
                setSelectedNoteId(e.target.value);
                setSelectedSectionId('');
              }}
            >
              <option value="">Select a note…</option>
              {nodes.map(n => (
                <option key={n.id} value={n.id}>{n.title || 'Untitled note'}</option>
              ))}
            </ChoiceSelect>
          </div>

          {selectedNoteId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600 }}>2. Choose section:</label>
              <ChoiceSelect
                aria-label="Select section to link"
                value={selectedSectionId}
                onChange={e => setSelectedSectionId(e.target.value)}
              >
                <option value="">Whole note (global)</option>
                {noteSections.map((p, idx) => (
                  <option key={p.id} value={p.id}>{p.parentId ? '  ↳ ' : ''}{sectionLabel(p.markdown, idx, p.title)}</option>
                ))}
              </ChoiceSelect>
            </div>
          )}

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              type="button"
              className="ghost"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => { setAdding(false); setErrorMessage(''); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !selectedNoteId}
              style={{ fontSize: '11px', padding: '3px 10px' }}
              onClick={handleAddLink}
            >
              {busy ? 'Linking…' : 'Add link'}
            </button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div style={{ fontSize: '11px', color: 'var(--color-danger, #d93025)', marginTop: '4px' }}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
