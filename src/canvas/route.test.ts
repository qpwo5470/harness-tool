import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import { routeOrthogonal, DEFAULT_STUB, type Box, type Pt, type RouteInput } from './route';

/** 하네스 표준 배치를 포함한 가로 방향 네 조합 — getSmoothStepPath 가 깨져 있던 그 지점 */
const H_COMBOS: [Position, Position][] = [
  [Position.Right, Position.Left],   // 왼쪽 커넥터 o=180 → 오른쪽 커넥터 o=0
  [Position.Left, Position.Left],
  [Position.Right, Position.Right],
  [Position.Left, Position.Right],
];

const ALL_SIDES = [Position.Left, Position.Right, Position.Top, Position.Bottom];

const base = (sp: Position, tp: Position, over: Partial<RouteInput> = {}): RouteInput => ({
  sourceX: 100, sourceY: 200, targetX: 500, targetY: 320,
  sourcePosition: sp, targetPosition: tp,
  ...over,
});

const name = (p: Position) => String(p);

describe('레인이 실제로 경로를 움직인다', () => {
  it.each(H_COMBOS)('%s → %s: laneY 를 바꾸면 path 가 바뀐다', (sp, tp) => {
    const a = routeOrthogonal(base(sp, tp, { laneY: 0 }));
    const b = routeOrthogonal(base(sp, tp, { laneY: 24 }));
    expect(b.d).not.toBe(a.d);
  });

  it.each(H_COMBOS)('%s → %s: 가로 주행 구간의 y 가 laneY 만큼 밀린다', (sp, tp) => {
    const a = routeOrthogonal(base(sp, tp, { laneY: 0 }));
    const b = routeOrthogonal(base(sp, tp, { laneY: 24 }));
    // 가장 긴 가로 선분 = 주행 구간
    const trunkY = (pts: Pt[]) => {
      let best = { len: -1, y: 0 };
      for (let k = 1; k < pts.length; k++) {
        if (Math.abs(pts[k].y - pts[k - 1].y) > 1e-6) continue;
        const len = Math.abs(pts[k].x - pts[k - 1].x);
        if (len > best.len) best = { len, y: pts[k].y };
      }
      return best.y;
    };
    expect(trunkY(b.points) - trunkY(a.points)).toBeCloseTo(24);
  });

  it('네 변 조합 전부(세로 포함)에서 laneY 가 경로를 바꾼다', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        const a = routeOrthogonal(base(sp, tp, { laneY: 0 }));
        const b = routeOrthogonal(base(sp, tp, { laneY: 18 }));
        expect(`${name(sp)}->${name(tp)}:${b.d}`).not.toBe(`${name(sp)}->${name(tp)}:${a.d}`);
      }
    }
  });

  it('네 변 조합 전부에서 laneX 가 경로를 바꾼다', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        const a = routeOrthogonal(base(sp, tp, { laneX: 0 }));
        const b = routeOrthogonal(base(sp, tp, { laneX: 18 }));
        expect(`${name(sp)}->${name(tp)}:${b.d}`).not.toBe(`${name(sp)}->${name(tp)}:${a.d}`);
      }
    }
  });

  it('가로-가로에서 laneX 는 세로 간선의 x 를 민다', () => {
    const a = routeOrthogonal(base(Position.Right, Position.Left, { laneX: 0 }));
    const b = routeOrthogonal(base(Position.Right, Position.Left, { laneX: 20 }));
    const firstVerticalX = (pts: Pt[]) => {
      for (let k = 1; k < pts.length; k++) {
        if (Math.abs(pts[k].x - pts[k - 1].x) < 1e-6 && Math.abs(pts[k].y - pts[k - 1].y) > 1e-6) {
          return pts[k].x;
        }
      }
      return NaN;
    };
    expect(firstVerticalX(b.points) - firstVerticalX(a.points)).toBeCloseTo(20);
  });
});

