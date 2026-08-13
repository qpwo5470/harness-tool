/**
 * 직교(맨해튼) 배선 경로 계산 — 순수 함수. DOM·React 없음.
 *
 * ── 왜 getSmoothStepPath 를 버렸나 (실측)
 * 예전 OrthogonalEdge 는 React Flow 의 `getSmoothStepPath({ centerY })` 에 레인을
 * 실어 보냈다. 그런데 그 함수는 **핸들 방향 조합에 따라 centerY 를 통째로 무시한다.**
 * 직접 돌려 확인한 결과:
 *
 *     right->left   centerY 무시   ← 하네스 표준 배치(왼쪽 o=180 → 오른쪽 o=0)
 *     left->left    centerY 무시
 *     right->right  centerY 무시
 *     left->right   centerY 반영
 *
 * 즉 우리가 계산한 레인이 화면에 거의 반영되지 않았다. 20본 두 열 배치 실측으로
 * 세로 구간 겹침 123쌍(전부 같은 x 에 포개짐), 스텁 라벨 좌표가 완전히 같은 쌍 6개.
 * 라이브러리 안쪽 규칙을 우회하는 것보다 경로를 직접 잡는 편이 짧고 확실하다.
 *
 * ── 경로 모양
 *   S ─(스텁)─ A ┐                     ┌ B ─(스텁)─ T
 *                └───── 주행 구간 ─────┘
 * 양 끝은 반드시 핸들 방향으로 곧게 빠져나온 뒤에 꺾인다(패드에서 비스듬히
 * 나가면 어느 핀에서 나온 선인지 읽히지 않는다). 선분은 전부 수평 아니면 수직.
 *
 * ── 레인 두 축
 *   laneY : 가로 간선(주행 구간)의 y 를 민다
 *   laneX : 세로 간선의 x 를 민다
 * 스텁이 가로면 그 스텁을 늘려야 세로 간선이 옆으로 밀리므로 laneX 가 스텁 길이를,
 * 스텁이 세로면 laneY 가 스텁 길이를 늘린다. **밀어내기는 항상 바깥쪽**이라
 * 부호를 무시한다 — 부호를 그대로 쓰면 스텁이 패드 안으로 파고들어
 * "핸들 방향으로 stub 만큼 곧게" 라는 약속이 깨진다.
 *
 * ── 노드 상자 비켜가기 (sourceBox / targetBox)
 * 핸들 방향이 목적지 반대면(예: o=0 커넥터에서 오른쪽으로 가는 배선) 경로가
 * 패드 밖으로 나왔다가 되돌아 들어와야 한다. 그때 주행 구간이 **자기 노드 박스
 * 한가운데를 관통**했다. 엣지는 노드보다 아래층(zIndex 0)이라 화면에서는 선이
 * 박스 반대편 변에서 난데없이 튀어나오는 것처럼 보였다(J1→SP1, SP1→J2 실측).
 *
 * 그래서 출발·도착 노드의 경계 상자를 받아 주행 구간과 스텁을 그 바깥으로 민다.
 * **두 상자만 피한다** — 제3의 노드를 지나는 건 이번 범위 밖이다(그건 레인 배정과
 * 경로 계획을 함께 푸는 문제라 A* 같은 진짜 회피기가 필요하다).
 * 상자는 **선택 입력**이다. 안 넘기면 예전과 완전히 같은 경로가 나온다.
 */
import { Position } from '@xyflow/react';

export type Pt = { x: number; y: number };

/** 피해야 할 사각형 (화면 좌표, 좌상단 기준) */
export type Box = { x: number; y: number; w: number; h: number };

export type RouteInput = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  /** 가로 간선의 y 를 미는 값 */
  laneY?: number;
  /** 세로 간선의 x 를 미는 값 */
  laneX?: number;
  /** 패드에서 수직으로 빠져나오는 거리 */
  stub?: number;
  /** 라벨을 도착 패드에서 경로를 따라 얼마나 뒤로 물릴지 */
  labelBackoff?: number;
  /** 출발 노드 경계 상자 — 없으면 회피를 건너뛴다 */
  sourceBox?: Box;
  /** 도착 노드 경계 상자 — 없으면 회피를 건너뛴다 */
  targetBox?: Box;
  /** 상자에서 띄울 여백 */
  clearance?: number;
};

export type Route = {
  /** SVG path d */
  d: string;
  /** 꺾임점 목록 — 시험과 라벨 배치에 쓴다 */
  points: Pt[];
  /** 스텁 라벨 자리 — 도착 패드 바로 앞 */
  labelX: number;
  labelY: number;
};

/** 패드에서 곧게 빠져나오는 기본 거리 */
export const DEFAULT_STUB = 14;
/** 라벨을 도착 패드에서 물리는 기본 거리 */
export const DEFAULT_LABEL_BACKOFF = 22;
/** 노드 상자에서 띄울 기본 여백 — 선이 테두리에 붙어 보이지 않을 만큼만 */
export const DEFAULT_CLEARANCE = 12;

