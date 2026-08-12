/**
 * Agent A 소유 — 문서 → React Flow(커스텀 노드/엣지) 변환.
 */
import type { Node, Edge } from '@xyflow/react';
import type { HarnessDocument, ViewMode, Endpoint } from '../types';
import { computeNets } from '../store/netlist';

function endpointNodeId(e: Endpoint): string {
  return e.type === 'pin' ? e.connectorId : e.deviceId;
}
function endpointHandle(e: Endpoint): string {
  return e.type === 'pin' ? e.pinId : (e.terminal ?? '__node');
}
/**
 * 와이어 색을 화면에 그릴 색으로 변환.
 * - 흰색/아주 밝은 색은 캔버스 배경에 묻히므로 회색 테두리 효과를 위해 보정
 * - 알 수 없는 색 이름은 회색으로 폴백(잘못된 값이 검정으로 보이지 않게)
 */
const NAMED_COLORS = new Set([
  'red','black','white','green','blue','yellow','orange','brown',
  'purple','gray','grey','pink','violet','cyan','magenta',
]);

export function strokeColor(base: string): string {
  const c = base.trim().toLowerCase();
  if (c === 'white') return '#d1d5db';        // 흰 선은 옅은 회색으로 표현
  if (c === 'yellow') return '#eab308';       // 노랑은 배경에 묻히므로 진하게
  if (NAMED_COLORS.has(c)) return c;
  if (/^#[0-9a-f]{3,8}$/i.test(base.trim())) return base.trim();
  return '#6b7280';                            // 알 수 없는 값
}

/**
 * 전선 색 약호. 도면에서는 색 이름을 다 쓸 자리가 없어 약호를 쓴다.
 * (현장 관행 · Claude Design 스펙과 동일)
 */
const ABBR: Record<string, string> = {
  red: 'R', black: 'B', white: 'W', green: 'G', blue: 'L',
  yellow: 'Y', orange: 'O', brown: 'Br', purple: 'V', violet: 'V',
  gray: 'Gy', grey: 'Gy', pink: 'P', cyan: 'C', magenta: 'M',
};

export function colorAbbr(base: string, stripe?: string): string {
  const a = ABBR[base.trim().toLowerCase()] ?? base.trim().slice(0, 2).toUpperCase();
  if (!stripe) return a;
  const b = ABBR[stripe.trim().toLowerCase()] ?? stripe.trim().slice(0, 2).toUpperCase();
  return `${a}/${b}`;
}

function pos(
  p: { logical?: { x: number; y: number }; physical?: { x: number; y: number } },
  view: ViewMode,
  fallback: { x: number; y: number },
) {
  return p[view] ?? p.logical ?? p.physical ?? fallback;
}

/**
 * 도면 레퍼런스 부여 — 커넥터 J1..Jn, 스플라이스 SP1.., 장치 D1..
 * 문서 내 등장 순서로 고정한다(다시 계산해도 같은 번호가 나와야 한다).
 */
export function refLabels(doc: HarnessDocument): Map<string, string> {
  const out = new Map<string, string>();
  let j = 0, sp = 0, d = 0;
  for (const c of doc.connectors) {
    out.set(c.id, c.kind === 'splice' ? `SP${++sp}` : `J${++j}`);
  }
  for (const dev of doc.devices) out.set(dev.id, `D${++d}`);
  return out;
}

export function docToNodes(
  doc: HarnessDocument,
  view: ViewMode,
  hotPinsByNode: Map<string, string[]> = new Map(),
): Node[] {
  const nodes: Node[] = [];
  const refs = refLabels(doc);
  let i = 0;
  for (const c of doc.connectors) {
    nodes.push({
      id: c.id,
      type: 'connector',
      zIndex: 1,
      position: pos(c.positions, view, { x: 80 + i * 160, y: 80 }),
      data: {
        connector: c,
        housing: doc.usedParts.find((p) => p.id === c.housingId),
        view,
        ref: refs.get(c.id),
        hotPins: hotPinsByNode.get(c.id) ?? [],
      },
    });
    i++;
  }
  for (const d of doc.devices) {
    nodes.push({
      id: d.id,
      type: 'device',
      zIndex: 1,
      position: pos(d.positions, view, { x: 80 + i * 160, y: 320 }),
      data: { device: d, ref: refs.get(d.id), hotPins: hotPinsByNode.get(d.id) ?? [] },
    });
    i++;
  }
  return nodes;
}

/** 선택된 요소가 속한 네트의 와이어 id 집합 (하이라이트용) */
export function highlightedWires(doc: HarnessDocument, selection: string | null): Set<string> {
  if (!selection) return new Set();
  const nets = computeNets(doc);
  // 선택이 와이어인 경우
  const byWire = nets.find((n) => n.wireIds.includes(selection));
  if (byWire) return new Set(byWire.wireIds);
  // 선택이 커넥터/장치인 경우: 그 노드에 속한 끝점을 포함하는 네트 전부
  const ids = new Set<string>();
  for (const n of nets) {
    if (n.members.some((m) => m.split(':')[1] === selection)) {
      for (const w of n.wireIds) ids.add(w);
    }
  }
  return ids;
}

/**
 * 레인 인덱스 → 화면 오프셋(px). 중앙 기준 대칭: 0, +step, -step, +2step …
 * 도면 중앙에서 한쪽으로 쏠리지 않게 한다.
 */
export function laneOffset(lane: number, step = 12): number {
  const k = Math.ceil(lane / 2);
  if (k === 0) return 0;              // -0 이 나오지 않게 먼저 처리
  return (lane % 2 === 1 ? 1 : -1) * k * step;
}

/**
 * 레인 자동 배정 — **구간 겹침 채색**(interval graph coloring).
 *
 * 이전 방식(배선 순서로 하나씩 벌리기)은 배선 수에 비례해 도면이 세로로
 * 벌어졌다. 20본이면 ±120px.
 *
 * 수평 구간이 실제로 겹치는 배선끼리만 레인을 달리하면 되므로,
 * x 범위가 안 겹치는 배선은 같은 레인을 재사용한다.
 * → 레인 수가 **최대 동시 겹침 수**에서 멈춘다(20본 기준 보통 4~5레인).
 *
 * @param spans 배선별 수평 구간 [x1, x2] (x1 ≤ x2)
 * @param gap   같은 레인을 재사용하기 위해 필요한 최소 간격
 * @returns 배선별 레인 인덱스 (입력과 같은 순서)
 */
export function colorLanes(spans: [number, number][], gap = 10): number[] {
  // x1 오름차순으로 훑어야 그리디 채색이 최적이 된다.
  // 원래 순서로 되돌려야 하므로 인덱스를 들고 다닌다.
  const order = spans
    .map((s, i) => ({ i, x1: Math.min(s[0], s[1]), x2: Math.max(s[0], s[1]) }))
    .sort((a, b) => a.x1 - b.x1);

  const laneEnds: number[] = [];   // 레인별로 현재까지 쓰인 오른쪽 끝
  const out = new Array<number>(spans.length).fill(0);

  for (const w of order) {
    let lane = laneEnds.findIndex((end) => end + gap <= w.x1);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = w.x2;
    out[w.i] = lane;
  }
  return out;
}

/**
 * @param highlight 같은 네트에 속해 강조할 와이어들 (굵게/선명하게)
 * @param labelFor  상세 라벨을 띄울 와이어 id — 딱 하나만.
 *                  네트 전체에 라벨을 달면 스플라이스 근처에서 서로 겹쳐 못 읽는다.
 */
export function docToEdges(
  doc: HarnessDocument,
  highlight: Set<string> = new Set(),
  labelFor: string | null = null,
  view: ViewMode = 'logical',
): Edge[] {
  const dim = highlight.size > 0;

  // 각 배선의 수평 구간을 양 끝 노드의 x 로 근사해 레인을 채색한다.
  // 정확한 핸들 좌표는 React Flow 가 렌더할 때 정해지지만, 겹침 판정에는
  // 노드 x 로 충분하다(패드 격자 폭은 보통 100px 안쪽).
  const nodeX = new Map<string, number>();
  for (const c of doc.connectors) nodeX.set(c.id, pos(c.positions, view, { x: 0, y: 0 }).x);
  for (const d of doc.devices) nodeX.set(d.id, pos(d.positions, view, { x: 0, y: 0 }).x);
  const spans = doc.wires.map((w) => [
    nodeX.get(endpointNodeId(w.from)) ?? 0,
    nodeX.get(endpointNodeId(w.to)) ?? 0,
  ] as [number, number]);
  const laneIdx = colorLanes(spans);

  // 스텁 신호명은 도착 핀의 규격 신호를 쓴다(없으면 출발 핀).
  const signalAt = (e: Endpoint): string | undefined => {
    if (e.type !== 'pin') return undefined;
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    const pin = c?.pins.find((p) => p.id === e.pinId);
    const housing = doc.usedParts.find((p) => p.id === c?.housingId);
    return housing?.pinLayout?.find((s) => s.index === pin?.index)?.signal;
  };

  return doc.wires.map((w, i) => {
    const stripe = w.color.stripe ? `/${w.color.stripe}` : '';
    const on = highlight.has(w.id);
    const len = w.lengthMm != null ? ` · ${w.lengthMm}mm` : '';
    const spec = `${w.color.base}${stripe} · ${w.gauge.system.toUpperCase()}${w.gauge.value}${len}`;
    const color = strokeColor(w.color.base);
    return {
      id: w.id,
      type: 'ortho',
      source: endpointNodeId(w.from),
      sourceHandle: endpointHandle(w.from),
      target: endpointNodeId(w.to),
      targetHandle: endpointHandle(w.to),
      // 노드보다 아래에 그려 커넥터 블록을 가로지르지 않게 한다
      zIndex: 0,
      style: {
        stroke: color,
        strokeWidth: on ? 3.2 : 1.6,
        opacity: dim && !on ? 0.16 : 1,
      },
      data: {
        lane: laneOffset(laneIdx[i]),
        abbr: colorAbbr(w.color.base, w.color.stripe),
        signal: signalAt(w.to) ?? signalAt(w.from),
        on,
        dim: dim && !on,
        spec,
        detail: w.id === labelFor ? spec : undefined,
      },
    } satisfies Edge;
  });
}

/** 하위호환 합본 (테스트/기존 호출부) */
export function docToFlow(doc: HarnessDocument, view: ViewMode): { nodes: Node[]; edges: Edge[] } {
  return { nodes: docToNodes(doc, view), edges: docToEdges(doc, new Set(), null, view) };
}
