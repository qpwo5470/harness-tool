/**
 * Agent A 소유 — 배선 캔버스 (Wave 1).
 * - 커스텀 핀 노드 렌더 (논리/물리 뷰)
 * - 드래그로 핀↔핀 결선(loose 모드) → 스토어에 Wire 생성
 * - 노드 드래그 위치를 뷰별로 스토어에 저장
 * - 노드/엣지 선택을 스토어에 반영
 */
import { useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useHarnessStore } from '../store/harnessStore';
import { docToNodes, docToEdges, highlightedWires } from './docToFlow';
import { nodeTypes } from './nodes';
import type { Endpoint, Wire } from '../types';
import { suggestedColor } from '../library/seed';

let wireSeq = 0;
const nextWireId = () => `w-${Date.now().toString(36)}-${wireSeq++}`;

function toEndpoint(store: ReturnType<typeof useHarnessStore.getState>, nodeId: string, handle: string | null): Endpoint | null {
  const doc = store.doc;
  if (doc.connectors.some((c) => c.id === nodeId)) {
    if (!handle) return null;
    return { type: 'pin', connectorId: nodeId, pinId: handle };
  }
  if (doc.devices.some((d) => d.id === nodeId)) {
    return { type: 'device', deviceId: nodeId, terminal: handle && handle !== '__node' ? handle : undefined };
  }
  return null;
}

function Flow() {
  const doc = useHarnessStore((s) => s.doc);
  const view = useHarnessStore((s) => s.activeView);
  const select = useHarnessStore((s) => s.select);
  const updateConnector = useHarnessStore((s) => s.updateConnector);
  const updateDevice = useHarnessStore((s) => s.updateDevice);
  const addWire = useHarnessStore((s) => s.addWire);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // 문서/뷰 변경 시 재빌드 (구조·데이터의 단일 진실원천 = 스토어)
  const selection = useHarnessStore((s) => s.selection);

  useEffect(() => {
    setNodes(docToNodes(doc, view));
  }, [doc, view, setNodes]);

  // 선택된 네트 하이라이트 (스플라이스 너머까지 이어진 경로가 보임)
  useEffect(() => {
    // 네트 전체는 강조하되, 라벨은 실제로 클릭한 와이어 하나에만 띄운다
    const isWire = doc.wires.some((w) => w.id === selection);
    setEdges(docToEdges(doc, highlightedWires(doc, selection), isWire ? selection : null));
  }, [doc, selection, setEdges]);

  const onConnect = (c: Connection) => {
    const s = useHarnessStore.getState();
    const from = toEndpoint(s, c.source!, c.sourceHandle ?? null);
    const to = toEndpoint(s, c.target!, c.targetHandle ?? null);
    if (!from || !to) return;
    // 규격 커넥터(RJ45/USB/MDB 등)면 표준 색상을 기본값으로 제안
    let base = 'black';
    let stripe: string | undefined;
    if (from.type === 'pin') {
      const c = s.doc.connectors.find((x) => x.id === from.connectorId);
      const pin = c?.pins.find((p) => p.id === from.pinId);
      const housing = s.doc.usedParts.find((p) => p.id === c?.housingId);
      const std = suggestedColor(housing, pin?.index ?? 0);
      if (std) {
        const [b, st] = std.split('/');
        base = b;
        stripe = st;
      }
    }
    const wire: Wire = {
      id: nextWireId(),
      from,
      to,
      color: { base, stripe },
      gauge: { system: 'awg', value: 22 },
    };
    addWire(wire);
  };

  const onNodeClick: NodeMouseHandler = (_e, n) => select(n.id);
  const onEdgeClick: EdgeMouseHandler = (_e, ed) => select(ed.id);

  const onNodeDragStop = (_e: unknown, n: Node) => {
    if (doc.connectors.some((c) => c.id === n.id)) {
      const cur = doc.connectors.find((c) => c.id === n.id)!;
      updateConnector(n.id, { positions: { ...cur.positions, [view]: n.position } });
    } else if (doc.devices.some((d) => d.id === n.id)) {
      const cur = doc.devices.find((d) => d.id === n.id)!;
      updateDevice(n.id, { positions: { ...cur.positions, [view]: n.position } });
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => select(null)}
      connectionMode={ConnectionMode.Loose}
      // 배선을 노드 아래층에 그린다.
      // 기본값이면 검은 선이 커넥터 블록 위를 가로질러 "까만 줄"처럼 보인다.
      elevateNodesOnSelect
      defaultEdgeOptions={{ zIndex: 0 }}
      fitView
    >
      <Background gap={16} />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

export function HarnessCanvas() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </div>
  );
}
