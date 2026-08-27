/**
 * 45° 사선 라우팅 — 개선안 §2-1.
 *
 * ── 여기서 재는 것
 *  1) **각도**가 정확히 45° 뿐이다(임의 각 금지) · 스텁 14 는 그대로다
 *  2) **언제 직교로 되돌아가는가** — 폭 부족 · 마주 보지 않는 핸들 · 상자 관통 ·
 *     사람이 손으로 잡은 꺾임 · 케이블 심선
 *  3) **판독성이 실제로 좋아졌는가** — 교차 쌍 수와 꺾임점 수를 직교와 나란히 센다.
 *     "좋아 보인다" 가 아니라 숫자여야 한다.
 *  4) **화면 = 종이** — 두 그림이 같은 함수에서 나온다
 *
 * 판정기는 라우터를 믿지 않고 직접 쓴다(선분 교차·각도). 라우터가 제 결과를
 * 신고하게 하면 라우터의 버그를 시험이 함께 갖는다.
 */
import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import {
  routeDiagonal, routeAuto, routeOrthogonal, segmentHitsBox,
  DEFAULT_STUB, DIAG_MARGIN, type Box, type Pt, type DiagonalInput,
} from './route';
import { assignLanes, assignDiagCenters, DIAG_MAX_GAP } from './docToFlow';
import { planWires, routeWire } from './wirePlan';
import { conn, strip, fanoutDoc } from '../fixtures/fanoutDoc';
import type { HarnessDocument, Wire } from '../types';

const EPS = 1e-6;

/* ── 판정기 ─────────────────────────────────────────────────────────────── */

type Seg = { w: number; p: Pt; q: Pt };

function segsOf(routes: { points: Pt[] }[]): Seg[] {
  const out: Seg[] = [];
  routes.forEach((r, w) => {
    for (let k = 1; k < r.points.length; k++) out.push({ w, p: r.points[k - 1], q: r.points[k] });
  });
  return out;
}

/** 두 선분이 **속에서** 만나는가 (끝점만 스치는 것은 세지 않는다) */
function meets(a: Seg, b: Seg): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(a.p, a.q, b.p);
  const d2 = side(a.p, a.q, b.q);
  const d3 = side(b.p, b.q, a.p);
  const d4 = side(b.p, b.q, a.q);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

/** 서로 다른 배선끼리 실제로 교차하는 선분 쌍 수 */
function crossPairs(routes: { points: Pt[] }[]): number {
  const s = segsOf(routes);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) if (s[i].w !== s[j].w && meets(s[i], s[j])) n++;
  }
  return n;
}

/** 꺾임점(양 끝 패드 제외) 개수 — 눈이 가닥을 놓칠 수 있는 자리의 수 */
function turnCount(routes: { points: Pt[] }[]): number {
  return routes.reduce((n, r) => n + Math.max(0, r.points.length - 2), 0);
}

/** 경로에 사선 선분이 있는가 */
function hasDiagonal(points: Pt[]): boolean {
  return points.some((p, k) => k > 0
    && Math.abs(p.x - points[k - 1].x) > EPS && Math.abs(p.y - points[k - 1].y) > EPS);
}

/** 같은 문서를 **직교로만** 그린 대조군 — 레인은 그대로 켠다 */
function orthoRoutes(doc: HarnessDocument) {
  const lanes = assignLanes(doc, 'logical');
  return doc.wires.map((_, i) => routeOrthogonal({
    sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
    targetX: lanes.to[i].x, targetY: lanes.to[i].y,
    sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
    laneY: lanes.laneY[i], laneX: lanes.laneX[i],
    sourceBox: lanes.fromBox[i], targetBox: lanes.toBox[i], obstacles: lanes.obstacles,
  }));
}

/* ── 픽스처 ─────────────────────────────────────────────────────────────── */

/**
 * **5P → 10P 역순 매핑** — 개선안 §2-1 이 이름 대어 말하는 그 사례다.
 * 왼쪽 5핀이 오른쪽 10핀의 뒤쪽 다섯 핀에 거꾸로 물린다 → 다섯 가닥이 서로 전부 교차한다.
 */
