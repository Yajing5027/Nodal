// ============================================================
// App State Context — shared UI state, NOT a source of truth
// Dexie is the persistent source. This context holds:
// - currentMapId, selectedNodeId (UI selection state)
// - live data snapshots from Dexie
// ============================================================
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type {
  KnowledgeNode,
  KnowledgeMap,
  KnowledgeTag,
  ID,
} from '../domain/types';
import { getAllNodes } from '../repositories/nodeRepository';
import { getAllMaps } from '../repositories/mapRepository';
import { getAllTags } from '../repositories/tagRepository';
import { ensureCourseTagsExist } from '../repositories/tagMigration';
import { ensureStarterNotes } from '../repositories/starterNotes';
import { ensureStudyWorkspace } from '../repositories/showcaseContent';
import { AppStateContext, type AppState, type AppView } from './AppState';

export function AppProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [maps, setMaps] = useState<KnowledgeMap[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [reviewTargetIds, setReviewTargetIds] = useState<ID[] | null>(null);
  const [reviewFocusTargetId, setReviewFocusTargetId] = useState<ID | null>(null);
  const [reviewReturnView, setReviewReturnView] = useState<AppView>('home');
  const startReview = (ids?: ID[], options?: { focusTargetId?: ID; returnView?: AppView }) => {
    setReviewTargetIds(ids ?? null);
    setReviewFocusTargetId(options?.focusTargetId ?? null);
    setReviewReturnView(options?.returnView ?? (activeView === 'review' ? 'cards' : activeView));
    setActiveView('review');
  };
  const [mapContentVersion, setMapContentVersion] = useState(0);
  const [currentMapId, setCurrentMapId] = useState<ID | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<ID | null>(null);
  const [pendingSectionId, setPendingSectionId] = useState<ID | null>(null);
  const [libraryTagId, setLibraryTagId] = useState<ID | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<ID | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadRef = useRef<Promise<{
    nodes: KnowledgeNode[];
    maps: KnowledgeMap[];
    tags: KnowledgeTag[];
  }> | null>(null);

  const refreshNodes = useCallback(async () => {
    const data = await getAllNodes();
    setNodes(data);
  }, []);

  const refreshMaps = useCallback(async () => {
    const data = await getAllMaps();
    setMaps(data);
  }, []);

  const refreshTags = useCallback(async () => {
    const data = await getAllTags();
    setTags(data);
  }, []);

  const refreshAll = useCallback(async () => {
    const [n, m, t] = await Promise.all([getAllNodes(), getAllMaps(), getAllTags()]);
    setNodes(n);
    setMaps(m);
    setTags(t);
  }, []);

  // Initial load: read whatever the user actually has
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // Ensure course tag trees exist safely in-place without overwriting user assignments
        if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
          try {
            await ensureCourseTagsExist();
            await ensureStarterNotes();
            await ensureStudyWorkspace();
          } catch (e) {
            console.error('Initialization check error:', e);
          }
        }

        // React StrictMode runs effects twice in development. Reuse one initialization
        // promise so both passes read the same fresh snapshot.
        if (!initialLoadRef.current) {
          initialLoadRef.current = Promise.all([
            getAllNodes(),
            getAllMaps(),
            getAllTags(),
          ]).then(([nodes, maps, tags]) => ({ nodes, maps, tags }));
        }
        const { nodes: n, maps: m, tags: t } = await initialLoadRef.current;
        if (cancelled) return;
        setNodes(n);
        setMaps(m);
        setTags(t);
        // Auto-select first map
        if (m.length > 0) {
          setCurrentMapId(m[0].id);
        }
      } catch (err) {
        console.error('Failed to initialize app data:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const getNode = useCallback(
    (id: ID) => nodes.find((n) => n.id === id),
    [nodes]
  );

  const getTag = useCallback(
    (id: ID) => tags.find((t) => t.id === id),
    [tags]
  );

  const openNode = useCallback((id: ID) => {
    setLibraryTagId(null);
    setSelectedNodeId(id);
    setSelectedOccurrenceId(null);
    setActiveView(curr => (curr === 'sections' ? 'sections' : 'nodes'));
  }, []);

  // Transient UI navigation: open a Node and request that its reader scroll to
  // and highlight the requested Section. Not persisted to the knowledge model.
  const openNodeSection = useCallback((id: ID, sectionId?: ID) => {
    setPendingSectionId(sectionId ?? null);
    openNode(id);
  }, [openNode]);

  const consumePendingSection = useCallback(() => setPendingSectionId(null), []);

  const openMap = useCallback((id: ID) => {
    setCurrentMapId(id);
    setSelectedNodeId(null);
    setSelectedOccurrenceId(null);
    setActiveView('map');
  }, []);

  const refreshMapContent = useCallback(() => {
    setMapContentVersion((version) => version + 1);
  }, []);

  const value: AppState = {
    nodes,
    maps,
    tags,
    activeView,
    reviewTargetIds,
    reviewFocusTargetId,
    reviewReturnView,
    startReview,
    mapContentVersion,
    currentMapId,
    selectedNodeId,
    libraryTagId,
    setLibraryTagId,
    selectedOccurrenceId,
    leftCollapsed,
    rightCollapsed,
    isLoading,
    setActiveView,
    openNode,
    openNodeSection,
    pendingSectionId,
    consumePendingSection,
    openMap,
    refreshMapContent,
    setCurrentMapId,
    setSelectedNodeId,
    setSelectedOccurrenceId,
    setLeftCollapsed,
    setRightCollapsed,
    refreshNodes,
    refreshMaps,
    refreshTags,
    refreshAll,
    getNode,
    getTag,
  };

  if (typeof window !== 'undefined') {
    (window as any).__nodal_app = value;
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
