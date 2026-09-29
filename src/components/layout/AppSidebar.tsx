import { useEffect, useMemo, useState, useRef } from 'react';
import { liveQuery } from 'dexie';
import { useApp } from '../../app/useApp';
import { useTheme } from '../../app/themeState';
import type { AppView } from '../../app/AppState';
import type { KnowledgeMap, KnowledgeTag } from '../../domain/types';
import { getNodeTagSummary } from '../../domain/types';
import { getMapOutline, type MapOutline, type OccurrenceOutline } from '../../features/maps/mapOutline';
import { getDescendantTagIds } from '../../repositories/tagRepository';

type IconName = 'home' | 'note' | 'review' | 'map' | 'tag' | 'search' | 'sun' | 'moon' | 'system' | 'panel' | 'settings';
const paths: Record<IconName, string> = {
  home: 'm3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  review: 'M4 5h14v14H4zM8 2h13v14M8 10h6M8 14h4',
  map: 'M9 3h6v5H9zM2 16h6v5H2zM16 16h6v5h-6zM12 8v4M5 16v-4h14v4',
  tag: 'M3 3h8l10 10-8 8L3 11zM7 7h.01',
  search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11',
  system: 'M3 4h18v13H3zM8 21h8M12 17v4',
  panel: 'M3 4h18v16H3zM9 4v16',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
};
export function NavIcon({ name }: { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function MapBranch({ map, onNavigate }: { map: KnowledgeMap; onNavigate: () => void }) {
  const { currentMapId, activeView, openMap, setSelectedNodeId, setSelectedOccurrenceId, selectedOccurrenceId } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [outline, setOutline] = useState<MapOutline | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const subscription = liveQuery(() => getMapOutline(map.id)).subscribe({ next: setOutline });
    return () => subscription.unsubscribe();
  }, [expanded, map.id]);
  const open = () => { openMap(map.id); onNavigate(); };
  const item = ({ occurrence, nodeTitle }: OccurrenceOutline) => (
    <li key={occurrence.id}>
      <button
        className={`tree-note${activeView === 'map' && currentMapId === map.id && selectedOccurrenceId === occurrence.id ? ' is-active' : ''}`}
        onClick={() => { open(); setSelectedNodeId(occurrence.nodeId); setSelectedOccurrenceId(occurrence.id); }}
        title={nodeTitle}
      >
        <span className="tree-dot" />
        <span>{nodeTitle}</span>
      </button>
    </li>
  );
  return (
    <li>
      <div className={`sidebar-nav-row branch-row${activeView === 'map' && currentMapId === map.id ? ' is-active' : ''}`}>
        <button
          className="sidebar-link"
          aria-current={activeView === 'map' && currentMapId === map.id ? 'page' : undefined}
          onClick={open}
          title={map.title}
          style={{ flex: 1, minWidth: 0 }}
        >
          <NavIcon name="map" />
          <span>{map.title}</span>
        </button>
        <button
          type="button"
          className="branch-toggle"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${map.title}`}
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); setExpanded(value => !value); }}
        >
          {expanded ? '⌄' : '›'}
        </button>
      </div>
      {expanded && (
        <ul className="branch-children" style={{ marginLeft: '17px', paddingLeft: '9px', borderLeft: '1px solid var(--border)' }}>
          {!outline ? (
            <li className="branch-empty">Loading…</li>
          ) : (
            <>
              {outline.frames.map(({ frame, occurrences }) => (
                <li key={frame.id}>
                  <details open>
                    <summary>{frame.title}</summary>
                    <ul>{occurrences.map(item)}</ul>
                  </details>
                </li>
              ))}
              {outline.unassigned.map(item)}
              {!outline.frames.length && !outline.unassigned.length && (
                <li className="branch-empty">Empty map</li>
              )}
            </>
          )}
        </ul>
      )}
    </li>
  );
}

function TagBranch({
  tag,
  allTags,
  onNavigate,
  depth = 0,
}: {
  tag: KnowledgeTag;
  allTags: KnowledgeTag[];
  onNavigate: () => void;
  depth?: number;
}) {
  const { activeView, libraryTagId, setLibraryTagId, setSelectedNodeId, setActiveView, nodes } = useApp();
  const [expanded, setExpanded] = useState(false);
  const children = useMemo(() => allTags.filter(t => t.parentId === tag.id), [allTags, tag.id]);
  const hasChildren = children.length > 0;

  const descendantIds = useMemo(() => getDescendantTagIds(tag.id, allTags), [tag.id, allTags]);
  const count = useMemo(() => {
    return nodes.filter(node => {
      const allTids = getNodeTagSummary(node).allTags;
      return allTids.some(tid => descendantIds.has(tid));
    }).length;
  }, [nodes, descendantIds]);

  const isSelected = activeView === 'nodes' && libraryTagId === tag.id;

  const handleClick = () => {
    if (isSelected && hasChildren) {
      setExpanded(v => !v);
    } else {
      setLibraryTagId(tag.id);
      setSelectedNodeId(null);
      setActiveView('nodes');
      if (hasChildren && !expanded) {
        setExpanded(true);
      }
      onNavigate();
    }
  };

  return (
    <li className="tag-branch-item">
      <div className={`sidebar-nav-row${isSelected ? ' is-active' : ''}`} style={{ position: 'relative' }}>
        <button
          className="sidebar-link tag-branch-link"
          onClick={handleClick}
          title={tag.name}
          aria-expanded={hasChildren ? expanded : undefined}
          style={{
            width: '100%',
            paddingLeft: `${10 + depth * 14}px`,
            paddingRight: '6px',
            boxSizing: 'border-box',
          }}
        >
          {depth > 0 && (
            <span
              style={{
                position: 'absolute',
                left: `${depth * 14}px`,
                top: '6px',
                bottom: '6px',
                width: '1px',
                background: 'var(--border)',
              }}
            />
          )}
          <NavIcon name="tag" />
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tag.name}
          </span>
          <small
            className="sidebar-tag-count"
            style={{
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'right',
              minWidth: '24px',
              color: 'var(--text-muted)',
              fontSize: '11px',
            }}
          >
            {count}
          </small>
          <span
            className="tag-chevron-slot"
            style={{
              width: '16px',
              minWidth: '16px',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              color: 'var(--text-muted)',
              userSelect: 'none',
              cursor: hasChildren ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              if (hasChildren) {
                e.stopPropagation();
                setExpanded(v => !v);
              }
            }}
          >
            {hasChildren ? (expanded ? '⌄' : '›') : ''}
          </span>
        </button>
      </div>
      {hasChildren && expanded && (
        <ul
          className="tag-children"
          style={{
            listStyle: 'none',
            margin: '0',
            padding: '0',
          }}
        >
          {children.map(child => (
            <TagBranch
              key={child.id}
              tag={child}
              allTags={allTags}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AppSidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const { activeView, setActiveView, setSelectedNodeId, libraryTagId, setLibraryTagId, maps, nodes, tags, openNode } = useApp();
  const { mode, setMode } = useTheme();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [nodesExpanded, setNodesExpanded] = useState(false);
  const [mapsExpanded, setMapsExpanded] = useState(true);
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen, onClose]);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return nodes.filter(node => {
      const tagNames = getNodeTagSummary(node).allTags
        .map(tid => tags.find(t => t.id === tid)?.name || '')
        .join(' ')
        .toLowerCase();
      return `${node.title} ${node.contentMarkdown} ${tagNames}`.toLowerCase().includes(q);
    }).slice(0, 8);
  }, [nodes, tags, query]);
  const go = (view: AppView) => { setSelectedNodeId(null); setLibraryTagId(null); setActiveView(view); onClose(); };
  
  const rootTags = useMemo(() => {
    return tags.filter(t => !t.parentId || !tags.some(p => p.id === t.parentId));
  }, [tags]);
  const sortedRootTags = useMemo(() => {
    return [...rootTags].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }, [rootTags]);

  // Horizontal sidebar width resizing (default 260, min 200, max 480)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('nodal:sidebar-width');
    if (saved) {
      const val = parseInt(saved, 10);
      if (!isNaN(val) && val >= 200 && val <= 480) return val;
    }
    return 260;
  });
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(260);

  useEffect(() => {
    document.documentElement.style.setProperty('--navigation-width', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  const handleWidthMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingWidth(true);
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      const nextWidth = Math.min(480, Math.max(200, startWidthRef.current + delta));
      setSidebarWidth(nextWidth);
      document.documentElement.style.setProperty('--navigation-width', `${nextWidth}px`);
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      const delta = upEvent.clientX - startXRef.current;
      const finalWidth = Math.min(480, Math.max(200, startWidthRef.current + delta));
      setSidebarWidth(finalWidth);
      localStorage.setItem('nodal:sidebar-width', String(finalWidth));
      document.documentElement.style.setProperty('--navigation-width', `${finalWidth}px`);
      setIsResizingWidth(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleWidthKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSidebarWidth(w => {
        const next = Math.max(200, w - 10);
        localStorage.setItem('nodal:sidebar-width', String(next));
        return next;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSidebarWidth(w => {
        const next = Math.min(480, w + 10);
        localStorage.setItem('nodal:sidebar-width', String(next));
        return next;
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSidebarWidth(200);
      localStorage.setItem('nodal:sidebar-width', '200');
    } else if (e.key === 'End') {
      e.preventDefault();
      setSidebarWidth(480);
      localStorage.setItem('nodal:sidebar-width', '480');
    }
  };

  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = localStorage.getItem('nodal:sidebar-content-split');
    if (saved) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 20 && val <= 80) return val;
    }
    return 54;
  });
  const isDraggingSplitRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const relativeY = moveEvent.clientY - rect.top;
      const totalHeight = rect.height;
      if (totalHeight <= 0) return;
      const newPercent = Math.min(80, Math.max(20, (relativeY / totalHeight) * 100));
      setSplitRatio(newPercent);
      localStorage.setItem('nodal:sidebar-content-split', String(newPercent));
    };

    const onMouseUp = () => {
      isDraggingSplitRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleSplitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSplitRatio(prev => {
        const next = Math.max(20, prev - 5);
        localStorage.setItem('nodal:sidebar-content-split', String(next));
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSplitRatio(prev => {
        const next = Math.min(80, prev + 5);
        localStorage.setItem('nodal:sidebar-content-split', String(next));
        return next;
      });
    }
  };

  return <>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={onClose} />}
    <aside
      className={`app-sidebar${mobileOpen ? ' is-open' : ''}${isResizingWidth ? ' is-resizing' : ''}`}
      aria-label="Workspace navigation"
      style={mobileOpen ? undefined : { width: `${sidebarWidth}px`, flex: `0 0 ${sidebarWidth}px` }}
    >
      <div className="sidebar-brand"><button onClick={() => go('home')} aria-label="Nodal home"><span className="sidebar-logo">n</span><strong>Nodal</strong></button><button className="mobile-close" onClick={onClose} aria-label="Close navigation">×</button></div>
      <div className="sidebar-search"><NavIcon name="search" /><input id="global-search-input" type="search" aria-label="Search all knowledge" value={query} onFocus={() => setSearching(true)} onBlur={() => setSearching(false)} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur(); } if (event.key === 'Enter' && results[0]) { openNode(results[0].id); setQuery(''); onClose(); } }} /><kbd>⌘ K</kbd>
        {searching && query.trim() && <div className="sidebar-search-results">{results.length ? results.map(node => <button key={node.id} onMouseDown={event => event.preventDefault()} onClick={() => { openNode(node.id); setQuery(''); onClose(); }}>{node.title || 'Untitled note'}</button>) : <p>No matching notes</p>}</div>}
      </div>
      <nav className="sidebar-scroll" aria-label="Primary navigation">
        <div className="sidebar-main-links">
          <div className="sidebar-nav-row">
            <button
              className={`sidebar-link${activeView === 'home' ? ' is-active' : ''}`}
              aria-current={activeView === 'home' ? 'page' : undefined}
              onClick={() => go('home')}
            >
              <NavIcon name="home" />
              <span>Today</span>
            </button>
          </div>
          <div className={`sidebar-nav-row${(activeView === 'cards' || activeView === 'review' || activeView === 'plans') ? ' is-active' : ''}`}>
            <button
              className="sidebar-link"
              aria-current={(activeView === 'cards' || activeView === 'review') ? 'page' : undefined}
              onClick={() => go('cards')}
            >
              <NavIcon name="review" />
              <span>Recall</span>
            </button>
            <button
              className={`sidebar-inline-action${activeView === 'plans' ? ' is-active-sub' : ''}`}
              aria-label="Review plan settings"
              title="Review plans"
              onClick={() => go('plans')}
            >
              <NavIcon name="settings" />
            </button>
          </div>
        </div>

        <div ref={splitContainerRef} className="sidebar-split-container">
          <div
            className="sidebar-pane sidebar-pane-content"
            style={{
              flex: `0 0 ${splitRatio}%`,
              height: `${splitRatio}%`,
              minHeight: '70px',
              overflowY: 'auto',
            }}
          >
            <details className="sidebar-section" open>
              <summary><span>Content</span><span className="disclosure-chevron">⌄</span></summary>
              <div className="sidebar-nav-row sidebar-content-row" style={{ marginTop: 4 }}>
                <button
                  className={`sidebar-link sidebar-content-link${activeView === 'nodes' && !libraryTagId ? ' is-active' : ''}`}
                  aria-current={activeView === 'nodes' && !libraryTagId ? 'page' : undefined}
                  onClick={() => go('nodes')}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <NavIcon name="note" />
                  <span>Notes</span>
                  <small>{nodes.length}</small>
                </button>
                <button
                  type="button"
                  className="sidebar-inline-action sidebar-expand-action"
                  aria-label={notesExpanded ? 'Collapse notes preview' : 'Expand notes preview'}
                  title={notesExpanded ? 'Collapse notes preview' : 'Expand notes preview'}
                  onClick={(e) => { e.stopPropagation(); setNotesExpanded(v => !v); }}
                >
                  <span style={{ fontSize: '11px', transform: notesExpanded ? 'none' : 'rotate(-90deg)', display: 'inline-block', transition: 'transform 0.15s ease' }}>⌄</span>
                </button>
              </div>
              {notesExpanded && (
                <ul className="note-branches" style={{ marginTop: 2, marginLeft: '16px', paddingLeft: '8px', borderLeft: '1px solid var(--border)', maxHeight: '160px', overflowY: 'auto', listStyle: 'none' }}>
                  {nodes.map(n => (
                    <li key={n.id} style={{ margin: '2px 0' }}>
                      <button
                        type="button"
                        className="sidebar-link"
                        onClick={() => { openNode(n.id); onClose(); }}
                        style={{ fontSize: '12px', padding: '3px 6px', width: '100%', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {n.title || 'Untitled note'}
                      </button>
                    </li>
                  ))}
                  {nodes.length === 0 && <li style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px' }}>No notes yet</li>}
                </ul>
              )}

              <div className="sidebar-nav-row sidebar-content-row" style={{ marginTop: 2 }}>
                <button
                  className={`sidebar-link sidebar-content-link${activeView === 'sections' ? ' is-active' : ''}`}
                  aria-current={activeView === 'sections' ? 'page' : undefined}
                  onClick={() => go('sections')}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <NavIcon name="panel" />
                  <span>Nodes</span>
                </button>
                <button
                  type="button"
                  className="sidebar-inline-action sidebar-expand-action"
                  aria-label={nodesExpanded ? 'Collapse nodes preview' : 'Expand nodes preview'}
                  title={nodesExpanded ? 'Collapse nodes preview' : 'Expand nodes preview'}
                  onClick={(e) => { e.stopPropagation(); setNodesExpanded(v => !v); }}
                >
                  <span style={{ fontSize: '11px', transform: nodesExpanded ? 'none' : 'rotate(-90deg)', display: 'inline-block', transition: 'transform 0.15s ease' }}>⌄</span>
                </button>
              </div>
              {nodesExpanded && (
                <ul className="node-section-branches" style={{ marginTop: 2, marginLeft: '16px', paddingLeft: '8px', borderLeft: '1px solid var(--border)', maxHeight: '160px', overflowY: 'auto', listStyle: 'none' }}>
                  {nodes.map(n => (
                    <li key={n.id} style={{ margin: '2px 0' }}>
                      <button
                        type="button"
                        className="sidebar-link"
                        onClick={() => { openNode(n.id); onClose(); }}
                        style={{ fontSize: '12px', padding: '3px 6px', width: '100%', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {n.title || 'Untitled note'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={`sidebar-nav-row sidebar-content-row${activeView === 'maps' ? ' is-active' : ''}`} style={{ marginTop: 2 }}>
                <button
                  type="button"
                  className="sidebar-link sidebar-content-link section-overview"
                  aria-current={activeView === 'maps' ? 'page' : undefined}
                  onClick={() => go('maps')}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <NavIcon name="map" />
                  <span>Maps</span>
                  <small>{maps.length}</small>
                </button>
                <button
                  type="button"
                  className="sidebar-inline-action sidebar-expand-action"
                  aria-label={mapsExpanded ? 'Collapse maps preview' : 'Expand maps preview'}
                  aria-expanded={mapsExpanded}
                  title={mapsExpanded ? 'Collapse maps preview' : 'Expand maps preview'}
                  onClick={(e) => { e.stopPropagation(); setMapsExpanded(v => !v); }}
                >
                  <span style={{ fontSize: '11px', transform: mapsExpanded ? 'none' : 'rotate(-90deg)', display: 'inline-block', transition: 'transform 0.15s ease' }}>⌄</span>
                </button>
              </div>
              {mapsExpanded && (
                <ul className="map-branches" style={{ marginTop: 2, marginLeft: '16px', paddingLeft: '8px', borderLeft: '1px solid var(--border)', maxHeight: '160px', overflowY: 'auto' }}>
                  {maps.map(map => <MapBranch key={map.id} map={map} onNavigate={onClose} />)}
                </ul>
              )}
            </details>
          </div>

          <div
            className="sidebar-splitter"
            role="separator"
            aria-label="Resize content and tags panels"
            aria-orientation="horizontal"
            tabIndex={0}
            onMouseDown={handleSplitMouseDown}
            onKeyDown={handleSplitKeyDown}
            title="Drag or use arrow keys to adjust heights"
          >
            <div style={{ height: '1px', width: '100%', background: 'var(--border)' }} />
          </div>

          <div
            className="sidebar-pane sidebar-pane-tags"
            style={{
              flex: 1,
              minHeight: '70px',
              overflowY: 'auto',
            }}
          >
            <div className="sidebar-section" style={{ margin: 0 }}>
              <div className="sidebar-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px 8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tags</span>
                <button
                  type="button"
                  className={`sidebar-inline-action${activeView === 'tags' ? ' is-active-sub' : ''}`}
                  aria-label="Manage tags"
                  title="Manage tags"
                  onClick={event => { event.preventDefault(); event.stopPropagation(); go('tags'); }}
                  style={{ width: '22px', height: '22px', minWidth: '22px' }}
                >
                  <NavIcon name="settings" />
                </button>
              </div>
              <ul className="tag-branches">
                {sortedRootTags.map(tag => (
                  <TagBranch key={tag.id} tag={tag} allTags={tags} onNavigate={onClose} />
                ))}
              </ul>
              {!tags.length && <p className="branch-empty">No tags yet</p>}
            </div>
          </div>
        </div>
      </nav>
      <div className="sidebar-bottom">
        <details className="sidebar-tools" open={['plan', 'data'].includes(activeView) ? true : undefined}>
          <summary><NavIcon name="settings" /><span>Tools & settings</span><span>⌄</span></summary>
          <div>
            {([{view:'plan',label:'Activity'},{view:'data',label:'Data & backup'}] as const).map(item => (
              <button
                key={item.view}
                className={activeView === item.view ? 'is-active' : ''}
                aria-current={activeView === item.view ? 'page' : undefined}
                onClick={() => go(item.view)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </details>
        <div className="appearance-switch" role="group" aria-label="Appearance">{([{ value: 'light', label: 'Light mode', icon: 'sun' }, { value: 'dark', label: 'Dark mode', icon: 'moon' }, { value: 'system', label: 'Use system appearance', icon: 'system' }] as const).map(option => <button key={option.value} aria-label={option.label} title={option.label} aria-pressed={mode === option.value} onClick={() => setMode(option.value)}><NavIcon name={option.icon} /><span>{option.value === 'system' ? 'Auto' : option.value === 'light' ? 'Light' : 'Dark'}</span></button>)}</div>
      </div>
      {!mobileOpen && (
        <div
          className="sidebar-horizontal-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar width"
          aria-valuenow={sidebarWidth}
          aria-valuemin={200}
          aria-valuemax={480}
          tabIndex={0}
          onMouseDown={handleWidthMouseDown}
          onKeyDown={handleWidthKeyDown}
        />
      )}
    </aside>
  </>;
}
