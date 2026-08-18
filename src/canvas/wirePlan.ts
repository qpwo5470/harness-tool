/**
 * 배선 기하의 **단일 출처** — 같은 문서면 화면과 PDF 가 같은 경로를 받는다.
 *
 * ── 왜 이 파일이 생겼나 (실측)
 * 화면은 route.ts 의 직교 라우터(레인 두 축 + 끝 노드 박스 회피)로 옮겼는데
 * PDF(pdfDraw.ts)는 제 경로 계산을 그대로 들고 있었다. 그래서 **같은 하네스에서
 * 두 그림이 갈렸다**:
 *   · 화면 — J1(o=0, 핸들이 왼쪽 변) → SP1 배선이 J1 박스 아래로 돌아 간다
 *   · PDF  — 같은 배선이 J1 박스를 관통한다. 하우징을 흰색으로 채우므로 선이
 *            덮여 사라지고, 박스 오른쪽 변에서 난데없이 튀어나온 것처럼 보인다
 * 게다가 pdfDraw 는 엣지 data 의 `lane` 을 읽고 있었는데 그 필드는 이미 `laneY`·
 * `laneX` 두 축으로 갈린 뒤였다. 즉 **PDF 의 레인 분리는 통째로 0 이었다**
 * (`data.lane ?? 0` 이 언제나 0). 20본 도면이면 스무 가닥이 한 줄에 포개진다.
 *
 * 도면은 공장에 나가는 산출물이다. 그림이 둘이면 어느 쪽이 맞는지 아무도 모른다.
 * 그래서 "문서 → 배선 경로" 를 여기 한 곳에만 둔다. 화면(OrthogonalEdge)도
 * PDF(pdfDraw)도 이 함수만 부른다. **좌표계 변환(px → pt, 스케일·평행이동)은
 * PDF 쪽에서만** 한다 — 기하는 여기서 끝난다.
 *
 * React·DOM 을 쓰지 않는다(그래야 PDF 쪽에서도 부를 수 있다).
 */
import type { Position } from '@xyflow/react';
import type { HarnessDocument, Id, ViewMode } from '../types';
import { assignLanes, LANE_Y_STEP } from './docToFlow';
import { PITCH } from './geometry';
import { routeOrthogonal, DEFAULT_STUB, type Box, type Pt, type Route } from './route';

/**
 * 엣지 양 끝 좌표.
 * 화면은 React Flow 가 **DOM 실측**으로 주고, PDF 는 geometry.ts 가 계산해서 준다.
 * 두 출처는 몇 px 어긋날 수 있다(REF_BLOCK_H 가 CSS 실측 근사값이라서).
 * 그래서 좌표만 밖에서 받고, 그 좌표로 무엇을 그리는지는 아래 한 함수가 정한다.
 */
export type EdgeEnds = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
};

/**
 * 배선 한 가닥의 레인·회피 정보.
 * `docToEdges` 가 엣지 data 에 싣는 필드와 **같은 모양**이라 그대로 넘길 수 있다.
 */
export type WireGeometry = {
  /** 가로 주행 구간의 y 오프셋 */
  laneY?: number;
  /** 세로 간선의 x 오프셋 */
  laneX?: number;
  /** 출발 노드 경계 상자 — 없으면 회피를 건너뛴다 */
  sourceBox?: Box;
  /** 도착 노드 경계 상자 */
  targetBox?: Box;
  /**
   * 제3의 노드 상자들 — 한 줄로 늘어선 커넥터 사이를 지나는 배선이 가운데
   * 하우징을 관통하지 않게 한다. 배선 전체가 **같은 배열**을 나눠 쓴다.
   */
  obstacles?: Box[];
};

/**
 * 배선 한 가닥의 경로. **화면과 PDF 가 둘 다 이 함수만 부른다.**
 *
 * 여기서 stub 기본값을 못박는 이유: 예전에 pdfDraw 가 `STUB_OUT = 14` 를 따로
 * 적어 두고 있었다. 상수를 베끼면 한쪽만 고쳐지고 두 그림이 조용히 갈라진다.
 */
export function routeWire(ends: EdgeEnds, g: WireGeometry = {}): Route {
  return routeOrthogonal({
    ...ends,
    laneY: g.laneY ?? 0,
    laneX: g.laneX ?? 0,
    stub: DEFAULT_STUB,
    sourceBox: g.sourceBox,
    targetBox: g.targetBox,
    obstacles: g.obstacles,
  });
}

