import { archiveWorkspaceContent, hasCleanupArchive, restoreWorkspaceContent } from '../../repositories/workspaceCleanup';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/useApp';
import { ConfirmDialog } from '../../components/ui';
import { exportFullBackup, exportMapMarkdown, PORTABLE_SCHEMA_VERSION } from '../export/exporter';
import { importBackup } from '../export/importer';
import { getAllMaps } from '../../repositories/mapRepository';
import { handleError } from '../../utils/errors';

const LAST_BACKUP_KEY = 'nodal:last-full-backup-at';

export function DataPage() {
  const {
    nodes,
    maps,
    tags,
    currentMapId,
    setCurrentMapId,
    setSelectedNodeId,
    refreshAll,
  } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [busyAction, setBusyAction] = useState<'export' | 'map' | 'import' | 'cleanup' | null>(null);
  const [status, setStatus] = useState('');
  const [canRestore, setCanRestore] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  useEffect(() => { void hasCleanupArchive().then(setCanRestore); }, []);
  const clean = async (restore = false) => {
    setBusyAction('cleanup');
    try {
      if (restore) await restoreWorkspaceContent(); else await archiveWorkspaceContent();
      setSelectedNodeId(null); setCurrentMapId(null); await refreshAll();
      setCanRestore(await hasCleanupArchive()); setCleanupOpen(false);
      setStatus(restore ? 'Previous content restored. New notes are preserved.' : 'Workspace cleared. You can restore the previous content below. Review plans are kept.');
    } catch (error) { setStatus(handleError(error, 'Workspace cleanup')); }
    finally { setBusyAction(null); }
  };

  const [lastBackup, setLastBackup] = useState(() => localStorage.getItem(LAST_BACKUP_KEY));

  const runFullExport = async () => {
    setBusyAction('export');
    setStatus('');
    try {
      await exportFullBackup();
      const timestamp = new Date().toISOString();
      localStorage.setItem(LAST_BACKUP_KEY, timestamp);
      setLastBackup(timestamp);
      setStatus('Full backup downloaded.');
    } catch (error) {
      setStatus(handleError(error, 'Export backup'));
    } finally {
      setBusyAction(null);
    }
  };

  const runMapExport = async () => {
    if (!currentMapId) return;
    setBusyAction('map');
    setStatus('');
    try {
      await exportMapMarkdown(currentMapId);
      setStatus('Map Markdown downloaded.');
    } catch (error) {
      setStatus(handleError(error, 'Export map'));
    } finally {
      setBusyAction(null);
    }
  };

  const runImport = async () => {
    if (!importFile) return;
    setBusyAction('import');
    setStatus('');
    try {
      await importBackup(importFile, 'replace');
      await refreshAll();
      const restoredMaps = await getAllMaps();
      setCurrentMapId(restoredMaps[0]?.id ?? null);
      setSelectedNodeId(null);
      setStatus('Backup restored successfully.');
    } catch (error) {
      setStatus(handleError(error, 'Import backup'));
    } finally {
      setBusyAction(null);
      setImportFile(null);
    }
  };

  const currentMap = maps.find((map) => map.id === currentMapId);

  return (
    <main className="resource-page narrow-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Local-first storage</p>
          <h1>Data & backup</h1>
          <p>Your knowledge is stored in this browser. A downloaded ZIP is your portable, long-term safety copy.</p>
        </div>
      </div>

      <section className="data-overview">
        <div><strong>{nodes.length}</strong><span>Nodes</span></div>
        <div><strong>{maps.length}</strong><span>Maps</span></div>
        <div><strong>{tags.length}</strong><span>Tags</span></div>
        <div><strong>{PORTABLE_SCHEMA_VERSION}</strong><span>Backup format</span></div>
      </section>

      <section className="settings-section">
        <div className="settings-copy">
          <h2>Full backup</h2>
          <p>Download notes, maps, assets, recall prompts, memory states, review history, review plans and scheduling state as one versioned ZIP.</p>
          <small>
            {lastBackup
              ? `Last downloaded from this browser ${new Date(lastBackup).toLocaleString()}`
              : 'No backup has been recorded in this browser yet.'}
          </small>
        </div>
        <button className="primary" disabled={busyAction !== null} onClick={runFullExport}>
          {busyAction === 'export' ? 'Preparing…' : 'Export full backup'}
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-copy">
          <h2>Restore from backup</h2>
          <p>Replace the current knowledge base with a Nodal backup. Validation and import happen as one transaction.</p>
          <small>Export your current data first. Restore cannot be undone.</small>
        </div>
        <button disabled={busyAction !== null} onClick={() => inputRef.current?.click()}>Choose backup…</button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          hidden
          onChange={(event) => {
            setImportFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
      </section>

      <section className="settings-section">
        <div className="settings-copy">
          <h2>Readable map export</h2>
          <p>Export the selected map as Markdown for reading or sharing. This is not a lossless backup.</p>
          <small>{currentMap ? `Current map: ${currentMap.title}` : 'Open a map first to enable this export.'}</small>
        </div>
        <button disabled={!currentMapId || busyAction !== null} onClick={runMapExport}>
          {busyAction === 'map' ? 'Preparing…' : 'Export map Markdown'}
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-copy"><h2>Fresh start</h2><p>Clear notes, maps, and their recall data. Course tags (Math, CS, English) are preserved. The previous content is kept locally until you restore it.</p></div>
        {canRestore ? <button disabled={busyAction !== null} onClick={() => void clean(true)}>Restore previous content</button> : <button disabled={busyAction !== null || (!nodes.length && !maps.length)} onClick={() => setCleanupOpen(true)}>Clear workspace content…</button>}
      </section>

      <ConfirmDialog open={cleanupOpen} title="Start with an empty workspace?" message={<p>Move {nodes.length} notes, {maps.length} maps, and their recall data into a local recovery archive. Course tags will be preserved. You can restore them here later. Download a full backup for a separate safety copy.</p>} confirmLabel={busyAction === 'cleanup' ? 'Clearing…' : 'Archive and clear'} onConfirm={() => { if (!busyAction) void clean(); }} onCancel={() => setCleanupOpen(false)} />
      {status && <div className="inline-status" role="status">{status}</div>}

      <div className="storage-note">
        <strong>What “local-first” means</strong>
        <p>Nodal has no account, server, or cloud sync. Clearing this browser’s site data can remove the working database, so keep backups somewhere you control.</p>
      </div>

      <ConfirmDialog
        open={importFile !== null}
        title="Replace knowledge base?"
        message={
          <div>
            <p><strong>{importFile?.name}</strong> will replace every item currently stored in Nodal.</p>
            <p style={{ marginTop: 'var(--space-2)', color: 'var(--danger)' }}>Export a full backup first if you may need the current data.</p>
          </div>
        }
        confirmLabel={busyAction === 'import' ? 'Restoring…' : 'Replace and restore'}
        danger
        onConfirm={runImport}
        onCancel={() => setImportFile(null)}
      />
    </main>
  );
}