function reversed5to10(gapX = 580): HarnessDocument {
  const h5 = strip('lib-strip-5', 5);
  const h10 = strip('lib-strip-10', 10);
  const L = conn('J1', h5.id, 5, 180, 40, 120);
  const R = conn('J2', h10.id, 10, 0, 40 + gapX, 40);
  const wires = Array.from({ length: 5 }, (_, k) => ({
    id: `w${k + 1}`,
    from: { type: 'pin', connectorId: L.id, pinId: L.pins[k].id },
    to: { type: 'pin', connectorId: R.id, pinId: R.pins[9 - k].id },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
  })) as Wire[];
  return {
    schemaVersion: 1, id: 'rev', name: '역순 5P→10P',
    createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
    connectors: [L, R], devices: [], wires, cables: [], usedParts: [h5, h10],
  };
}

const ENDS = {
  sourceX: 100, sourceY: 200, targetX: 700, targetY: 320,
  sourcePosition: Position.Right, targetPosition: Position.Left,
};
const at = (over: Partial<DiagonalInput> = {}) => routeDiagonal({ ...ENDS, ...over });

/* ── 1. 각도와 스텁 ──────────────────────────────────────────────────────── */

describe('사선은 정확히 45° 이고 스텁 14 는 그대로다', () => {
  it('사선 선분의 |dx| 와 |dy| 가 같다', () => {
    const r = at({ center: 400 })!;
    const diag = segsOf([r]).filter((s) => Math.abs(s.p.x - s.q.x) > EPS && Math.abs(s.p.y - s.q.y) > EPS);
    expect(diag).toHaveLength(1);
    expect(Math.abs(diag[0].p.x - diag[0].q.x)).toBeCloseTo(Math.abs(diag[0].p.y - diag[0].q.y), 9);
  });

  it('중심 x 를 어디에 두어도 각도는 45° 그대로다 (임의 각이 생기지 않는다)', () => {
    for (const center of [0, 200, 300, 400, 500, 900, 5000]) {
      const r = at({ center })!;
      for (const s of segsOf([r])) {
        const dx = Math.abs(s.p.x - s.q.x);
        const dy = Math.abs(s.p.y - s.q.y);
        expect(dx < EPS || dy < EPS || Math.abs(dx - dy) < EPS, `center=${center} ${dx}x${dy}`).toBe(true);
      }
    }
  });

  it('양 끝은 패드에서 핸들 방향으로 stub 이상 곧게 나간다', () => {
    const r = at({ center: 400 })!;
    const p = r.points;
    expect(p[1].x - p[0].x).toBeGreaterThanOrEqual(DEFAULT_STUB);
    expect(p[0].y).toBe(ENDS.sourceY);                       // 곧게 = y 가 안 바뀐다
    expect(p[p.length - 1].x - p[p.length - 2].x).toBeGreaterThanOrEqual(DEFAULT_STUB);
    expect(p[p.length - 1].y).toBe(ENDS.targetY);
  });

  it('사선은 스텁 끝에서 DIAG_MARGIN 만큼 더 떨어져 시작한다', () => {
    // center 를 왼쪽 끝까지 밀어도 스텁 안으로 파고들지 않는다
    const r = at({ center: -9999 })!;
    expect(r.points[1].x).toBeGreaterThanOrEqual(ENDS.sourceX + DEFAULT_STUB + DIAG_MARGIN - EPS);
  });

  it('양 끝 좌표는 패드 그대로다', () => {
    const r = at({ center: 400 })!;
    expect(r.points[0]).toEqual({ x: ENDS.sourceX, y: ENDS.sourceY });
    expect(r.points[r.points.length - 1]).toEqual({ x: ENDS.targetX, y: ENDS.targetY });
  });
});

describe('1:1 스트레이트는 저절로 곧은 선이다', () => {
  it('dy = 0 이면 꺾임점이 없다', () => {
    const r = routeDiagonal({ ...ENDS, targetY: ENDS.sourceY, center: 400 })!;
    expect(r.points).toEqual([{ x: 100, y: 200 }, { x: 700, y: 200 }]);
  });

  it('dy 가 0.6 미만이면(눈에 안 보이는 어긋남) 역시 곧은 선이다', () => {
    const r = routeDiagonal({ ...ENDS, targetY: ENDS.sourceY + 0.5, center: 400 })!;
    expect(r.points).toHaveLength(2);
  });

  it('0.6 이상이면 사선이 생긴다 (경계가 실제로 물린다)', () => {
    expect(hasDiagonal(routeDiagonal({ ...ENDS, targetY: ENDS.sourceY + 0.7, center: 400 })!.points)).toBe(true);
  });
});