/** 배선 한 가닥의 계획 — 꺾임점 · SVG path · 스텁 라벨 자리 */
export type PlannedWire = {
  /** 와이어 id */
  id: string;
  /** SVG path d (화면 좌표계) */
  d: string;
  /** 꺾임점 목록 (화면 좌표계) */
  points: Pt[];
  /** 스텁 라벨 중심 x */
  labelX: number;
  /** 스텁 라벨 중심 y */
  labelY: number;
};

/**
 * 문서 → 배선별 경로. 순서는 `doc.wires` 그대로다.
 *
 * 끝점 좌표·레인·노드 박스는 전부 `assignLanes`(docToFlow) 한 곳에서 나온다.
 * PDF 는 여기서 나온 점들에 **등비 변환만** 걸어 그린다.
 */
export function planWires(doc: HarnessDocument, view: ViewMode = 'logical'): PlannedWire[] {
  const lanes = assignLanes(doc, view);
  return doc.wires.map((w, i) => {
    const r = routeWire(
      {
        sourceX: lanes.from[i].x,
        sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x,
        targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side,
        targetPosition: lanes.to[i].side,
      },
      {
        laneY: lanes.laneY[i],
        laneX: lanes.laneX[i],
        sourceBox: lanes.fromBox[i],
        targetBox: lanes.toBox[i],
        obstacles: lanes.obstacles,
      },
    );
    return { id: w.id, d: r.d, points: r.points, labelX: r.labelX, labelY: r.labelY };
  });
}

// ============================================================
// 자켓(케이블 외피) 계획
// ============================================================

/**
 * ── 왜 자켓을 여기서 계산하나
 * 배선 경로와 **같은 이유**다. 자켓은 심선 경로에서 유도되므로, 화면과 PDF 가
 * 각자 계산하면 두 그림이 갈린다(경로에서 이미 두 번 난 사고다 — 파일 머리말).
 * 그래서 자켓도 이 파일 한 곳에서만 만들고, 화면(JacketLayer)도 PDF(pdfDraw)도
 * `planJackets` 만 부른다. 좌표계 변환은 여전히 PDF 쪽에서만 한다.
 *
 * ── 왜 "감싸는 사각형 윤곽" 인가 (표현 근거)
 * 케이블은 여러 심선이 **한 자켓 안에 들어 있는 물건**이다. 도면에서 그 사실을
 * 나타내는 제도 관행은 심선 다발을 슬리브(외피) 윤곽으로 감싸는 것이다.
 * 이 도구의 도면 규칙(직교·각진 모서리)에 그대로 얹히고, 윤곽이라 안쪽 심선의
 * 색·굵기·약호를 하나도 가리지 않는다. 굵은 띠로 덧칠하면 자켓색이 전선색을
 * 덮어 어느 심선이 무슨 색인지 못 읽는다 — 도면이 잃는 정보가 더 크다.
 *
 * ── 자켓을 그리는 구간 = **심선 2본 이상이 나란히 가는 구간**
 * 자켓이 있다는 말은 그 구간에서 심선들이 함께 간다는 뜻이다. 한 본만 지나는
 * 구간은 이미 갈라진 뒤이므로 윤곽을 그리지 않는다. 그래서 자켓 사각형이 끝나는
 * 자리가 곧 **브레이크아웃**이고, 그 바깥에서 심선은 맨선으로 각자 끝으로 간다.
 * 이 규칙 하나로 "나란히 가는 구간 / 갈라지는 구간" 이 그림에서 갈린다.
 */

/** 심선 바깥으로 자켓 벽을 띄우는 거리(px) */
export const JACKET_PAD = 7;

/** 이보다 짧은 토막은 그리지 않는다 — 실오라기 같은 사각형은 읽히지 않는다 */
export const JACKET_MIN_RUN = 10;

