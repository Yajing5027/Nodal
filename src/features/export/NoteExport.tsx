import { db } from '../../db/database';
import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeNode } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';
import {
  buildNoteExport,
  copyFormattedText,
  describeExportAssets,
  downloadText,
  downloadMarkdownWithAssets,
  printNoteDocument,
} from './contentExport';

export function NoteExport({ node, sectionId, beforeExport }: { node: KnowledgeNode; sectionId?: string; beforeExport?: () => Promise<void> }) {
  const { getNode } = useApp();
  const panels = useMemo(() => splitNotePanels(node.contentMarkdown), [node.contentMarkdown]);
  const [open, setOpen] = useState(false);
  const [savedGuidance, setSavedGuidance] = useState(node.aiGuidance);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void db.nodes.get(node.id).then(saved => {
      if (!cancelled) setSavedGuidance(saved?.aiGuidance ?? node.aiGuidance);
    });
    return () => { cancelled = true; };
  }, [open, node.id, node.aiGuidance]);

  const [excluded, setExcluded] = useState<string[]>([]);
  const [guidance, setGuidance] = useState(true);
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [printableUrl, setPrintableUrl] = useState<string | null>(null);

  const selected = panels.filter(panel => sectionId ? panel.id === sectionId : !excluded.includes(panel.id)).map(panel => panel.id);

  const scopeDescription = useMemo(() => {
    if (sectionId) {
      const idx = panels.findIndex(p => p.id === sectionId);
      const name = idx >= 0 ? sectionLabel(panels[idx].markdown, idx) : sectionId;
      return `Section: ${name}`;
    }
    if (selected.length === panels.length) {
      return `Entire note (${panels.length} sections)`;
    }
    return `${selected.length} of ${panels.length} sections`;
  }, [sectionId, panels, selected.length]);

  const getExportMarkdown = async () => {
    await beforeExport?.();
    const saved = await db.nodes.get(node.id);
    return buildNoteExport({ ...node, aiGuidance: saved?.aiGuidance ?? node.aiGuidance }, selected, guidance, request, getNode);
  };

  const handleCopy = async () => {
    setBusy(true); setStatus('');
    try {
      const rawText = await getExportMarkdown();
      const text = await describeExportAssets(rawText);
      const kind = await copyFormattedText(text);
      setStatus(kind === 'formatted' ? 'Copied with formatting. Paste into your AI chat or document.' : 'Copied as Markdown fallback.');
    } catch {
      setStatus('Could not copy. Please select and copy from the preview below.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadMarkdown = async () => {
    setBusy(true); setStatus('');
    try {
      const rawText = await getExportMarkdown();
      downloadText(rawText, node.title);
      setStatus('Markdown downloaded.');
    } catch {
      setStatus('Could not download Markdown.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadZip = async () => {
    setBusy(true); setStatus('');
    try {
      const rawText = await getExportMarkdown();
      const result = await downloadMarkdownWithAssets(node.title, rawText);
      let msg = `ZIP downloaded (${result.assetCount} image${result.assetCount === 1 ? '' : 's'}).`;
      if (result.missingAssets.length > 0) {
        msg += ` (${result.missingAssets.length} image reference${result.missingAssets.length === 1 ? '' : 's'} missing in database)`;
      }
      setStatus(msg);
    } catch (e) {
      setStatus(`Could not create ZIP: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    setBusy(true); setStatus(''); setPrintableUrl(null);
    try {
      const rawText = await getExportMarkdown();
      const result = await printNoteDocument(node.title, rawText, scopeDescription);
      if (result.blobUrl) {
        setPrintableUrl(result.blobUrl);
      }
      let msg = 'Print dialog opened. Select "Save as PDF" to save your document.';
      if (result.missingAssets.length > 0) {
        msg += ` (Note: ${result.missingAssets.length} referenced image(s) could not be loaded)`;
      }
      setStatus(msg);
    } catch (e) {
      setStatus(`Could not open print document: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note-export" onMouseDown={event => event.stopPropagation()}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {sectionId ? 'Export section' : 'Export / Copy'}
      </button>

      {open && (
        <>
          <div className="export-backdrop" onClick={() => setOpen(false)} />
          <section
            className="export-options"
            aria-label="Export options"
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <header>
              <div>
                <strong>{sectionId ? 'Export Section' : 'Export Note'}</strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Scope: <strong>{scopeDescription}</strong>
                </p>
              </div>
              <button type="button" aria-label="Close export" onClick={() => setOpen(false)}>×</button>
            </header>

            {!sectionId && (
              <>
                <div style={{ display: 'flex', gap: '8px', margin: '8px 0 4px' }}>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '2px 8px' }}
                    onClick={() => setExcluded(selected.length === panels.length ? panels.map(p => p.id) : [])}
                  >
                    {selected.length === panels.length ? 'Deselect all sections' : 'Select all sections'}
                  </button>
                </div>
                <div className="export-section-list">
                  {panels.map((panel, index) => (
                    <label key={panel.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(panel.id)}
                        onChange={event =>
                          setExcluded(ids =>
                            event.target.checked ? ids.filter(id => id !== panel.id) : [...ids, panel.id]
                          )
                        }
                      />
                      {sectionLabel(panel.markdown, index)}
                    </label>
                  ))}
                </div>
              </>
            )}

            <label className="export-guidance-toggle">
              <input type="checkbox" checked={guidance} onChange={event => setGuidance(event.target.checked)} />
              Include saved Guidance
            </label>

            <label>
              This session's request
              <textarea
                value={request}
                onChange={event => setRequest(event.target.value)}
                placeholder="e.g. Focus on heap index math and weak spots."
              />
            </label>

            <div className="export-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
              <button type="button" className="primary" disabled={busy || !selected.length} onClick={handleCopy}>
                Copy formatted text
              </button>
              <button type="button" disabled={busy || !selected.length} onClick={handleDownloadMarkdown}>
                Download .md
              </button>
              <button type="button" disabled={busy || !selected.length} onClick={handleDownloadZip} title="Download .md plus all local assets in a zip file">
                Download ZIP (with images)
              </button>
              <button type="button" disabled={busy || !selected.length} onClick={handlePrint} title="Clean printable layout with math, tables and images. Select 'Save as PDF' in the print dialog.">
                Print / Save as PDF
              </button>
            </div>

            {status && <p role="status" style={{ margin: '8px 0', fontSize: '13px' }}>{status}</p>}

            {printableUrl && (
              <p style={{ margin: '6px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Print dialog blocked or need a direct link?{' '}
                <a href={printableUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', color: 'var(--text-primary)' }}>
                  Open printable view in new tab
                </a>
              </p>
            )}

            <details style={{ marginTop: '8px' }}>
              <summary>Preview text</summary>
              <textarea
                readOnly
                aria-label="Export preview"
                value={buildNoteExport({ ...node, aiGuidance: savedGuidance }, selected, guidance, request, getNode)}
              />
            </details>
          </section>
        </>
      )}
    </div>
  );
}
