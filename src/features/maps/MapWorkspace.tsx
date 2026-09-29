// ============================================================
// MapWorkspace — center panel: React Flow canvas for a KnowledgeMap
// Displays and edits occurrences (knowledge nodes), frames, relations.
// React Flow is a projection; all writes go through repositories to Dexie.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  KnowledgeNode,
  KnowledgeRelation,
  MapOccurrence,
  KnowledgeFrame,
  FlowNodeData,
  FlowEdgeData,
  RelationDirection,
  RelationScope,
  ID,
} from '../../domain/types';
import { useApp } from '../../app/useApp';
import { InlineNodeCreator } from '../../components/ui';
import {
  getOccurrencesForMap,
  createOccurrence,
  updateOccurrence,
  deleteOccurrence,
  getFramesForMap,
  createFrame,
  updateFrame,
  deleteFrame,
  updateMap,
} from '../../repositories/mapRepository';
import {
  getRelationsForMap,
  createRelation,
  updateRelation,
  deleteRelation,
} from '../../repositories/relationRepository';
import { createNode } from '../../repositories/nodeRepository';
import { KnowledgeNodeCard } from './KnowledgeNodeCard';
import { FrameNode, type FrameNodeData } from './FrameNode';
import { RelationEdge } from './RelationEdge';
import { RelationEditor } from './RelationEditor';
import { AddNodePopover } from './AddNodePopover';
import { splitNotePanels } from '../../domain/notePanels';
import { sectionLabel } from '../../domain/sectionTransclusion';

// ---------- Types (intersect with Record to satisfy @xyflow/react v12 constraint) ----------
type FlowNodeDataExt = FlowNodeData & Record<string, unknown>;
type FrameNodeDataExt = FrameNodeData & Record<string, unknown>;
type FlowEdgeDataExt = FlowEdgeData & Record<string, unknown>;

type FlowNode = Node<FlowNodeDataExt, 'knowledgeNode'> | Node<FrameNodeDataExt, 'frame'>;
type FlowEdge = Edge<FlowEdgeDataExt, 'relation'>;

interface CreatorPos {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
}

interface EditorPos {
  relationId: ID;
  x: number;
  y: number;
}

import { projectMapExcerpt } from '../../domain/contentProjection';

// ---------- Helpers ----------

const nodeTypes = {
  knowledgeNode: KnowledgeNodeCard,
  frame: FrameNode,
};

const edgeTypes = {
  relation: RelationEdge,
};

function computeAutoHandles(src: FlowNode, tgt: FlowNode): { sourceHandle: string; targetHandle: string } {
  const srcW = src.width ?? (src.type === 'frame' ? 300 : 220);
  const srcH = src.height ?? (src.type === 'frame' ? 200 : 80);
  const tgtW = tgt.width ?? (tgt.type === 'frame' ? 300 : 220);
  const tgtH = tgt.height ?? (tgt.type === 'frame' ? 200 : 80);

  const c1x = src.position.x + srcW / 2;
  const c1y = src.position.y + srcH / 2;
  const c2x = tgt.position.x + tgtW / 2;
  const c2y = tgt.position.y + tgtH / 2;

  const dx = c2x - c1x;
  const dy = c2y - c1y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left', targetHandle: 'right' };
  } else {
    return dy >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' };
  }
}