/* ── 2. 언제 직교로 되돌아가는가 ──────────────────────────────────────────── */

describe('직교로 되돌아가는 자리 — 기존 라우터는 지우지 않았다', () => {
  it('폭이 모자라면 null (|dy| 가 클수록 사선이 x 를 많이 먹는다)', () => {
    // 스텁 끝 사이 폭 = 600 - 28 = 572. |dy| 가 그보다 크면 담을 수 없다
    expect(at({ targetY: 200 + 560, center: 400 })).not.toBeNull();
    expect(at({ targetY: 200 + 600, center: 400 })).toBeNull();
  });

  it('마주 보지 않는 핸들이면 null (되돌아오는 길은 직교 라우터의 일이다)', () => {
    for (const [sp, tp] of [
      [Position.Left, Position.Left], [Position.Right, Position.Right],
      [Position.Left, Position.Right], [Position.Top, Position.Left],
      [Position.Right, Position.Bottom],
    ] as const) {
      expect(routeDiagonal({ ...ENDS, sourcePosition: sp, targetPosition: tp, center: 400 }), `${sp}->${tp}`).toBeNull();
    }
  });

  it('스텁끼리 이미 지나쳤으면 null', () => {
    expect(at({ targetX: ENDS.sourceX + 20, center: 100 })).toBeNull();
  });

  it('상자를 관통하면 null — 사선은 비켜 밀 수 없으므로 통째로 포기한다', () => {
    const wall: Box = { x: 380, y: 240, w: 60, h: 60 };
    // 대조군: 그 자리에 상자가 없으면 사선을 그린다
    expect(at({ center: 400 })).not.toBeNull();
    expect(at({ center: 400, obstacles: [wall] })).toBeNull();
    // 그리고 routeAuto 는 그 자리를 직교로 채운다 — 선이 사라지지 않는다
    const auto = routeAuto({ ...ENDS, center: 400, obstacles: [wall] });
    expect(hasDiagonal(auto.points)).toBe(false);
    expect(auto.points[0]).toEqual({ x: ENDS.sourceX, y: ENDS.sourceY });
  });

  it('양 끝 패드가 붙은 상자는 회피 검사에서 뺀다 (패드가 그 변 위에 있다)', () => {
    // 출발 패드를 오른쪽 변에 물고 있는 상자. 여백(12)을 재면 스텁이 언제나 걸린다.
    const own: Box = { x: 0, y: 150, w: 100, h: 100 };
    expect(at({ center: 400, sourceBox: own })).not.toBeNull();
    expect(at({ center: 400, obstacles: [own] })).not.toBeNull();
  });

  it('center 를 안 주면 사선을 아예 시도하지 않는다 — 예전 호출부는 글자 하나까지 같다', () => {
    expect(routeAuto({ ...ENDS }).d).toBe(routeOrthogonal({ ...ENDS }).d);
  });
});

describe('선분·상자 판정기 자체', () => {
  const b: Box = { x: 100, y: 100, w: 100, h: 100 };
  it('가로지르면 걸리고, 변에 닿기만 하면 안 걸린다', () => {
    expect(segmentHitsBox({ x: 0, y: 150 }, { x: 300, y: 150 }, b, 0)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 100 }, { x: 300, y: 100 }, b, 0)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 300 }, { x: 300, y: 300 }, b, 0)).toBe(false);
  });
  it('사선도 bbox 가 아니라 선분으로 잰다', () => {
    // bbox 는 상자를 덮지만 선분은 상자 위를 스쳐 지난다
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 300, y: 300 }, b, 0)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: -120 }, { x: 300, y: 180 }, b, 0)).toBe(false);
  });
  it('여백을 주면 그만큼 넓게 잡는다', () => {
    expect(segmentHitsBox({ x: 0, y: 95 }, { x: 300, y: 95 }, b, 0)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 95 }, { x: 300, y: 95 }, b, 12)).toBe(true);
  });
});

/* ── 3. 중심 x 배분 ──────────────────────────────────────────────────────── */

