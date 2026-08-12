/**
 * Agent A 소유 — 배선 캔버스 (도면형).
 * - 커스텀 핀 노드 렌더 (논리 뷰=하우징 심볼 / 물리 뷰=회전 배치)
 * - 직교(맨해튼) 배선 + 레인 분리
 * - 도면 프레임 + 제목블록
 * - 배선 hover → 상세 카드 + 접속표 동기 강조
 * - 드래그로 핀↔핀 결선(loose 모드) → 스토어에 Wire 생성
 * - 선택 모델(§11): 호버(임시) / 클릭 고정 / Shift·박스 드래그 다중 / ESC 한 단계
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { useSelectionStore } from '../store/selectionStore';
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
  const updateConnector = useHarnessStore((s) => s.updateConnector);
  const updateDevice = useHarnessStore((s) => s.updateDevice);
  const addWire = useHarnessStore((s) => s.addWire);
  const selection = useHarnessStore((s) => s.selection);

  const hoverWire = useHoverStore((s) => s.wireId);
  const hoverSource = useHoverStore((s) => s.source);
  const setHover = useHoverStore((s) => s.setHover);
  const setCursor = useHoverStore((s) => s.setCursor);

  // §11 선택 모델 — 다중은 selectionStore, 단일은 기존 harnessStore.selection
  const ids = useSelectionStore((s) => s.ids);
  const clickSelect = useSelectionStore((s) => s.click);
  const setIds = useSelectionStore((s) => s.setIds);
  const escape = useSelectionStore((s) => s.escape);
  const multi = ids.length > 1;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 강조 대상: hover 가 있으면 hover 우선, 없으면 선택.
  // 다중일 때는 "선택된 것만" 진하게 하므로 네트 확장(active)을 쓰지 않는다.
  const active = multi ? null : (hoverWire ?? selection);

  /**
   * 양 끝 패드를 강조할 배선들.
   * 호버는 임시, 선택은 고정 — 둘 다 패드를 물들인다.
   * (§11: "클릭 → 강조 유지 + 양 끝 패드 테두리")
   */
  const hotPinsByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    const targets = new Set<string>();
    if (hoverWire) targets.add(hoverWire);
    if (multi) for (const id of ids) targets.add(id);
    else if (selection) targets.add(selection);

    for (const id of targets) {
      const w = doc.wires.find((x) => x.id === id);
      if (!w) continue;
      for (const e of [w.from, w.to]) {
        if (e.type === 'pin') {
          m.set(e.connectorId, [...(m.get(e.connectorId) ?? []), e.pinId]);
        }
      }
    }
    return m;
  }, [doc.wires, hoverWire, selection, ids, multi]);

  useEffect(() => {
    setNodes(docToNodes(doc, view, hotPinsByNode));
  }, [doc, view, hotPinsByNode, setNodes]);

  // 선택/hover 된 네트 하이라이트 (스플라이스 너머까지 이어진 경로가 보임)
  useEffect(() => {
    const highlight = multi ? new Set(ids) : highlightedWires(doc, active);
    const isWire = !multi && doc.wires.some((w) => w.id === active);
    const fixed = new Set(multi ? ids : selection ? [selection] : []);
    // 고정 선택은 엣지에 selected 를 실어 보낸다 — 호버(임시)와 눈으로 구분되게.
    setEdges(
      docToEdges(doc, highlight, isWire ? active : null, view).map((e) =>
        fixed.has(e.id) ? { ...e, selected: true } : e,
      ),
    );
  }, [doc, active, view, setEdges, multi, ids, selection]);

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

  // 노드는 단일 선택만 다룬다 — 다중 선택 속성 탭은 배선 공통 속성용이다.
  const onNodeClick: NodeMouseHandler = (_e, n) => setIds([n.id]);
  const onEdgeClick: EdgeMouseHandler = (e, ed) => clickSelect(ed.id, e.shiftKey || e.metaKey);
  const onEdgeEnter: EdgeMouseHandler = (_e, ed) => setHover(ed.id, 'canvas');
  const onEdgeLeave: EdgeMouseHandler = () => setHover(null);

  /**
   * 박스 드래그(selectionOnDrag) 결과.
   * 클릭 한 번으로도 이 콜백이 도는데, 그때는 기존 단일 선택 경로가 이미 처리한 뒤라
   * 2개 이상일 때만 받아 다중으로 승격시킨다.
   */
  const onSelectionChange = useCallback(
    ({ edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const wireIds = selEdges.map((e) => e.id);
      if (wireIds.length > 1) setIds(wireIds);
    },
    [setIds],
  );

  const onNodeDragStop = (_e: unknown, n: Node) => {
    if (doc.connectors.some((c) => c.id === n.id)) {
      const cur = doc.connectors.find((c) => c.id === n.id)!;
      updateConnector(n.id, { positions: { ...cur.positions, [view]: n.position } });
    } else if (doc.devices.some((d) => d.id === n.id)) {
      const cur = doc.devices.find((d) => d.id === n.id)!;
      updateDevice(n.id, { positions: { ...cur.positions, [view]: n.position } });
    }
  };

  /**
   * ESC 는 항상 한 단계만 푼다: 다중 → 단일 → 없음.
   * 캔버스가 아니라 window 에 건다 — 속성 탭에서 값을 고치다 ESC 를 눌러도
   * 같은 규칙이 적용돼야 한다. 모달·메뉴가 떠 있으면 그쪽이 먼저다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (escape() !== 'none') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escape]);

  // 커서 추적은 강조 중일 때만 상태를 갱신한다(비강조 시 리렌더 방지).
  const onMouseMove = (e: React.MouseEvent) => {
    if (!hoverWire) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setCursor(e.clientX - r.left, e.clientY - r.top);
  };

  const refs = useMemo(() => refLabels(doc), [doc]);
  const hovered = hoverWire ? doc.wires.find((w) => w.id === hoverWire) : undefined;
  /**
   * 선택이 고정되면 상세 카드는 뜨지 않는다(§11).
   * 값은 우측 속성 탭에 이미 펼쳐져 있고, 카드가 도면 위를 따라다니면 가린다.
   */
  const pinned = multi || selection != null;

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
        onSelectionChange={onSelectionChange}
        onPaneClick={() => setIds([])}
        connectionMode={ConnectionMode.Loose}
        // 빈 곳을 끌면 점선 박스로 다중 선택. 화면 이동은 가운데·오른쪽 버튼으로 넘긴다.
        // (React Flow 는 이 둘을 짝으로 써야 좌클릭 드래그가 박스가 된다)
        selectionOnDrag
        panOnDrag={[1, 2]}
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

      {/* 다중 선택 중임을 도면 위에서도 알린다 — 우측 탭을 보지 않아도 몇 본인지 읽힌다 */}
      {multi && (
        <div className="hz-multi-badge">
          <b className="num">{ids.length}</b>본 선택 · <span className="num">ESC</span> 해제
        </div>
      )}

      {/* 배선 상세 카드 — 캔버스에서 hover 할 때만 (표 hover · 고정 선택은 카드 없음) */}
      {hovered && hoverSource === 'canvas' && !pinned && (
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
