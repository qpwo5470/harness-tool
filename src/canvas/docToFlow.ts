/**
 * Agent A 소유 — 문서 → React Flow(커스텀 노드/엣지) 변환.
 */
import { Position, type Node, type Edge } from '@xyflow/react';
import type { HarnessDocument, ViewMode, Endpoint, Vec2 } from '../types';
import { computeNets } from '../store/netlist';
import { lengthResolver } from '../store/wireLength';
import {
  pinAnchor, pinAnchorPhysical, deviceAnchor, isHorizontalSide,
  connectorBox, deviceBox, layoutCells, type NodeBox,
} from './geometry';
// 세로 간선이 어디까지 뻗는지는 **상자를 비켜 간 뒤에야** 알 수 있다.
// 그래서 레인을 정하기 전에 라우터를 한 번 돌려 본다(assignLanes 주석 참고).
import { routeOrthogonal, type Pt } from './route';

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
 * 자켓색 미지정일 때 쓰는 중립색.
 *
 * hex 로 못박는 이유는 pdfDraw 의 색표와 같다 — PDF 는 CSS 변수를 읽지 못하는데
 * 화면과 종이가 같은 그림이어야 하므로 **한 문자열**을 둘 다 쓴다.
 * (값은 tokens.css 의 --muted)
 */
export const JACKET_UNSPEC_COLOR = '#7a7a7d';

/**
 * 자켓을 그릴 색과 선 모양.
 *
 * **미지정은 색을 지어내지 않는다.** 검정을 기본값으로 깔면 도면이 "검은 자켓"
 * 이라고 말하게 되고, 그 도면을 받은 사람은 검정을 발주한다. 대신 중립색
 * **점선** 윤곽으로 그려 "자켓은 있으나 색은 정해지지 않았다" 를 그림으로 말한다.
 * (실선/점선은 흑백 인쇄에서도 남는 구분이다 — 색만으로 나누지 않는다.)
 *
 * 지정된 색은 전선과 **같은 보정**(strokeColor)을 지난다. 자켓색 red 는 UI 강조가
 * 아니라 **물건의 색**이므로 그대로 빨강으로 그린다 — 전선 빨강과 같은 자격이다.
 */