/**
 * 이웃한 두 심선이 **나란하다**고 볼 수 있는 최대 간격(px).
 *
 * 값의 근거: 한 자켓 안의 심선들은 커넥터에서 이웃한 핀으로 들어가므로 도면에서
 * 벌어지는 몫은 **핀 한 칸**(PITCH) 이고, 거기에 라우터가 겹치지 않게 벌려 놓는
 * **레인 두 칸**(LANE_Y_STEP × 2)이 더해진다. 그보다 더 벌어져 있으면 두 가닥
 * 사이에 다른 배선이 들어갈 자리가 있다는 뜻이고, 그건 한 다발이 아니라 각자 다른
 * 길을 가다 같은 대역을 지나는 것이다 — 그런 둘을 한 사각형으로 묶으면 도면이
 * "이 둘은 같은 외피 안에 있다" 는 거짓말을 한다.
 */
export const JACKET_MAX_GAP = PITCH + LANE_Y_STEP * 2;

const EPS = 1e-6;

/** 자켓 한 토막 — 심선 2본 이상이 나란히 가는 구간을 감싸는 직교 사각형 */
export type JacketRun = {
  /** 진행 축 — 'h' 가로 주행, 'v' 세로 주행 */
  axis: 'h' | 'v';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 이 토막을 함께 지나는 심선 id (문서 순서) */
  wireIds: Id[];
};

export type PlannedJacket = {
  cableId: Id;
  /** 문서에 적힌 자켓색 원문. **미지정이면 undefined — 색을 지어내지 않는다** */
  jacketColor?: string;
  /** 이 케이블의 심선 id (문서 순서) */
  coreIds: Id[];
  /** 자켓 토막들. 비어 있으면 그릴 자켓이 없다(심선 0~1본이거나 함께 가는 구간이 없다) */
  runs: JacketRun[];
  /** 도면에 적는 이름 — 윤곽만으로는 **어느** 케이블인지 알 수 없다 */
  label: string;
  /** 이름표 기준점(글자 왼쪽 아래). 자켓 토막이 없으면 null */
  labelAt: Pt | null;
};

const segLen = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 경로 양 끝에서 `trim` 만큼 잘라 낸 부분 경로.
 * 남는 길이가 없으면 빈 배열 — 그 심선은 자켓 후보에서 통째로 빠진다.
 */
export function trimPath(points: Pt[], trim: number): Pt[] {
  const total = points.reduce((s, p, k) => (k === 0 ? 0 : s + segLen(points[k - 1], p)), 0);
  const from = trim;
  const to = total - trim;
  if (to - from <= EPS) return [];

  const out: Pt[] = [];
  let acc = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    const len = segLen(a, b);
    const s = acc;
    const e = acc + len;
    acc = e;
    if (e <= from + EPS || s >= to - EPS) continue;
    const at = (t: number): Pt =>
      len < EPS ? a : { x: a.x + ((b.x - a.x) * (t - s)) / len, y: a.y + ((b.y - a.y) * (t - s)) / len };
    const p = at(Math.max(from, s));
    const q = at(Math.min(to, e));
    if (!out.length) out.push(p);
    out.push(q);
  }
  return out;
}

/**
 * 자켓이 덮을 수 있는 부분 경로 — **스텁을 뺀 나머지**.
 *
 * 스텁(패드에서 핸들 방향으로 곧게 나오는 구간)은 심선이 이미 제 핀으로 갈라진
 * 뒤다. 실제 케이블도 끝에서 자켓을 벗겨 심선을 각 단자에 압착한다. 스텁을 두면
 * 커넥터 면에서 핀 피치만큼 벌어진 심선들까지 한 사각형이 감싸, 도면이 "이 핀들이
 * 한 외피 안에 있다" 는 거짓말을 한다.
 *
 * 꺾임점이 4개 이상(=선분 3개 이상)이면 첫·끝 **선분**을 통째로 뺀다 —
 * 라우터가 언제나 그 둘을 스텁으로 놓기 때문이다(route.ts). 선분이 둘 이하인
 * 짧은 경로(두 패드가 마주 보아 곧게 이어진 경우)는 뺄 스텁이 따로 없으므로
 * 양 끝에서 스텁 길이만큼 잘라 낸다 — 어느 쪽이든 자켓은 패드에 닿지 않는다.
 */
export function jacketPath(points: Pt[]): Pt[] {
  return points.length >= 4 ? points.slice(1, -1) : trimPath(points, DEFAULT_STUB);
}

/** 한 배선이 한 축 위에 놓은 선분 하나 */
type CoreSpan = { core: Id; at: number; lo: number; hi: number };

