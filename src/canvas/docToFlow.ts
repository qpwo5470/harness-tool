/**
 * Agent A 소유 — 문서 → React Flow(커스텀 노드/엣지) 변환.
 */
import { Position, type Node, type Edge } from '@xyflow/react';
import type { HarnessDocument, ViewMode, Endpoint, Vec2 } from '../types';
import { computeNets } from '../store/netlist';
import {
  pinAnchor, pinAnchorPhysical, deviceAnchor, isHorizontalSide,
  connectorBox, deviceBox, type NodeBox,
} from './geometry';

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

/**
 * 노드 배치 좌표 — 화면과 배선 계획이 **같은 좌표**를 봐야 한다.
 * 위치가 없는 문서용 폴백까지 여기서 한 번만 정한다(두 곳에서 따로 계산하면
 * 폴백 문서에서만 배선이 엉뚱한 데를 가리킨다).
 */
export function nodePositions(doc: HarnessDocument, view: ViewMode): Map<string, Vec2> {
  const m = new Map<string, Vec2>();
  let i = 0;
  for (const c of doc.connectors) m.set(c.id, pos(c.positions, view, { x: 80 + i++ * 160, y: 80 }));
  for (const d of doc.devices) m.set(d.id, pos(d.positions, view, { x: 80 + i++ * 160, y: 320 }));
  return m;
}