// ---------- Inner component (has access to useReactFlow) ----------
function MapWorkspaceInner() {
  const {
    currentMapId,
    selectedOccurrenceId,
    setSelectedNodeId,
    setSelectedOccurrenceId,
    setRightCollapsed,
    maps,
    refreshAll,
    refreshMapContent,
    getNode,
    getTag,
  } = useApp();

  const { screenToFlowPosition, flowToScreenPosition, setViewport, getNodes } =
    useReactFlow<FlowNode, FlowEdge>();

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);

  const [creatorPos, setCreatorPos] = useState<CreatorPos | null>(null);
  const [addNodePos, setAddNodePos] = useState<{ x: number; y: number } | null>(null);
  const [editorPos, setEditorPos] = useState<EditorPos | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const occurrencesRef = useRef<MapOccurrence[]>([]);
  const framesRef = useRef<KnowledgeFrame[]>([]);
  const relationsRef = useRef<KnowledgeRelation[]>([]);
  const positionTimers = useRef<Map<ID, ReturnType<typeof setTimeout>>>(new Map());
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadToken = useRef(0);

  // ---------- Frame callbacks ----------
  const handleFrameTitleChange = useCallback(
    (frameId: ID, title: string) => {
      updateFrame(frameId, { title }).then(() => refreshMapContent());
      framesRef.current = framesRef.current.map((f) =>
        f.id === frameId ? { ...f, title } : f
      );
      setFlowNodes((nds) =>
        nds.map((n) =>
          n.id === frameId && n.type === 'frame'
            ? { ...n, data: { ...n.data, title } }
            : n
        )
      );
    },
    [setFlowNodes, refreshMapContent]
  );

  const handleFrameDelete = useCallback(
    (frameId: ID) => {
      deleteFrame(frameId).then(() => refreshMapContent()); // unassigns occurrences internally
      framesRef.current = framesRef.current.filter((f) => f.id !== frameId);
      occurrencesRef.current = occurrencesRef.current.map((o) =>
        o.frameId === frameId ? { ...o, frameId: null } : o
      );
      setFlowNodes((nds) =>
        nds
          .filter((n) => n.id !== frameId)
          .map((n) =>
            n.type === 'knowledgeNode' && n.data.frameId === frameId
              ? { ...n, data: { ...n.data, frameId: null } }
              : n
          )
      );
    },
    [setFlowNodes, refreshMapContent]
  );

  const handleFrameResize = useCallback((frameId: ID, width: number, height: number) => {
    updateFrame(frameId, { width, height });
    framesRef.current = framesRef.current.map((f) =>
      f.id === frameId ? { ...f, width, height } : f
    );
  }, []);

  // ---------- Data loading ----------
  const loadMapData = useCallback(
    async (mapId: ID) => {
      const token = ++loadToken.current;
      const [occurrences, frames, relations] = await Promise.all([
        getOccurrencesForMap(mapId),
        getFramesForMap(mapId),
        getRelationsForMap(mapId),
      ]);
      if (token !== loadToken.current) return; // stale

      occurrencesRef.current = occurrences;
      framesRef.current = frames;
      relationsRef.current = relations;

      // nodeId → first occurrenceId (for edge mapping)
      const nodeIdToOccId = new Map<ID, ID>();
      for (const occ of occurrences) {
        if (!nodeIdToOccId.has(occ.nodeId)) {
          nodeIdToOccId.set(occ.nodeId, occ.id);
        }
      }

      // Frame nodes first (rendered behind knowledge nodes)
      const frameNodes: FlowNode[] = frames.map((f) => ({
        id: f.id,
        type: 'frame',
        position: { x: f.x, y: f.y },
        data: {
          frameId: f.id,
          title: f.title,
          onTitleChange: handleFrameTitleChange,
          onDelete: handleFrameDelete,
          onResizeEnd: handleFrameResize,
        },
        style: { width: f.width, height: f.height },
      })) as FlowNode[];

      // Knowledge node occurrences
      const occNodes: FlowNode[] = occurrences.map((occ) => {
        const node = getNode(occ.nodeId);
        const tags =
          node?.tagIds
            .map((tid) => getTag(tid)?.name)
            .filter((t): t is string => Boolean(t)) ?? [];
        const panels = node ? splitNotePanels(node.contentMarkdown) : [];
        const sectionPanel = occ.sectionId ? panels.find((p) => p.id === occ.sectionId) : null;
        const isBrokenSection = Boolean(occ.sectionId && !sectionPanel);
        let sectionTitle: string | null = null;
        let summary = '';
        if (occ.sectionId) {
          if (sectionPanel) {
            const idx = panels.indexOf(sectionPanel);
            sectionTitle = sectionLabel(sectionPanel.markdown, idx);
            summary = sectionPanel.markdown.replace(/^#+\s+[^\n]+\n*/, '').slice(0, 80);
          } else {
            sectionTitle = 'Deleted section';
            summary = 'Section was removed from source note';
          }
        } else {
          summary = node ? projectMapExcerpt(node, getNode) : '';
        }
        return {
          id: occ.id,
          type: 'knowledgeNode',
          position: { x: occ.x, y: occ.y },
          data: {
            occurrenceId: occ.id,
            nodeId: occ.nodeId,
            sectionId: occ.sectionId ?? null,
            sectionTitle,
            isBrokenSection,
            title: node?.title ?? 'Untitled',
            tags,
            summary,
            frameId: occ.frameId,
          },
          width: occ.width,
          height: occ.height,
        };
      }) as FlowNode[];

      setFlowNodes([...frameNodes, ...occNodes]);

      // Edges from relations (supporting node occurrences and frames)
      const frameIds = new Set(frames.map((f) => f.id));
      const getEndpointFlowId = (id: ID, type?: 'node' | 'frame') => {
        if (type === 'frame' || frameIds.has(id)) return id;
        return nodeIdToOccId.get(id);
      };

      const allNodesList = [...frameNodes, ...occNodes];
      const relEdges: FlowEdge[] = relations
        .map((r) => {
          const srcId = getEndpointFlowId(r.sourceNodeId, r.sourceType);
          const tgtId = getEndpointFlowId(r.targetNodeId, r.targetType);
          if (!srcId || !tgtId) return null;

          const srcNode = allNodesList.find((n) => n.id === srcId);
          const tgtNode = allNodesList.find((n) => n.id === tgtId);

          let sHandle = r.sourceHandle;
          let tHandle = r.targetHandle;
          if ((!sHandle || !tHandle) && srcNode && tgtNode) {
            const auto = computeAutoHandles(srcNode, tgtNode);
            if (!sHandle) sHandle = auto.sourceHandle;
            if (!tHandle) tHandle = auto.targetHandle;
          }

          return {
            id: r.id,
            type: 'relation',
            source: srcId,
            target: tgtId,
            sourceHandle: sHandle,
            targetHandle: tHandle,
            data: {
              relationId: r.id,
              label: r.label,
              direction: r.direction,
              scope: r.scope,
              sourceHandle: r.sourceHandle ?? null,
              targetHandle: r.targetHandle ?? null,
            },
          } as FlowEdge;
        })
        .filter((e): e is FlowEdge => Boolean(e));
      setFlowEdges(relEdges);

      // Restore viewport
      const map = maps.find((m) => m.id === mapId);
      if (map) {
        setViewport({ x: map.viewportX, y: map.viewportY, zoom: map.viewportZoom });
      }
    },
    [getNode, getTag, maps, setFlowNodes, setFlowEdges, setViewport, handleFrameTitleChange, handleFrameDelete, handleFrameResize]
  );

  useEffect(() => {
    if (!currentMapId) {
      setFlowNodes([]);
      setFlowEdges([]);
      occurrencesRef.current = [];
      framesRef.current = [];
      relationsRef.current = [];
      return;
    }
    loadMapData(currentMapId);
  }, [currentMapId, loadMapData, setFlowNodes, setFlowEdges]);

  // ---------- Double-click empty canvas → create node ----------
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Ignore double-clicks on nodes or edges
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node') || target.closest('.react-flow__edge')) {
        return;
      }
      if (!currentMapId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const flowPos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setCreatorPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        flowX: flowPos.x,
        flowY: flowPos.y,
      });
    },
    [currentMapId, screenToFlowPosition]
  );

  const handleCreateNode = useCallback(
    async (title: string) => {
      if (!currentMapId || !creatorPos) return;
      const pos = creatorPos;
      setCreatorPos(null);
      const node = await createNode({ title });
      const occ = await createOccurrence({
        mapId: currentMapId,
        nodeId: node.id,
        x: pos.flowX,
        y: pos.flowY,
      });
      await refreshAll();
      await loadMapData(currentMapId);
      refreshMapContent();
      setSelectedOccurrenceId(occ.id);
      setSelectedNodeId(node.id);
    },
    [
      currentMapId,
      creatorPos,
      refreshAll,
      loadMapData,
      setSelectedOccurrenceId,
      setSelectedNodeId,
      refreshMapContent,
    ]
  );

  // ---------- Add existing node ----------
  const handleAddExistingNode = useCallback(
    async (node: KnowledgeNode, sectionId?: string | null) => {
      if (!currentMapId) return;
      setAddNodePos(null);
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = rect ? rect.width / 2 : 400;
      const centerY = rect ? rect.height / 2 : 300;
      const flowPos = screenToFlowPosition({
        x: (rect?.left ?? 0) + centerX,
        y: (rect?.top ?? 0) + centerY,
      });
      await createOccurrence({
        mapId: currentMapId,
        nodeId: node.id,
        sectionId: sectionId ?? null,
        x: flowPos.x + (Math.random() - 0.5) * 40,
        y: flowPos.y + (Math.random() - 0.5) * 40,
      });
      await refreshAll();
      await loadMapData(currentMapId);
      refreshMapContent();
    },
    [currentMapId, screenToFlowPosition, refreshAll, loadMapData, refreshMapContent]
  );

  // ---------- Create frame ----------
  const handleCreateFrame = useCallback(async () => {
    if (!currentMapId) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.width / 2 : 400;
    const centerY = rect ? rect.height / 2 : 300;
    const flowPos = screenToFlowPosition({
      x: (rect?.left ?? 0) + centerX,
      y: (rect?.top ?? 0) + centerY,
    });
    const frame = await createFrame({
      mapId: currentMapId,
      title: 'New Frame',
      x: flowPos.x - 150,
      y: flowPos.y - 100,
      width: 300,
      height: 200,
    });
    framesRef.current = [...framesRef.current, frame];
    setFlowNodes((nds) => [
      ...nds,
      {
        id: frame.id,
        type: 'frame',
        position: { x: frame.x, y: frame.y },
        data: {
          frameId: frame.id,
          title: frame.title,
          onTitleChange: handleFrameTitleChange,
          onDelete: handleFrameDelete,
          onResizeEnd: handleFrameResize,
        },
        style: { width: frame.width, height: frame.height },
      } as FlowNode,
    ]);
    refreshMapContent();
  }, [currentMapId, screenToFlowPosition, setFlowNodes, handleFrameTitleChange, handleFrameDelete, handleFrameResize, refreshMapContent]);

  // ---------- Connect → create relation ----------
  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!currentMapId || !connection.source || !connection.target) return;
      const sourceOcc = occurrencesRef.current.find((o) => o.id === connection.source);
      const targetOcc = occurrencesRef.current.find((o) => o.id === connection.target);
      const sourceFrame = framesRef.current.find((f) => f.id === connection.source);
      const targetFrame = framesRef.current.find((f) => f.id === connection.target);

      const sourceId = sourceOcc?.nodeId ?? sourceFrame?.id;
      const sourceType = sourceFrame ? 'frame' : 'node';
      const targetId = targetOcc?.nodeId ?? targetFrame?.id;
      const targetType = targetFrame ? 'frame' : 'node';

      if (!sourceId || !targetId) return;

      const srcNode = getNodes().find((n) => n.id === connection.source);
      const tgtNode = getNodes().find((n) => n.id === connection.target);

      let sHandle = connection.sourceHandle;
      let tHandle = connection.targetHandle;
      if ((!sHandle || !tHandle) && srcNode && tgtNode) {
        const auto = computeAutoHandles(srcNode, tgtNode);
        if (!sHandle) sHandle = auto.sourceHandle;
        if (!tHandle) tHandle = auto.targetHandle;
      }

      const relation = await createRelation({
        sourceNodeId: sourceId,
        sourceType,
        targetNodeId: targetId,
        targetType,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        label: '',
        direction: 'none',
        scope: 'map',
        mapId: currentMapId,
      });
      relationsRef.current = [...relationsRef.current, relation];

      const newEdge: FlowEdge = {
        id: relation.id,
        type: 'relation',
        source: connection.source,
        target: connection.target,
        sourceHandle: sHandle,
        targetHandle: tHandle,
        data: {
          relationId: relation.id,
          label: relation.label,
          direction: relation.direction,
          scope: relation.scope,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        },
        selected: true,
      };
      setFlowEdges((eds) => [...eds.map((e) => ({ ...e, selected: false })), newEdge]);

      // Position editor at midpoint
      if (srcNode && tgtNode && containerRef.current) {
        const midX = (srcNode.position.x + tgtNode.position.x) / 2;
        const midY = (srcNode.position.y + tgtNode.position.y) / 2;
        const screenPos = flowToScreenPosition({ x: midX, y: midY });
        const rect = containerRef.current.getBoundingClientRect();
        setEditorPos({
          relationId: relation.id,
          x: screenPos.x - rect.left,
          y: screenPos.y - rect.top,
        });
      }
    },
    [currentMapId, setFlowEdges, getNodes, flowToScreenPosition]
  );

  // ---------- Selection ----------
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      if (isConnecting) {
        if (!connectSourceId) {
          setConnectSourceId(node.id);
        } else {
          if (connectSourceId !== node.id) {
            void onConnect({
              source: connectSourceId,
              target: node.id,
              sourceHandle: null,
              targetHandle: null,
            });
          }
          setIsConnecting(false);
          setConnectSourceId(null);
        }
        return;
      }
      setEditorPos(null);
      if (node.type === 'knowledgeNode') {
        setSelectedOccurrenceId(node.id);
        setSelectedNodeId(node.data.nodeId);
        setRightCollapsed(false);
      } else {
        setSelectedOccurrenceId(null);
        setSelectedNodeId(null);
      }
    },
    [isConnecting, connectSourceId, onConnect, setSelectedOccurrenceId, setSelectedNodeId, setRightCollapsed]
  );

  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: FlowEdge) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setEditorPos({
        relationId: edge.id,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      setSelectedOccurrenceId(null);
      setSelectedNodeId(null);
    },
    [setSelectedOccurrenceId, setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => {
    setCreatorPos(null);
    setAddNodePos(null);
    setEditorPos(null);
    setSelectedOccurrenceId(null);
    setSelectedNodeId(null);
  }, [setSelectedOccurrenceId, setSelectedNodeId]);

  // ---------- Relation editing ----------
  const handleRelationChange = useCallback(
    (changes: {
      label?: string;
      direction?: RelationDirection;
      scope?: RelationScope;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }) => {
      if (!editorPos) return;
      const { relationId } = editorPos;
      updateRelation(relationId, changes);
      relationsRef.current = relationsRef.current.map((r) =>
        r.id === relationId ? { ...r, ...changes } : r
      );
      setFlowEdges((eds) =>
        eds.map((e) => {
          if (e.id !== relationId || !e.data) return e;
          const srcNode = getNodes().find((n) => n.id === e.source);
          const tgtNode = getNodes().find((n) => n.id === e.target);
          let newSourceHandle = changes.sourceHandle !== undefined ? changes.sourceHandle : e.sourceHandle;
          let newTargetHandle = changes.targetHandle !== undefined ? changes.targetHandle : e.targetHandle;
          if ((!newSourceHandle || !newTargetHandle) && srcNode && tgtNode) {
            const auto = computeAutoHandles(srcNode, tgtNode);
            if (!newSourceHandle) newSourceHandle = auto.sourceHandle;
            if (!newTargetHandle) newTargetHandle = auto.targetHandle;
          }
          return {
            ...e,
            sourceHandle: newSourceHandle,
            targetHandle: newTargetHandle,
            data: {
              ...e.data,
              label: changes.label ?? e.data.label,
              direction: changes.direction ?? e.data.direction,
              scope: changes.scope ?? e.data.scope,
              sourceHandle: changes.sourceHandle !== undefined ? changes.sourceHandle : e.data.sourceHandle,
              targetHandle: changes.targetHandle !== undefined ? changes.targetHandle : e.data.targetHandle,
            },
          } as FlowEdge;
        })
      );
    },
    [editorPos, setFlowEdges, getNodes]
  );

  const handleReverseRelation = useCallback(async () => {
    if (!editorPos) return;
    const { relationId } = editorPos;
    const rel = relationsRef.current.find((r) => r.id === relationId);
    if (!rel) return;

    const newSourceId = rel.targetNodeId;
    const newTargetId = rel.sourceNodeId;
    const newSourceType = rel.targetType ?? 'node';
    const newTargetType = rel.sourceType ?? 'node';
    const newSourceHandle = rel.targetHandle ?? null;
    const newTargetHandle = rel.sourceHandle ?? null;

    await updateRelation(relationId, {
      sourceNodeId: newSourceId,
      targetNodeId: newTargetId,
      sourceType: newSourceType,
      targetType: newTargetType,
      sourceHandle: newSourceHandle,
      targetHandle: newTargetHandle,
    });

    relationsRef.current = relationsRef.current.map((r) =>
      r.id === relationId
        ? {
            ...r,
            sourceNodeId: newSourceId,
            targetNodeId: newTargetId,
            sourceType: newSourceType,
            targetType: newTargetType,
            sourceHandle: newSourceHandle,
            targetHandle: newTargetHandle,
          }
        : r
    );

    setFlowEdges((eds) =>
      eds.map((e) => {
        if (e.id !== relationId || !e.data) return e;
        const newSrc = e.target;
        const newTgt = e.source;
        const srcNode = getNodes().find((n) => n.id === newSrc);
        const tgtNode = getNodes().find((n) => n.id === newTgt);
        let sHandle = newSourceHandle;
        let tHandle = newTargetHandle;
        if ((!sHandle || !tHandle) && srcNode && tgtNode) {
          const auto = computeAutoHandles(srcNode, tgtNode);
          if (!sHandle) sHandle = auto.sourceHandle;
          if (!tHandle) tHandle = auto.targetHandle;
        }
        return {
          ...e,
          source: newSrc,
          target: newTgt,
          sourceHandle: sHandle,
          targetHandle: tHandle,
          data: {
            relationId: e.data.relationId,
            label: e.data.label,
            direction: e.data.direction,
            scope: e.data.scope,
            sourceHandle: newSourceHandle,
            targetHandle: newTargetHandle,
          },
        } as FlowEdge;
      })
    );
  }, [editorPos, setFlowEdges, getNodes]);

  const handleRelationDelete = useCallback(() => {
    if (!editorPos) return;
    const { relationId } = editorPos;
    deleteRelation(relationId);
    relationsRef.current = relationsRef.current.filter((r) => r.id !== relationId);
    setFlowEdges((eds) => eds.filter((e) => e.id !== relationId));
    setEditorPos(null);
  }, [editorPos, setFlowEdges]);

  // ---------- Node drag end → persist position + frame assignment ----------
  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: FlowNode) => {
      const occId = node.id;
      const existing = positionTimers.current.get(occId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        if (node.type === 'knowledgeNode') {
          const newX = node.position.x;
          const newY = node.position.y;
          const nodeW = node.width ?? 200;
          const nodeH = node.height ?? 80;
          const centerX = newX + nodeW / 2;
          const centerY = newY + nodeH / 2;

          let newFrameId: ID | null = null;
          for (const frame of framesRef.current) {
            if (
              centerX >= frame.x &&
              centerX <= frame.x + frame.width &&
              centerY >= frame.y &&
              centerY <= frame.y + frame.height
            ) {
              newFrameId = frame.id;
              break;
            }
          }

          const occ = occurrencesRef.current.find((o) => o.id === occId);
          const changes: Partial<MapOccurrence> = { x: newX, y: newY };
          if (occ && occ.frameId !== newFrameId) {
            changes.frameId = newFrameId;
          }
          updateOccurrence(occId, changes);
          occurrencesRef.current = occurrencesRef.current.map((o) =>
            o.id === occId ? { ...o, ...changes } : o
          );
          if (changes.frameId !== undefined) {
            setFlowNodes((nds) =>
              nds.map((n) =>
                n.id === occId && n.type === 'knowledgeNode'
                  ? { ...n, data: { ...n.data, frameId: changes.frameId! } }
                  : n
              )
            );
          }
        } else if (node.type === 'frame') {
          updateFrame(node.id, { x: node.position.x, y: node.position.y });
          framesRef.current = framesRef.current.map((f) =>
            f.id === node.id ? { ...f, x: node.position.x, y: node.position.y } : f
          );
        }

        // Dynamically update auto handles for edges connected to this moved node
        setFlowEdges((eds) =>
          eds.map((e) => {
            if (e.source !== occId && e.target !== occId) return e;
            const rel = relationsRef.current.find((r) => r.id === e.id);
            if (rel && (rel.sourceHandle || rel.targetHandle)) return e;
            const src = getNodes().find((n) => n.id === e.source);
            const tgt = getNodes().find((n) => n.id === e.target);
            if (!src || !tgt) return e;
            const auto = computeAutoHandles(src, tgt);
            return {
              ...e,
              sourceHandle: auto.sourceHandle,
              targetHandle: auto.targetHandle,
            };
          })
        );

        positionTimers.current.delete(occId);
      }, 500);

      positionTimers.current.set(occId, timer);
    },
    [setFlowNodes, setFlowEdges, getNodes]
  );

  // ---------- Viewport persistence ----------
  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (!currentMapId) return;
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
      viewportTimer.current = setTimeout(() => {
        updateMap(currentMapId, {
          viewportX: viewport.x,
          viewportY: viewport.y,
          viewportZoom: viewport.zoom,
        });
      }, 1000);
    },
    [currentMapId]
  );

  // ---------- Keyboard: Delete/Backspace ----------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      // Priority: relation editor open → delete relation
      if (editorPos) {
        e.preventDefault();
        handleRelationDelete();
        return;
      }

      // Check selected edge
      const selectedEdge = flowEdges.find((ed) => ed.selected);
      if (selectedEdge) {
        e.preventDefault();
        deleteRelation(selectedEdge.id);
        relationsRef.current = relationsRef.current.filter((r) => r.id !== selectedEdge.id);
        setFlowEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
        return;
      }

      // Check selected occurrence
      const selectedOccNode = flowNodes.find(
        (n) => n.type === 'knowledgeNode' && n.selected
      );
      if (selectedOccNode && selectedOccNode.type === 'knowledgeNode') {
        e.preventDefault();
        const occId = selectedOccNode.id;
        deleteOccurrence(occId).then(() => refreshMapContent());
        occurrencesRef.current = occurrencesRef.current.filter((o) => o.id !== occId);
        setFlowNodes((nds) => nds.filter((n) => n.id !== occId));
        setSelectedOccurrenceId(null);
        setSelectedNodeId(null);
        return;
      }

      // Check selected frame
      const selectedFrameNode = flowNodes.find((n) => n.type === 'frame' && n.selected);
      if (selectedFrameNode) {
        e.preventDefault();
        handleFrameDelete(selectedFrameNode.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    editorPos,
    flowEdges,
    flowNodes,
    handleRelationDelete,
    handleFrameDelete,
    setFlowEdges,
    setFlowNodes,
    setSelectedOccurrenceId,
    setSelectedNodeId,
    refreshMapContent,
  ]);

  // ---------- Sync external selection (selectedOccurrenceId from navigator) ----------
  useEffect(() => {
    if (!selectedOccurrenceId) return;
    setFlowNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === selectedOccurrenceId,
      }))
    );
    setFlowEdges((eds) => eds.map((e) => ({ ...e, selected: false })));
  }, [selectedOccurrenceId, setFlowNodes, setFlowEdges]);

  // ---------- Render ----------
  if (!currentMapId) {
    return (
      <div
        className="h-full w-full flex items-center justify-center"
        style={{ background: 'var(--surface)' }}
      >
        <span className="text-muted" style={{ fontSize: 'var(--font-md)' }}>
          Select or create a map
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} onDoubleClick={onPaneDoubleClick} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Global SVG marker definitions for relation arrowheads */}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        <defs>
          <marker
            id="rel-arrow-normal"
            markerWidth="12"
            markerHeight="12"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L12,6 L0,12 Z" fill="var(--border-strong)" />
          </marker>
          <marker
            id="rel-arrow-selected"
            markerWidth="12"
            markerHeight="12"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            orient="auto-start-reverse"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L12,6 L0,12 Z" fill="var(--text-muted)" />
          </marker>
        </defs>
      </svg>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={flowNodes}
        edges={flowEdges}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
        minZoom={0.2}
        maxZoom={2}
        zoomOnDoubleClick={false}
      >
        <Background gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
          nodeColor={(n) =>
            n.type === 'frame' ? 'var(--surface-tertiary)' : 'var(--border-strong)'
          }
          maskColor="color-mix(in srgb, var(--surface-secondary) 75%, transparent)"
        />
      </ReactFlow>

      {/* Floating toolbar */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--space-3)',
          left: 'var(--space-3)',
          zIndex: 10,
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => setAddNodePos({ x: 12, y: 48 })}
          style={{ fontSize: 'var(--font-sm)' }}
        >
          + Add Node
        </button>
        <button onClick={handleCreateFrame} style={{ fontSize: 'var(--font-sm)' }}>
          + Frame
        </button>
        <button
          className={isConnecting ? 'primary' : 'ghost'}
          onClick={() => {
            setIsConnecting(v => !v);
            setConnectSourceId(null);
          }}
          style={{ fontSize: 'var(--font-sm)' }}
          title={isConnecting ? 'Click source then target node/frame to connect' : 'Connect tool: click two nodes or frames to create a relation'}
        >
          {isConnecting ? (connectSourceId ? 'Select target…' : 'Select source…') : 'Connect'}
        </button>
        {isConnecting && (
          <span style={{ fontSize: '12px', color: 'var(--accent)', background: 'var(--surface)', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
            {connectSourceId ? 'Now click target' : 'Click first node/frame'}
            <button
              onClick={() => { setIsConnecting(false); setConnectSourceId(null); }}
              style={{ background: 'none', border: 'none', marginLeft: '6px', cursor: 'pointer', color: 'var(--text-muted)' }}
              title="Cancel connect"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {/* Empty state */}
      {flowNodes.length === 0 && !creatorPos && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-sm)',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <div style={{ fontSize: 'var(--font-md)', fontWeight: 500 }}>
            Double-click anywhere to create a node
          </div>
          <div style={{ fontSize: 'var(--font-xs)' }}>or add existing knowledge</div>
        </div>
      )}

      {/* Inline node creator */}
      {creatorPos && (
        <InlineNodeCreator
          x={creatorPos.x}
          y={creatorPos.y}
          onSubmit={handleCreateNode}
          onCancel={() => setCreatorPos(null)}
        />
      )}

      {/* Add node popover */}
      {addNodePos && currentMapId && (
        <AddNodePopover
          mapId={currentMapId}
          x={addNodePos.x}
          y={addNodePos.y}
          onAdd={handleAddExistingNode}
          onClose={() => setAddNodePos(null)}
        />
      )}

      {/* Relation editor */}
      {editorPos &&
        (() => {
          const edge = flowEdges.find((e) => e.id === editorPos.relationId);
          if (!edge || !edge.data) return null;
          return (
            <RelationEditor
              label={edge.data.label}
              direction={edge.data.direction}
              scope={edge.data.scope}
              sourceHandle={edge.data.sourceHandle}
              targetHandle={edge.data.targetHandle}
              x={editorPos.x}
              y={editorPos.y}
              onChange={handleRelationChange}
              onReverse={handleReverseRelation}
              onDelete={handleRelationDelete}
              onClose={() => setEditorPos(null)}
            />
          );
        })()}
    </div>
  );
}

// ---------- Default export (wrapped in provider) ----------
export function MapWorkspace() {
  return (
    <ReactFlowProvider>
      <MapWorkspaceInner />
    </ReactFlowProvider>
  );
}
