import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/useApp';
import type { AppView } from '../../app/AppState';
import { createNode } from '../../repositories/nodeRepository';
import { getNodeTagSummary } from '../../domain/types';

const NAV_ITEMS: Array<{ view: Exclude<AppView, 'map' | 'review'>; label: string }> = [
  { view: 'home', label: 'Today' },
  { view: 'plan', label: 'Activity' },
  { view: 'plans', label: 'Review plans' },
  { view: 'cards', label: 'Review' },
  { view: 'nodes', label: 'Notes' },
  { view: 'maps', label: 'Maps' },
];

export function TopBar() {
  const {
    activeView,
    setActiveView,
    setSelectedNodeId,
    maps,
    nodes,
    tags,
    currentMapId,
    openNode,
    refreshAll,
  } = useApp();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const currentMap = maps.find((map) => map.id === currentMapId);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return nodes
      .filter((node) => {
        const tagNames = getNodeTagSummary(node).allTags
          .map((tagId) => tags.find((tag) => tag.id === tagId)?.name ?? '')
          .join(' ');
        return `${node.title} ${node.contentMarkdown} ${tagNames}`
          .toLowerCase()
          .includes(normalized);
      })
      .slice(0, 8);
  }, [nodes, query, tags]);

  const handleNewNode = async () => {
    const node = await createNode({ title: 'Untitled note' });
    await refreshAll();
    openNode(node.id);
  };

  return (
    <header className="app-topbar">
      <button className="brand-button" onClick={() => setActiveView('home')} aria-label="Nodal home">
        <span className="brand-mark" aria-hidden="true">N</span>
        <span>Nodal</span>
      </button>

      <nav className="primary-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const selected = activeView === item.view || (item.view === 'maps' && activeView === 'map');
          return (
            <button
              key={item.view}
              className={`nav-button${selected ? ' is-active' : ''}`}
              onClick={() => { if (item.view === 'nodes') setSelectedNodeId(null); setActiveView(item.view); }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {activeView === 'map' && currentMap && (
        <div className="map-breadcrumb" title={currentMap.title}>
          <span>/</span>
          <span>{currentMap.title}</span>
        </div>
      )}

      <div className="topbar-spacer" />

      <div className="utility-nav" aria-label="Library and settings">
        <button className="ghost" onClick={() => setActiveView('tags')}>Browse</button>
        <button className="ghost" onClick={() => setActiveView('data')}>Data</button>
      </div>

      <div className="global-search">
        <input
          ref={searchRef}
          id="global-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
          aria-label="Search all knowledge"
        />
        <span className="search-shortcut" aria-hidden="true">⌘K</span>
        {searchFocused && query.trim() && (
          <div className="search-results" role="listbox">
            {results.length === 0 ? (
              <div className="search-empty">No matching nodes</div>
            ) : (
              results.map((node) => (
                <button
                  key={node.id}
                  className="search-result"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    openNode(node.id);
                    setQuery('');
                    setSearchFocused(false);
                  }}
                >
                  <span>{node.title}</span>
                  <small>Node</small>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="create-actions">
        <button className="primary" onClick={handleNewNode}>New note</button>
      </div>
    </header>
  );
}
