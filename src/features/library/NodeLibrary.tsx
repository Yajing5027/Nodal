import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { useApp } from '../../app/useApp';
import { createNode, deleteNode, updateNode } from '../../repositories/nodeRepository';
import {
  getAllSectionRatings,
  subscribeSectionRatings,
  computeNodeScore,
  type SectionRatingRecord,
  type NodeSummaryScore,
} from '../../repositories/sectionRatingRepository';
import { relativeTime } from '../navigator/utils';
import { CardRow } from '../cards/CardRow';
import { cardExcerpt } from '../cards/cardExcerpt';
import { KnowledgeCard } from '../cards/KnowledgeCard';
import { ConfirmDialog } from '../../components/ui';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { getDescendantTagIds, getTagPath } from '../../repositories/tagRepository';
import type { KnowledgeNode, KnowledgeTag } from '../../domain/types';
import { getNodeTagSummary } from '../../domain/types';

const ROW_HEIGHT = 74;
const OVERSCAN = 6;
const VIRTUALIZATION_THRESHOLD = 30;

interface GroupSection {
  id: string;
  title: string;
  parentPath?: string;
  subtreeTotal?: number;
  notes: KnowledgeNode[];
}

export function NodeLibrary() {
  const {
    nodes,
    tags,
    selectedNodeId,
    setSelectedNodeId,
    refreshAll,
    libraryTagId,
    setLibraryTagId,
  } = useApp();

  const [query, setQuery] = useState('');

  // Selection mode
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isDragSelectingRef = useRef(false);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDragSelectingRef.current = false;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleRowMouseDown = (nodeId: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button.reorder-btn, .card-row-drag-handle')) return;
    if (isSelecting || e.shiftKey || e.metaKey || e.ctrlKey) {
      isDragSelectingRef.current = true;
      if (!isSelecting) setIsSelecting(true);
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
    }
  };

  const handleRowMouseEnter = (nodeId: string) => {
    if (!isDragSelectingRef.current) return;
    setSelectedNoteIds(prev => new Set(prev).add(nodeId));
  };


  const [sortField, setSortField] = useState<'updatedAt' | 'createdAt' | 'title' | 'order' | 'score'>(() => {
    return (localStorage.getItem('nodal:notes-sort-field') as any) || 'updatedAt';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('nodal:notes-sort-dir') as any) || 'desc';
  });
  const [groupByTag, setGroupByTag] = useState<boolean>(() => {
    return localStorage.getItem('nodal:notes-group-by-tag') !== 'false';
  });

  const [allRatings, setAllRatings] = useState<Record<string, SectionRatingRecord>>({});
  useEffect(() => {
    let active = true;
    getAllSectionRatings().then(r => { if (active) setAllRatings(r); });
    const unsub = subscribeSectionRatings(() => {
      getAllSectionRatings().then(r => { if (active) setAllRatings(r); });
    });
    return () => { active = false; unsub(); };
  }, []);

  const nodeScores = useMemo(() => {
    const map = new Map<string, NodeSummaryScore>();
    for (const node of nodes) {
      map.set(node.id, computeNodeScore(node, allRatings));
    }
    return map;
  }, [nodes, allRatings]);

  const handleToggleGroupByTag = () => {
    const next = !groupByTag;
    setGroupByTag(next);
    localStorage.setItem('nodal:notes-group-by-tag', String(next));
  };

  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedFromSectionId, setDraggedFromSectionId] = useState<string | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [reorderNotice, setReorderNotice] = useState<string | null>(null);

  const handleMoveNote = async (sectionNotes: KnowledgeNode[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sectionNotes.length) return;

    const reordered = [...sectionNotes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    for (let i = 0; i < reordered.length; i++) {
      const n = reordered[i];
      const newOrder = i * 10;
      if (n.order !== newOrder) {
        await updateNode(n.id, { order: newOrder });
      }
    }
    await refreshAll();
  };

  const handleDragStart = (nodeId: string, sectionId: string) => {
    setDraggedNodeId(nodeId);
    setDraggedFromSectionId(sectionId);
  };

  const handleDragOver = (e: React.DragEvent, targetNodeId: string) => {
    e.preventDefault();
    if (draggedNodeId && dragOverNodeId !== targetNodeId) {
      setDragOverNodeId(targetNodeId);
    }
  };

  const handleDrop = async (e: React.DragEvent, sectionId: string, sectionNotes: KnowledgeNode[], targetIndex: number) => {
    e.preventDefault();
    setDragOverNodeId(null);
    if (!draggedNodeId) return;

    if (draggedFromSectionId !== sectionId) {
      setReorderNotice('Notes reordering is restricted within the same tag group.');
      setTimeout(() => setReorderNotice(null), 3000);
      setDraggedNodeId(null);
      return;
    }

    const currentIndex = sectionNotes.findIndex(n => n.id === draggedNodeId);
    if (currentIndex === -1 || currentIndex === targetIndex) {
      setDraggedNodeId(null);
      return;
    }

    const reordered = [...sectionNotes];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    for (let i = 0; i < reordered.length; i++) {
      const n = reordered[i];
      const newOrder = i * 10;
      if (n.order !== newOrder) {
        await updateNode(n.id, { order: newOrder });
      }
    }
    setDraggedNodeId(null);
    await refreshAll();
  };

  const containerRef = useRef<HTMLElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  const selected = nodes.find(node => node.id === selectedNodeId);
  const currentTag = tags.find(tag => tag.id === libraryTagId);

  const handleSortFieldChange = (field: typeof sortField) => {
    setSortField(field);
    localStorage.setItem('nodal:notes-sort-field', field);
  };

  const handleSortDirToggle = () => {
    const next = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(next);
    localStorage.setItem('nodal:notes-sort-dir', next);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
      }
    };
    updateHeight();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    if (ro) ro.observe(el);
    return () => ro?.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const create = async () => {
    const node = await createNode({ title: 'Untitled note', ...(currentTag ? { tagIds: [currentTag.id] } : {}) });
    await refreshAll();
    setSelectedNodeId(node.id);
  };

  const renderRowTags = (n: KnowledgeNode) => {
    const summary = getNodeTagSummary(n);
    const whole = tags.filter(t => summary.wholeTags.includes(t.id));
    const sectionOnly = tags.filter(t => summary.sectionOnlyTags.includes(t.id));
    return (
      <div style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
        {whole.map(t => <span key={t.id}>#{t.name}</span>)}
        {sectionOnly.map(t => (
          <span
            key={t.id}
            title="Tag appears in specific section(s)"
            aria-label={`${t.name}, section tag`}
            style={{
              border: '1px dashed var(--accent, #3b82f6)',
              borderRadius: '4px',
              padding: '0 4px',
              fontSize: '11px',
              color: 'var(--accent, #2563eb)',
              opacity: 0.9,
            }}
          >
            #{t.name}
          </span>
        ))}
      </div>
    );
  };

  // Helper to determine the most specific (leaf) tags assigned to a note
  const getLeafTagsForNode = useCallback((node: KnowledgeNode): KnowledgeTag[] => {
    const allTids = getNodeTagSummary(node).allTags;
    if (allTids.length === 0) return [];
    const assigned = tags.filter(t => allTids.includes(t.id));
    if (assigned.length <= 1) return assigned;

    return assigned.filter(t => {
      const descendants = getDescendantTagIds(t.id, tags);
      return !assigned.some(other => other.id !== t.id && descendants.has(other.id));
    });
  }, [tags]);

  // Group notes into sections
  const tagSections = useMemo((): GroupSection[] => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (n: KnowledgeNode) => {
      if (!q) return true;
      const allTids = getNodeTagSummary(n).allTags;
      const noteTagNames = allTids.map(tid => tags.find(t => t.id === tid)?.name || '').join(' ').toLowerCase();
      return `${n.title} ${n.contentMarkdown} ${noteTagNames}`.toLowerCase().includes(q);
    };

    const sortFn = (a: KnowledgeNode, b: KnowledgeNode) => {
      let diff = 0;
      if (sortField === 'score') {
        const scoreA = nodeScores.get(a.id)?.score ?? null;
        const scoreB = nodeScores.get(b.id)?.score ?? null;
        if (scoreA === null && scoreB === null) diff = a.title.localeCompare(b.title);
        else if (scoreA === null) return 1;
        else if (scoreB === null) return -1;
        else diff = scoreA - scoreB;
      } else if (sortField === 'title') {
        diff = a.title.localeCompare(b.title);
      } else if (sortField === 'createdAt') {
        diff = (a.createdAt || 0) - (b.createdAt || 0);
      } else if (sortField === 'order') {
        diff = (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
      } else {
        diff = (a.updatedAt || 0) - (b.updatedAt || 0);
      }
      return sortDir === 'asc' ? diff : -diff;
    };

    // When Tag grouping is OFF (and not viewing a specific tag from nav): flat un-grouped list
    if (!groupByTag && !libraryTagId) {
      const flat = nodes.filter(matchesQuery).sort(sortFn);
      return [{
        id: 'all',
        title: 'All Notes',
        notes: flat,
      }];
    }

    // If explicit libraryTagId is selected from navigation
    if (libraryTagId) {
      if (libraryTagId === '__untagged__') {
        const untagged = nodes.filter(n => getNodeTagSummary(n).allTags.length === 0 && matchesQuery(n)).sort(sortFn);
        return [{
          id: '__untagged__',
          title: 'Untagged Notes',
          notes: untagged,
        }];
      }
      const t = tags.find(x => x.id === libraryTagId);
      const descIds = getDescendantTagIds(libraryTagId, tags);
      const tagged = nodes.filter(n => getNodeTagSummary(n).allTags.some(tid => descIds.has(tid)) && matchesQuery(n)).sort(sortFn);
      return [{
        id: libraryTagId,
        title: t?.name || 'Notes',
        notes: tagged,
      }];
    }

    // Default Notes list: group directly by tags
    const notesByTagId = new Map<string, KnowledgeNode[]>();
    const untaggedNotes: KnowledgeNode[] = [];

    for (const node of nodes) {
      if (!matchesQuery(node)) continue;
      const leafTags = getLeafTagsForNode(node);
      if (leafTags.length === 0) {
        untaggedNotes.push(node);
      } else {
        for (const lt of leafTags) {
          const list = notesByTagId.get(lt.id) ?? [];
          list.push(node);
          notesByTagId.set(lt.id, list);
        }
      }
    }

    for (const list of notesByTagId.values()) {
      list.sort(sortFn);
    }
    untaggedNotes.sort(sortFn);

    const rootTags = tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
    rootTags.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

    const sections: GroupSection[] = [];

    for (const root of rootTags) {
      const descIds = getDescendantTagIds(root.id, tags);
      const rootTreeNotes = nodes.filter(n => matchesQuery(n) && getNodeTagSummary(n).allTags.some(tid => descIds.has(tid)));
      if (rootTreeNotes.length === 0) continue;

      const tagsInTree = tags.filter(t => descIds.has(t.id));
      for (const t of tagsInTree) {
        const groupNotes = notesByTagId.get(t.id);
        if (groupNotes && groupNotes.length > 0) {
          const path = getTagPath(t, tags);
          sections.push({
            id: t.id,
            title: t.name,
            parentPath: t.id !== root.id ? path : undefined,
            subtreeTotal: t.id === root.id ? rootTreeNotes.length : undefined,
            notes: groupNotes,
          });
        }
      }
    }

    if (untaggedNotes.length > 0 || (nodes.length === 0 && !query)) {
      sections.push({
        id: '__untagged__',
        title: 'Untagged',
        notes: untaggedNotes,
      });
    }

    return sections;
  }, [nodes, tags, query, libraryTagId, sortField, sortDir, groupByTag, nodeScores, getLeafTagsForNode]);

  // Flattened list for virtualization and counts
  const allFilteredNotes = useMemo(() => {
    const seen = new Set<string>();
    const res: KnowledgeNode[] = [];
    for (const sec of tagSections) {
      for (const n of sec.notes) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          res.push(n);
        }
      }
    }
    return res;
  }, [tagSections]);

  const matchingTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tags.filter(t => t.name.toLowerCase().includes(q));
  }, [tags, query]);

  const totalCount = allFilteredNotes.length;
  const isVirtualized = totalCount > VIRTUALIZATION_THRESHOLD && tagSections.length <= 1;

  const startIndex = isVirtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const endIndex = isVirtualized ? Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN) : totalCount;

  const visibleNodes = isVirtualized ? allFilteredNotes.slice(startIndex, endIndex) : allFilteredNotes;
  const topSpacer = isVirtualized ? startIndex * ROW_HEIGHT : 0;
  const bottomSpacer = isVirtualized ? Math.max(0, (totalCount - endIndex) * ROW_HEIGHT) : 0;

  // Selection toggle
  const toggleSelect = (nodeId: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedNoteIds.size === allFilteredNotes.length) {
      setSelectedNoteIds(new Set());
    } else {
      setSelectedNoteIds(new Set(allFilteredNotes.map(n => n.id)));
    }
  };

  const selectedNotesList = useMemo(() => {
    return nodes.filter(n => selectedNoteIds.has(n.id));
  }, [nodes, selectedNoteIds]);

  // Bulk actions
  const handleBulkExport = async () => {
    if (selectedNotesList.length === 0) return;
    const zip = new JSZip();
    for (const note of selectedNotesList) {
      const filename = `${(note.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')}.md`;
      zip.file(filename, note.contentMarkdown);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nodal-selected-notes-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedNotesList.length === 0) return;
    setIsDeleting(true);
    try {
      for (const note of selectedNotesList) {
        await deleteNode(note.id);
        if (selectedNodeId === note.id) setSelectedNodeId(null);
      }
      setSelectedNoteIds(new Set());
      setIsSelecting(false);
      setBulkDeleteDialogOpen(false);
      await refreshAll();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const activeEl = document.activeElement;
      const rows = containerRef.current?.querySelectorAll<HTMLButtonElement>('.knowledge-card-row');
      if (!rows || rows.length === 0) return;
      const currentIndex = Array.from(rows).indexOf(activeEl as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = currentIndex < rows.length - 1 ? rows[currentIndex + 1] : rows[0];
        next?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = currentIndex > 0 ? rows[currentIndex - 1] : rows[rows.length - 1];
        prev?.focus();
      }
    }
  };

  return (
    <main ref={containerRef} className="cards-page notes-card-library" onScroll={handleScroll}>
      <header className="cards-heading">
        <div>
          {currentTag && (
            <p className="library-path" style={{ margin: '0 0 4px', fontSize: '12px' }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setLibraryTagId(null)}
                style={{ padding: '0 4px', textDecoration: 'underline', cursor: 'pointer', border: 'none', background: 'none', color: 'var(--text-muted)' }}
              >
                All Notes
              </button>
              {' › Tag'}
            </p>
          )}
          <h1>{currentTag?.name ?? (libraryTagId === '__untagged__' ? 'Untagged Notes' : 'Notes')}</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            data-testid="select-notes-btn"
            className={`select-notes-btn ${isSelecting ? 'secondary' : 'ghost'}`}
            onClick={() => {
              setIsSelecting(v => !v);
              if (isSelecting) setSelectedNoteIds(new Set());
            }}
          >
            {isSelecting ? 'Cancel' : 'Select'}
          </button>
          <button className="primary" onClick={create}>New note</button>
        </div>
      </header>



      {/* Selection toolbar when selection mode is active */}
      {isSelecting && (
        <div className="selection-toolbar" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          marginBottom: 'var(--space-3)',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong, #cbd5e1)',
          borderRadius: '8px',
          gap: '12px',
          flexWrap: 'nowrap',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" className="ghost" onClick={selectAll} style={{ fontSize: '13px', padding: '4px 8px' }}>
              {selectedNoteIds.size === allFilteredNotes.length && allFilteredNotes.length > 0 ? 'Deselect all' : 'Select all'}
            </button>
            <span style={{ fontSize: '13px', fontWeight: 550 }}>
              {selectedNoteIds.size} selected
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              disabled={selectedNoteIds.size === 0}
              onClick={handleBulkExport}
              style={{ fontSize: '13px', padding: '4px 12px' }}
            >
              Export
            </button>
            <button
              type="button"
              className="danger"
              disabled={selectedNoteIds.size === 0}
              onClick={() => setBulkDeleteDialogOpen(true)}
              style={{ fontSize: '13px', padding: '4px 12px' }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {reorderNotice && (
        <div style={{
          padding: '8px 14px',
          marginBottom: 'var(--space-3)',
          background: 'rgba(234, 67, 53, 0.1)',
          border: '1px solid var(--color-danger, #d93025)',
          borderRadius: '8px',
          color: 'var(--color-danger, #d93025)',
          fontSize: '13px',
        }}>
          {reorderNotice}
        </div>
      )}

      <div className="cards-tools" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span>{allFilteredNotes.length} notes</span>
        <button
          type="button"
          className={`ghost${groupByTag ? ' is-active' : ''}`}
          aria-pressed={groupByTag}
          onClick={handleToggleGroupByTag}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            background: groupByTag ? 'var(--selection)' : undefined,
            color: groupByTag ? 'var(--text)' : undefined,
            fontWeight: groupByTag ? 600 : undefined,
            border: '1px solid var(--border)',
          }}
        >
          Group by tag {groupByTag ? '✓' : ''}
        </button>
        <input
          type="search"
          aria-label="Find a note"
          value={query}
          onChange={event => setQuery(event.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChoiceSelect
            aria-label="Sort notes by"
            value={sortField}
            onChange={e => handleSortFieldChange(e.target.value as typeof sortField)}
          >
            <option value="updatedAt">Updated</option>
            <option value="createdAt">Created</option>
            <option value="title">Name</option>
            <option value="order">Manual</option>
            <option value="score">Score</option>
          </ChoiceSelect>
          <button
            type="button"
            className="ghost"
            onClick={handleSortDirToggle}
            aria-label={`Sort direction: ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            style={{ minWidth: 32, padding: '6px 8px' }}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Matching Tags results from Search */}
      {matchingTags.length > 0 && (
        <section className="notes-matching-tags" style={{ margin: '14px 0', padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Matching Tags ({matchingTags.length})
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {matchingTags.map(tag => {
              const path = getTagPath(tag, tags);
              const count = nodes.filter(n => getNodeTagSummary(n).allTags.includes(tag.id)).length;
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="matching-tag-result"
                  onClick={() => {
                    setLibraryTagId(tag.id);
                    setQuery('');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--surface-secondary)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: 'var(--text)',
                  }}
                  title={`Filter notes by tag: ${tag.name}`}
                >
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Tag ·</span>
                  <strong>{tag.name}</strong>
                  {path !== tag.name && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({path})</span>}
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '4px' }}>{count} {count === 1 ? 'note' : 'notes'}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* If single section virtualized */}
      {isVirtualized ? (
        <div className="card-row-list" onKeyDown={handleListKeyDown}>
          {topSpacer > 0 && <div className="card-row-spacer" style={{ height: topSpacer }} aria-hidden="true" />}
          {visibleNodes.map((node, nodeIndex) => {
            const score = nodeScores.get(node.id);
            return (
              <CardRow
                key={node.id}
                title={node.title || 'Untitled note'}
                excerpt={cardExcerpt(node, (id) => nodes.find(n => n.id === id))}
                label={`Preview note: ${node.title}`}
                selectable={isSelecting}
                selected={selectedNoteIds.has(node.id)}
                onToggleSelect={() => toggleSelect(node.id)}
                onOpen={() => setSelectedNodeId(node.id)}
                onMouseDown={(e) => handleRowMouseDown(node.id, e)}
                onMouseEnter={() => handleRowMouseEnter(node.id)}
                reorderControls={
                  sortField === 'order' ? (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 4px', flexShrink: 0 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <span
                        className="card-row-drag-handle"
                        draggable
                        onDragStart={() => handleDragStart(node.id, 'all')}
                        onDragEnd={() => { setDraggedNodeId(null); setDragOverNodeId(null); }}
                        title="Drag to reorder"
                        style={{ cursor: 'grab', padding: '4px', color: 'var(--text-muted)', fontSize: '14px', userSelect: 'none' }}
                      >
                        ⠿
                      </span>
                      <button
                        type="button"
                        className="ghost reorder-btn"
                        title="Move up"
                        disabled={nodeIndex === 0}
                        onClick={() => handleMoveNote(allFilteredNotes, nodeIndex, 'up')}
                        style={{ padding: '2px 4px', fontSize: '11px', minWidth: '18px', height: '22px' }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ghost reorder-btn"
                        title="Move down"
                        disabled={nodeIndex === allFilteredNotes.length - 1}
                        onClick={() => handleMoveNote(allFilteredNotes, nodeIndex, 'down')}
                        style={{ padding: '2px 4px', fontSize: '11px', minWidth: '18px', height: '22px' }}
                      >
                        ↓
                      </button>
                    </div>
                  ) : undefined
                }
                tags={renderRowTags(node)}
                meta={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {score && score.score !== null ? (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: score.score === 100 ? 'rgba(52, 168, 83, 0.12)' : score.score >= 50 ? 'rgba(249, 171, 0, 0.15)' : 'rgba(234, 67, 53, 0.12)',
                          color: score.score === 100 ? 'var(--color-success, #1e8e3e)' : score.score >= 50 ? 'var(--color-warning, #e37400)' : 'var(--color-danger, #d93025)',
                        }}
                      >
                        {score.label}
                      </span>
                    ) : null}
                    <time>{relativeTime(node.updatedAt)}</time>
                  </div>
                }
              />
            );
          })}
          {bottomSpacer > 0 && <div className="card-row-spacer" style={{ height: bottomSpacer }} aria-hidden="true" />}
        </div>
      ) : (
        /* Render directly grouped by tag sections */
        <div className="notes-tag-groups-container" onKeyDown={handleListKeyDown}>
          {tagSections.map(section => (
            <section key={section.id} className="notes-tag-group" style={{ marginBottom: '24px' }}>
              <div
                className="notes-tag-group-header"
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: '10px',
                }}
              >
                <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
                  {section.parentPath ? (
                    <span>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{section.parentPath.slice(0, section.parentPath.lastIndexOf('/') + 1)} </span>
                      {section.title}
                    </span>
                  ) : (
                    section.title
                  )}
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {section.notes.length} {section.notes.length === 1 ? 'note' : 'notes'}
                  {section.subtreeTotal !== undefined && section.subtreeTotal !== section.notes.length && ` · ${section.subtreeTotal} total`}
                </span>
              </div>
              <div className="card-row-list">
                {section.notes.map((node, nodeIndex) => {
                  const score = nodeScores.get(node.id);
                  return (
                    <div
                      key={node.id}
                      onDragOver={e => handleDragOver(e, node.id)}
                      onDrop={e => handleDrop(e, section.id, section.notes, nodeIndex)}
                      style={{
                        borderRadius: '8px',
                        borderTop: dragOverNodeId === node.id ? '2px solid var(--accent)' : undefined,
                      }}
                    >
                      <CardRow
                        title={node.title || 'Untitled note'}
                        excerpt={cardExcerpt(node, (id) => nodes.find(n => n.id === id))}
                        label={`Preview note: ${node.title}`}
                        selectable={isSelecting}
                        selected={selectedNoteIds.has(node.id)}
                        onToggleSelect={() => toggleSelect(node.id)}
                        onOpen={() => setSelectedNodeId(node.id)}
                        onMouseDown={(e) => handleRowMouseDown(node.id, e)}
                        onMouseEnter={() => handleRowMouseEnter(node.id)}
                        reorderControls={
                          sortField === 'order' ? (
                            <div
                              style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 4px', flexShrink: 0 }}
                              onClick={e => e.stopPropagation()}
                            >
                              <span
                                className="card-row-drag-handle"
                                draggable
                                onDragStart={() => handleDragStart(node.id, section.id)}
                                onDragEnd={() => { setDraggedNodeId(null); setDragOverNodeId(null); }}
                                title="Drag to reorder"
                                style={{ cursor: 'grab', padding: '4px', color: 'var(--text-muted)', fontSize: '14px', userSelect: 'none' }}
                              >
                                ⠿
                              </span>
                              <button
                                type="button"
                                className="ghost reorder-btn"
                                title="Move up"
                                disabled={nodeIndex === 0}
                                onClick={() => handleMoveNote(section.notes, nodeIndex, 'up')}
                                style={{ padding: '2px 4px', fontSize: '11px', minWidth: '18px', height: '22px' }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="ghost reorder-btn"
                                title="Move down"
                                disabled={nodeIndex === section.notes.length - 1}
                                onClick={() => handleMoveNote(section.notes, nodeIndex, 'down')}
                                style={{ padding: '2px 4px', fontSize: '11px', minWidth: '18px', height: '22px' }}
                              >
                                ↓
                              </button>
                            </div>
                          ) : undefined
                        }
                        tags={renderRowTags(node)}
                        meta={
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {score && score.score !== null ? (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: score.score === 100 ? 'rgba(52, 168, 83, 0.12)' : score.score >= 50 ? 'rgba(249, 171, 0, 0.15)' : 'rgba(234, 67, 53, 0.12)',
                                  color: score.score === 100 ? 'var(--color-success, #1e8e3e)' : score.score >= 50 ? 'var(--color-warning, #e37400)' : 'var(--color-danger, #d93025)',
                                }}
                              >
                                {score.label}
                              </span>
                            ) : null}
                            <time>{relativeTime(node.updatedAt)}</time>
                          </div>
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {!allFilteredNotes.length && (
        <p className="empty-state">{nodes.length ? 'No matching notes.' : 'Create your first note.'}</p>
      )}

      {selected && <KnowledgeCard key={selected.id} nodeId={selected.id} onClose={() => setSelectedNodeId(null)} />}

      {/* Bulk Delete Confirm Dialog */}
      <ConfirmDialog
        open={bulkDeleteDialogOpen}
        title={`Delete ${selectedNotesList.length} ${selectedNotesList.length === 1 ? 'note' : 'notes'}`}
        message={
          <div>
            <p>Permanently delete the following <strong>{selectedNotesList.length}</strong> {selectedNotesList.length === 1 ? 'note' : 'notes'} and remove them from all maps?</p>
            <ul style={{ margin: 'var(--space-2) 0', maxHeight: '160px', overflowY: 'auto', paddingLeft: 'var(--space-4)' }}>
              {selectedNotesList.map(n => <li key={n.id}>{n.title || 'Untitled note'}</li>)}
            </ul>
            <p style={{ marginTop: 'var(--space-2)', color: 'var(--danger)', fontSize: 'var(--font-xs)' }}>
              This also permanently deletes their review targets, rating history, and recall cards. This action cannot be undone.
            </p>
          </div>
        }
        confirmLabel={isDeleting ? 'Deleting…' : `Delete ${selectedNotesList.length} ${selectedNotesList.length === 1 ? 'note' : 'notes'}`}
        danger
        onConfirm={handleBulkDeleteConfirm}
        onCancel={() => { if (!isDeleting) setBulkDeleteDialogOpen(false); }}
      />
    </main>
  );
}
