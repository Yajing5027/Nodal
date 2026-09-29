// ============================================================
// NodeInspector — right-side panel for viewing and editing the
// canonical KnowledgeNode. Title, tags, markdown content, images,
// relations, map occurrences, metadata, and delete.
//
// CRITICAL: Markdown (contentMarkdown in Dexie) is the source of truth.
// The MDXEditor holds UI state only. Every change debounces to updateNode.
// Images are Asset blobs, never base64 in markdown.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ID } from '../../domain/types';
import { useApp } from '../../app/useApp';
import { updateNode, deleteNode, getMapsContainingNode } from '../../repositories/nodeRepository';
import { getOccurrencesForNode } from '../../repositories/mapRepository';
import { createAsset } from '../../repositories/assetRepository';
import { NoteExport } from '../export/NoteExport';
import { AIGuidance } from './AIGuidance';
import { Section, ConfirmDialog } from '../../components/ui';
import { TagEditor } from './TagEditor';
import { ImageManager } from './ImageManager';
import { RelationList } from './RelationList';
import { NotePanelEditor } from './NotePanelEditor';
import { RecallTargetsPanel } from '../review/RecallTargetsPanel';
import { PlanAssignmentControl } from '../review/PlanAssignmentControl';
import { SelectionRecall, type RecallCreated } from '../review/SelectionRecall';
import { getFeatureFlags } from '../../domain/featureFlags';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface MapOccurrenceInfo {
  mapId: ID;
  mapTitle: string;
  count: number;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NodeInspector({ context = 'map', nodeId, onRecallCreated }: { context?: 'map' | 'library' | 'card'; nodeId?: ID; onRecallCreated?: RecallCreated }) {
  const {
    selectedNodeId,
    setActiveView,
    getNode,
    setSelectedNodeId,
    openMap,
    refreshMapContent,
    refreshAll,
    refreshNodes,
  } = useApp();

  const inspectedId = nodeId ?? selectedNodeId;
  const node = inspectedId ? getNode(inspectedId) : undefined;

  // ---- Local UI state ----
  const [titleDraft, setTitleDraft] = useState('');
  const [overviewDraft, setOverviewDraft] = useState(node?.overview ?? '');
  const [contentDraft, setContentDraft] = useState(node?.contentMarkdown ?? '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mapsContainingNode, setMapsContainingNode] = useState<MapOccurrenceInfo[]>([]);

  // ---- Refs for debounce / auto-save ----
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTitleRef = useRef('');
  const latestOverviewRef = useRef('');
  const latestContentRef = useRef('');
  const inFlightRef = useRef(0);
  const savedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentNodeIdRef = useRef<ID | null>(null);

  // ---- Save status helpers ----
  const markSaving = useCallback(() => {
    inFlightRef.current += 1;
    setSaveStatus('saving');
  }, []);

  const markSaved = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    if (inFlightRef.current === 0) {
      setSaveStatus('saved');
      if (savedResetRef.current) clearTimeout(savedResetRef.current);
      savedResetRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, []);

  const markError = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    setSaveStatus('error');
  }, []);

  // ---- Reset drafts when node changes ----
  useEffect(() => {
    if (!node) {
      currentNodeIdRef.current = null;
      return;
    }
    currentNodeIdRef.current = node.id;
    setTitleDraft(node.title);
    setOverviewDraft(node.overview ?? '');
    setContentDraft(node.contentMarkdown);
    latestTitleRef.current = node.title;
    latestOverviewRef.current = node.overview ?? '';
    latestContentRef.current = node.contentMarkdown;
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Flush pending saves + clear timeouts on node change / unmount ----
  useEffect(() => {
    return () => {
      // Flush any pending debounced saves immediately
      if (titleTimeoutRef.current) {
        clearTimeout(titleTimeoutRef.current);
        titleTimeoutRef.current = null;
        const nodeId = currentNodeIdRef.current;
        const title = latestTitleRef.current;
        if (nodeId) {
          markSaving();
          updateNode(nodeId, { title })
            .then(() => { markSaved(); refreshNodes(); })
            .catch(() => markError());
        }
      }
      if (overviewTimeoutRef.current) {
        clearTimeout(overviewTimeoutRef.current);
        overviewTimeoutRef.current = null;
        const nodeId = currentNodeIdRef.current;
        const overview = latestOverviewRef.current;
        if (nodeId) {
          markSaving();
          updateNode(nodeId, { overview })
            .then(() => { markSaved(); refreshNodes(); })
            .catch(() => markError());
        }
      }
      if (contentTimeoutRef.current) {
        clearTimeout(contentTimeoutRef.current);
        contentTimeoutRef.current = null;
        const nodeId = currentNodeIdRef.current;
        const content = latestContentRef.current;
        if (nodeId) {
          markSaving();
          updateNode(nodeId, { contentMarkdown: content })
            .then(() => { markSaved(); refreshNodes(); })
            .catch(() => markError());
        }
      }
    };
  }, [node?.id, markSaving, markSaved, markError, refreshNodes]);

  // ---- Fetch maps containing this node (for "Appears In" + delete dialog) ----
  useEffect(() => {
    if (!node) {
      setMapsContainingNode([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [mapsList, occurrences] = await Promise.all([
        getMapsContainingNode(node.id),
        getOccurrencesForNode(node.id),
      ]);
      if (cancelled) return;
      const countMap = new Map<ID, number>();
      for (const occ of occurrences) {
        countMap.set(occ.mapId, (countMap.get(occ.mapId) ?? 0) + 1);
      }
      setMapsContainingNode(
        mapsList.map((m) => ({
          mapId: m.mapId,
          mapTitle: m.mapTitle,
          count: countMap.get(m.mapId) ?? 0,
        }))
      );
    })();
    return () => { cancelled = true; };
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Paste support: clipboard image → create Asset + add to node ----
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !node) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Let MDXEditor handle paste inside itself (its imageUploadHandler runs)
      const target = e.target as HTMLElement | null;
      if (target?.closest('.mdxeditor')) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handlePastedImage(file);
          }
          break;
        }
      }
    };

    el.addEventListener('paste', handlePaste);
    return () => el.removeEventListener('paste', handlePaste);
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePastedImage = useCallback(
    async (file: File) => {
      if (!node) return;
      const asset = await createAsset({
        filename: file.name || 'pasted-image.png',
        mimeType: file.type,
        blob: file,
        description: '',
      });
      const newAssetIds = [...node.assetIds, asset.id];
      const currentContent = latestContentRef.current ?? node.contentMarkdown ?? '';
      const updatedContent = `${currentContent}\n\n![${asset.filename}](asset://${asset.id})\n\n`;
      latestContentRef.current = updatedContent;
      setContentDraft(updatedContent);
      markSaving();
      try {
        await updateNode(node.id, { assetIds: newAssetIds, contentMarkdown: updatedContent });
        markSaved();
        refreshNodes();
      } catch {
        markError();
      }
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- Title: debounce 500ms → updateNode ----
  const handleTitleChange = useCallback(
    (value: string) => {
      setTitleDraft(value);
      latestTitleRef.current = value;
      if (!node) return;
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current);
      const nodeId = node.id;
      titleTimeoutRef.current = setTimeout(() => {
        titleTimeoutRef.current = null;
        markSaving();
        updateNode(nodeId, { title: value })
          .then(() => { markSaved(); refreshNodes(); })
          .catch(() => markError());
      }, 500);
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- Overview: debounce 500ms → updateNode ----
  const handleOverviewChange = useCallback(
    (value: string) => {
      setOverviewDraft(value);
      latestOverviewRef.current = value;
      if (!node) return;
      if (overviewTimeoutRef.current) clearTimeout(overviewTimeoutRef.current);
      const nodeId = node.id;
      overviewTimeoutRef.current = setTimeout(() => {
        overviewTimeoutRef.current = null;
        markSaving();
        updateNode(nodeId, { overview: value })
          .then(() => { markSaved(); refreshNodes(); })
          .catch(() => markError());
      }, 500);
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- Content: debounce 600ms → updateNode ----
  const handleContentChange = useCallback(
    (markdown: string) => {
      if (!node) return;
      latestContentRef.current = markdown;
      setContentDraft(markdown);
      if (contentTimeoutRef.current) clearTimeout(contentTimeoutRef.current);
      const nodeId = node.id;
      contentTimeoutRef.current = setTimeout(() => {
        contentTimeoutRef.current = null;
        markSaving();
        updateNode(nodeId, { contentMarkdown: markdown })
          .then(() => { markSaved(); refreshNodes(); })
          .catch(() => markError());
      }, 600);
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  const handleInsertAssetInNote = useCallback(
    (assetId: ID, filename: string, description?: string) => {
      if (!node) return;
      const label = description?.trim() || filename;
      const insertion = `\n\n![${label}](asset://${assetId})\n\n`;
      const current = latestContentRef.current ?? node.contentMarkdown ?? '';
      const updated = current + insertion;
      handleContentChange(updated);
    },
    [node, handleContentChange]
  );

  // ---- Tags: immediate updateNode ----
  const handleTagsChange = useCallback(
    (tagIds: ID[]) => {
      if (!node) return;
      markSaving();
      updateNode(node.id, { tagIds })
        .then(() => { markSaved(); refreshNodes(); })
        .catch(() => markError());
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- Assets: immediate updateNode ----
  const handleAssetsChange = useCallback(
    (assetIds: ID[]) => {
      if (!node) return;
      markSaving();
      updateNode(node.id, { assetIds })
        .then(() => { markSaved(); refreshNodes(); })
        .catch(() => markError());
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- When editor creates an asset (image upload), also add to assetIds ----
  const handleEditorAssetCreated = useCallback(
    (assetId: ID) => {
      if (!node) return;
      if (node.assetIds.includes(assetId)) return;
      const newAssetIds = [...node.assetIds, assetId];
      markSaving();
      updateNode(node.id, { assetIds: newAssetIds })
        .then(() => { markSaved(); refreshNodes(); })
        .catch(() => markError());
    },
    [node, markSaving, markSaved, markError, refreshNodes]
  );

  // ---- Delete node ----
  const handleDeleteNode = useCallback(async () => {
    if (!node) return;
    setDeleteDialogOpen(false);
    await deleteNode(node.id);
    setSelectedNodeId(null);
    await refreshAll();
    refreshMapContent();
  }, [node, setSelectedNodeId, refreshAll, refreshMapContent]);

  // ---- Save status text/color ----
  const saveStatusText =
    saveStatus === 'saving' ? 'Saving…' :
    saveStatus === 'saved' ? 'Saved' :
    saveStatus === 'error' ? 'Error saving' : '';

  const saveStatusColor =
    saveStatus === 'saving' ? 'var(--warning)' :
    saveStatus === 'saved' ? 'var(--success)' :
    saveStatus === 'error' ? 'var(--danger)' : 'transparent';

  // ==================== RENDER ====================

  // Empty state: no node selected, or node no longer exists
  if (!node) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-6)',
          textAlign: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: 'var(--font-md)', color: 'var(--text-muted)' }}>
          Select a node to view and edit its details.
        </span>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)', lineHeight: 1.6 }}>
          {context === 'library'
            ? 'Choose a node from the library, or create a new one.'
            : 'Choose an occurrence on the canvas or in this map’s outline.'}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`node-inspector is-${context === 'card' ? 'library is-card' : context}`}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* ---- Header: title + save status + secondary actions ---- */}
      <div
        className="note-editor-heading"
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <input
            value={titleDraft}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Note title"
            aria-label="Note title"
            style={{
              fontSize: 'var(--font-xl)',
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              padding: 0,
              outline: 'none',
              flex: 1,
              minWidth: 0,
            }}
          />
          <div className="note-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
            {getFeatureFlags().enableBatchRecallHeader && (
              <button type="button" className="ghost compact" onClick={() => { setSelectedNodeId(node.id); setActiveView('batch'); }}>Batch recall editor</button>
            )}
            <NoteExport node={{...node, title:titleDraft, overview:overviewDraft, contentMarkdown:contentDraft}} />
          </div>
        </div>
        <div className="note-overview-card" style={{
          marginTop: '6px',
          padding: '8px 12px',
          background: 'var(--surface-secondary)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 8px 8px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              fontSize: '10.5px',
              fontWeight: 650,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted)',
            }}>
              Note Overview
            </span>
            {overviewDraft.length > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {overviewDraft.length} chars
              </span>
            )}
          </div>
          <textarea
            value={overviewDraft}
            onChange={(e) => handleOverviewChange(e.target.value)}
            placeholder="Add a high-level summary or abstract for this note…"
            aria-label="Note overview"
            rows={2}
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              border: 'none',
              background: 'transparent',
              padding: 0,
              outline: 'none',
              width: '100%',
              resize: 'vertical',
              boxSizing: 'border-box',
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ height: 14, display: 'flex', alignItems: 'center' }}>
          {saveStatusText && (
            <span style={{ fontSize: 'var(--font-xs)', color: saveStatusColor }}>
              {saveStatusText}
            </span>
          )}
        </div>
      </div>

      {/* ---- Scrollable body ---- */}
      <div className="note-editor-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>
        <details className="note-guidance-disclosure"><summary>Guidance</summary><AIGuidance key={node.id} nodeId={node.id} /></details>
        <div className="note-editor-body">
          {getFeatureFlags().enableClozeTools ? (
            <SelectionRecall sourceId={node.id} onCreated={onRecallCreated} getMarkdown={() => latestContentRef.current} beforeSave={async () => {
              if (contentTimeoutRef.current) clearTimeout(contentTimeoutRef.current);
              contentTimeoutRef.current = null;
              if (latestContentRef.current !== node.contentMarkdown) await updateNode(node.id, { contentMarkdown: latestContentRef.current });
              await refreshNodes();
            }}>
              <NotePanelEditor
                key={node.id}
                markdown={node.contentMarkdown}
                onChange={handleContentChange}
                onAssetCreated={handleEditorAssetCreated}
                nodeId={node.id}
              />
            </SelectionRecall>
          ) : (
            <NotePanelEditor
              key={node.id}
              markdown={node.contentMarkdown}
              onChange={handleContentChange}
              onAssetCreated={handleEditorAssetCreated}
              nodeId={node.id}
            />
          )}
        </div>

        {context === 'library' && <details className="note-disclosure"><summary>Recall cards</summary><RecallTargetsPanel nodeId={node.id} /></details>}

        <Section title="Review plan" defaultOpen><PlanAssignmentControl subjectType="node" subjectId={node.id} /></Section>

        <details className="note-disclosure note-details"><summary>Details</summary>
        <Section title="Tags" defaultOpen><TagEditor node={node} onTagsChange={handleTagsChange} /></Section>

        {/* Images */}
        <Section title="Images" defaultOpen={false}>
          <ImageManager
            node={node}
            onAssetsChange={handleAssetsChange}
            onInsertInNote={handleInsertAssetInNote}
          />
        </Section>

        {/* Relations */}
        <Section title="Relations" defaultOpen={false}>
          <RelationList nodeId={node.id} />
        </Section>

        {/* Appears In Maps */}
        <Section title="Appears In Maps" defaultOpen={false}>
          {mapsContainingNode.length === 0 ? (
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-faint)' }}>
              This node does not appear in any map.
            </span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {mapsContainingNode.map((m) => (
                <div
                  key={m.mapId}
                  onClick={() => openMap(m.mapId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-sm)',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.mapTitle}
                  </span>
                  <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', flexShrink: 0, marginLeft: 'var(--space-2)' }}>
                    {m.count} {m.count === 1 ? 'occurrence' : 'occurrences'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Metadata */}
        <Section title="Metadata" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Created</span>
              <span>{formatDate(node.createdAt)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Updated</span>
              <span>{formatDate(node.updatedAt)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ID</span>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.id}
              </span>
            </div>
          </div>
        </Section>

        </details>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete Node"
        danger
        confirmLabel="Delete Node"
        message={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p>
              This will permanently delete <strong>{node.title}</strong> and remove it from all maps.
              Relations referencing this node will also be deleted.
            </p>
            {mapsContainingNode.length > 0 && (
              <div>
                <p style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>This node appears in:</p>
                <ul style={{ paddingLeft: 'var(--space-4)', margin: 0 }}>
                  {mapsContainingNode.map((m) => (
                    <li key={m.mapId}>{m.mapTitle}</li>
                  ))}
                </ul>
              </div>
            )}
            <p style={{ color: 'var(--danger)', fontSize: 'var(--font-xs)' }}>
              This also permanently deletes this note's review targets, rating history, and unpublished recall selections. Export a full backup first if you need to keep them. This action cannot be undone.
            </p>
          </div>
        }
        onConfirm={handleDeleteNode}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