/**
 * 한 칸 안에서 **실제로 한 다발이 될 수 있는** 심선 무리를 고른다.
 *
 * 무리를 끊는 자리는 둘이다.
 *  (1) **남의 전선이 사이를 지날 때.** 자켓은 표시가 아니라 물건이라, 그 안에 이
 *      케이블에 속하지 않은 전선이 들어가 있으면 도면은 "저 가닥도 심선" 이라고
 *      거짓말한다.
 *  (2) **이웃 심선이 JACKET_MAX_GAP 보다 벌어져 있을 때.** 그만큼 떨어진 둘은
 *      나란히 가는 것이 아니다(상수 주석 참고).
 * 끊고 남은 무리 중 심선이 가장 많은 것만 자켓으로 묶는다 — 사정이 생겼다고 자켓을
 * 통째로 포기하면 빽빽한 도면에서 케이블이 도로 사라진다.
 *
 * 가로지르는 배선(다른 축)은 보지 않는다 — 도면에서 선은 원래 교차한다.
 */
function bundleAt(here: CoreSpan[], others: CoreSpan[]): { cores: Set<Id>; min: number; max: number } | null {
  const sorted = [...here].sort((a, b) => a.at - b.at);
  const fats = others.map((f) => f.at);

  const chunks: CoreSpan[][] = [];
  let cur: CoreSpan[] = [];
  for (const s of sorted) {
    const prev = cur[cur.length - 1];
    const split = prev
      && (s.at - prev.at > JACKET_MAX_GAP
        || fats.some((a) => a > prev.at + EPS && a < s.at - EPS));
    if (split) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) chunks.push(cur);

  let best: { cores: Set<Id>; min: number; max: number } | null = null;
  for (const c of chunks) {
    const min = c[0].at;
    const max = c[c.length - 1].at;
    // 무리 바깥이라도 자켓 벽(JACKET_PAD) 안쪽이면 벽이 남의 전선을 넘어간다
    if (fats.some((a) => a > min - JACKET_PAD && a < max + JACKET_PAD && (a < min - EPS || a > max + EPS))) continue;
    const cores = new Set(c.map((s) => s.core));
    if (cores.size < 2) continue;
    if (!best || cores.size > best.cores.size || (cores.size === best.cores.size && max - min < best.max - best.min)) {
      best = { cores, min, max };
    }
  }
  return best;
}

/**
 * 축 하나를 훑어 "함께 가는 구간" 을 뽑는다.
 *
 * 쓸어가기(sweep)로 하는 이유: 자켓은 **모든 지점에서** 그 자리를 함께 지나는
 * 심선이 누구인지에 달렸다. 선분끼리 짝지어 묶으면(클러스터링) 심선 셋 중 둘만
 * 겹치는 구간에서 답이 갈린다. 끝점을 전부 모아 칸으로 자르면 칸마다 답이 하나로
 * 정해지고, 이웃 칸의 심선 집합이 같을 때만 이어 붙이므로 **집합이 바뀌는 자리가
 * 곧 자켓이 끊기는 자리**가 된다.
 *
 * 자르는 자리에는 **남의 전선 끝점도 함께** 넣는다. 그래야 한 칸 안에서 심선 집합도
 * 남의 전선 집합도 변하지 않아, 칸마다 답이 하나로 정해진다.
 *
 * @param order   심선 id 를 문서 순서로 — 결과의 wireIds 순서를 결정론적으로 만든다
 * @param foreign 이 케이블에 속하지 않은 배선들의 같은 축 선분
 */
