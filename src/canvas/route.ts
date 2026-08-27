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
 * ── 노드 상자 비켜가기 (sourceBox / targetBox / obstacles)
 * 핸들 방향이 목적지 반대면(예: o=0 커넥터에서 오른쪽으로 가는 배선) 경로가
 * 패드 밖으로 나왔다가 되돌아 들어와야 한다. 그때 주행 구간이 **자기 노드 박스
 * 한가운데를 관통**했다. 엣지는 노드보다 아래층(zIndex 0)이라 화면에서는 선이
 * 박스 반대편 변에서 난데없이 튀어나오는 것처럼 보였다(J1→SP1, SP1→J2 실측).
 *
 * 그래서 출발·도착 노드의 경계 상자를 받아 주행 구간과 스텁을 그 바깥으로 민다.
 *
 * ── 제3의 노드도 피한다 (obstacles) — 왜 A* 를 안 썼나
 * 예전에는 **자기 두 상자만** 피했다. 커넥터를 한 줄로 늘어놓고(하네스 도면에서
 * 가장 흔한 배치) 양 끝을 이으면 주행 구간이 가운데 커넥터들을 통째로 관통했다.
 * 실측: 커넥터 5개(x = 0/260/520/780/1040) · 배선 8본에서 **3본이 가운데 셋을
 * 관통**(w2·w3·w4 → cB·cC·cD). 하우징은 흰색으로 채워지므로 화면·PDF 모두에서
 * 선이 그 구간만 사라진다.
 *
 * 고친 방법은 회피기를 새로 만드는 게 아니라 **이미 있던 두 손잡이의 대상을
 * 넓힌 것**이다: `pushAside`(주행 구간을 상자 밖으로) · `pushOut`(스텁 연장)이
 * 자기 두 상자에 하던 일을 **막고 있는 모든 상자**에 한다. 일반 경로 탐색기(A*)는
 * 이 문제에 과할 뿐 아니라, 지금 코드가 지키는 성질(직교 · 스텁 불변 · 레인 분리 ·
 * 결정론)을 전부 다시 증명해야 한다. 여기서 필요한 건 "가로 띠 하나를 어디에
 * 놓을까" 뿐이고 그건 1차원 문제다.
 *
 * 끝 상자(sourceBox/targetBox)와 장애물을 **같은 목록**으로 다룬다. 끝 상자는
 * 핸들이 변 위에 붙어 있다는 점만 다른데, `crosses` 가 변에 닿기만 하는 것을
 * 통과로 보므로(스텁 첫 점이 제 상자에 걸리지 않게) 취급을 나눌 필요가 없다.
 *
 * 상자는 전부 **선택 입력**이다. 안 넘기면 예전과 완전히 같은 경로가 나온다.
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
  /**
   * 제3의 노드 상자들 — 없거나 비면 회피를 건너뛴다(예전 경로 그대로).
   * 문서의 모든 노드를 그대로 넘겨도 된다: 자기 두 끝이 여기 또 들어와도 같은
   * 사각형이라 결과가 바뀌지 않는다. 배선마다 목록을 다시 만들지 말고
   * 문서당 한 번 만든 **같은 배열**을 나눠 쓴다(docToFlow.nodeBoxes).
   */
  obstacles?: Box[];
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
/**
 * 주행 구간 ↔ 스텁 맞물림을 푸는 되풀이 **상한**.
 * 대부분 두 바퀴에서 값이 같아져 그 자리에서 멈춘다(settle). 상한은 서로 물고
 * 도는 병적인 배치에서 계산이 끝난다는 것만 보장한다 — 결정론을 위해 상수다.
 */
export const MAX_AVOID_PASSES = 4;

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

/**
 * 선분 길이.
 *
 * 예전에는 맨해튼 거리(|dx|+|dy|)였다 — 선분이 전부 수평 아니면 수직이던 시절에는
 * 같은 값이라 그래도 됐다. 45° 사선이 들어오면 갈린다: 사선의 맨해튼 길이는
 * 실제 길이의 √2 배라, 라벨을 "22px 되짚은 자리"에 놓는 계산이 사선 구간에서만
 * 1.4배 짧게 잡힌다. 직교 경로에서는 두 값이 정확히 같으므로 **기존 좌표는
 * 하나도 바뀌지 않는다**(시험이 못박고 있다).
 *
 * `stubLabel.backFrom` 도 같은 이유로 같은 식을 쓴다 — 두 곳이 다른 자를 쓰면
 * 겹침을 푼 자리와 실제로 찍히는 자리가 갈라진다.
 */
