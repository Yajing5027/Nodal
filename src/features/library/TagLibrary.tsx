import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../app/useApp';
import { createTag, deleteTag, getTagByName, updateTag, wouldCreateTagCycle } from '../../repositories/tagRepository';

import { ConfirmDialog } from '../../components/ui';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import type { ID, KnowledgeTag } from '../../domain/types';

export function TagLibrary() {
  const { tags, nodes, maps, refreshAll } = useApp();
  const [nameDraft, setNameDraft] = useState('');
  const [parentDraft, setParentDraft] = useState<string>('');
  const [selectedTagId, setSelectedTagId] = useState<ID | null>(null);
  const [selectedNameDraft, setSelectedNameDraft] = useState('');
  const [selectedParentDraft, setSelectedParentDraft] = useState<string>('');
  const [deleteId, setDeleteId] = useState<ID | null>(null);
  const [notice, setNotice] = useState<string>('');

  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const isDragSelectingRef = useRef(false);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isDragSelectingRef.current = false;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleRowMouseDown = (tagId: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, .tag-drag-handle, .tag-col-order')) {
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      setSelectedTagIds(prev => new Set(prev).add(tagId));
      setSelectedTagId(tagId);
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedTagIds(prev => {
        const next = new Set(prev);
        if (next.has(tagId)) next.delete(tagId);
        else next.add(tagId);
        return next;
      });
      setSelectedTagId(tagId);
    } else {
      isDragSelectingRef.current = true;
      setSelectedTagIds(new Set([tagId]));
      setSelectedTagId(tagId);
    }
  };

  const handleRowMouseEnter = (tagId: string) => {
    if (!isDragSelectingRef.current) return;
    setSelectedTagIds(prev => new Set(prev).add(tagId));
  };

  const nameInputRef = useRef<HTMLInputElement>(null);
  const selectedNameInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop state
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'inside' | 'after' | null>(null);

  const [sortField, setSortField] = useState<'name' | 'createdAt' | 'order'>(() => {
    return (localStorage.getItem('nodal:tags-sort-field') as any) || 'name';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('nodal:tags-sort-dir') as any) || 'asc';
  });

  const handleSortFieldChange = (field: typeof sortField) => {
    setSortField(field);
    localStorage.setItem('nodal:tags-sort-field', field);
  };

  const handleSortDirToggle = () => {
    const next = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(next);
    localStorage.setItem('nodal:tags-sort-dir', next);
  };

  const [expandedIds, setExpandedIds] = useState<Set<ID>>(() => new Set(tags.map(t => t.id)));
  const [searchQuery, setSearchQuery] = useState('');

  const selectedTag = useMemo(() => tags.find(t => t.id === selectedTagId) || null, [tags, selectedTagId]);

  useEffect(() => {
    if (selectedTag) {
      setSelectedNameDraft(selectedTag.name);
      setSelectedParentDraft(selectedTag.parentId ?? '');
    } else {
      setSelectedNameDraft('');
      setSelectedParentDraft('');
    }
  }, [selectedTag]);

  const toggleExpand = (id: ID, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sortTagList = useCallback((list: KnowledgeTag[]) => {
    return [...list].sort((a, b) => {
      let diff = 0;
      if (sortField === 'createdAt') {
        diff = (a.createdAt || 0) - (b.createdAt || 0);
      } else if (sortField === 'order') {
        diff = (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
      } else {
        diff = a.name.localeCompare(b.name);
      }
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [sortField, sortDir]);

  const rootTags = useMemo(() => {
    const roots = tags.filter((t) => !t.parentId || !tags.some((p) => p.id === t.parentId));
    return sortTagList(roots);
  }, [tags, sortTagList]);

  const getChildrenOf = useCallback((parentId: string) => {
    const children = tags.filter((t) => t.parentId === parentId);
    return sortTagList(children);
  }, [tags, sortTagList]);

  const finishCreate = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      const newTag = await createTag({
        name,
        parentId: parentDraft || null,
        order: tags.length,
      });
      if (parentDraft) {
        setExpandedIds(prev => new Set(prev).add(parentDraft).add(newTag.id));
      }
      setNameDraft('');
      setParentDraft('');
      setNotice('');
      setSelectedTagId(newTag.id);
      await refreshAll();
    } catch (err: any) {
      setNotice(err?.message || 'Failed to create tag');
    }
  };

  const saveSelectedTag = async () => {
    if (!selectedTagId) return;
    const name = selectedNameDraft.trim();
    if (!name) return;
    const duplicate = await getTagByName(name);
    if (duplicate && duplicate.id !== selectedTagId) {
      setNotice(`A tag named "${name}" already exists.`);
      return;
    }
    const targetParent = selectedParentDraft ? selectedParentDraft : null;
    if (wouldCreateTagCycle(selectedTagId, targetParent, tags)) {
      setNotice('Cannot move tag under itself or its descendants (cycle prevented).');
      return;
    }
    await updateTag(selectedTagId, { name, parentId: targetParent });
    if (targetParent) {
      setExpandedIds(prev => new Set(prev).add(targetParent));
    }
    setNotice('');
    await refreshAll();
  };

  const handleAddSub = (parentTagId: string) => {
    setParentDraft(parentTagId);
    setExpandedIds(prev => new Set(prev).add(parentTagId));
    nameInputRef.current?.focus();
  };

  const moveOrder = async (tag: KnowledgeTag, delta: number) => {
    const currentOrder = tag.order ?? 0;
    await updateTag(tag.id, { order: currentOrder + delta });
    await refreshAll();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteTag(deleteId);
    if (selectedTagId === deleteId) {
      setSelectedTagId(null);
    }
    setDeleteId(null);
    await refreshAll();
  };

  const deleteTarget = tags.find((t) => t.id === deleteId);

  // Helper to format parent path for a tag
  const getTagPath = (tag: KnowledgeTag): string => {
    const parts: string[] = [];
    let curr = tag.parentId;
    const visited = new Set<string>();
    while (curr && !visited.has(curr)) {
      visited.add(curr);
      const parent = tags.find((t) => t.id === curr);
      if (parent) {
        parts.unshift(parent.name);
        curr = parent.parentId;
      } else {
        break;
      }
    }
    return parts.join(' / ');
  };

  const matchesSearch = useCallback((tag: KnowledgeTag): boolean => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if (tag.name.toLowerCase().includes(q)) return true;
    const children = getChildrenOf(tag.id);
    return children.some(matchesSearch);
  }, [searchQuery, getChildrenOf]);

  // Drag and drop handlers
  const handleDragStart = (tagId: string, e: React.DragEvent) => {
    setDraggedTagId(tagId);
    e.dataTransfer.setData('text/plain', tagId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (targetTag: KnowledgeTag, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedTagId || draggedTagId === targetTag.id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;

    let pos: 'before' | 'inside' | 'after';
    if (relY < 0.25) pos = 'before';
    else if (relY > 0.75) pos = 'after';
    else pos = 'inside';

    setDropTargetId(targetTag.id);
    setDropPosition(pos);
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
    setDropPosition(null);
  };

  const handleDrop = async (targetTag: KnowledgeTag, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const movingId = draggedTagId;
    setDraggedTagId(null);
    setDropTargetId(null);
    setDropPosition(null);

    if (!movingId || movingId === targetTag.id) return;

    if (dropPosition === 'inside') {
      if (wouldCreateTagCycle(movingId, targetTag.id, tags)) {
        setNotice('Cannot nest a tag inside itself or its descendants.');
        return;
      }
      await updateTag(movingId, { parentId: targetTag.id });
      setExpandedIds(prev => new Set(prev).add(targetTag.id));
      setNotice('');
      await refreshAll();
    } else {
      const targetParent = targetTag.parentId || null;
      if (wouldCreateTagCycle(movingId, targetParent, tags)) {
        setNotice('Cannot move tag here (cycle prevented).');
        return;
      }

      // Reorder among siblings
      const siblings = tags.filter(t => (t.parentId || null) === targetParent && t.id !== movingId);
      sortTagList(siblings);

      const targetIndex = siblings.findIndex(s => s.id === targetTag.id);
      const insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
      const reordered = [...siblings];
      const movingTag = tags.find(t => t.id === movingId);
      if (movingTag) {
        reordered.splice(Math.max(0, insertIndex), 0, movingTag);
        await Promise.all(
          reordered.map((t, idx) =>
            updateTag(t.id, {
              parentId: targetParent,
              order: idx,
            })
          )
        );
        setNotice('');
        await refreshAll();
      }
    }
  };

  const renderTagTree = (tag: KnowledgeTag, depth: number = 0): React.ReactNode => {
    if (!matchesSearch(tag)) return null;

    const children = getChildrenOf(tag.id);
    const hasChildren = children.length > 0;
    const directNodes = nodes.filter((n) => n.tagIds && n.tagIds.includes(tag.id));
    const taggedMaps = maps.filter((m) => m.tagIds && m.tagIds.includes(tag.id));
    const isExpanded = expandedIds.has(tag.id);
    const isSelected = selectedTagId === tag.id || selectedTagIds.has(tag.id);

    const isDropTarget = dropTargetId === tag.id;
    const dropFeedbackStyle: React.CSSProperties = isDropTarget
      ? dropPosition === 'inside'
        ? { background: 'rgba(70, 109, 99, 0.12)', outline: '2px dashed var(--accent)' }
        : dropPosition === 'before'
        ? { borderTop: '2px solid var(--accent)' }
        : { borderBottom: '2px solid var(--accent)' }
      : {};

    return (
      <div key={tag.id} className="tag-tree-node">
        <div
          className={`tag-tree-row${isSelected ? ' is-selected' : ''}`}
          draggable={false}
          onMouseDown={(e) => handleRowMouseDown(tag.id, e)}
          onMouseEnter={() => handleRowMouseEnter(tag.id)}
          onDragOver={(e) => handleDragOver(tag, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(tag, e)}
          onClick={() => setSelectedTagId(tag.id)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSelectedTagId(tag.id);
            if (e.key === 'ArrowRight' && hasChildren && !isExpanded) toggleExpand(tag.id);
            if (e.key === 'ArrowLeft' && hasChildren && isExpanded) toggleExpand(tag.id);
            if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveOrder(tag, -1); }
            if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveOrder(tag, 1); }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: '34px',
            padding: '3px 8px',
            paddingLeft: `${8 + depth * 18}px`,
            position: 'relative',
            cursor: 'pointer',
            borderRadius: '6px',
            border: isSelected ? '1px solid var(--selection-border)' : '1px solid transparent',
            background: isSelected ? 'var(--selection)' : 'transparent',
            transition: 'background 0.12s ease',
            userSelect: 'none',
            ...dropFeedbackStyle,
          }}
        >
          {depth > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${depth * 18 - 4}px`,
                top: '50%',
                width: '10px',
                height: '1px',
                background: 'var(--border)',
              }}
            />
          )}

          {/* Tag Title and Expand toggle */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={(e) => toggleExpand(tag.id, e)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${tag.name}` : `Expand ${tag.name}`}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                width: '14px',
                height: '14px',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: '11px',
              }}
            >
              {hasChildren ? (isExpanded ? '▾' : '▸') : '•'}
            </button>
            <strong
              style={{
                fontSize: depth === 0 ? '14px' : '12.5px',
                fontWeight: depth === 0 ? 650 : 500,
                color: depth === 0 ? 'var(--text)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {tag.name}
            </strong>
            {searchQuery.trim() && tag.parentId && (
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                ({getTagPath(tag)})
              </span>
            )}
          </div>

          {/* Fixed column for N (Notes) */}
          <div
            className="tag-col-n"
            style={{
              width: '56px',
              flexShrink: 0,
              textAlign: 'right',
              paddingRight: '8px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
            title={`${directNodes.length} notes`}
          >
            {directNodes.length}
          </div>

          {/* Fixed column for M (Maps) */}
          <div
            className="tag-col-m"
            style={{
              width: '56px',
              flexShrink: 0,
              textAlign: 'right',
              paddingRight: '8px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
            title={`${taggedMaps.length} maps`}
          >
            {taggedMaps.length}
          </div>

          {/* Fixed column for sub (Subtags) */}
          <div
            className="tag-col-sub"
            style={{
              width: '56px',
              flexShrink: 0,
              textAlign: 'center',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
            title={`${children.length} sub-tags`}
          >
            {children.length}
          </div>

          {/* Fixed column for Order controls */}
          <div
            className="tag-col-order"
            style={{
              width: '64px',
              flexShrink: 0,
              display: 'flex',
              gap: '2px',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span
              className="tag-drag-handle"
              draggable
              onDragStart={(e) => handleDragStart(tag.id, e)}
              onDragEnd={() => setDraggedTagId(null)}
              title="Drag to reorder"
              style={{ cursor: 'grab', padding: '0 2px', fontSize: '12px', color: 'var(--text-muted)', userSelect: 'none' }}
            >
              ⋮⋮
            </span>
            <button
              type="button"
              className="ghost"
              style={{ padding: '1px 5px', fontSize: '11px', minWidth: '18px', height: '22px' }}
              onClick={() => moveOrder(tag, -1)}
              title="Move up in order"
              aria-label={`Move ${tag.name} up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="ghost"
              style={{ padding: '1px 5px', fontSize: '11px', minWidth: '18px', height: '22px' }}
              onClick={() => moveOrder(tag, 1)}
              title="Move down in order"
              aria-label={`Move ${tag.name} down`}
            >
              ↓
            </button>
          </div>
        </div>

        {isExpanded && children.length > 0 && (
          <div className="tag-expanded-content" style={{ display: 'flex', flexDirection: 'column' }}>
            {children.map(child => renderTagTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="tag-library-2col"
      style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--surface-secondary)',
      }}
    >
      {/* Left Narrow Toolbar (Search, Permanent New Tag, Selected Tag Actions) */}
      <aside
        className="tag-library-left-panel"
        style={{
          width: '280px',
          flex: '0 0 280px',
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
        aria-label="Tag operations"
      >
        <div>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: '0 0 2px', fontWeight: 600 }}>
            Classification
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0, color: 'var(--text)' }}>
            Tags
          </h1>
        </div>

        {/* Tag search */}
        <div>
          <input
            type="search"
            aria-label="Find a tag"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px' }}
          />
        </div>

        {/* Permanent New Tag Section */}
        <form
          onSubmit={(e) => { e.preventDefault(); finishCreate(); }}
          style={{
            padding: '12px',
            background: 'var(--surface-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
            New Tag
          </span>
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Tag name…"
            aria-label="New tag name"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px' }}
          />
          <ChoiceSelect
            value={parentDraft}
            onChange={(e) => setParentDraft(e.target.value)}
            aria-label="Parent tag"
            style={{ width: '100%', fontSize: '12px' }}
          >
            <option value="">Root level</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </ChoiceSelect>
          <button
            type="submit"
            className="primary"
            disabled={!nameDraft.trim()}
            style={{ alignSelf: 'flex-start', padding: '4px 14px', fontSize: '12px' }}
          >
            Create tag
          </button>
        </form>



        {/* Selected Tag Inspector & Actions */}
        {selectedTag ? (
          <div
            style={{
              padding: '12px',
              background: 'var(--surface-secondary)',
              border: '1px solid var(--selection-border)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>
                Selected: {selectedTag.name}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelectedTagId(null)}
                style={{ padding: '0 4px', fontSize: '13px', lineHeight: 1, minWidth: 'unset', height: 'unset' }}
                title="Deselect"
              >
                ✕
              </button>
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                Name:
              </label>
              <input
                ref={selectedNameInputRef}
                value={selectedNameDraft}
                onChange={(e) => setSelectedNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveSelectedTag(); }}
                aria-label="Edit selected tag name"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                Parent:
              </label>
              <ChoiceSelect
                value={selectedParentDraft}
                onChange={(e) => setSelectedParentDraft(e.target.value)}
                aria-label="Change parent tag"
                style={{ width: '100%', fontSize: '12px' }}
              >
                <option value="">Root level</option>
                {tags
                  .filter((t) => t.id !== selectedTag.id && !wouldCreateTagCycle(selectedTag.id, t.id, tags))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </ChoiceSelect>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
              <button
                type="button"
                className="primary"
                onClick={saveSelectedTag}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Save
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => handleAddSub(selectedTag.id)}
                style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid var(--border)' }}
                title={`Add child tag under ${selectedTag.name}`}
              >
                ＋ Add Sub
              </button>
              <button
                type="button"
                className="danger-quiet"
                onClick={() => setDeleteId(selectedTag.id)}
                style={{ fontSize: '12px', padding: '4px 10px' }}
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '16px 12px',
              border: '1px dashed var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              lineHeight: 1.45,
            }}
          >
            Click any tag in the tree to edit name, change parent, or add sub-tags.
          </div>
        )}
      </aside>

      {/* Right Column: Compact Tree List with Aligned Columns */}
      <section
        className="tag-library-right-panel"
        style={{
          flex: 1,
          minWidth: 0,
          padding: '24px 28px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxSizing: 'border-box',
        }}
        aria-label="Tag hierarchy tree"
      >
        {notice && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: 'rgba(234, 67, 53, 0.1)',
              border: '1px solid var(--color-danger, #d93025)',
              color: 'var(--color-danger, #d93025)',
              fontSize: '13px',
            }}
          >
            {notice}
          </div>
        )}

        {/* Toolbar: Tag count and Sort controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ChoiceSelect
              aria-label="Sort tags by"
              value={sortField}
              onChange={(e) => handleSortFieldChange(e.target.value as typeof sortField)}
            >
              <option value="name">Name</option>
              <option value="createdAt">Created</option>
              <option value="order">Manual</option>
            </ChoiceSelect>
            <button
              type="button"
              className="ghost"
              onClick={handleSortDirToggle}
              aria-label={`Sort direction: ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              style={{ minWidth: 32, padding: '4px 8px' }}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* Tree Table Header with Fixed Aligned Columns */}
        <div
          className="tag-tree-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            minHeight: '30px',
            padding: '4px 8px',
            borderBottom: '1px solid var(--border)',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>Tag Name</div>
          <div style={{ width: '56px', flexShrink: 0, textAlign: 'right', paddingRight: '8px' }}>N</div>
          <div style={{ width: '56px', flexShrink: 0, textAlign: 'right', paddingRight: '8px' }}>M</div>
          <div style={{ width: '56px', flexShrink: 0, textAlign: 'center' }}>Sub</div>
          <div style={{ width: '64px', flexShrink: 0, textAlign: 'center' }}>Order</div>
        </div>

        {/* Compact Tree Rows */}
        <div className="tag-tree-body" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {rootTags.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No tags yet. Use the New Tag form on the left to create one.
            </div>
          ) : (
            rootTags.map((rootTag) => renderTagTree(rootTag, 0))
          )}
        </div>
      </section>

      {/* Delete Tag Confirm Dialog */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Tag"
        message={
          <div>
            <p>Delete tag <strong>{deleteTarget?.name}</strong>?</p>
            <p style={{ marginTop: 'var(--space-2)', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Child tags will be promoted to the parent level. Associated notes and maps will not be deleted.
            </p>
          </div>
        }
        confirmLabel="Delete tag"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
