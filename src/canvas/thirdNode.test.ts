/**
 * 배선이 **제3의 노드**(자기 끝이 아닌 부품) 뒤로 숨지 않는다 — 못박는 자리.
 *
 * 실측한 결함: 커넥터를 한 줄로 늘어놓고(하네스 도면에서 가장 흔한 배치) 양 끝을
 * 이으면 주행 구간이 가운데 커넥터들을 통째로 관통했다. 하우징은 흰색으로
 * 채워지므로 화면·PDF 모두에서 선이 그 구간만 사라진다.
 *
 *   고치기 전 — 배선 8본 · 제3노드 관통 **3본** (w2·w3·w4 → cB·cC·cD)
 *   고친 뒤   — 관통 **0본**
 *
 * 교차 판정은 **이 파일에서 직접** 쓴다(라우터를 믿지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { assignLanes, nodeBoxes } from './docToFlow';
import { planWires } from './wirePlan';
import { routeWire } from './wirePlan';
import { DEFAULT_STUB, type Pt } from './route';
import { rowOfConnectorsDoc } from '../fixtures/rowOfConnectors';
import type { HarnessDocument } from '../types';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * 축 정렬 선분이 사각형 **속**을 지나는가.
 * 변에 닿기만 하는 건 겹침이 아니다 — 패드 핸들은 상자 변 위에 있으므로
 * 스텁의 첫 점은 언제나 어느 변에 걸린다.
 */
function segHitsBox(p: Pt, q: Pt, b: Rect, eps = 1e-6): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

/** 배선 하나가 어느 노드의 끝에 붙어 있는가 */
function endsOf(doc: HarnessDocument, i: number): Set<string> {
  const w = doc.wires[i];
  return new Set(
    [w.from, w.to].map((e) => (e.type === 'pin' ? e.connectorId : e.deviceId)),
  );
}

/**
 * 제3의 노드를 지나는 배선을 센다.
 * @returns 관통한 배선 수와 `배선→[부품]` 목록 (실패 메시지에 그대로 찍힌다)
 */
function thirdNodeHits(doc: HarnessDocument, routes: { id: string; points: Pt[] }[]) {
  const boxes = nodeBoxes(doc, 'logical');
  const detail: string[] = [];
  routes.forEach((r, i) => {
    const ends = endsOf(doc, i);
    const hit = new Set<string>();
    for (let k = 1; k < r.points.length; k++) {
      for (const n of boxes) {
        if (ends.has(n.id)) continue;             // 자기 끝 상자는 따로 센다
        if (segHitsBox(r.points[k - 1], r.points[k], n.box)) hit.add(n.id);
      }
    }
    if (hit.size) detail.push(`${r.id}→[${[...hit].join(',')}]`);
  });
  return { count: detail.length, detail };
}

/** 실제로 그려지는 경로 (화면·PDF 가 함께 부르는 그 함수) */
function realRoutes(doc: HarnessDocument) {
  return planWires(doc, 'logical').map((w) => ({ id: w.id, points: w.points }));
}

/**
 * 대조군 — **장애물 목록만 빼고** 나머지(끝점·레인·자기 상자)는 실제와 같게 둔다.
 * 이것이 고치기 전의 라우터가 그리던 그림이다.
 */
function withoutObstacles(doc: HarnessDocument) {
  const lanes = assignLanes(doc, 'logical');
  return doc.wires.map((w, i) => ({
    id: w.id,
    points: routeWire(
      {
        sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x, targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      },
      { laneY: lanes.laneY[i], laneX: lanes.laneX[i], sourceBox: lanes.fromBox[i], targetBox: lanes.toBox[i] },
    ).points,
  }));
}