export function docToNodes(
  doc: HarnessDocument,
  view: ViewMode,
  hotPinsByNode: Map<string, string[]> = new Map(),
): Node[] {
  const nodes: Node[] = [];
  const refs = refLabels(doc);
  const at = nodePositions(doc, view);
  let i = 0;
  for (const c of doc.connectors) {
    nodes.push({
      id: c.id,
      type: 'connector',
      zIndex: 1,
      position: at.get(c.id)!,
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
      position: at.get(d.id)!,
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

/** 한 배선이 차지하는 구간 하나. key 가 같은 것끼리만 겹침을 따진다. */
export type LaneRun = { item: number; key: string; a: number; b: number };

/**
 * 그룹별 구간 겹침 채색 — 세로 간선 레인(laneX) 배정용.
 *
 * 세로 간선은 **같은 노드의 같은 변**에서 나온 것끼리만 x 가 같다(스텁 끝).
 * 그래서 전역으로 채색하면(colorLanes) 겹치지도 않을 배선까지 레인을 잡아먹어
 * 부채꼴이 쓸데없이 넓어진다. key 로 묶어 필요한 만큼만 벌린다.
 *
 * 배선 하나가 구간을 둘 갖는다(출발 쪽 · 도착 쪽)는 점이 colorLanes 와 다르다.
 * 레인은 배선당 하나이므로 두 구간의 제약을 **함께** 만족해야 한다.
 *
 * @param count 배선 수
 * @param runs  배선별 구간들 (item = 배선 인덱스)
 * @param gap   같은 레인을 재사용하기 위해 필요한 최소 간격
 */
export function colorRuns(count: number, runs: LaneRun[], gap = 4): number[] {
  const byItem: LaneRun[][] = Array.from({ length: count }, () => []);
  for (const r of runs) byItem[r.item]?.push(r);

  const startOf = (rs: LaneRun[]) => (rs.length ? Math.min(...rs.map((r) => Math.min(r.a, r.b))) : Infinity);
  // 구간 시작 순으로 훑어야 그리디 채색이 낭비 없이 돈다(colorLanes 와 같은 이유).
  const order = Array.from({ length: count }, (_, i) => i)
    .sort((p, q) => startOf(byItem[p]) - startOf(byItem[q]));

  const overlaps = (x: LaneRun, y: LaneRun) => {
    if (x.key !== y.key) return false;
    const [a1, b1] = x.a <= x.b ? [x.a, x.b] : [x.b, x.a];
    const [a2, b2] = y.a <= y.b ? [y.a, y.b] : [y.b, y.a];
    return a1 - gap <= b2 && a2 - gap <= b1;
  };

  const lanes = new Array<number>(count).fill(0);
  const placed: { lane: number; runs: LaneRun[] }[] = [];
  for (const i of order) {
    const mine = byItem[i];
    const used = new Set<number>();
    for (const p of placed) {
      if (mine.some((r) => p.runs.some((o) => overlaps(r, o)))) used.add(p.lane);
    }
    let lane = 0;
    while (used.has(lane)) lane++;
    lanes[i] = lane;
    placed.push({ lane, runs: mine });
  }
  return lanes;
}

/** 가로 주행 구간 레인 간격 */
export const LANE_Y_STEP = 12;
/** 세로 간선 레인 간격 — 패드에서 바깥으로 밀어내는 거리라 항상 0 이상 */
export const LANE_X_STEP = 10;

export type Anchor = { x: number; y: number; side: Position };

/**
 * 끝점 → 핸들 좌표(근사).
 *
 * 예전에는 **노드 좌상단 x** 로만 구간을 잡았다. 12핀 커넥터는 폭이 368px 이라
 * 오른쪽 변에서 나가는 배선의 구간이 통째로 어긋났고, 그 위에서 돌린 레인 채색은
 * 화면과 무관한 값이 됐다. 이제 geometry.ts 의 핸들 식을 그대로 쓴다.
 *
 * "근사"인 이유: 라벨 블록 높이(REF_BLOCK_H)만 CSS 실측 상수라 몇 px 오차가 있다.
 * 레인 간격이 10px 단위라 배정 결과는 바뀌지 않는다.
 */
export function endpointAnchor(
  doc: HarnessDocument,
  e: Endpoint,
  view: ViewMode,
  at: Map<string, Vec2> = nodePositions(doc, view),
): Anchor {
  const p = at.get(endpointNodeId(e)) ?? { x: 0, y: 0 };
  if (e.type === 'pin') {
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    if (!c) return { x: p.x, y: p.y, side: Position.Right };
    const housing = doc.usedParts.find((x) => x.id === c.housingId);
    const index = c.pins.find((x) => x.id === e.pinId)?.index ?? 1;
    return view === 'physical' && housing?.pinLayout?.length
      ? pinAnchorPhysical(c, housing, index, p)
      : pinAnchor(c, housing, index, p);
  }
  const d = doc.devices.find((x) => x.id === e.deviceId);
  if (!d) return { x: p.x, y: p.y, side: Position.Left };
  return deviceAnchor(d, e.terminal, p);
}

/**
 * 끝점이 붙은 노드의 경계 상자.
 *
 * 배선은 노드보다 아래층(zIndex 0)에 그려진다. 그래서 경로가 노드 박스를 지나면
 * 화면에서 통째로 사라진다 — 라우터가 피할 수 있게 상자를 알려줘야 한다.
 * 상자를 못 구하면(끝점이 문서에 없는 등) undefined 를 준다: 라우터는 그때
 * 회피 없이 예전대로 그린다.
 */
export function endpointBox(
  doc: HarnessDocument,
  e: Endpoint,
  view: ViewMode,
  at: Map<string, Vec2> = nodePositions(doc, view),
): NodeBox | undefined {
  const p = at.get(endpointNodeId(e));
  if (!p) return undefined;
  if (e.type === 'pin') {
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    if (!c) return undefined;
    return connectorBox(c, doc.usedParts.find((x) => x.id === c.housingId), p, view);
  }
  const d = doc.devices.find((x) => x.id === e.deviceId);
  return d ? deviceBox(d, p) : undefined;
}

export type WireLanes = {
  /** 배선별 가로 주행 구간 y 오프셋 */
  laneY: number[];
  /** 배선별 세로 간선 x 오프셋 (패드에서 바깥으로) */
  laneX: number[];
  /** 배선별 양 끝 핸들 좌표 — 시험·진단용 */
  from: Anchor[];
  to: Anchor[];
  /** 배선별 양 끝 노드 경계 상자 — 라우터가 이 상자를 피해 간다 */
  fromBox: (NodeBox | undefined)[];
  toBox: (NodeBox | undefined)[];
};

/**
 * 배선 레인 두 축을 한꺼번에 배정한다.
 *
 * 순서가 중요하다: 세로 간선이 y 로 어디까지 뻗는지는 주행 구간 y(=laneY)가
 * 정해져야 알 수 있다. 그래서 laneY 를 먼저 풀고 그 결과로 세로 구간을 그린다.
 */
export function assignLanes(doc: HarnessDocument, view: ViewMode = 'logical'): WireLanes {
  const at = nodePositions(doc, view);
  const from = doc.wires.map((w) => endpointAnchor(doc, w.from, view, at));
  const to = doc.wires.map((w) => endpointAnchor(doc, w.to, view, at));

  // 1) 가로 주행 구간 — x 로 겹치는 배선끼리 y 를 달리한다.
  const spans = doc.wires.map((_, i) => [from[i].x, to[i].x] as [number, number]);
  const laneY = colorLanes(spans).map((k) => laneOffset(k, LANE_Y_STEP));

  // 2) 세로 간선 — 같은 노드·같은 변에서 나온 세로 구간이 y 로 겹치면 x 를 벌린다.
  //    (겹침 판정 구간은 패드 y 에서 주행 구간 y 까지)
  const runs: LaneRun[] = [];
  doc.wires.forEach((w, i) => {
    const s = from[i];
    const t = to[i];
    const midY = (s.y + t.y) / 2 + laneY[i];
    if (isHorizontalSide(s.side)) {
      runs.push({ item: i, key: `${endpointNodeId(w.from)}:${s.side}`, a: s.y, b: midY });
    }
    if (isHorizontalSide(t.side)) {
      runs.push({ item: i, key: `${endpointNodeId(w.to)}:${t.side}`, a: t.y, b: midY });
    }
  });
  const laneX = colorRuns(doc.wires.length, runs).map((k) => k * LANE_X_STEP);

  const fromBox = doc.wires.map((w) => endpointBox(doc, w.from, view, at));
  const toBox = doc.wires.map((w) => endpointBox(doc, w.to, view, at));

  return { laneY, laneX, from, to, fromBox, toBox };
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
  const lanes = assignLanes(doc, view);

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
        laneY: lanes.laneY[i],
        laneX: lanes.laneX[i],
        // 노드보다 아래층에 그려지므로 두 끝 노드 박스를 피해 가야 한다
        sourceBox: lanes.fromBox[i],
        targetBox: lanes.toBox[i],
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