export function segLen(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
 *
 * 한 상자를 넘어가다 다른 상자에 걸릴 수 있어 되풀이한다. **끝난다는 근거**:
 * v 는 dir 한 방향으로만 움직이므로 한 번 넘어간 상자는 다시 걸리지 않는다.
 * 따라서 한 바퀴마다 상자를 최소 하나씩 영구히 털어 낸다 → 상자 수만큼이면 끝.
 */
function pushOut(at: number, from: number, to: number, dir: number, boxes: Box[], c: number, axis: Axis): number {
  let v = at;
  for (let pass = 0; pass <= boxes.length; pass++) {
    let moved = false;
    for (const b of boxes) {
      const { across, along } = ranges(b, c, axis);
      if (!crosses(v, from, to, across, along)) continue;
      v = dir < 0 ? Math.min(v, across.lo) : Math.max(v, across.hi);
      moved = true;
    }
    if (!moved) break;
  }
  return v;
}

/**
 * 주행 구간을 상자 밖으로 비킨다. 스텁과 달리 **양쪽 다** 갈 수 있으므로
 * 더 가까운 쪽(위/아래 또는 좌/우)을 고른다. 여러 상자가 걸리면 **합집합** 기준으로
 * 한 번에 넘긴다 — 상자 사이 틈으로 비집고 들어가면 다음 상자에 또 걸린다.
 *
 * 넘어간 자리에서 **다른** 상자에 새로 걸릴 수 있으므로 되풀이한다. 그때 방향은
 * 처음 고른 것을 **끝까지 유지한다**. 매번 가까운 쪽을 다시 고르면 두 무리 사이를
 * 오락가락하다 상한에 걸린다. 한 방향으로만 가면 이미 넘은 상자는 다시 걸리지
 * 않으므로(v 가 그 상자의 바깥 변을 지나 단조로 멀어진다) 상자 수만큼이면 끝난다.
 *
 * 레인은 그 바깥쪽으로 얹는다 — 여러 가닥이 같은 상자를 돌아 나가도 서로 벌어진다.
 * **부호는 접는다**(|lane|): 안쪽으로 되돌아가면 방금 넘은 상자를 다시 관통한다.
 * 그래서 레인 값은 접어도 크기가 겹치지 않아야 한다 — 그 성질은 값을 만드는
 * 쪽(docToFlow.laneOffset)이 지킨다. 예전 완전 대칭(±k·step)에서는 ±k 두 가닥이
 * 우회 구간에서 한 자리에 포개졌다.
 */
function pushAside(at: number, from: number, to: number, lane: number, boxes: Box[], c: number, axis: Axis): number {
  const k = Math.abs(lane);
  let v = at;
  let dir = 0;                                  // 0=아직 안 정함 · -1=낮은 쪽 · +1=높은 쪽
  for (let pass = 0; pass <= boxes.length; pass++) {
    const hit = boxes.filter((b) => {
      const { across, along } = ranges(b, c, axis);
      return crosses(v, from, to, across, along);
    });
    if (!hit.length) break;
    const lo = Math.min(...hit.map((b) => (axis === 'x' ? b.x : b.y))) - c;
    const hi = Math.max(...hit.map((b) => (axis === 'x' ? b.x + b.w : b.y + b.h))) + c;
    if (dir === 0) dir = v - lo <= hi - v ? -1 : 1;
    v = dir < 0 ? lo - k : hi + k;
  }
  return v;
}

/**
 * 값이 더 움직이지 않을 때까지 되풀이하되 **상한에서 멈춘다**.
 *
 * 주행 구간과 스텁은 서로 물린다: 주행 구간을 밀면 스텁(세로 간선)이 길어지고,
 * 스텁을 밀면 주행 구간의 진행 범위가 넓어져 다른 상자에 새로 걸린다. 그래서
 * 한 번으로는 안 끝난다. 되풀이는 **값이 같아지면 즉시** 멈추므로(대부분 두 바퀴)
 * 상한은 병적인 배치에서만 쓰인다. 상한에 걸리면 남은 관통은 그대로 그린다 —
 * 선이 아예 사라지는 것보다 낫고, 그 사실은 검증 규칙 `wire-crosses-part` 가
 * **최종 경로를 직접 다시 재서** 알린다(라우터의 자기 신고를 믿지 않는다).
 */
function settle(step: () => number[], max: number): void {
  let prev: number[] = [];
  for (let p = 0; p < max; p++) {
    const now = step();
    if (prev.length === now.length && prev.every((v, k) => Math.abs(v - now[k]) < EPS)) return;
    prev = now;
  }
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

  // 피할 상자 — 하나도 없으면(정보 부족) 예전 경로 그대로다.
  // 끝 상자와 제3의 노드를 한 목록에 담는다(머리말 참고). 자기 두 끝이 obstacles
  // 에 또 들어와도 같은 사각형이라 결과가 달라지지 않는다.
  const boxes: Box[] = [];
  if (i.sourceBox) boxes.push(i.sourceBox);
  if (i.targetBox) boxes.push(i.targetBox);
  if (i.obstacles?.length) boxes.push(...i.obstacles);
  const cl = i.clearance ?? DEFAULT_CLEARANCE;
  const passes = boxes.length ? MAX_AVOID_PASSES : 0;

  let raw: Pt[];
  if (hS && hT) {
    // 가로-가로: 가운데에 가로 주행 구간을 깔고 양쪽에서 세로로 붙는다.
    const baseY = (A.y + B.y) / 2 + laneY;
    let ax = A.x, bx = B.x, my = baseY;
    settle(() => {
      my = pushAside(baseY, Math.min(ax, bx), Math.max(ax, bx), laneY, boxes, cl, 'y');
      ax = pushOut(A.x, S.y, my, ds.x, boxes, cl, 'x');
      bx = pushOut(B.x, T.y, my, dt.x, boxes, cl, 'x');
      return [my, ax, bx];
    }, passes);
    raw = [S, { x: ax, y: S.y }, { x: ax, y: my }, { x: bx, y: my }, { x: bx, y: T.y }, T];
  } else if (!hS && !hT) {
    // 세로-세로: 가운데 세로 주행 구간.
    const baseX = (A.x + B.x) / 2 + laneX;
    let ay = A.y, by = B.y, mx = baseX;
    settle(() => {
      mx = pushAside(baseX, Math.min(ay, by), Math.max(ay, by), laneX, boxes, cl, 'x');
      ay = pushOut(A.y, S.x, mx, ds.y, boxes, cl, 'y');
      by = pushOut(B.y, T.x, mx, dt.y, boxes, cl, 'y');
      return [mx, ay, by];
    }, passes);
    raw = [S, { x: S.x, y: ay }, { x: mx, y: ay }, { x: mx, y: by }, { x: T.x, y: by }, T];
  } else if (hS) {
    // 가로 → 세로: ㄱ자 한 번. 세로 간선 x 는 A.x(=laneX), 가로 간선 y 는 B.y(=laneY).
    // 여기서 움직일 수 있는 건 두 스텁 길이뿐이라 밀어내기도 그 둘로만 한다.
    let ax = A.x, by = B.y;
    settle(() => {
      ax = pushOut(A.x, S.y, by, ds.x, boxes, cl, 'x');
      by = pushOut(B.y, T.x, ax, dt.y, boxes, cl, 'y');
      return [ax, by];
    }, passes);
    raw = [S, { x: ax, y: S.y }, { x: ax, y: by }, { x: T.x, y: by }, T];
  } else {
    // 세로 → 가로: 반대 방향 ㄱ자.
    let ay = A.y, bx = B.x;
    settle(() => {
      ay = pushOut(A.y, S.x, bx, ds.y, boxes, cl, 'y');
      bx = pushOut(B.x, T.y, ay, dt.x, boxes, cl, 'x');
      return [ay, bx];
    }, passes);
    raw = [S, { x: S.x, y: ay }, { x: bx, y: ay }, { x: bx, y: T.y }, T];
  }

  return finish(raw, i.labelBackoff);
}

/** 꺾임점 → Route. 두 라우터가 **같은 자를 쓰도록** 마무리를 한 곳에 둔다. */
function finish(raw: Pt[], labelBackoff?: number): Route {
  const points = simplify(raw);
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`).join(' ');
  const label = pointFromEnd(points, labelBackoff ?? DEFAULT_LABEL_BACKOFF);
  return { d, points, labelX: round(label.x), labelY: round(label.y) };
}

/* ── 45° 사선 라우터 ──────────────────────────────────────────────────────
 *
 * ── 왜 필요한가 (개선안 §2-1)
 * 직교 라우터는 세로 꺾임을 **가로 주행 구간의 x 한 자리**에 모은다. 핀맵이 뒤섞인
 * 배선(5P → 10P 역순 매핑)에서는 그 한 자리에 세로 선분 n개가 나란히 서고, 어느
 * 가닥이 어느 핀으로 가는지 눈으로 못 따라간다. 레인(laneX)이 그 선분들을 벌려
 * 주기는 하지만 벌린 만큼 **꺾임점이 같은 x 대역에 몰리는 것**은 그대로다.
 *
 * 45° 사선은 그 문제를 다르게 푼다. 가닥마다 사선 구간의 **중심 x** 를 어긋나게
 * 두면 꺾임점 2n개가 x 축을 따라 고르게 흩어지고, 사선의 기울기가 언제나 같으므로
 * (정확히 45°) 눈이 한 가닥을 끝까지 따라갈 수 있다. 이것이 손으로 그린 하네스
 * 도면의 오래된 관행이기도 하다.
 *
 * ── 각도는 왜 "정확히 45°" 인가
 * 임의 각을 쓰면 가닥마다 기울기가 달라 사선끼리 어디서 만날지 눈이 예측하지
 * 못한다. 기울기를 하나로 못박으면 사선들이 서로 **평행 아니면 직각**이라
 * 교차점이 규칙적으로 보인다. 그래서 `half = |dy|/2` 로 x 진행량을 dy 에
 * 묶는다 — 이 식이 곧 45° 다.
 *
 * ── 기존 직교 라우터는 지운 게 아니라 **밑에 남는다**
 * 스플라이스 합류처럼 사선이 어색한 자리, 사선을 담을 폭이 없는 자리, 상자를
 * 비켜 가야 하는 자리는 전부 `routeOrthogonal` 로 되돌아간다(개선안이 "존치"
 * 라고 못박았다). 그래서 이 함수는 **못 그리면 `null` 을 돌려준다** — 무엇을
 * 대신 그릴지는 부르는 쪽(`routeAuto`)이 정한다.
 */

/** 사선 구간 양옆에 두는 최소 여유(px) — 레퍼런스 `render.py::route45` 의 4 */
export const DIAG_MARGIN = 4;

/**
 * 이보다 작은 |dy| 는 꺾을 것이 없다 — 곧은 한 줄로 잇는다.
 * **1:1 스트레이트 매핑이 여기 걸린다**(마주 보는 핀은 dy = 0).
 */
export const DIAG_FLAT = 0.6;

export type DiagonalInput = RouteInput & {
  /** 사선 구간의 중심 x. 없으면 두 스텁 끝의 중점 */
  center?: number;
};

/** 점이 상자 안(변 포함)에 있는가 */
function holds(b: Box, p: Pt): boolean {
  return p.x >= b.x - EPS && p.x <= b.x + b.w + EPS
    && p.y >= b.y - EPS && p.y <= b.y + b.h + EPS;
}

/**
 * 선분이 (여백만큼 부풀린) 상자 **속**을 지나는가 — 변에 닿기만 하는 것은 통과.
 *
 * 직교 전용이던 `crosses` 를 못 쓰는 이유: 사선은 축에 정렬돼 있지 않다.
 * 그래서 축별 구간 자르기(Liang–Barsky slab)로 일반 선분을 받는다.
 * 판정 기준(변에 닿는 것은 통과)은 `crosses` 와 **같게** 맞췄다 — 스텁 첫 점이
 * 제 패드가 붙은 상자 변 위에 있기 때문이다.
 */
export function segmentHitsBox(p: Pt, q: Pt, b: Box, clearance: number): boolean {
  const lo = { x: b.x - clearance, y: b.y - clearance };
  const hi = { x: b.x + b.w + clearance, y: b.y + b.h + clearance };
  let t0 = 0;
  let t1 = 1;
  for (const k of ['x', 'y'] as const) {
    const d = q[k] - p[k];
    if (Math.abs(d) < EPS) {
      // 이 축으로 움직이지 않는다 — 그 좌표가 띠 밖(또는 변 위)이면 통과
      if (p[k] <= lo[k] + EPS || p[k] >= hi[k] - EPS) return false;
      continue;
    }
    const a = (lo[k] - p[k]) / d;
    const c = (hi[k] - p[k]) / d;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
    if (t1 - t0 <= EPS) return false;
  }
  return t1 - t0 > EPS;
}

/**
 * 수평 → 정확히 45° 사선 → 수평. 담을 수 없으면 `null`.
 *
 * ── 못 그리는 자리 (전부 직교로 되돌아간다)
 *  (1) **마주 보는 가로 핸들이 아니다.** 스텁이 목적지 반대로 나가면 되돌아오는
 *      길이 필요하고, 그 길을 상자 밖으로 미는 것은 직교 라우터의 일이다
 *      (`pushOut`·`pushAside`). 사선에는 밀어낼 손잡이가 없다.
 *  (2) **스텁끼리 이미 지나쳤다**(B.x ≤ A.x). 사선을 놓을 x 가 없다.
 *  (3) **폭 부족**(lo > hi). |dy| 가 클수록 사선이 x 를 많이 먹는다 —
 *      레퍼런스와 같은 조건이다.
 *  (4) **상자 관통.** 사선이 하우징을 지나면 지금(직교)보다 나쁘다. 하우징은
 *      흰색으로 채워지므로 그 구간에서 선이 통째로 사라진다. 사선은 한 방향으로
 *      비켜 밀 수 없으므로(밀면 45° 가 깨진다) 그 조합은 통째로 포기한다.
 *
 * ── laneY·laneX 를 쓰지 않는다
 * 두 레인은 "가로 주행 구간의 y" 와 "세로 간선의 x" 를 미는 값인데, 사선 경로에는
 * 그런 선분이 아예 없다. 가닥을 벌리는 일은 여기서 **중심 x**(center)가 한다.
 * 그래서 사람이 레인을 손으로 지정한 배선은 사선을 쓰지 않는다 — 그 판단은
 * 값을 만드는 쪽(`docToFlow.assignDiagCenters`)이 내린다.
 */
export function routeDiagonal(i: DiagonalInput): Route | null {
  const stub = i.stub ?? DEFAULT_STUB;
  const ds = OUTWARD[i.sourcePosition] ?? OUTWARD[Position.Right];
  const dt = OUTWARD[i.targetPosition] ?? OUTWARD[Position.Left];
  if (!(ds.x > 0 && dt.x < 0)) return null;                    // (1)

  const S: Pt = { x: i.sourceX, y: i.sourceY };
  const T: Pt = { x: i.targetX, y: i.targetY };
  // 스텁 14 는 그대로다 — 패드에서 곧게 나온 뒤에 꺾인다(개선안 §1).
  const A: Pt = { x: S.x + stub, y: S.y };
  const B: Pt = { x: T.x - stub, y: T.y };
  if (B.x - A.x <= EPS) return null;                           // (2)

  const dy = B.y - A.y;
  let raw: Pt[];
  if (Math.abs(dy) < DIAG_FLAT) {
    raw = [S, T];                                              // 1:1 스트레이트
  } else {
    const half = Math.abs(dy) / 2;                             // ← 이 식이 45° 다
    const lo = A.x + DIAG_MARGIN + half;
    const hi = B.x - DIAG_MARGIN - half;
    if (lo > hi) return null;                                  // (3)
    const c = Math.min(Math.max(i.center ?? (A.x + B.x) / 2, lo), hi);
    raw = [S, { x: c - half, y: S.y }, { x: c + half, y: T.y }, T];
  }

  // (4) 상자 회피 — 양 끝 패드가 붙은 상자는 뺀다. 패드가 그 변 **위**에 있어
  //     여백(clearance)을 재면 언제나 걸린다. 경로는 두 패드 사이에서만 x 가
  //     늘어나므로(단조) 제 끝 상자를 관통할 일도 없다.
  const boxes: Box[] = [];
  if (i.sourceBox) boxes.push(i.sourceBox);
  if (i.targetBox) boxes.push(i.targetBox);
  if (i.obstacles?.length) boxes.push(...i.obstacles);
  const cl = i.clearance ?? DEFAULT_CLEARANCE;
  const walls = boxes.filter((b) => !holds(b, S) && !holds(b, T));
  for (let k = 1; k < raw.length; k++) {
    if (walls.some((b) => segmentHitsBox(raw[k - 1], raw[k], b, cl))) return null;
  }

  return finish(raw, i.labelBackoff);
}

/**
 * 사선을 **쓸 수 있으면 쓰고 아니면 직교로** 그린다.
 *
 * 두 라우터 중 무엇을 쓸지는 **여기 한 곳에서만** 갈린다. 화면(OrthogonalEdge →
 * wirePlan.routeWire)도 PDF(pdfDraw → wirePlan.planWires)도 스텁 라벨 배치
 * (docToFlow.docToEdges)도 전부 이 함수를 지난다. 갈림길이 두 곳이면 그 둘이
 * 언젠가 다르게 갈리고, 그때 화면과 종이가 갈라진다 — 이 레포가 두 번 낸 사고다.
 *
 * `center` 가 없으면 사선을 아예 시도하지 않는다. 그래서 **상자·레인만 넘기던
 * 예전 호출부는 글자 하나까지 같은 경로를 받는다**(속성 패널의 꺾임 미리보기가
 * 그렇게 부른다).
 */
export function routeAuto(i: DiagonalInput): Route {
  return (i.center != null ? routeDiagonal(i) : null) ?? routeOrthogonal(i);
}