describe('사선 중심 x 를 가닥마다 어긋나게 배분한다', () => {
  const doc = reversed5to10();
  const lanes = assignLanes(doc, 'logical');

  it('다섯 가닥의 중심이 전부 다르고 간격이 일정하다', () => {
    const cs = lanes.diagCenter.filter((v): v is number => v != null).sort((a, b) => a - b);
    expect(cs).toHaveLength(5);
    const steps = cs.slice(1).map((v, k) => v - cs[k]);
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 6);
    expect(steps[0]).toBeGreaterThan(0);
    expect(steps[0]).toBeLessThanOrEqual(DIAG_MAX_GAP);
  });

  it('도착 핀 y 가 위인 가닥일수록 중심이 왼쪽이다 (교차 최소화 정렬)', () => {
    const order = doc.wires.map((_, i) => i).sort((a, b) => lanes.to[a].y - lanes.to[b].y);
    const cs = order.map((i) => lanes.diagCenter[i]!);
    for (let k = 1; k < cs.length; k++) expect(cs[k]).toBeGreaterThan(cs[k - 1]);
  });

  /**
   * 레퍼런스 식 `(span - 60) / n` 은 통로가 60px 이하일 때 **음수**가 된다.
   * 음수 간격은 자리 순서를 뒤집어, 교차를 줄이려던 정렬이 되레 교차를 만든다.
   * 그래서 0 으로 접는다 — 다섯 가닥이 같은 중심을 쓰고, 담기지 못하는 가닥은
   * 라우터가 직교로 되돌린다.
   */
  it('통로가 좁으면 간격을 0 으로 접는다 (자리 순서가 뒤집히지 않게)', () => {
    const tight = reversed5to10(126);   // 스텁 끝 사이 폭 60px
    const l = assignLanes(tight, 'logical');
    const cs = l.diagCenter.filter((v): v is number => v != null);
    expect(new Set(cs).size).toBe(1);
  });

  it('같은 두 노드를 잇는 배선끼리만 무리를 짓는다', () => {
    // 팬아웃 20본은 A→C 10본 · B→D 10본 두 무리다. 무리마다 중심이 다섯 개씩 겹친다.
    const l = assignLanes(fanoutDoc(), 'logical');
    const ac = l.diagCenter.slice(0, 10);
    const bd = l.diagCenter.slice(10);
    expect(ac).toEqual(bd);              // 두 무리가 같은 x 대역을 각자 나눠 쓴다
    expect(new Set(ac).size).toBe(10);
  });
});

/* ── 4. 판독성이 실제로 좋아졌는가 (숫자) ─────────────────────────────────── */

/**
 * ── 왜 이 두 숫자인가
 * 개선안이 말한 결함은 "세로 꺾임이 한 지점에 몰려 어느 가닥인지 추적이 안 된다" 다.
 * 추적을 방해하는 것은 두 가지다.
 *   · **교차** — 두 선이 만나는 자리에서 눈이 다른 가닥으로 갈아탄다
 *   · **꺾임점** — 방향이 바뀌는 자리에서 눈이 선을 놓친다
 * 둘 다 세어 직교와 나란히 둔다. 대조군이 없으면 "0 이 좋은 값인지" 알 수 없다.
 */
