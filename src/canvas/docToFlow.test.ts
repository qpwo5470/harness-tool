import { describe, it, expect } from 'vitest';
import { docToFlow, docToEdges, highlightedWires, assignLanes } from './docToFlow';
import { routeOrthogonal, type Pt } from './route';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { Connector, HarnessDocument, Orientation, PartLibraryItem, Wire } from '../types';

describe('docToFlow', () => {
  it('노드 = 커넥터+장치, 엣지 = 와이어', () => {
    const { nodes, edges } = docToFlow(sampleDoc, 'logical');
    expect(nodes).toHaveLength(4); // 커넥터 3 + 장치 1
    expect(edges).toHaveLength(3); // 와이어 3
  });
});

describe('highlightedWires', () => {
  it('와이어 선택 시 같은 네트 전체가 하이라이트된다', () => {
    const hl = highlightedWires(sampleDoc, 'w1');
    expect([...hl].sort()).toEqual(['w1', 'w2', 'w3']); // 스플라이스 너머까지
  });

  it('커넥터 선택 시 그 커넥터가 물린 네트가 하이라이트된다', () => {
    const hl = highlightedWires(sampleDoc, 'con-a');
    expect(hl.has('w1')).toBe(true);
  });

  it('선택 없으면 빈 집합', () => {
    expect(highlightedWires(sampleDoc, null).size).toBe(0);
  });
});

describe('docToEdges 하이라이트 스타일', () => {
  it('하이라이트된 엣지는 굵고, 나머지는 흐려진다', () => {
    const edges = docToEdges(sampleDoc, new Set(['w1']));
    const on = edges.find((e) => e.id === 'w1')!;
    const off = edges.find((e) => e.id === 'w2')!;
    expect(on.style?.strokeWidth).toBe(3.2);
    expect(off.style?.opacity).toBe(0.16);
  });
});

describe('도면 레퍼런스', () => {
  it('커넥터 J·스플라이스 SP·장치 D 로 번호가 붙는다', async () => {
    const { refLabels } = await import('./docToFlow');
    const refs = refLabels(sampleDoc);
    const vals = [...refs.values()];
    expect(vals.some((v) => /^J\d+$/.test(v))).toBe(true);
    expect(vals.some((v) => /^SP\d+$/.test(v))).toBe(true);
    expect(vals.some((v) => /^D\d+$/.test(v))).toBe(true);
  });

  it('같은 문서를 다시 계산해도 번호가 같다', async () => {
    const { refLabels } = await import('./docToFlow');
    expect([...refLabels(sampleDoc)]).toEqual([...refLabels(sampleDoc)]);
  });
});

describe('레인 배정 — 구간 겹침 채색', () => {
  it('레인 인덱스는 중앙 기준 대칭 오프셋으로 바뀐다', async () => {
    const { laneOffset } = await import('./docToFlow');
    expect([0, 1, 2, 3, 4].map((l) => laneOffset(l, 12))).toEqual([0, 12, -12, 24, -24]);
  });

  it('겹치지 않는 구간은 같은 레인을 재사용한다', async () => {
    const { colorLanes } = await import('./docToFlow');
    // [0,10] [50,60] [100,110] — 서로 안 겹침 → 전부 레인 0
    expect(colorLanes([[0, 10], [50, 60], [100, 110]])).toEqual([0, 0, 0]);
  });

  it('완전히 겹치는 구간은 레인이 갈린다', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([[0, 100], [0, 100], [0, 100]])).toEqual([0, 1, 2]);
  });

  it('레인 수는 배선 수가 아니라 최대 동시 겹침 수에서 멈춘다', async () => {
    const { colorLanes } = await import('./docToFlow');
    // 20본이지만 동시에 겹치는 건 최대 2개 → 레인 2개면 충분
    const spans = Array.from({ length: 20 }, (_, i) => [i * 50, i * 50 + 60] as [number, number]);
    const lanes = colorLanes(spans);
    expect(new Set(lanes).size).toBeLessThanOrEqual(2);
  });

  it('입력 순서 그대로 돌려준다 (내부에서 정렬해도)', async () => {
    const { colorLanes } = await import('./docToFlow');
    // x1 역순으로 넣어도 i 번째 결과가 i 번째 입력에 대응해야 한다
    const lanes = colorLanes([[200, 300], [0, 100]]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toBe(0); // 안 겹치므로 둘 다 레인 0
    expect(lanes[1]).toBe(0);
  });

  it('x1 > x2 로 뒤집힌 구간도 처리한다', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([[100, 0], [200, 300]])).toEqual([0, 0]);
  });

  it('배선이 없으면 빈 배열', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([])).toEqual([]);
  });
});

/* ============================================================
   밀도 시험 — 20본 두 열 팬아웃
   ------------------------------------------------------------
   getSmoothStepPath 시절 이 배치에서 세로 구간 겹침 123쌍(전부 같은 x 에 포개짐),
   스텁 라벨 좌표가 완전히 같은 쌍 6개가 나왔다. 그 수치를 못박는 자리다.
   ============================================================ */