export function jacketPaint(jacketColor?: string): { color: string; dashed: boolean } {
  const raw = (jacketColor ?? '').trim();
  if (!raw) return { color: JACKET_UNSPEC_COLOR, dashed: true };
  return { color: strokeColor(raw), dashed: false };
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
 * 레인 인덱스 → 화면 오프셋(px). 중앙 기준으로 위아래 번갈아 벌린다:
 * 0, +step, -1.5step, +2step, -2.5step …  도면 중앙에서 한쪽으로 쏠리지 않게 한다.
 *
 * ── 왜 음수 쪽만 반 칸 더 미나 (실측한 결함)
 * 예전에는 완전 대칭(0, +step, -step, +2step, -2step)이었다. 그런데 라우터가
 * 노드 상자를 돌아 나갈 때는 **부호를 접어 |laneY| 만** 쓴다(route.pushAside —
 * 안쪽으로 되돌아가면 그 상자를 다시 관통하므로 밀어내기는 언제나 바깥쪽이다).
 * 그래서 크기까지 같은 ±k 두 가닥이 우회 구간에서 **같은 자리에 포개졌다**.
 * 커넥터를 한 줄로 늘어놓고 양 끝을 네 본으로 이으면 네 본 중 두 본이 겹쳤다
 * (제3의 노드 회피가 들어오면서 우회하는 배선이 크게 늘어 눈에 띄었다).
 *
 * 반 칸을 더하면 접은 뒤 크기가 0 · step · 1.5step · 2step · 2.5step … 로 전부
 * 달라지고, 접기 전 간격도 여전히 step 이상이다(가장 좁은 쌍이 0 ↔ +step).
 * 레인 번호가 커질수록 |오프셋| 도 커지므로 접어도 **순서가 뒤집히지 않는다** —
 * 우회 구간에서 가닥끼리 서로 넘나들지 않는다.
 */
export function laneOffset(lane: number, step = 12): number {
  const k = Math.ceil(lane / 2);
  if (k === 0) return 0;              // -0 이 나오지 않게 먼저 처리
  return lane % 2 === 1 ? k * step : -(k * step + step / 2);
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

/** 가로 주행 구간 레인 간격 */
export const LANE_Y_STEP = 12;
/** 세로 간선 레인 간격 — 패드에서 바깥으로 밀어내는 거리라 항상 0 이상 */
export const LANE_X_STEP = 10;

/**
 * 같은 케이블 심선이 **도면에서 이웃한 높이**에 오도록 레인 번호를 바꿔 단다.
 *
 * ── 왜 필요한가 (실측)
 * 자켓은 심선 2본 이상이 **나란히 가는 구간**에만 그린다(wirePlan.planJackets).
 * 그런데 레인 채색(colorLanes)은 케이블을 전혀 모른다 — x 로 겹치는 순서대로
 * 번호를 나눠 줄 뿐이다. 그래서 한 케이블의 심선이 레인 0 과 레인 4 에 떨어지고
 * 그 사이(레인 2)로 **남의 배선**이 지나가는 일이 생긴다. 그러면 자켓이 통째로
 * 사라진다(bundleAt 이 사이에 낀 남의 전선에서 무리를 끊는다) — 케이블이 있는
 * 도면과 없는 도면이 다시 같은 그림이 된다.
 *
 * ── 왜 "번호 바꿔 달기"(permutation) 인가 — 겹침 0 이 유지되는 근거
 * 레인 채색은 **x 로 겹치는 배선끼리 서로 다른 번호**를 준 것이다(proper coloring).
 * 색 이름을 통째로 맞바꾸는 것은 그 성질을 건드리지 않는다: 겹치던 두 배선은
 * 바꾼 뒤에도 여전히 다른 번호를 갖는다. 레인 **수**도 그대로라 도면이 더
 * 벌어지지도 않는다. 즉 이 함수는 "누가 어느 높이에 서는가" 만 바꾼다.
 *
 * ── 이웃은 **번호 순이 아니라 오프셋 순**이다
 * laneOffset 은 중앙에서 위아래로 번갈아 벌린다(0, +12, -18, +24, -30 …).
 * 그래서 번호 0 과 1 은 이웃이지만 1 과 2 는 사이에 0 이 낀다. 도면에서 이웃이
 * 되려면 **오프셋으로 정렬한 순서**에서 붙어 있어야 한다 — slots 가 그 순서다.
 *
 * ── 케이블이 없으면 항등(identity)
 * 어느 레인도 케이블에 묶이지 않으면 seq 는 slots 그대로가 되어 remap 이 항등이
 * 된다. 케이블 없는 문서의 좌표를 못박은 시험이 그대로 통과해야 하기 때문이다.
 *
 * @param lanes  배선별 레인 번호 (colorLanes 결과)
 * @param cableOf 배선 → 케이블 id (단선이면 undefined)
 */
export function groupLanesByCable(
  lanes: number[],
  cableOf: (wire: number) => string | undefined,
  step = LANE_Y_STEP,
): number[] {
  const count = lanes.length ? Math.max(...lanes) + 1 : 0;
  if (count < 2) return lanes.slice();

  // 레인 → 그 레인에 든 케이블. 한 레인에 **서로 다른 케이블**이 섞이면 어느 쪽으로도
  // 끌어당길 수 없다(둘 다 이웃으로 만들 수는 없다) — 그런 레인은 제자리에 둔다.
  const cableOfLane: (string | undefined)[] = new Array(count).fill(undefined);
  const mixed = new Set<number>();
  lanes.forEach((l, i) => {
    const c = cableOf(i);
    if (!c) return;
    if (cableOfLane[l] === undefined) cableOfLane[l] = c;
    else if (cableOfLane[l] !== c) mixed.add(l);
  });
  for (const l of mixed) cableOfLane[l] = undefined;
  if (cableOfLane.every((c) => c === undefined)) return lanes.slice();

  // 레인 번호를 **도면 위에서 아래로** 늘어놓은 것 (오프셋 오름차순)
  const slots = Array.from({ length: count }, (_, k) => k)
    .sort((a, b) => laneOffset(a, step) - laneOffset(b, step));

  // 위에서부터 훑다가 어느 케이블을 처음 만나면 그 케이블의 레인을 **그 자리에
  // 몰아서** 내보낸다. 처음 만난 자리에 붙이므로 케이블은 원래 있던 높이 근처에
  // 남고(도면이 크게 출렁이지 않는다), 케이블이 없으면 순서가 그대로다.
  const done = new Set<number>();
  const seq: number[] = [];
  for (const l of slots) {
    if (done.has(l)) continue;
    const c = cableOfLane[l];
    if (c == null) {
      seq.push(l);
      done.add(l);
      continue;
    }
    for (const m of slots) {
      if (done.has(m) || cableOfLane[m] !== c) continue;
      seq.push(m);
      done.add(m);
    }
  }

  // i 번째로 놓기로 한 레인은 i 번째로 높은 자리(=slots[i] 번 레인)를 받는다
  const remap = new Array<number>(count);
  seq.forEach((l, i) => { remap[l] = slots[i]; });
  return lanes.map((l) => remap[l]);
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

/**
 * 배선 → **자켓을 그릴 수 있는** 케이블 id.
 *
 * 문서에 없는 케이블을 가리키는 배선(손으로 고친 JSON)과 심선이 1본뿐인 케이블은
 * 뺀다. 둘 다 자켓이 그려질 수 없어(나란히 갈 상대가 없다) 레인을 흔들 이유가 없다 —
 * 흔들면 그림만 달라지고 얻는 게 없다.
 */
export function coreCableOf(doc: HarnessDocument): (wire: number) => string | undefined {
  const known = new Set((doc.cables ?? []).map((c) => c.id));
  const cores = new Map<string, number>();
  for (const w of doc.wires) {
    if (w.cableId && known.has(w.cableId)) cores.set(w.cableId, (cores.get(w.cableId) ?? 0) + 1);
  }
  return (i) => {
    const id = doc.wires[i]?.cableId;
    return id && (cores.get(id) ?? 0) >= 2 ? id : undefined;
  };
}

export type Anchor = { x: number; y: number; side: Position };

/**
 * 끝점 → 핸들 좌표(근사).
 *
 * 예전에는 **노드 좌상단 x** 로만 구간을 잡았다. 12핀 커넥터는 폭이 368px 이라
 * 오른쪽 변에서 나가는 배선의 구간이 통째로 어긋났고, 그 위에서 돌린 레인 채색은
 * 화면과 무관한 값이 됐다. 이제 geometry.ts 의 핸들 식을 그대로 쓴다.
 *
 * "근사"인 이유: 라벨 블록 높이(REF_BLOCK_H)가 CSS 실측 상수라서다. 커넥터도
 * 장치도 이제 그 높이·폭·단자 줄 높이를 인라인으로 박아(nodes.tsx) 쓰므로 남는
 * 오차는 테두리 1.5px 과 장치 단자 줄의 좌우 padding 정도다. 레인 간격이 10px
 * 단위라 배정 결과는 안 바뀐다.
 *
 * `refs` 를 받는 이유: **장치** 블록 폭이 이름표 글자 폭에 달렸고(geometry.deviceSize)
 * 오른쪽 변 단자 핸들의 x 가 곧 그 폭이다. 경계 상자(endpointBox)와 다른 ref 를
 * 쓰면 핸들이 상자 변에서 어긋난다. 기본값을 두어 예전 호출부는 그대로 돌아간다.
 */
export function endpointAnchor(
  doc: HarnessDocument,
  e: Endpoint,
  view: ViewMode,
  at: Map<string, Vec2> = nodePositions(doc, view),
  refs: Map<string, string> = refLabels(doc),
): Anchor {
  const p = at.get(endpointNodeId(e)) ?? { x: 0, y: 0 };
  if (e.type === 'pin') {
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    if (!c) return { x: p.x, y: p.y, side: Position.Right };
    const housing = doc.usedParts.find((x) => x.id === c.housingId);
    const index = c.pins.find((x) => x.id === e.pinId)?.index ?? 1;
    // 물리 뷰 판정은 layoutCells 로 — 렌더(nodes.tsx)·경계상자(connectorBox)와 같은 기준
    return view === 'physical' && layoutCells(housing?.pinLayout)
      ? pinAnchorPhysical(c, housing, index, p)
      : pinAnchor(c, housing, index, p);
  }
  const d = doc.devices.find((x) => x.id === e.deviceId);
  if (!d) return { x: p.x, y: p.y, side: Position.Left };
  return deviceAnchor(d, e.terminal, p, refs.get(d.id));
}

/**
 * 끝점이 붙은 노드의 경계 상자.
 *
 * 배선은 노드보다 아래층(zIndex 0)에 그려진다. 그래서 경로가 노드 박스를 지나면
 * 화면에서 통째로 사라진다 — 라우터가 피할 수 있게 상자를 알려줘야 한다.
 * 상자를 못 구하면(끝점이 문서에 없는 등) undefined 를 준다: 라우터는 그때
 * 회피 없이 예전대로 그린다.
 *
 * `refs` 를 받는 이유: 상자 폭이 **이름표 글자 폭**까지 포함하는데(connectorBox ·
 * deviceBox), 이름표 첫 조각이 도면 레퍼런스("J1"·"SP12"·"D3")라 그 글자를 알아야
 * 폭이 맞는다. 기본값을 두어 예전 호출부는 그대로 돌아간다.
 */
export function endpointBox(
  doc: HarnessDocument,
  e: Endpoint,
  view: ViewMode,
  at: Map<string, Vec2> = nodePositions(doc, view),
  refs: Map<string, string> = refLabels(doc),
): NodeBox | undefined {
  const p = at.get(endpointNodeId(e));
  if (!p) return undefined;
  if (e.type === 'pin') {
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    if (!c) return undefined;
    return connectorBox(c, doc.usedParts.find((x) => x.id === c.housingId), p, view, refs.get(c.id));
  }
  const d = doc.devices.find((x) => x.id === e.deviceId);
  return d ? deviceBox(d, p, refs.get(d.id)) : undefined;
}

/**
 * 문서의 **모든** 노드 경계 상자 — 배선이 제3의 노드 뒤로 숨지 않게 라우터에 넘긴다.
 *
 * 왜 한 번만 만드나: 배선 N본 × 노드 M개다. 배선마다 목록을 다시 만들면 같은
 * 사각형을 N번씩 다시 계산한다(이름표 글자 폭까지 재는 계산이라 싸지 않다).
 * `assignLanes` 가 문서당 한 번 만들어 모든 배선이 **같은 배열**을 나눠 쓴다.
 *
 * 상자만이 아니라 id 까지 돌려주는 이유: 검증 규칙(`wire-crosses-part`)이
 * "어느 부품을 지나는지" 를 사람이 읽을 수 있게 짚어 줘야 한다. 라우터는 id 를
 * 쓰지 않으므로 그쪽에는 `.map((n) => n.box)` 로 상자만 넘긴다.
 */
export function nodeBoxes(
  doc: HarnessDocument,
  view: ViewMode,
  at: Map<string, Vec2> = nodePositions(doc, view),
  refs: Map<string, string> = refLabels(doc),
): { id: string; box: NodeBox }[] {
  const out: { id: string; box: NodeBox }[] = [];
  for (const c of doc.connectors) {
    const p = at.get(c.id);
    if (!p) continue;
    out.push({
      id: c.id,
      box: connectorBox(c, doc.usedParts.find((x) => x.id === c.housingId), p, view, refs.get(c.id)),
    });
  }
  for (const d of doc.devices) {
    const p = at.get(d.id);
    if (p) out.push({ id: d.id, box: deviceBox(d, p, refs.get(d.id)) });
  }
  return out;
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
  /**
   * 문서의 모든 노드 상자 — **배선 전체가 같은 배열을 나눠 쓴다**.
   * 자기 두 끝도 여기 들어 있지만 fromBox/toBox 와 같은 사각형이라 결과가
   * 달라지지 않는다(route.ts 머리말).
   */
  obstacles: NodeBox[];
};

/** 한 경로의 가로 선분들 (레인 laneY 가 실제로 미는 것이 이 선분들이다) */
function horizontals(points: Pt[]): { at: number; lo: number; hi: number }[] {
  const out: { at: number; lo: number; hi: number }[] = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6) {
      out.push({ at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  }
  return out;
}

/**
 * 레인 배정 하나를 **실제 경로로 재서** 매긴 값. 작을수록 좋다.
 *
 * 가중치를 지어내지 않으려고 **사전식(lexicographic)** 으로 비교한다 — 세 항목은
 * 성질이 다르고, "겹침 한 쌍이 벌어진 몇 px 과 같다" 같은 환산은 근거가 없다.
 *
 *  [0] 포개지는 가로 주행 구간 쌍 — 0 이 아니면 어느 선이 어느 선인지 못 읽는다.
 *      무엇보다 먼저다. 이 값이 늘어나면 다른 이득이 아무리 커도 받지 않는다.
 *  [1] 케이블 심선들 **사이에 낀 남의 전선** — 자켓이 통째로 끊기는 자리다
 *      (wirePlan.bundleAt 이 여기서 무리를 자른다).
 *  [2] 한 케이블 심선들이 벌어진 몫(px) — 좁을수록 자켓이 이어진다.
 *
 * 세로 선분은 세지 않는다. 이 계산은 laneX = 0 으로 그려 본 것이라 같은 커넥터에서
 * 나온 스텁들의 x 가 아직 겹쳐 있다 — 그 겹침을 푸는 것은 다음 단계(colorRuns)의
 * 일이고, laneY 를 고르는 자리에서 세면 의미 없는 숫자만 나온다.
 */
function laneCost(
  doc: HarnessDocument,
  probes: Pt[][],
  cableOf: (wire: number) => string | undefined,
): [number, number, number] {
  const segs = probes.map(horizontals);

  let overlaps = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const hit = segs[i].some((a) => segs[j].some((b) =>
        Math.abs(a.at - b.at) < 2 && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 2));
      if (hit) overlaps++;
    }
  }

  /** 배선의 **주행 구간** — 가장 긴 가로 선분. 레인이 미는 것도, 자켓이 감싸는 것도 그것이다. */
  const trunk = segs.map((s) => s.reduce<{ at: number; lo: number; hi: number } | null>(
    (best, seg) => (!best || seg.hi - seg.lo > best.hi - best.lo ? seg : best), null));

  const byCable = new Map<string, number[]>();
  doc.wires.forEach((_, i) => {
    const c = cableOf(i);
    if (c) byCable.set(c, [...(byCable.get(c) ?? []), i]);
  });

  let intruders = 0;
  let spread = 0;
  for (const cores of byCable.values()) {
    const mine = cores.map((i) => trunk[i]).filter((t): t is NonNullable<typeof t> => !!t);
    if (mine.length < 2) continue;
    const lo = Math.min(...mine.map((t) => t.at));
    const hi = Math.max(...mine.map((t) => t.at));
    const x0 = Math.min(...mine.map((t) => t.lo));
    const x1 = Math.max(...mine.map((t) => t.hi));
    spread += hi - lo;
    const own = new Set(cores);
    doc.wires.forEach((_, i) => {
      if (own.has(i)) return;
      const t = trunk[i];
      // 심선들이 만드는 띠 **안**을 남의 주행 구간이 지나면 그 자리에서 자켓이 끊긴다
      if (t && t.at >= lo && t.at <= hi && Math.min(t.hi, x1) - Math.max(t.lo, x0) > 2) intruders++;
    });
  }
  return [overlaps, intruders, spread];
}

/** 사전식 비교 — 앞 항목이 같을 때만 다음 항목을 본다 */
function cheaper(a: [number, number, number], b: [number, number, number]): boolean {
  for (let k = 0; k < a.length; k++) {
    if (Math.abs(a[k] - b[k]) > 1e-6) return a[k] < b[k];
  }
  return false;   // 완전히 같으면 바꾸지 않는다 — 이득 없이 도면을 흔들지 않는다
}

/**
 * 배선 레인 두 축을 한꺼번에 배정한다.
 *
 * 순서가 중요하다: 세로 간선이 y 로 어디까지 뻗는지는 주행 구간 y(=laneY)가
 * 정해져야 알 수 있다. 그래서 laneY 를 먼저 풀고 그 결과로 세로 구간을 그린다.
 */
export function assignLanes(doc: HarnessDocument, view: ViewMode = 'logical'): WireLanes {
  const at = nodePositions(doc, view);
  // 레퍼런스는 한 번만 매긴다 — 상자 폭에 이름표 글자가 들어가므로 배선마다
  // 다시 세면 같은 문서에서 O(n²) 이 된다(결과는 같다).
  // **핸들 좌표보다 먼저** 구한다: 장치 블록은 이름표 폭만큼 넓어지고(deviceSize)
  // 오른쪽 변 단자 핸들의 x 가 곧 그 폭이라, 상자와 같은 ref 를 써야 어긋나지 않는다.
  const refs = refLabels(doc);
  const from = doc.wires.map((w) => endpointAnchor(doc, w.from, view, at, refs));
  const to = doc.wires.map((w) => endpointAnchor(doc, w.to, view, at, refs));

  const fromBox = doc.wires.map((w) => endpointBox(doc, w.from, view, at, refs));
  const toBox = doc.wires.map((w) => endpointBox(doc, w.to, view, at, refs));
  // 제3의 노드 회피용. 문서당 한 번만 만들어 배선 전체가 같은 배열을 나눠 쓴다.
  const obstacles = nodeBoxes(doc, view, at, refs).map((n) => n.box);

  // 1) 가로 주행 구간 — x 로 겹치는 배선끼리 y 를 달리한다.
  //
  //    채색이 끝난 뒤 **같은 케이블 심선을 이웃 높이로 몰아 본다**(groupLanesByCable).
  //    채색 자체를 케이블로 흔들지 않는 이유: 겹침 0 은 채색이 지키는 성질이고,
  //    번호를 바꿔 다는 것만으로는 그 성질이 깨지지 않는다(그 함수 머리말).
  //
  //    그리고 **그려 보고 고른다**. 레인 오프셋은 배선마다 다른 기준 y 위에 얹히므로
  //    (주행 구간 기준 y = 두 패드의 중점 · L자면 도착 패드 쪽) "번호가 이웃"이
  //    곧 "도면에서 이웃"은 아니다. 어떤 배치에서는 몰아 놓는 편이 오히려 남의
  //    전선을 케이블 사이로 끌어들인다. 그래서 두 배정을 실제 경로로 재서
  //    **나빠지지 않을 때만** 바꾼다 — 라우터의 자기 신고를 믿지 않는 것과 같은 태도다.
  const spans = doc.wires.map((_, i) => [from[i].x, to[i].x] as [number, number]);
  const cableOf = coreCableOf(doc);
  const plain = colorLanes(spans);
  const grouped = groupLanesByCable(plain, cableOf);
  const probeAll = (ly: number[]) => doc.wires.map((_, i) => routeOrthogonal({
    sourceX: from[i].x, sourceY: from[i].y, targetX: to[i].x, targetY: to[i].y,
    sourcePosition: from[i].side, targetPosition: to[i].side,
    laneY: ly[i], laneX: 0,
    sourceBox: fromBox[i], targetBox: toBox[i], obstacles,
  }).points);

  let laneY = plain.map((k) => laneOffset(k, LANE_Y_STEP));
  let probes = probeAll(laneY);
  if (grouped.some((l, i) => l !== plain[i])) {
    const altY = grouped.map((k) => laneOffset(k, LANE_Y_STEP));
    const alt = probeAll(altY);
    if (cheaper(laneCost(doc, alt, cableOf), laneCost(doc, probes, cableOf))) {
      laneY = altY;
      probes = alt;
    }
  }

  // 2) 세로 간선 — 같은 노드·같은 변에서 나온 세로 구간이 y 로 겹치면 x 를 벌린다.
  //
  //    겹침 판정 구간은 "패드 y ~ 세로 간선이 꺾이는 y" 다. 예전에는 그 끝을
  //    **두 패드의 중점**(+laneY)으로 어림했다. 상자를 비켜 갈 일이 없던 시절에는
  //    맞았지만, 지금은 주행 구간이 상자 무리 바깥까지 밀리므로 세로 간선이 그만큼
  //    더 길어진다 — 늘어난 그 부분의 겹침을 통째로 놓쳤다(한 줄 배치에서 커넥터
  //    바로 옆 스텁 두 가닥이 8px 겹치는 것을 실측).
  //
  //    그래서 **laneX 를 0 으로 두고 한 번 그려 본 뒤** 그 꺾임 y 를 쓴다.
  //    닭-달걀(세로 간선 x 를 정하려면 y 범위를 알아야 하고, y 범위는 경로를
  //    그려 봐야 안다)을 한 번만 풀고 멈춘다: laneX 는 스텁을 옆으로 밀 뿐이라
  //    꺾임 y 를 거의 바꾸지 않는다. 완전한 동시 해는 범위 밖이다.
  const runs: LaneRun[] = [];
  doc.wires.forEach((w, i) => {
    const s = from[i];
    const t = to[i];
    const probe = probes[i];
    if (isHorizontalSide(s.side)) {
      runs.push({
        item: i, key: `${endpointNodeId(w.from)}:${s.side}`,
        a: s.y, b: turnY(probe, 'start'),
      });
    }
    if (isHorizontalSide(t.side)) {
      runs.push({
        item: i, key: `${endpointNodeId(w.to)}:${t.side}`,
        a: t.y, b: turnY(probe, 'end'),
      });
    }
  });
  const laneX = colorRuns(doc.wires.length, runs).map((k) => k * LANE_X_STEP);

  return { laneY, laneX, from, to, fromBox, toBox, obstacles };
}

/**
 * 경로에서 **끝에 가장 가까운 세로 간선**이 닿는 y.
 *
 * 가로 스텁 바로 다음(또는 직전)에 오는 세로 선분이 곧 그 커넥터 옆구리를
 * 오르내리는 구간이고, 레인(laneX)이 벌려야 하는 것도 그 선분이다.
 * 꺾임점 배열은 `simplify` 를 거쳐 길이가 배치마다 다르므로 자리(index)로 집지
 * 않고 **찾아서** 쓴다. 세로 선분이 아예 없으면(완전히 곧은 배선) 끝 y 를 준다.
 */
function turnY(points: { x: number; y: number }[], side: 'start' | 'end'): number {
  const eps = 1e-6;
  if (side === 'start') {
    for (let k = 1; k < points.length; k++) {
      if (Math.abs(points[k].x - points[k - 1].x) < eps && Math.abs(points[k].y - points[k - 1].y) > eps) {
        return points[k].y;
      }
    }
    return points[0].y;
  }
  for (let k = points.length - 1; k > 0; k--) {
    if (Math.abs(points[k].x - points[k - 1].x) < eps && Math.abs(points[k].y - points[k - 1].y) > eps) {
      return points[k - 1].y;
    }
  }
  return points[points.length - 1].y;
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

  // 길이는 공용 해석기를 쓴다 — 케이블 심선은 케이블 길이로 재단되므로
  // 캔버스 라벨만 비워 두면 물리 뷰·자재표와 숫자가 갈린다.
  const lengthOf = lengthResolver(doc);

  return doc.wires.map((w, i) => {
    const stripe = w.color.stripe ? `/${w.color.stripe}` : '';
    const on = highlight.has(w.id);
    const mm = lengthOf(w).mm;
    const len = mm != null ? ` · ${mm}mm` : '';
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
        // 제3의 노드도 마찬가지다(한 줄로 늘어선 커넥터 사이를 지나는 배선).
        // 배열은 배선 전체가 나눠 쓰는 **같은 참조**다 — 배선마다 새로 만들면
        // 엣지 data 가 매번 달라져 React Flow 가 전부 다시 그린다.
        obstacles: lanes.obstacles,
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