describe('한 줄로 늘어선 커넥터 — 제3의 노드 관통', () => {
  const doc = rowOfConnectorsDoc();

  it('배선 8본 · 커넥터 5개 배치다', () => {
    expect(doc.wires).toHaveLength(8);
    expect(doc.connectors).toHaveLength(5);
  });

  it('제3의 노드를 지나는 배선이 0본', () => {
    const { count, detail } = thirdNodeHits(doc, realRoutes(doc));
    expect(count, detail.join(' ')).toBe(0);
  });

  /**
   * 대조군 — 이 시험이 정말 무언가를 붙잡는지 보인다.
   * 장애물 목록을 빼면 A→E 세 본이 가운데 셋을 그대로 관통한다(= 원래 결함).
   */
  it('장애물 목록을 안 넘기면 실제로 3본이 관통한다 (대조군)', () => {
    const { count, detail } = thirdNodeHits(doc, withoutObstacles(doc));
    expect(count).toBe(3);
    // 어느 배선이 무엇을 지나는지까지 못박는다 — 숫자만 맞고 대상이 바뀌면 다른 사고다
    expect(detail).toEqual([
      'w2→[cB,cC,cD]',
      'w3→[cB,cC,cD]',
      'w4→[cB,cC,cD]',
    ]);
  });

  it('자기 끝 노드 상자도 여전히 지나지 않는다', () => {
    const boxes = new Map(nodeBoxes(doc, 'logical').map((n) => [n.id, n.box]));
    let n = 0;
    realRoutes(doc).forEach((r, i) => {
      for (const id of endsOf(doc, i)) {
        const b = boxes.get(id);
        if (!b) continue;
        for (let k = 1; k < r.points.length; k++) {
          if (segHitsBox(r.points[k - 1], r.points[k], b)) n++;
        }
      }
    });
    expect(n).toBe(0);
  });

  it('직교 불변식이 유지된다 (대각선 없음 · 양 끝 좌표 그대로)', () => {
    const lanes = assignLanes(doc, 'logical');
    realRoutes(doc).forEach((r, i) => {
      for (let k = 1; k < r.points.length; k++) {
        const dx = Math.abs(r.points[k].x - r.points[k - 1].x);
        const dy = Math.abs(r.points[k].y - r.points[k - 1].y);
        expect(dx < 1e-6 || dy < 1e-6, `배선 ${r.id} 대각선 ${dx}x${dy}`).toBe(true);
      }
      expect(r.points[0]).toEqual({ x: lanes.from[i].x, y: lanes.from[i].y });
      expect(r.points[r.points.length - 1]).toEqual({ x: lanes.to[i].x, y: lanes.to[i].y });
    });
  });

  it('스텁은 회피 뒤에도 핸들 방향으로 stub 이상 곧게 나간다', () => {
    const lanes = assignLanes(doc, 'logical');
    const outward: Record<string, Pt> = {
      left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
      top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
    };
    realRoutes(doc).forEach((r, i) => {
      const p = r.points;
      const ds = outward[lanes.from[i].side];
      const dt = outward[lanes.to[i].side];
      const s0 = (p[1].x - p[0].x) * ds.x + (p[1].y - p[0].y) * ds.y;
      const n = p.length;
      const t0 = (p[n - 2].x - p[n - 1].x) * dt.x + (p[n - 2].y - p[n - 1].y) * dt.y;
      expect(s0, `출발 ${r.id}`).toBeGreaterThanOrEqual(DEFAULT_STUB - 1e-6);
      expect(t0, `도착 ${r.id}`).toBeGreaterThanOrEqual(DEFAULT_STUB - 1e-6);
    });
  });

  /**
   * 여러 가닥이 같은 무리를 돌아 나가도 서로 벌어져 있어야 한다.
   * 회피가 레인을 덮어써 버리면 A→E 네 본이 한 줄에 포개져, 관통은 없어도
   * 읽을 수 없는 도면이 된다.
   */
  it('같은 무리를 돌아 나가는 배선들의 주행 구간이 서로 다른 높이다', () => {
    const trunkY = (pts: Pt[]) => {
      let best = { len: -1, y: 0 };
      for (let k = 1; k < pts.length; k++) {
        if (Math.abs(pts[k].y - pts[k - 1].y) > 1e-6) continue;
        const len = Math.abs(pts[k].x - pts[k - 1].x);
        if (len > best.len) best = { len, y: pts[k].y };
      }
      return best.y;
    };
    const across = realRoutes(doc).filter((r) => ['w1', 'w2', 'w3', 'w4'].includes(r.id));
    const ys = across.map((r) => trunkY(r.points));
    expect(new Set(ys).size).toBe(ys.length);
  });

  /**
   * 우회가 밀도를 망치지 않는다.
   * 여러 가닥을 같은 상자 무리 밖으로 밀다 보면 죄다 같은 높이로 몰릴 수 있다 —
   * 관통은 없어도 선끼리 구분이 안 되면 도면으로서는 마찬가지로 못 쓴다.
   */
  it('가로·세로 구간끼리 포개지는 쌍이 0', () => {
    type Seg = { wire: number; at: number; a: number; b: number };
    const horiz: Seg[] = [];
    const vert: Seg[] = [];
    realRoutes(doc).forEach((r, i) => {
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
    const overlapPairs = (segs: Seg[], tol = 2) => {
      const out: string[] = [];
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          if (segs[i].wire === segs[j].wire) continue;
          if (Math.abs(segs[i].at - segs[j].at) >= tol) continue;
          const from = Math.max(segs[i].a, segs[j].a);
          const to = Math.min(segs[i].b, segs[j].b);
          if (to - from > tol) out.push(`${doc.wires[segs[i].wire].id}/${doc.wires[segs[j].wire].id}@${segs[i].at}`);
        }
      }
      return out;
    };
    expect(overlapPairs(horiz).join(' ')).toBe('');
    expect(overlapPairs(vert).join(' ')).toBe('');
  });

  it('결정론 — 같은 문서를 다시 계산하면 같은 경로가 나온다', () => {
    expect(JSON.stringify(realRoutes(doc))).toBe(JSON.stringify(realRoutes(rowOfConnectorsDoc())));
  });
});