/** 1열 N핀 스트립 하우징 — 패드가 세로로 늘어서 핸들이 PITCH 간격으로 벌어진다 */
function strip(id: string, n: number): PartLibraryItem {
  return {
    id, category: 'housing', name: `${n}P 스트립`, pinCount: n,
    pinLayout: Array.from({ length: n }, (_, k) => ({ index: k + 1, offset: { x: 0, y: k } })),
  };
}

function conn(id: string, housingId: string, n: number, o: Orientation, x: number, y: number): Connector {
  return {
    id, kind: 'connector', housingId, orientation: o,
    positions: { logical: { x, y } },
    pins: Array.from({ length: n }, (_, k) => ({ id: `${id}p${k + 1}`, index: k + 1 })),
  };
}

/**
 * 왼쪽 두 열(오른쪽으로 나감) → 오른쪽 두 열(왼쪽으로 나감), 20본.
 * 핀 순서를 뒤집어 물려 배선이 서로 교차하게 한다(가장 빡센 경우).
 */
function fanoutDoc(): HarnessDocument {
  const h10 = strip('lib-strip-10', 10);
  const A = conn('J-A', h10.id, 10, 180, 40, 40);
  const B = conn('J-B', h10.id, 10, 180, 40, 420);
  const C = conn('J-C', h10.id, 10, 0, 900, 40);
  const D = conn('J-D', h10.id, 10, 0, 900, 420);
  const wires: Wire[] = [];
  const link = (from: Connector, to: Connector, tag: string) => {
    for (let k = 0; k < 10; k++) {
      wires.push({
        id: `${tag}${k}`,
        from: { type: 'pin', connectorId: from.id, pinId: from.pins[k].id },
        to: { type: 'pin', connectorId: to.id, pinId: to.pins[9 - k].id },
        color: { base: 'red' },
        gauge: { system: 'awg', value: 22 },
      });
    }
  };
  link(A, C, 'ac');
  link(B, D, 'bd');
  return {
    schemaVersion: 1, id: 'fan', name: '팬아웃',
    createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
    connectors: [A, B, C, D], devices: [], wires, cables: [], usedParts: [h10],
  };
}

type Seg = { wire: number; a: number; b: number; at: number };

/**
 * 실제 그려질 경로를 계산해 가로·세로 선분으로 쪼갠다.
 * @param useLanes false 면 레인을 끈다 — 이 시험이 정말 물리는지 보이는 대조군.
 */
function segmentsOf(doc: HarnessDocument, useLanes = true) {
  const lanes = assignLanes(doc, 'logical');
  const horiz: Seg[] = [];
  const vert: Seg[] = [];
  const labels: Pt[] = [];
  doc.wires.forEach((_, i) => {
    const r = routeOrthogonal({
      sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
      targetX: lanes.to[i].x, targetY: lanes.to[i].y,
      sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      laneY: useLanes ? lanes.laneY[i] : 0,
      laneX: useLanes ? lanes.laneX[i] : 0,
      // 화면과 같은 조건으로 잰다 — 실제 엣지도 두 끝 노드 상자를 피해 간다.
      sourceBox: lanes.fromBox[i],
      targetBox: lanes.toBox[i],
    });
    labels.push({ x: r.labelX, y: r.labelY });
    for (let k = 1; k < r.points.length; k++) {
      const p = r.points[k - 1];
      const q = r.points[k];
      if (Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.x - q.x) > 1e-6) {
        horiz.push({ wire: i, at: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) });
      } else if (Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) > 1e-6) {
        vert.push({ wire: i, at: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y) });
      }
    }
  });
  return { horiz, vert, labels };
}

/** 같은 축 위에서 실제로 포개지는(선끼리 구분이 안 되는) 쌍 수 */
function overlapPairs(segs: Seg[], tol = 2): number {
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].wire === segs[j].wire) continue;      // 같은 배선의 제 구간끼리는 셈하지 않는다
      if (Math.abs(segs[i].at - segs[j].at) >= tol) continue;
      const from = Math.max(segs[i].a, segs[j].a);
      const to = Math.min(segs[i].b, segs[j].b);
      if (to - from > tol) n++;
    }
  }
  return n;
}

