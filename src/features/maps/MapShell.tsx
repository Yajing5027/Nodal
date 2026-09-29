import { useApp } from '../../app/useApp';
import { MapWorkspace } from './MapWorkspace';
import { NodeInspector } from '../nodes/NodeInspector';
import { updateMap } from '../../repositories/mapRepository';
import { useEffect, useState } from 'react';
import { createRetrievalTarget, getRetrievalTargetsForSource } from '../../repositories/reviewRepository';

export function MapShell() {
  const [focusCanvas, setFocusCanvas] = useState(false);
  const [frameworkTargetExists, setFrameworkTargetExists] = useState(false);
  const {
    maps,
    currentMapId,
    selectedNodeId,
    rightCollapsed,
    setRightCollapsed,
    setActiveView,
    refreshMaps,
  } = useApp();
  const currentMap = maps.find((map) => map.id === currentMapId);

  useEffect(() => {
    if (!currentMapId) {
      setFrameworkTargetExists(false);
      return;
    }
    getRetrievalTargetsForSource('map', currentMapId).then((items) => {
      setFrameworkTargetExists(items.some(({ target }) => target.kind === 'framework_reconstruction'));
    });
  }, [currentMapId]);

  if (!currentMap) {
    return (
      <main className="missing-map">
        <p>No map is open.</p>
        <button className="primary" onClick={() => setActiveView('maps')}>Choose a map</button>
      </main>
    );
  }

  return (
    <main className={`map-shell${focusCanvas ? ' is-focused' : ''}`}>
      <div className="map-context-bar">
        <div className="map-context-title">
          <input
            key={currentMap.id}
            className="map-title-input"
            defaultValue={currentMap.title}
            aria-label="Map title"
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = currentMap.title;
                event.currentTarget.blur();
              }
            }}
            onBlur={async (event) => {
              const title = event.currentTarget.value.trim();
              if (!title || title === currentMap.title) {
                event.currentTarget.value = currentMap.title;
                return;
              }
              await updateMap(currentMap.id, { title });
              await refreshMaps();
            }}
          />
          {currentMap.description && <span>{currentMap.description}</span>}
        </div>
        <div className="topbar-spacer" />
        <button className="ghost compact map-focus-button" aria-pressed={focusCanvas} onClick={() => setFocusCanvas(value => !value)}>{focusCanvas ? 'Exit focus' : 'Focus'}</button>
        <button
          className={frameworkTargetExists ? 'ghost compact framework-saved' : 'compact'}
          disabled={frameworkTargetExists}
          onClick={async () => {
            await createRetrievalTarget({
              sourceType: 'map',
              sourceId: currentMap.id,
              kind: 'framework_reconstruction',
              promptMarkdown: `Reconstruct the essential structure of ${currentMap.title}.`,
              expectedEvidenceMarkdown: currentMap.description || 'Recover the key nodes, branches, and relation directions before opening the map.',
            });
            setFrameworkTargetExists(true);
          }}
        >{frameworkTargetExists ? 'Structure in review ✓' : 'Review this structure'}</button>
        <button
          className="ghost compact"
          title="Toggle map inspector"
          onClick={() => {
            if (focusCanvas) {
              setFocusCanvas(false);
              setRightCollapsed(false);
            } else {
              setRightCollapsed(!rightCollapsed);
            }
          }}
        >
          {rightCollapsed || focusCanvas ? 'Inspector' : 'Hide inspector'}
        </button>
      </div>

      <div className="map-workspace-grid">
        <section className="map-canvas" aria-label={`${currentMap.title} map canvas`}>
          <MapWorkspace />
        </section>

        {!rightCollapsed && !focusCanvas && (
          <aside className="map-inspector">
            {selectedNodeId ? (
              <NodeInspector context="map" />
            ) : (
              <div className="map-overview-panel" style={{ padding: 'var(--space-3)' }}>
                <header style={{ marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                  <p className="eyebrow" style={{ margin: 0, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Map Inspector</p>
                  <h3 style={{ margin: '4px 0 0', fontSize: '16px' }}>{currentMap.title}</h3>
                  {currentMap.description && (
                    <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {currentMap.description}
                    </p>
                  )}
                </header>
                <div className="map-inspector-guide" style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <p style={{ margin: '0 0 12px' }}>
                    Select a note, section, frame, or connection line on the canvas to inspect its details and relationships.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    <li>Click <strong>+ Add Node</strong> to place a note or section.</li>
                    <li>Click <strong>+ Frame</strong> to group items.</li>
                    <li>Click <strong>Connect</strong> or drag between ports to link items.</li>
                    <li>Double-click on canvas to create a quick note.</li>
                  </ul>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