const EPS = 1e-6;

/** 핸들이 바라보는 바깥 방향 단위벡터 */
const OUTWARD: Record<Position, Pt> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 겹치는 점과 **같은 방향으로** 이어지는 꺾임점을 지운다.
 * 방향이 뒤집히는 점(되돌아가는 자리)은 남겨야 한다 — 지우면 스텁이 통째로 사라져
 * 패드에서 곧게 나온다는 약속이 깨진다.
 */
function simplify(raw: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push(p);
  }
  for (let k = 1; k < out.length - 1; ) {
    const a = out[k - 1];
    const b = out[k];
    const c = out[k + 1];
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    const monotone = sameX
      ? (b.y - a.y) * (c.y - b.y) > 0
      : sameY
        ? (b.x - a.x) * (c.x - b.x) > 0
        : false;
    if (monotone) out.splice(k, 1);
    else k++;
  }
  return out;
}

/** 직교 경로라 구간 길이는 맨해튼 거리와 같다 */
function segLen(a: Pt, b: Pt): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 경로 끝(도착 패드)에서 거리 dist 만큼 되짚어 올라간 점 */
function pointFromEnd(points: Pt[], dist: number): Pt {
  const total = points.reduce((s, p, k) => (k === 0 ? 0 : s + segLen(points[k - 1], p)), 0);
  // 아주 짧은 배선에서 라벨이 출발 쪽으로 넘어가지 않게 절반에서 멈춘다
  let remain = Math.min(dist, total / 2);
  for (let k = points.length - 1; k > 0; k--) {
    const p = points[k];
    const q = points[k - 1];
    const len = segLen(p, q);
    if (len >= remain) {
      const t = len < EPS ? 0 : remain / len;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    remain -= len;
  }
  return points[0];
}

/* ── 노드 상자 비켜가기 ───────────────────────────────────────────────────── */

type Span = { lo: number; hi: number };
const span = (a: number, b: number): Span => (a <= b ? { lo: a, hi: b } : { lo: b, hi: a });

/** 축(가로/세로) 하나를 골라 쓰는 구조 — x 축이면 across=x, along=y */
type Axis = 'x' | 'y';
function ranges(b: Box, c: number, axis: Axis): { across: Span; along: Span } {
  const x = span(b.x - c, b.x + b.w + c);
  const y = span(b.y - c, b.y + b.h + c);
  return axis === 'x' ? { across: x, along: y } : { across: y, along: x };
}

/**
 * 축 정렬 선분이 (여백만큼 부풀린) 상자 **속**을 지나는가.
 * 변에 정확히 닿기만 하는 건 통과로 본다 — 그래야 한 번 밀어낸 결과가
 * 다시 걸리지 않고(멱등) 패드 변에서 시작하는 스텁이 제 노드에 걸리지 않는다.
 */
function crosses(at: number, from: number, to: number, across: Span, along: Span): boolean {
  const s = span(from, to);
  return at > across.lo + EPS && at < across.hi - EPS
    && s.hi > along.lo + EPS && s.lo < along.hi - EPS;
}

/**
 * 스텁에서 뻗어 나온 선분을 상자 밖으로 **더 밀어낸다**.
 * 미는 방향은 핸들 방향(dir) 하나뿐이다 — 반대로 당기면 "핸들 방향으로 stub 만큼
 * 곧게 나온다"는 약속이 깨진다. 스텁이 길어질 뿐이라 모양은 유지된다.
 */
function pushOut(at: number, from: number, to: number, dir: number, boxes: Box[], c: number, axis: Axis): number {
  let v = at;
  // 한 상자를 넘어가다 다른 상자에 걸릴 수 있으니 두 번 훑는다(상자는 최대 둘).
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      const { across, along } = ranges(b, c, axis);
      if (!crosses(v, from, to, across, along)) continue;
      v = dir < 0 ? Math.min(v, across.lo) : Math.max(v, across.hi);
    }
  }
  return v;
}

/**
 * 주행 구간을 상자 밖으로 비킨다. 스텁과 달리 **양쪽 다** 갈 수 있으므로
 * 더 가까운 쪽(위/아래 또는 좌/우)을 고른다.
 *
 * 레인은 그 바깥쪽으로 얹는다 — 여러 가닥이 같은 상자를 돌아 나가도 서로 벌어진다.
 * 다만 부호를 접으므로 ±k 레인은 같은 자리로 겹친다. 레인 배정(docToFlow)은
 * 우회 사정을 모르는 상류 단계라 여기서 더 풀 수 없다. 남은 한계.
 */
function pushAside(at: number, from: number, to: number, lane: number, boxes: Box[], c: number, axis: Axis): number {
  const hit = boxes.filter((b) => {
    const { across, along } = ranges(b, c, axis);
    return crosses(at, from, to, across, along);
  });
  if (!hit.length) return at;
  const lo = Math.min(...hit.map((b) => (axis === 'x' ? b.x : b.y))) - c;
  const hi = Math.max(...hit.map((b) => (axis === 'x' ? b.x + b.w : b.y + b.h))) + c;
  const k = Math.abs(lane);
  return at - lo <= hi - at ? lo - k : hi + k;
}

