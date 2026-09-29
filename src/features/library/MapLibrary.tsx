import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/useApp';
import {
  createMap,
  deleteMap,
  getOccurrenceCountsByMap,
  updateMap,
} from '../../repositories/mapRepository';
import { ConfirmDialog } from '../../components/ui';
import { ChoiceSelect } from '../../components/ui/ChoiceSelect';
import { getDescendantTagIds } from '../../repositories/tagRepository';
import { relativeTime } from '../navigator/utils';
import type { ID } from '../../domain/types';

export function MapLibrary() {
  const { maps, tags, openMap, refreshAll } = useApp();
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<ID | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [deleteId, setDeleteId] = useState<ID | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string>('__all__');
  const [tagPickerMapId, setTagPickerMapId] = useState<ID | null>(null);

  const [sortField, setSortField] = useState<'updatedAt' | 'createdAt' | 'title' | 'order'>(() => {
    return (localStorage.getItem('nodal:maps-sort-field') as any) || 'updatedAt';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('nodal:maps-sort-dir') as any) || 'desc';
  });

  const handleSortFieldChange = (field: typeof sortField) => {
    setSortField(field);
    localStorage.setItem('nodal:maps-sort-field', field);
  };

  const handleSortDirToggle = () => {
    const next = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(next);
    localStorage.setItem('nodal:maps-sort-dir', next);
  };

  useEffect(() => {
    let cancelled = false;
    getOccurrenceCountsByMap().then((nextCounts) => {
      if (!cancelled) setCounts(nextCounts);
    });
    return () => { cancelled = true; };
  }, [maps]);

  const descendantTagIds = useMemo(() => {
    if (selectedTagId === '__all__' || selectedTagId === '__untagged__') return null;
    return getDescendantTagIds(selectedTagId, tags);
  }, [selectedTagId, tags]);

  const visibleMaps = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...maps]
      .filter((map) => {
        if (selectedTagId === '__untagged__') {
          if (map.tagIds && map.tagIds.length > 0) return false;
        } else if (descendantTagIds) {
          if (!map.tagIds || !map.tagIds.some((tid) => descendantTagIds.has(tid))) return false;
        }
        if (normalized && !`${map.title} ${map.description || ''}`.toLowerCase().includes(normalized)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'title') {
          diff = a.title.localeCompare(b.title);
        } else if (sortField === 'createdAt') {
          diff = (a.createdAt || 0) - (b.createdAt || 0);
        } else if (sortField === 'order') {
          diff = (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
        } else {
          diff = (a.updatedAt || 0) - (b.updatedAt || 0);
        }
        return sortDir === 'asc' ? diff : -diff;
      });
  }, [maps, query, selectedTagId, descendantTagIds, sortField, sortDir]);

  const handleNewMap = async () => {
    const map = await createMap({
      title: 'Untitled Map',
      tagIds: selectedTagId !== '__all__' && selectedTagId !== '__untagged__' ? [selectedTagId] : [],
    });
    await refreshAll();
    openMap(map.id);
  };

  const startRename = (id: ID, title: string) => {
    setEditingId(id);
    setTitleDraft(title);
  };

  const saveRename = async () => {
    if (!editingId) return;
    const title = titleDraft.trim();
    if (title) await updateMap(editingId, { title });
    setEditingId(null);
    await refreshAll();
  };

  const toggleMapTag = async (mapId: ID, tagId: ID) => {
    const targetMap = maps.find((m) => m.id === mapId);
    if (!targetMap) return;
    const currentTags = targetMap.tagIds ?? [];
    const nextTags = currentTags.includes(tagId)
      ? currentTags.filter((id) => id !== tagId)
      : [...currentTags, tagId];
    await updateMap(mapId, { tagIds: nextTags });
    await refreshAll();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteMap(deleteId);
    setDeleteId(null);
    await refreshAll();
  };

  const deleteTarget = maps.find((map) => map.id === deleteId);

  return (
    <main className="resource-page">
      <div className="page-heading">
        <div>
          <h1>Maps</h1>
        </div>
        <button className="primary" onClick={handleNewMap}>New map</button>
      </div>

      <div className="resource-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search maps"
            style={{ width: '200px' }}
          />
          <ChoiceSelect
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
            aria-label="Filter maps by tag"
          >
            <option value="__all__">All tags</option>
            <option value="__untagged__">Untagged</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </ChoiceSelect>

          <ChoiceSelect
            value={sortField}
            onChange={(e) => handleSortFieldChange(e.target.value as typeof sortField)}
            aria-label="Sort maps by"
          >
            <option value="updatedAt">Updated</option>
            <option value="createdAt">Created</option>
            <option value="title">Title</option>
            <option value="order">Manual order</option>
          </ChoiceSelect>

          <button
            type="button"
            className="ghost"
            onClick={handleSortDirToggle}
            aria-label={`Toggle sort direction, currently ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            style={{ padding: '4px 8px', fontSize: '13px' }}
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        <span>{visibleMaps.length} map{visibleMaps.length === 1 ? '' : 's'}</span>
      </div>

      <section className="table-list" aria-label="Map library">
        {visibleMaps.length === 0 ? (
          <div className="actionable-empty large">
            <p>{maps.length === 0 ? 'Create a map when spatial organization will help.' : 'No maps match your search or filter.'}</p>
            {maps.length === 0 && <button onClick={handleNewMap}>Create first map</button>}
          </div>
        ) : visibleMaps.map((map) => {
          const mapTags = (map.tagIds ?? []).map((id) => tags.find((t) => t.id === id)).filter(Boolean) as typeof tags;
          const isTagPickerOpen = tagPickerMapId === map.id;

          return (
            <div key={map.id} className="table-row map-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <div className="map-title-cell" style={{ flex: 1, minWidth: 0 }}>
                {editingId === map.id ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={saveRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveRename();
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    style={{ width: '100%' }}
                  />
                ) : (
                  <>
                    <strong style={{ fontSize: '15px' }}>{map.title || 'Untitled Map'}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginTop: '4px', flexWrap: 'wrap' }}>
                      {mapTags.map((t) => (
                        <span key={t.id} style={{ fontSize: '11px', background: 'var(--surface-secondary, rgba(0,0,0,0.06))', padding: '1px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                          #{t.name}
                        </span>
                      ))}
                      <button
                        type="button"
                        className="ghost compact"
                        style={{ fontSize: '11px', padding: '1px 6px', height: 'auto' }}
                        onClick={() => setTagPickerMapId(isTagPickerOpen ? null : map.id)}
                      >
                        {mapTags.length === 0 ? '+ Tag' : '✎ Tags'}
                      </button>
                    </div>

                    {isTagPickerOpen && (
                      <div style={{ marginTop: '8px', padding: '8px', background: 'var(--surface-hover)', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {tags.length === 0 ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No tags available. Create tags first.</span>
                        ) : tags.map((t) => {
                          const active = (map.tagIds ?? []).includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={active ? 'primary' : 'ghost'}
                              style={{ fontSize: '11px', padding: '2px 8px', height: 'auto' }}
                              onClick={() => toggleMapTag(map.id, t.id)}
                            >
                              {active ? `✓ ${t.name}` : `+ ${t.name}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="map-facts" style={{ flexShrink: 0 }}>
                <span><strong>{counts[map.id] ?? 0}</strong><small>Occurrences</small></span>
                <span><strong>{relativeTime(map.updatedAt)}</strong><small>Updated</small></span>
              </div>

              <div className="row-actions" style={{ flexShrink: 0 }}>
                <button onClick={() => startRename(map.id, map.title)}>Rename</button>
                <button className="danger-quiet" onClick={() => setDeleteId(map.id)}>Delete</button>
                <button className="primary" onClick={() => openMap(map.id)}>Open map</button>
              </div>
            </div>
          );
        })}
      </section>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Map"
        message={
          <div>
            <p>Delete <strong>{deleteTarget?.title}</strong> and its local frames, occurrences, and map-only relations?</p>
            <p style={{ marginTop: 'var(--space-2)' }}>Your Nodes and global relations will remain in the knowledge library.</p>
          </div>
        }
        confirmLabel="Delete map"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </main>
  );
}