describe('밀도 — 20본 두 열 팬아웃', () => {
  const doc = fanoutDoc();

  it('배선 20본을 만든다', () => {
    expect(doc.wires).toHaveLength(20);
  });

  it('가로 구간끼리 포개지는 쌍이 0', () => {
    const { horiz } = segmentsOf(doc);
    expect(horiz.length).toBeGreaterThan(20);   // 구간을 실제로 뽑았는지 먼저 확인
    expect(overlapPairs(horiz)).toBe(0);
  });

  it('세로 구간끼리 포개지는 쌍이 0 (예전엔 123쌍)', () => {
    const { vert } = segmentsOf(doc);
    expect(vert.length).toBeGreaterThan(20);
    expect(overlapPairs(vert)).toBe(0);
  });

  it('스텁 라벨 자리가 배선마다 다르다 (예전엔 완전히 같은 쌍 6개)', () => {
    const { labels } = segmentsOf(doc);
    const keys = new Set(labels.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(keys.size).toBe(labels.length);
  });

  it('라벨은 도착 커넥터 쪽에 붙는다 (경로 중점이 아니다)', () => {
    const lanes = assignLanes(doc, 'logical');
    const { labels } = segmentsOf(doc);
    labels.forEach((p, i) => {
      const toTarget = Math.abs(p.x - lanes.to[i].x) + Math.abs(p.y - lanes.to[i].y);
      const toSource = Math.abs(p.x - lanes.from[i].x) + Math.abs(p.y - lanes.from[i].y);
      expect(toTarget, `배선 ${i}`).toBeLessThan(toSource);
    });
  });

  /**
   * 대조군 — 이 시험이 정말 무언가를 붙잡고 있는지 보인다.
   * 레인을 끄면 이 배치에서 가로 90쌍 · 세로 80쌍이 포개진다(핀을 뒤집어 물려
   * 스무 본의 중점 y 가 전부 같아지는 배치라서). 위 두 시험의 0 은 우연이 아니다.
   */
  it('레인을 끄면 실제로 포개진다 (대조군)', () => {
    const { horiz, vert } = segmentsOf(doc, false);
    expect(overlapPairs(horiz)).toBeGreaterThan(50);
    expect(overlapPairs(vert)).toBeGreaterThan(50);
  });

  it('레인 수는 배선 수만큼 벌어지지 않는다 (세로 간선은 커넥터별로만 벌린다)', () => {
    const lanes = assignLanes(doc, 'logical');
    // 한 커넥터에 10핀이므로 세로 레인은 10개면 충분하다
    expect(new Set(lanes.laneX).size).toBeLessThanOrEqual(10);
  });
});

/* ============================================================
   샘플 문서 — 배선이 제 노드 박스 뒤로 숨지 않는다
   ------------------------------------------------------------
   화면에서 확인한 버그: J1(con-a, o=0 → 핸들이 왼쪽 변)에서 오른쪽 SP1 로 가는
   배선의 주행 구간이 J1 박스 한가운데를 관통했다. 엣지는 노드보다 아래층
   (zIndex 0)이라 박스에 가려 선이 사라진다. SP1→J2 도 같았다.
   ============================================================ */

/** 축 정렬 선분과 사각형이 실제로 겹치는가 — 변에 닿기만 하는 건 겹침이 아니다 */
function segHitsBox(p: Pt, q: Pt, b: { x: number; y: number; w: number; h: number }): boolean {
  const eps = 1e-6;
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

/** 배선 전체에서 제 끝 노드 상자를 관통하는 선분 수 */
function boxHits(doc: HarnessDocument, useBoxes: boolean): number {
  const lanes = assignLanes(doc, 'logical');
  let n = 0;
  doc.wires.forEach((_, i) => {
    const r = routeOrthogonal({
      sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
      targetX: lanes.to[i].x, targetY: lanes.to[i].y,
      sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      laneY: lanes.laneY[i], laneX: lanes.laneX[i],
      sourceBox: useBoxes ? lanes.fromBox[i] : undefined,
      targetBox: useBoxes ? lanes.toBox[i] : undefined,
    });
    for (const b of [lanes.fromBox[i], lanes.toBox[i]]) {
      if (!b) continue;
      for (let k = 1; k < r.points.length; k++) {
        if (segHitsBox(r.points[k - 1], r.points[k], b)) n++;
      }
    }
  });
  return n;
}

describe('배선이 제 노드 박스 뒤로 숨지 않는다', () => {
  it('샘플 문서: 관통하는 선분이 하나도 없다', () => {
    expect(boxHits(sampleDoc, true)).toBe(0);
  });

  it('상자를 안 넘기면 실제로 관통한다 (대조군 — 원래 버그)', () => {
    expect(boxHits(sampleDoc, false)).toBeGreaterThan(0);
  });

  it('20본 팬아웃에서도 관통이 없다', () => {
    expect(boxHits(fanoutDoc(), true)).toBe(0);
  });
});

describe('색 약호', () => {
  it('현장 관행 약호로 줄인다', async () => {
    const { colorAbbr } = await import('./docToFlow');
    expect(colorAbbr('red')).toBe('R');
    expect(colorAbbr('black')).toBe('B');
    expect(colorAbbr('blue')).toBe('L');   // 청색은 L (Blue 는 Black 과 혼동)
    expect(colorAbbr('white', 'orange')).toBe('W/O');
  });

  it('모르는 색도 두 글자로 폴백한다', async () => {
    const { colorAbbr } = await import('./docToFlow');
    expect(colorAbbr('teal')).toBe('TE');
  });
});