export function routeOrthogonal(i: RouteInput): Route {
  const stub = i.stub ?? DEFAULT_STUB;
  const laneY = i.laneY ?? 0;
  const laneX = i.laneX ?? 0;
  const ds = OUTWARD[i.sourcePosition] ?? OUTWARD[Position.Right];
  const dt = OUTWARD[i.targetPosition] ?? OUTWARD[Position.Left];

  /** 스텁이 가로인가 — 가로 스텁은 세로 간선을, 세로 스텁은 가로 간선을 옆으로 민다 */
  const hS = ds.y === 0;
  const hT = dt.y === 0;
  const pushS = Math.abs(hS ? laneX : laneY);
  const pushT = Math.abs(hT ? laneX : laneY);

  const S: Pt = { x: i.sourceX, y: i.sourceY };
  const T: Pt = { x: i.targetX, y: i.targetY };
  const A: Pt = { x: S.x + ds.x * (stub + pushS), y: S.y + ds.y * (stub + pushS) };
  const B: Pt = { x: T.x + dt.x * (stub + pushT), y: T.y + dt.y * (stub + pushT) };

  // 피할 상자 — 둘 다 없으면(정보 부족) 예전 경로 그대로다.
  const boxes: Box[] = [];
  if (i.sourceBox) boxes.push(i.sourceBox);
  if (i.targetBox) boxes.push(i.targetBox);
  const cl = i.clearance ?? DEFAULT_CLEARANCE;
  // 주행 구간과 스텁은 서로 물린다: 주행 구간을 밀면 스텁(세로 간선)이 길어지고,
  // 스텁을 밀면 주행 구간의 가로 범위가 넓어져 다른 상자에 새로 걸릴 수 있다.
  // 상자가 둘뿐이라 두 번 맞추면 실질적으로 수렴한다(완전 수렴 보장은 범위 밖).
  const passes = boxes.length ? 2 : 0;

  let raw: Pt[];
  if (hS && hT) {
    // 가로-가로: 가운데에 가로 주행 구간을 깔고 양쪽에서 세로로 붙는다.
    const baseY = (A.y + B.y) / 2 + laneY;
    let ax = A.x, bx = B.x, my = baseY;
    for (let p = 0; p < passes; p++) {
      my = pushAside(baseY, Math.min(ax, bx), Math.max(ax, bx), laneY, boxes, cl, 'y');
      ax = pushOut(A.x, S.y, my, ds.x, boxes, cl, 'x');
      bx = pushOut(B.x, T.y, my, dt.x, boxes, cl, 'x');
    }
    raw = [S, { x: ax, y: S.y }, { x: ax, y: my }, { x: bx, y: my }, { x: bx, y: T.y }, T];
  } else if (!hS && !hT) {
    // 세로-세로: 가운데 세로 주행 구간.
    const baseX = (A.x + B.x) / 2 + laneX;
    let ay = A.y, by = B.y, mx = baseX;
    for (let p = 0; p < passes; p++) {
      mx = pushAside(baseX, Math.min(ay, by), Math.max(ay, by), laneX, boxes, cl, 'x');
      ay = pushOut(A.y, S.x, mx, ds.y, boxes, cl, 'y');
      by = pushOut(B.y, T.x, mx, dt.y, boxes, cl, 'y');
    }
    raw = [S, { x: S.x, y: ay }, { x: mx, y: ay }, { x: mx, y: by }, { x: T.x, y: by }, T];
  } else if (hS) {
    // 가로 → 세로: ㄱ자 한 번. 세로 간선 x 는 A.x(=laneX), 가로 간선 y 는 B.y(=laneY).
    // 여기서 움직일 수 있는 건 두 스텁 길이뿐이라 밀어내기도 그 둘로만 한다.
    let ax = A.x, by = B.y;
    for (let p = 0; p < passes; p++) {
      ax = pushOut(A.x, S.y, by, ds.x, boxes, cl, 'x');
      by = pushOut(B.y, T.x, ax, dt.y, boxes, cl, 'y');
    }
    raw = [S, { x: ax, y: S.y }, { x: ax, y: by }, { x: T.x, y: by }, T];
  } else {
    // 세로 → 가로: 반대 방향 ㄱ자.
    let ay = A.y, bx = B.x;
    for (let p = 0; p < passes; p++) {
      ay = pushOut(A.y, S.x, bx, ds.y, boxes, cl, 'y');
      bx = pushOut(B.x, T.y, ay, dt.x, boxes, cl, 'x');
    }
    raw = [S, { x: S.x, y: ay }, { x: bx, y: ay }, { x: bx, y: T.y }, T];
  }

  const points = simplify(raw);
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
  const label = pointFromEnd(points, i.labelBackoff ?? DEFAULT_LABEL_BACKOFF);
  return { d, points, labelX: round(label.x), labelY: round(label.y) };
}