function sweepRuns(spans: CoreSpan[], axis: 'h' | 'v', order: Id[], foreign: CoreSpan[]): JacketRun[] {
  if (spans.length < 2) return [];
  const cuts = [...new Set([...spans, ...foreign].flatMap((s) => [s.lo, s.hi]))].sort((a, b) => a - b);
  const covers = (s: CoreSpan, lo: number, hi: number) => s.lo <= lo + EPS && s.hi >= hi - EPS;

  type Slab = { lo: number; hi: number; key: string; cores: Id[]; min: number; max: number };
  const slabs: Slab[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i];
    const hi = cuts[i + 1];
    if (hi - lo <= EPS) continue;
    const here = spans.filter((s) => covers(s, lo, hi));
    if (here.length < 2) continue;   // 한 본뿐이면 이미 갈라진 구간이다
    const group = bundleAt(here, foreign.filter((s) => covers(s, lo, hi)));
    if (!group) continue;
    const cores = order.filter((id) => group.cores.has(id));
    slabs.push({ lo, hi, key: cores.join('|'), cores, min: group.min, max: group.max });
  }

  const out: JacketRun[] = [];
  let cur: Slab | null = null;
  const flush = () => {
    if (!cur) return;
    const len = cur.hi - cur.lo;
    const across = cur.max - cur.min + JACKET_PAD * 2;
    // 길이가 폭보다 짧은 토막은 자켓이 아니라 얼룩으로 보인다 — 다발은 **주행**이다.
    // (몸통 자켓 양 끝에 10px 짜리 조각이 붙는 경우가 그렇다. 몸통 사각형의 끝이
    //  이미 브레이크아웃 자리를 말하므로 정보를 잃지 않는다.)
    if (len >= JACKET_MIN_RUN && len >= across) {
      out.push(
        axis === 'h'
          ? { axis, x: round(cur.lo), y: round(cur.min - JACKET_PAD), w: round(len), h: round(across), wireIds: cur.cores }
          : { axis, x: round(cur.min - JACKET_PAD), y: round(cur.lo), w: round(across), h: round(len), wireIds: cur.cores },
      );
    }
    cur = null;
  };
  for (const s of slabs) {
    if (cur && Math.abs(cur.hi - s.lo) <= EPS && cur.key === s.key) {
      cur.hi = s.hi;
      cur.min = Math.min(cur.min, s.min);
      cur.max = Math.max(cur.max, s.max);
      continue;
    }
    flush();
    cur = { ...s };
  }
  flush();
  return out;
}

/**
 * 문서 → 케이블별 자켓. 순서는 `doc.cables` 그대로다.
 *
 * 좌표계는 배선 경로와 같은 논리 px 다(planWires 와 같은 출처). PDF 는 여기서
 * 나온 사각형에 **등비 변환만** 걸어 그린다.
 */
export function planJackets(doc: HarnessDocument, view: ViewMode = 'logical'): PlannedJacket[] {
  const cables = doc.cables ?? [];
  if (!cables.length) return [];
  const routes = new Map(planWires(doc, view).map((r) => [r.id, r]));

  /** 경로를 축별 선분으로 쪼갠다 */
  const spansOf = (id: Id, pts: Pt[], h: CoreSpan[], v: CoreSpan[]) => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      if (Math.abs(a.y - b.y) <= EPS && Math.abs(a.x - b.x) > EPS) {
        h.push({ core: id, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      } else if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) > EPS) {
        v.push({ core: id, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      }
    }
  };

  return cables.map((cb) => {
    const coreIds = doc.wires.filter((w) => w.cableId === cb.id).map((w) => w.id);
    const mine = new Set(coreIds);
    const h: CoreSpan[] = [];
    const v: CoreSpan[] = [];
    const fh: CoreSpan[] = [];
    const fv: CoreSpan[] = [];
    for (const w of doc.wires) {
      const r = routes.get(w.id);
      if (!r) continue;
      if (mine.has(w.id)) spansOf(w.id, jacketPath(r.points), h, v);
      // 남의 전선은 **경로 전체**를 본다 — 스텁이든 주행 구간이든 자켓 안에
      // 들어와 있으면 도면이 그 가닥을 심선으로 읽히게 한다.
      else spansOf(w.id, r.points, fh, fv);
    }
    const runs = [...sweepRuns(h, 'h', coreIds, fh), ...sweepRuns(v, 'v', coreIds, fv)];

    // 이름표는 **가장 많은 심선이 가장 길게 함께 가는** 토막에 붙인다 —
    // 그 토막이 이 케이블의 몸통이고, 도면에서 눈이 먼저 가는 자리다.
    const main = runs.reduce<JacketRun | null>((best, r) => {
      if (!best) return r;
      if (r.wireIds.length !== best.wireIds.length) return r.wireIds.length > best.wireIds.length ? r : best;
      const len = (x: JacketRun) => (x.axis === 'h' ? x.w : x.h);
      return len(r) > len(best) ? r : best;
    }, null);

    return {
      cableId: cb.id,
      ...(cb.jacketColor != null ? { jacketColor: cb.jacketColor } : {}),
      coreIds,
      runs,
      label: cb.name ?? `${cb.coreCount}C 케이블`,
      labelAt: main ? { x: round(main.x + 2), y: round(main.y - 4) } : null,
    };
  });
}