describe('직교 불변식', () => {
  it('모든 선분이 수평 아니면 수직이다 (대각선 없음)', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        for (const laneY of [0, 12, -36]) {
          for (const laneX of [0, 8, 40]) {
            const { points } = routeOrthogonal(base(sp, tp, { laneY, laneX }));
            for (let k = 1; k < points.length; k++) {
              const dx = Math.abs(points[k].x - points[k - 1].x);
              const dy = Math.abs(points[k].y - points[k - 1].y);
              expect(
                dx < 1e-6 || dy < 1e-6,
                `${name(sp)}->${name(tp)} lane(${laneY},${laneX}) 대각선 선분 ${dx}x${dy}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('출발·도착 좌표를 정확히 지난다', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        const r = routeOrthogonal(base(sp, tp, { laneY: 20, laneX: 10 }));
        expect(r.points[0]).toEqual({ x: 100, y: 200 });
        expect(r.points[r.points.length - 1]).toEqual({ x: 500, y: 320 });
      }
    }
  });

  it('path d 는 M 하나 + L 들로만 이뤄진다 (곡선 없음)', () => {
    const { d } = routeOrthogonal(base(Position.Right, Position.Left, { laneY: 30 }));
    expect(d.startsWith('M ')).toBe(true);
    expect(/[CQAScqas]/.test(d)).toBe(false);
  });
});

describe('스텁 — 패드에서 핸들 방향으로 곧게 나간다', () => {
  const outward: Record<string, Pt> = {
    [Position.Left]: { x: -1, y: 0 },
    [Position.Right]: { x: 1, y: 0 },
    [Position.Top]: { x: 0, y: -1 },
    [Position.Bottom]: { x: 0, y: 1 },
  };

  it('첫 선분과 마지막 선분이 핸들 방향으로 stub 이상 뻗는다', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        for (const lane of [0, 24, -24]) {
          const r = routeOrthogonal(base(sp, tp, { laneY: lane, laneX: lane }));
          const pts = r.points;
          const ds = outward[sp];
          const dt = outward[tp];
          // 출발: pts[0] → pts[1]
          const s0 = (pts[1].x - pts[0].x) * ds.x + (pts[1].y - pts[0].y) * ds.y;
          // 도착: 마지막 선분을 거꾸로 보면 핸들 바깥 방향
          const n = pts.length;
          const t0 = (pts[n - 2].x - pts[n - 1].x) * dt.x + (pts[n - 2].y - pts[n - 1].y) * dt.y;
          expect(s0, `출발 ${name(sp)}->${name(tp)} lane ${lane}`).toBeGreaterThanOrEqual(DEFAULT_STUB - 1e-6);
          expect(t0, `도착 ${name(sp)}->${name(tp)} lane ${lane}`).toBeGreaterThanOrEqual(DEFAULT_STUB - 1e-6);
        }
      }
    }
  });

  it('stub 을 키우면 곧게 나가는 길이도 같이 커진다', () => {
    const r = routeOrthogonal(base(Position.Right, Position.Left, { stub: 40 }));
    expect(r.points[1].x - r.points[0].x).toBeCloseTo(40);
  });
});

describe('스텁 라벨 자리', () => {
  it('경로 중점이 아니라 도착 패드 쪽에 있다', () => {
    const r = routeOrthogonal(base(Position.Right, Position.Left));
    const toTarget = Math.abs(r.labelX - 500) + Math.abs(r.labelY - 320);
    const toSource = Math.abs(r.labelX - 100) + Math.abs(r.labelY - 200);
    expect(toTarget).toBeLessThan(toSource);
    // 예전 구현이 쓰던 중점과는 확실히 다른 자리여야 한다
    const midX = (100 + 500) / 2;
    expect(Math.abs(r.labelX - midX)).toBeGreaterThan(50);
  });

  it('도착 패드에서 backoff 거리(경로를 따라)에 놓인다', () => {
    const r = routeOrthogonal(base(Position.Right, Position.Left, { labelBackoff: 30 }));
    // 마지막 구간들을 따라 되짚은 거리 = 맨해튼 거리
    expect(Math.abs(r.labelX - 500) + Math.abs(r.labelY - 320)).toBeCloseTo(30);
  });

  it('네 변 조합 모두에서 라벨이 출발보다 도착에 가깝다', () => {
    for (const sp of ALL_SIDES) {
      for (const tp of ALL_SIDES) {
        const r = routeOrthogonal(base(sp, tp));
        const toTarget = Math.abs(r.labelX - 500) + Math.abs(r.labelY - 320);
        const toSource = Math.abs(r.labelX - 100) + Math.abs(r.labelY - 200);
        expect(toTarget, `${name(sp)}->${name(tp)}`).toBeLessThan(toSource);
      }
    }
  });

  it('backoff 보다 짧은 배선에서는 중점까지만 물러난다 (출발 쪽으로 안 넘어감)', () => {
    // 전체 길이 40 < backoff 기본값 22*2 → 절반(20)에서 멈춰야 한다
    const r = routeOrthogonal({
      sourceX: 0, sourceY: 0, targetX: 40, targetY: 0,
      sourcePosition: Position.Right, targetPosition: Position.Left,
    });
    const toTarget = Math.abs(r.labelX - 40) + Math.abs(r.labelY);
    const toSource = Math.abs(r.labelX) + Math.abs(r.labelY);
    expect(toTarget).toBeLessThanOrEqual(toSource);
    expect(toTarget).toBeCloseTo(20);
  });
});

/* ============================================================
   노드 상자 비켜가기
   ------------------------------------------------------------
   실제 화면에서 확인한 버그: J1(o=0 → 핸들이 왼쪽 변)에서 오른쪽 SP1 로 가는
   배선의 주행 구간이 J1 박스 한가운데를 관통했다. 엣지는 노드보다 아래층
   (zIndex 0)이라 선이 박스에 가려 사라지고, 화면에는 박스 반대편 변에서
   난데없이 튀어나오는 것처럼 보인다.
   ============================================================ */

/**
 * 축 정렬 선분과 사각형이 실제로 겹치는가 (선분·사각형 교차 판정).
 * 변에 닿기만 하는 건 겹침으로 세지 않는다 — 패드 핸들은 박스 변 위에 있으므로
 * 스텁의 첫 점은 언제나 변에 걸린다.
 */
function segHitsBox(p: Pt, q: Pt, b: Box, eps = 1e-6): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

/** 경로 전체에서 상자를 지나는 선분 수 */
function hits(points: Pt[], b: Box): number {
  let n = 0;
  for (let k = 1; k < points.length; k++) if (segHitsBox(points[k - 1], points[k], b)) n++;
  return n;
}

describe('노드 상자 비켜가기', () => {
  /** 출발 노드 — 핸들은 네 변의 한가운데에 둔다(실제 하우징도 변 위에 있다) */
  const SRC: Box = { x: 300, y: 200, w: 160, h: 120 };

  /**
   * 네 방향 각각, **핸들 방향과 목적지 방향이 반대**인 배치.
   * 도착 핸들도 출발 쪽을 향하게 두어(되돌아 나오는 쪽은 출발만) 원인을 하나로 묶는다.
   */
  const CASES = [
    {
      side: '왼쪽 변 → 오른쪽 목적지 (J1→SP1 실측 사례)',
      target: { x: 900, y: 250, w: 140, h: 110 } as Box,
      input: {
        sourceX: 300, sourceY: 260, targetX: 900, targetY: 300,
        sourcePosition: Position.Left, targetPosition: Position.Left,
      } as RouteInput,
    },
    {
      side: '오른쪽 변 → 왼쪽 목적지',
      target: { x: 20, y: 250, w: 140, h: 110 } as Box,
      input: {
        sourceX: 460, sourceY: 260, targetX: 160, targetY: 300,
        sourcePosition: Position.Right, targetPosition: Position.Right,
      } as RouteInput,
    },
    {
      side: '위쪽 변 → 아래쪽 목적지',
      target: { x: 330, y: 600, w: 140, h: 110 } as Box,
      input: {
        sourceX: 380, sourceY: 200, targetX: 400, targetY: 600,
        sourcePosition: Position.Top, targetPosition: Position.Top,
      } as RouteInput,
    },
    {
      side: '아래쪽 변 → 위쪽 목적지',
      target: { x: 330, y: 20, w: 140, h: 110 } as Box,
      input: {
        sourceX: 380, sourceY: 320, targetX: 400, targetY: 130,
        sourcePosition: Position.Bottom, targetPosition: Position.Bottom,
      } as RouteInput,
    },
  ];

  const LANES: [number, number][] = [[0, 0], [24, 10], [-24, 10], [12, 30]];

  it.each(CASES)('$side: 어떤 선분도 출발 노드 상자를 지나지 않는다', ({ input, target }) => {
    for (const [laneY, laneX] of LANES) {
      const r = routeOrthogonal({ ...input, laneY, laneX, sourceBox: SRC, targetBox: target });
      expect(hits(r.points, SRC), `lane(${laneY},${laneX}) ${JSON.stringify(r.points)}`).toBe(0);
    }
  });

  it.each(CASES)('$side: 도착 노드 상자도 지나지 않는다', ({ input, target }) => {
    for (const [laneY, laneX] of LANES) {
      const r = routeOrthogonal({ ...input, laneY, laneX, sourceBox: SRC, targetBox: target });
      expect(hits(r.points, target), `lane(${laneY},${laneX}) ${JSON.stringify(r.points)}`).toBe(0);
    }
  });

  /**
   * 대조군 — 이 시험이 정말 무언가를 붙잡는지 보인다.
   * 상자를 안 넘기면 네 배치 모두 주행 구간이 출발 상자를 관통한다(= 원래 버그).
   */
  it.each(CASES)('$side: 상자를 안 넘기면 실제로 관통한다 (대조군)', ({ input }) => {
    const r = routeOrthogonal(input);
    expect(hits(r.points, SRC)).toBeGreaterThan(0);
  });

  it('직교 불변식은 회피 뒤에도 유지된다 (대각선 없음 · 양 끝 좌표 그대로)', () => {
    for (const { input, target } of CASES) {
      for (const [laneY, laneX] of LANES) {
        const r = routeOrthogonal({ ...input, laneY, laneX, sourceBox: SRC, targetBox: target });
        for (let k = 1; k < r.points.length; k++) {
          const dx = Math.abs(r.points[k].x - r.points[k - 1].x);
          const dy = Math.abs(r.points[k].y - r.points[k - 1].y);
          expect(dx < 1e-6 || dy < 1e-6).toBe(true);
        }
        expect(r.points[0]).toEqual({ x: input.sourceX, y: input.sourceY });
        expect(r.points[r.points.length - 1]).toEqual({ x: input.targetX, y: input.targetY });
      }
    }
  });

  it('스텁은 회피 뒤에도 핸들 방향으로 stub 이상 곧게 나간다', () => {
    const outward: Record<string, Pt> = {
      [Position.Left]: { x: -1, y: 0 },
      [Position.Right]: { x: 1, y: 0 },
      [Position.Top]: { x: 0, y: -1 },
      [Position.Bottom]: { x: 0, y: 1 },
    };
    for (const { input, target } of CASES) {
      const r = routeOrthogonal({ ...input, laneY: 24, laneX: 10, sourceBox: SRC, targetBox: target });
      const ds = outward[input.sourcePosition];
      const pts = r.points;
      const out = (pts[1].x - pts[0].x) * ds.x + (pts[1].y - pts[0].y) * ds.y;
      expect(out).toBeGreaterThanOrEqual(DEFAULT_STUB - 1e-6);
    }
  });

  it('회피한 주행 구간에도 레인이 얹혀 여러 가닥이 벌어진다', () => {
    const { input, target } = CASES[0];
    const trunkY = (pts: Pt[]) => {
      let best = { len: -1, y: 0 };
      for (let k = 1; k < pts.length; k++) {
        if (Math.abs(pts[k].y - pts[k - 1].y) > 1e-6) continue;
        const len = Math.abs(pts[k].x - pts[k - 1].x);
        if (len > best.len) best = { len, y: pts[k].y };
      }
      return best.y;
    };
    const ys = [0, 12, 24, 36].map((laneY) =>
      trunkY(routeOrthogonal({ ...input, laneY, sourceBox: SRC, targetBox: target }).points),
    );
    expect(new Set(ys).size).toBe(ys.length);
    // 바깥으로 얹히므로 레인이 커질수록 상자에서 멀어진다
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeGreaterThan(ys[k - 1]);
  });

  it('상자가 멀면 경로가 달라지지 않는다', () => {
    const far: Box = { x: 5000, y: 5000, w: 100, h: 100 };
    const plain = routeOrthogonal(base(Position.Right, Position.Left, { laneY: 24, laneX: 10 }));
    const boxed = routeOrthogonal(
      base(Position.Right, Position.Left, { laneY: 24, laneX: 10, sourceBox: far, targetBox: far }),
    );
    expect(boxed.d).toBe(plain.d);
  });

  it('상자를 안 넘기면 예전 경로 그대로다 (회귀 방지)', () => {
    // stub 14 · laneX 10 → 스텁 24, laneY 24 → 주행 구간 y = 중점(260)+24
    const r = routeOrthogonal(base(Position.Right, Position.Left, { laneY: 24, laneX: 10 }));
    expect(r.points).toEqual([
      { x: 100, y: 200 },
      { x: 124, y: 200 },
      { x: 124, y: 284 },
      { x: 476, y: 284 },
      { x: 476, y: 320 },
      { x: 500, y: 320 },
    ]);
  });
});

describe('퇴화 사례', () => {
  it('완전히 같은 y 로 마주 보면 곧은 한 줄이다', () => {
    const r = routeOrthogonal({
      sourceX: 0, sourceY: 100, targetX: 300, targetY: 100,
      sourcePosition: Position.Right, targetPosition: Position.Left,
    });
    expect(r.points).toEqual([{ x: 0, y: 100 }, { x: 300, y: 100 }]);
  });

  it('출발과 도착이 같은 점이어도 터지지 않는다', () => {
    const r = routeOrthogonal({
      sourceX: 50, sourceY: 50, targetX: 50, targetY: 50,
      sourcePosition: Position.Right, targetPosition: Position.Left,
    });
    expect(Number.isFinite(r.labelX)).toBe(true);
    expect(r.d.startsWith('M ')).toBe(true);
  });
});
