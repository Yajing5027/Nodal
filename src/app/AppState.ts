import { createContext } from 'react';
import type { ID, KnowledgeMap, KnowledgeNode, KnowledgeTag } from '../domain/types';

export type AppView = 'home' | 'nodes' | 'maps' | 'tags' | 'data' | 'map' | 'review' | 'cards' | 'batch' | 'plan' | 'plans' | 'sections';

export interface StartReviewOptions {
  focusTargetId?: ID;
  returnView?: AppView;
}

export interface AppState {
  nodes: KnowledgeNode[];
  maps: KnowledgeMap[];
  tags: KnowledgeTag[];
  activeView: AppView;
  reviewTargetIds: ID[] | null;
  reviewFocusTargetId: ID | null;
  reviewReturnView: AppView;
  startReview: (ids?: ID[], options?: StartReviewOptions) => void;
  mapContentVersion: number;
  currentMapId: ID | null;
  selectedNodeId: ID | null;
  libraryTagId: ID | null;
  setLibraryTagId: (id: ID | null) => void;
  selectedOccurrenceId: ID | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  isLoading: boolean;
  setActiveView: (view: AppView) => void;
  openNode: (id: ID) => void;
  /** Open a Node and transiently focus/highlight a Section (UI state only). */
  openNodeSection: (id: ID, sectionId?: ID) => void;
  /** Transient focus request set by openNodeSection; the reader consumes and clears it. */
  pendingSectionId: ID | null;
  consumePendingSection: () => void;
  openMap: (id: ID) => void;
  refreshMapContent: () => void;
  setCurrentMapId: (id: ID | null) => void;
  setSelectedNodeId: (id: ID | null) => void;
  setSelectedOccurrenceId: (id: ID | null) => void;
  setLeftCollapsed: (value: boolean) => void;
  setRightCollapsed: (value: boolean) => void;
  refreshNodes: () => Promise<void>;
  refreshMaps: () => Promise<void>;
  refreshTags: () => Promise<void>;
  refreshAll: () => Promise<void>;
  getNode: (id: ID) => KnowledgeNode | undefined;
  getTag: (id: ID) => KnowledgeTag | undefined;
}

export const AppStateContext = createContext<AppState | null>(null);
