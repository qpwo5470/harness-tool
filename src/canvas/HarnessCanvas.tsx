/**
 * Agent A 소유 — 배선 캔버스 (도면형).
 * - 커스텀 핀 노드 렌더 (논리 뷰=하우징 심볼 / 물리 뷰=회전 배치)
 * - 직교(맨해튼) 배선 + 레인 분리
 * - 도면 프레임 + 제목블록
 * - 배선 hover → 상세 카드 + 접속표 동기 강조
 * - 드래그로 핀↔핀 결선(loose 모드) → 스토어에 Wire 생성
 */
import { useEffect, useMemo, useRef } from 'react';
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
import { useHoverStore } from '../store/hoverStore';
import { docToNodes, docToEdges, highlightedWires, refLabels, colorAbbr } from './docToFlow';
import { nodeTypes } from './nodes';
import { edgeTypes } from './OrthogonalEdge';
import { WireCard } from './WireCard';
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
  const selection = useHarnessStore((s) => s.selection);

  const hoverWire = useHoverStore((s) => s.wireId);
  const hoverSource = useHoverStore((s) => s.source);
  const setHover = useHoverStore((s) => s.setHover);
  const setCursor = useHoverStore((s) => s.setCursor);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 강조 대상: hover 가 있으면 hover 우선, 없으면 선택
  const active = hoverWire ?? selection;

  // 강조 중인 배선의 양 끝 핀 — 노드에서 해당 패드를 강조한다
  const hotPinsByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!hoverWire) return m;
    const w = doc.wires.find((x) => x.id === hoverWire);
    if (!w) return m;
    for (const e of [w.from, w.to]) {
      if (e.type === 'pin') {
        m.set(e.connectorId, [...(m.get(e.connectorId) ?? []), e.pinId]);
      }
    }
    return m;
  }, [doc.wires, hoverWire]);

  useEffect(() => {
    setNodes(docToNodes(doc, view, hotPinsByNode));
  }, [doc, view, hotPinsByNode, setNodes]);

  // 선택/hover 된 네트 하이라이트 (스플라이스 너머까지 이어진 경로가 보임)
  useEffect(() => {
    const isWire = doc.wires.some((w) => w.id === active);
    setEdges(docToEdges(doc, highlightedWires(doc, active), isWire ? active : null));
  }, [doc, active, setEdges]);

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
  const onEdgeEnter: EdgeMouseHandler = (_e, ed) => setHover(ed.id, 'canvas');
  const onEdgeLeave: EdgeMouseHandler = () => setHover(null);

  const onNodeDragStop = (_e: unknown, n: Node) => {
    if (doc.connectors.some((c) => c.id === n.id)) {
      const cur = doc.connectors.find((c) => c.id === n.id)!;
      updateConnector(n.id, { positions: { ...cur.positions, [view]: n.position } });
    } else if (doc.devices.some((d) => d.id === n.id)) {
      const cur = doc.devices.find((d) => d.id === n.id)!;
      updateDevice(n.id, { positions: { ...cur.positions, [view]: n.position } });
    }
  };

  // 커서 추적은 강조 중일 때만 상태를 갱신한다(비강조 시 리렌더 방지).
  const onMouseMove = (e: React.MouseEvent) => {
    if (!hoverWire) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setCursor(e.clientX - r.left, e.clientY - r.top);
  };

  const refs = useMemo(() => refLabels(doc), [doc]);
  const hovered = hoverWire ? doc.wires.find((w) => w.id === hoverWire) : undefined;

  return (
    <div className="hz-canvas-wrap" ref={wrapRef} onMouseMove={onMouseMove}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onEdgeMouseEnter={onEdgeEnter}
        onEdgeMouseLeave={onEdgeLeave}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => select(null)}
        connectionMode={ConnectionMode.Loose}
        // 배선을 노드 아래층에 그린다.
        // 기본값이면 검은 선이 커넥터 블록 위를 가로질러 "까만 줄"처럼 보인다.
        elevateNodesOnSelect
        defaultEdgeOptions={{ zIndex: 0 }}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} size={1} color="var(--line-row)" />
        <Controls showInteractive={false} />
        {/* 제목블록이 우하단을 쓰므로 미니맵은 우상단으로 뺀다 */}
        <MiniMap position="top-right" pannable zoomable />
      </ReactFlow>

      {/* 도면 프레임 — 화면 좌표계. 줌·팬과 무관하게 시트 테두리로 남는다. */}
      <div className="hz-frame" aria-hidden>
        <div className="hz-titleblock">
          <div className="hz-tb-row">
            <span className="hz-tb-main">{doc.name || '이름 없는 하네스'}</span>
            <span className="hz-tb-side num">{doc.drawingNo ?? '—'}</span>
          </div>
          <div className="hz-tb-row">
            <span className="hz-tb-sub num">
              SCALE 1:1 · {view === 'logical' ? '논리' : '물리'} · 배선 {doc.wires.length}
            </span>
            <span className="hz-tb-side num">{doc.rev ? `Rev.${doc.rev}` : '—'}</span>
          </div>
        </div>
      </div>

      {/* 배선 상세 카드 — 캔버스에서 hover 할 때만 (표 hover 는 카드 없음) */}
      {hovered && hoverSource === 'canvas' && (
        <WireCard
          wire={hovered}
          doc={doc}
          refs={refs}
          abbr={colorAbbr(hovered.color.base, hovered.color.stripe)}
        />
      )}
    </div>
  );
}

export function HarnessCanvas() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