describe('판독성 — 직교와 나란히 센다', () => {
  it('5P → 10P 역순: 교차 20쌍 → 10쌍, 꺾임점 20개 → 10개', () => {
    const doc = reversed5to10();
    const diag = planWires(doc, 'logical');
    const orth = orthoRoutes(doc);

    expect(crossPairs(orth)).toBe(20);
    expect(crossPairs(diag)).toBe(10);
    // 역순 매핑에서 다섯 가닥은 **모든 쌍이 반드시 한 번은** 만난다 → C(5,2)=10 이 하한.
    // 직교는 그 두 배를 만든다(세로 간선에서 한 번, 가로 주행 구간에서 한 번).
    expect(crossPairs(diag)).toBe((5 * 4) / 2);

    expect(turnCount(orth)).toBe(20);    // 가닥마다 꺾임 2회
    expect(turnCount(diag)).toBe(10);    // 가닥마다 사선 하나 = 꺾임 2회지만 겹치지 않는다
    // 꺾임점 x 가 가닥마다 다르다 — "한 지점에 몰린다" 는 결함이 사라진 것
    const xs = diag.flatMap((r) => r.points.slice(1, -1).map((p) => Math.round(p.x)));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('20본 두 열 팬아웃: 교차 132쌍 → 90쌍, 꺾임점 80개 → 40개', () => {
    const doc = fanoutDoc();
    expect(crossPairs(orthoRoutes(doc))).toBe(132);
    expect(crossPairs(planWires(doc, 'logical'))).toBe(90);
    expect(turnCount(orthoRoutes(doc))).toBe(80);
    expect(turnCount(planWires(doc, 'logical'))).toBe(40);
  });

  it('스텁 라벨은 사선 경로에서도 서로 겹치지 않는다', () => {
    // 라벨 상자 14px 높이 · 폭은 글자에서 온다. 좌표가 같은 쌍이 하나도 없어야 한다.
    for (const doc of [reversed5to10(), fanoutDoc()]) {
      const labels = planWires(doc, 'logical').map((r) => `${Math.round(r.labelX)},${Math.round(r.labelY)}`);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('라벨은 사선 위가 아니라 도착 패드 쪽 구간에 앉는다', () => {
    const doc = reversed5to10();
    const lanes = assignLanes(doc, 'logical');
    planWires(doc, 'logical').forEach((r, i) => {
      const toT = Math.hypot(r.labelX - lanes.to[i].x, r.labelY - lanes.to[i].y);
      const toS = Math.hypot(r.labelX - lanes.from[i].x, r.labelY - lanes.from[i].y);
      expect(toT, r.id).toBeLessThan(toS);
    });
  });
});

/* ── 5. 사람이 손으로 잡은 꺾임 ──────────────────────────────────────────── */

describe('수동 꺾임 지정(Wire.route)은 뜻을 잃지 않는다', () => {
  const doc = reversed5to10();
  const bend = (id: string, route: { laneY?: number; laneX?: number }): HarnessDocument => ({
    ...doc,
    wires: doc.wires.map((w) => (w.id === id ? { ...w, route } : w)),
  });

  it('지정한 가닥은 직교로 남는다 — 넣은 값이 실제로 그림을 바꾼다', () => {
    const before = planWires(doc, 'logical').find((r) => r.id === 'w2')!;
    expect(hasDiagonal(before.points)).toBe(true);

    const after = planWires(bend('w2', { laneY: 40 }), 'logical').find((r) => r.id === 'w2')!;
    expect(hasDiagonal(after.points)).toBe(false);
    expect(after.d).not.toBe(before.d);

    // 값을 더 밀면 또 달라진다 (한 번 바뀌고 마는 것이 아니다)
    const more = planWires(bend('w2', { laneY: 80 }), 'logical').find((r) => r.id === 'w2')!;
    expect(more.d).not.toBe(after.d);
  });

  it('0 도 지정된 값이다 — 참거짓으로 가르지 않는다', () => {
    const zero = planWires(bend('w2', { laneY: 0 }), 'logical').find((r) => r.id === 'w2')!;
    expect(hasDiagonal(zero.points)).toBe(false);
  });

  it('laneX 만 지정해도 직교로 남는다', () => {
    const r = planWires(bend('w3', { laneX: 10 }), 'logical').find((x) => x.id === 'w3')!;
    expect(hasDiagonal(r.points)).toBe(false);
  });

  it('**한 본만 옮기면 그 한 본만 움직인다** — 옆 가닥의 사선 중심이 안 튄다', () => {
    const before = new Map(planWires(doc, 'logical').map((r) => [r.id, r.d]));
    const after = new Map(planWires(bend('w2', { laneY: 40 }), 'logical').map((r) => [r.id, r.d]));
    const moved = [...after.keys()].filter((id) => after.get(id) !== before.get(id));
    expect(moved).toEqual(['w2']);
  });

  it('값을 지우면 사선으로 정확히 되돌아온다', () => {
    const bent = bend('w2', { laneY: 40 });
    const back: HarnessDocument = { ...bent, wires: bent.wires.map(({ route: _d, ...w }) => w as Wire) };
    expect(planWires(back, 'logical')).toEqual(planWires(doc, 'logical'));
  });
});

/* ── 6. 화면 = 종이 ─────────────────────────────────────────────────────── */

describe('화면과 PDF 가 같은 경로를 쓴다', () => {
  const doc = reversed5to10();

  /**
   * PDF(`export/pdfDraw.buildDrawing`)는 `planWires` 를 부르고 좌표 변환만 건다.
   * 여기서는 그 앞단, 곧 **엣지 data 로 실려 가는 값**이 planWires 와 같은 경로를
   * 만들어 내는지를 잰다. 화면 엣지(OrthogonalEdge)는 그 data 를 그대로
   * `routeWire` 에 넘기므로, 여기서 같으면 두 그림이 같다.
   * (DOM 쪽 짝은 `edgeRoute.dom.test.tsx`, 종이 쪽 짝은 `export/pdfRoute.test.ts`.)
   */
  it('엣지 data 로 routeWire 를 부르면 planWires 와 글자 하나까지 같다', () => {
    const lanes = assignLanes(doc, 'logical');
    const planned = planWires(doc, 'logical');
    doc.wires.forEach((w, i) => {
      const ends = {
        sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x, targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      };
      const r = routeWire(ends, {
        diagCenter: lanes.diagCenter[i],
        laneY: lanes.laneY[i], laneX: lanes.laneX[i],
        sourceBox: lanes.fromBox[i], targetBox: lanes.toBox[i], obstacles: lanes.obstacles,
        labelBackoff: undefined,
      });
      expect(r.d, w.id).toBe(planned[i].d.replace(/^M/, 'M'));
      expect(hasDiagonal(r.points), w.id).toBe(true);
    });
  });

  /**
   * **사선 중심을 안 실어 보내면 화면만 직교로 그려진다** — 그 갈라짐을 여기서 잡는다.
   * 이 시험이 없으면 `docToEdges` 에서 `diagCenter` 한 줄이 빠져도 아무도 모른다.
   */
  it('대조군 — 중심을 빼면 경로가 실제로 달라진다', () => {
    const lanes = assignLanes(doc, 'logical');
    const planned = planWires(doc, 'logical');
    const ends = {
      sourceX: lanes.from[0].x, sourceY: lanes.from[0].y,
      targetX: lanes.to[0].x, targetY: lanes.to[0].y,
      sourcePosition: lanes.from[0].side, targetPosition: lanes.to[0].side,
    };
    const geo = {
      laneY: lanes.laneY[0], laneX: lanes.laneX[0],
      sourceBox: lanes.fromBox[0], targetBox: lanes.toBox[0], obstacles: lanes.obstacles,
    };
    expect(routeWire(ends, geo).d).not.toBe(planned[0].d);
  });
});

/* ── 7. 케이블 심선 ─────────────────────────────────────────────────────── */

describe('케이블 심선은 사선을 쓰지 않는다 (자켓이 사라지지 않게)', () => {
  const cabled = (): HarnessDocument => {
    const doc = reversed5to10();
    const mine = new Set(['w1', 'w2']);
    return {
      ...doc,
      cables: [{ id: 'cb', name: '2C', coreCount: 2, lengthMm: 500 }],
      wires: doc.wires.map((w) => (mine.has(w.id) ? { ...w, cableId: 'cb' } : w)),
    };
  };

  it('심선은 직교, 나머지는 사선', () => {
    const r = new Map(planWires(cabled(), 'logical').map((x) => [x.id, x.points]));
    expect(hasDiagonal(r.get('w1')!)).toBe(false);
    expect(hasDiagonal(r.get('w2')!)).toBe(false);
    for (const id of ['w3', 'w4', 'w5']) expect(hasDiagonal(r.get(id)!), id).toBe(true);
  });

  it('심선이 빠져도 남은 가닥의 중심은 제자리다 (자리를 비워 둘 뿐)', () => {
    const bare = assignLanes(reversed5to10(), 'logical').diagCenter;
    const with2 = assignLanes(cabled(), 'logical').diagCenter;
    expect(with2.slice(2)).toEqual(bare.slice(2));
    expect(with2.slice(0, 2)).toEqual([undefined, undefined]);
  });

  it('심선이 1본뿐인 케이블은 자켓이 못 그려지므로 사선을 그대로 쓴다', () => {
    const doc = reversed5to10();
    const one: HarnessDocument = {
      ...doc,
      cables: [{ id: 'cb', name: '1C', coreCount: 1, lengthMm: 500 }],
      wires: doc.wires.map((w) => (w.id === 'w1' ? { ...w, cableId: 'cb' } : w)),
    };
    expect(assignDiagCenters(one, assignLanes(one, 'logical').from, assignLanes(one, 'logical').to)[0]).not.toBeUndefined();
  });
});
