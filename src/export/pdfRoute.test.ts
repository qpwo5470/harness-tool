/**
 * PDF 배선 기하 = 화면 배선 기하 — 못박는 자리.
 *
 * 왜 이 파일이 생겼나 (실측):
 * 실제로 뽑은 PDF 와 화면이 서로 다른 그림을 그렸다. 샘플 문서의 J1(o=0 →
 * 핸들이 왼쪽 변)에서 SP1 로 가는 배선이
 *   · 화면 — 왼쪽으로 나온 뒤 J1 박스 아래로 돌아 오른쪽으로 간다
 *   · PDF  — J1 박스를 관통한다(하우징을 흰색으로 채우므로 선이 덮여 사라진다)
 * 원인은 pdfDraw.ts 가 제 경로 계산을 갖고 있었던 것. 게다가 엣지 data 의
 * `lane` 을 읽고 있었는데 그 필드는 이미 `laneY`·`laneX` 로 갈린 뒤라
 * **PDF 의 레인 분리가 통째로 0** 이었다.
 *
 * 이 파일은 세 가지를 붙잡는다.
 *   1) 같은 문서를 넣으면 화면 경로와 PDF 경로의 꺾임점이 **좌표 변환을 되돌리면
 *      완전히 같다** — 한쪽만 고치면 여기서 깨진다.
 *   2) 샘플 문서에서 PDF 경로가 출발·도착 노드 상자를 관통하지 않는다.
 *   3) 20본 밀도 배치에서 PDF 경로도 겹침 0.
 *
 * 교차·겹침 판정은 **이 파일에서 직접** 쓴다(라우터를 믿지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { sampleDoc } from '../fixtures/sampleDoc';
import { fanoutDoc } from '../fixtures/fanoutDoc';
import { assignLanes, docToEdges } from '../canvas/docToFlow';
import { routeWire, planWires } from '../canvas/wirePlan';
import type { OrthoEdgeData } from '../canvas/OrthogonalEdge';
import type { HarnessDocument } from '../types';
import {
  buildDrawing, drawFrameAndTitleBlock, drawDrawing, fitTransform,
  PAPER_PT, type PdfLike, type Pt, type Rect, type Transform,
} from './pdfDraw';

// ============================================================
// 화면 쪽 경로 — HarnessCanvas 가 OrthogonalEdge 에 넘기는 것과 같은 재료로 만든다
// ============================================================

/**
 * 화면이 그리는 경로.
 *
 * React Flow 는 `docToEdges` 가 만든 엣지의 data(레인·노드 상자)를 그대로
 * OrthogonalEdge 에 넘기고, 좌표는 핸들 위치에서 준다. jsdom 에는 레이아웃이
 * 없어 그 좌표를 실측할 수 없으므로 여기서는 geometry 가 계산한 핸들 좌표
 * (assignLanes 의 from/to)를 쓴다 — PDF 가 쓰는 좌표와 같은 출처다.
 * **경로를 만드는 함수는 화면과 완전히 같은 것(routeWire)** 을 부른다.
 */
function screenRoutes(doc: HarnessDocument) {
  const lanes = assignLanes(doc, 'logical');
  const edges = docToEdges(doc, new Set(), null, 'logical');
  return edges.map((e, i) => {
    const d = (e.data ?? {}) as OrthoEdgeData;
    const r = routeWire(
      {
        sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x, targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      },
      d,
    );
    return { id: e.id, points: r.points, labelX: r.labelX, labelY: r.labelY };
  });
}

// ============================================================
// 판정기 — 라우터를 믿지 않고 직접 센다
// ============================================================

/** 축 정렬 선분이 사각형 **속**을 지나는가. 변에 닿기만 하는 건 아니다(핸들은 변 위에 있다). */
function segHitsBox(p: Pt, q: Pt, b: Rect, eps = 1e-6): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

type Seg = { wire: number; at: number; a: number; b: number };

/** 경로 묶음 → 가로·세로 선분 */
function splitSegments(paths: { points: Pt[] }[]) {
  const horiz: Seg[] = [];
  const vert: Seg[] = [];
  paths.forEach((w, i) => {
    for (let k = 1; k < w.points.length; k++) {
      const p = w.points[k - 1];
      const q = w.points[k];
      if (Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.x - q.x) > 1e-6) {
        horiz.push({ wire: i, at: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) });
      } else if (Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) > 1e-6) {
        vert.push({ wire: i, at: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y) });
      }
    }
  });
  return { horiz, vert };
}

/** 같은 축 위에서 실제로 포개지는(선끼리 구분이 안 되는) 쌍 수 */
function overlapPairs(segs: Seg[], tol = 2): number {
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].wire === segs[j].wire) continue;
      if (Math.abs(segs[i].at - segs[j].at) >= tol) continue;
      const from = Math.max(segs[i].a, segs[j].a);
      const to = Math.min(segs[i].b, segs[j].b);
      if (to - from > tol) n++;
    }
  }
  return n;
}

// ============================================================
// jsPDF 목 — 실제로 그린 선분만 받아 적는다
// ============================================================

type Line = { x1: number; y1: number; x2: number; y2: number };

function recordingPdf(): { pdf: PdfLike; lines: Line[] } {
  const lines: Line[] = [];
  const noop = () => undefined;
  const pdf: PdfLike = {
    setLineWidth: noop, setDrawColor: noop, setFillColor: noop, setTextColor: noop,
    setFontSize: noop, setFont: noop, text: noop, rect: noop, addImage: noop,
    setLineDashPattern: noop, addPage: noop, setPage: noop,
    getNumberOfPages: () => 1, save: noop,
    line: (x1, y1, x2, y2) => void lines.push({ x1, y1, x2, y2 }),
    internal: { pageSize: { getWidth: () => PAPER_PT.A3.w, getHeight: () => PAPER_PT.A3.h } },
  };
  return { pdf, lines };
}

/** 종이에 실제로 찍힌 배선 선분을 되짚어 논리 px 로 되돌린다 */
function drawnWireSegments(doc: HarnessDocument): { xf: Transform; segs: Line[] } {
  const { pdf, lines } = recordingPdf();
  const page = { w: PAPER_PT.A3.w, h: PAPER_PT.A3.h };
  const area = drawFrameAndTitleBlock(pdf, doc, () => 0, page);
  lines.length = 0;                       // 프레임·제목블록 선은 버린다
  const dr = buildDrawing(doc);
  const xf = fitTransform(dr.bounds, area);
  drawDrawing(pdf, dr, xf, () => 0);
  // drawDrawing 은 배선을 **맨 먼저** 그린다(하우징이 그 위를 덮는 순서라서).
  const count = dr.wires.reduce((n, w) => n + w.points.length - 1, 0);
  return { xf, segs: lines.slice(0, count) };
}

const inv = (v: number, off: number, scale: number) => (v - off) / scale;

// ============================================================
describe('PDF 배선 = 화면 배선 (같은 문서 → 같은 꺾임점)', () => {
  const docs: [string, HarnessDocument][] = [
    ['샘플 문서', sampleDoc],
    ['20본 팬아웃', fanoutDoc()],
  ];

  it.each(docs)('%s: buildDrawing 의 꺾임점이 화면 경로와 완전히 같다', (_name, doc) => {
    const screen = screenRoutes(doc);
    const pdf = buildDrawing(doc).wires;
    expect(pdf).toHaveLength(screen.length);
    pdf.forEach((w, i) => {
      expect(w.id, `배선 ${i}`).toBe(screen[i].id);
      expect(w.points, `배선 ${w.id}`).toEqual(screen[i].points);
    });
  });

  it.each(docs)('%s: 스텁 라벨 자리도 같은 출처다', (_name, doc) => {
    const screen = screenRoutes(doc);
    buildDrawing(doc).wires.forEach((w, i) => {
      expect(w.labelAt, `배선 ${w.id}`).toEqual({ x: screen[i].labelX, y: screen[i].labelY });
    });
  });

  /**
   * 종이에 실제로 찍힌 좌표까지 되짚는다.
   * PDF 는 논리 px 를 **등비 변환**(fitTransform)으로만 옮긴다 — 그 변환을
   * 되돌리면 화면 좌표가 그대로 나와야 한다. 여기가 "좌표계 차이만 변환한다"를
   * 붙잡는 자리다.
   */
  it('종이 좌표를 역변환하면 화면 꺾임점이 그대로 나온다 (샘플 문서)', () => {
    const screen = screenRoutes(sampleDoc);
    const { xf, segs } = drawnWireSegments(sampleDoc);
    const expected = screen.flatMap((w) =>
      w.points.slice(1).map((q, k) => ({ p: w.points[k], q })),
    );
    expect(segs).toHaveLength(expected.length);
    segs.forEach((s, i) => {
      const { p, q } = expected[i];
      expect(inv(s.x1, xf.tx, xf.scale)).toBeCloseTo(p.x, 6);
      expect(inv(s.y1, xf.ty, xf.scale)).toBeCloseTo(p.y, 6);
      expect(inv(s.x2, xf.tx, xf.scale)).toBeCloseTo(q.x, 6);
      expect(inv(s.y2, xf.ty, xf.scale)).toBeCloseTo(q.y, 6);
    });
  });

  /**
   * 대조군 — 이 시험이 정말 무언가를 붙잡는지 보인다.
   * 예전 PDF 는 레인을 0 으로 읽었다. 레인을 0 으로 만든 경로는 실제 화면 경로와
   * 다르다(= 예전 상태에서는 위 시험이 깨진다).
   */
  it('레인을 0 으로 두면 화면 경로와 달라진다 (대조군 — 예전 PDF 상태)', () => {
    const lanes = assignLanes(sampleDoc, 'logical');
    const flat = sampleDoc.wires.map((_, i) =>
      routeWire(
        {
          sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
          targetX: lanes.to[i].x, targetY: lanes.to[i].y,
          sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
        },
        { sourceBox: lanes.fromBox[i], targetBox: lanes.toBox[i] },
      ).points,
    );
    const real = buildDrawing(sampleDoc).wires.map((w) => w.points);
    expect(JSON.stringify(flat)).not.toBe(JSON.stringify(real));
  });

  it('PDF 는 레인을 실제로 반영한다 — 주행 구간 y 가 배선마다 다르다', () => {
    const trunkY = (points: Pt[]) => {
      let best = { len: -1, y: 0 };
      for (let k = 1; k < points.length; k++) {
        if (Math.abs(points[k].y - points[k - 1].y) > 1e-6) continue;
        const len = Math.abs(points[k].x - points[k - 1].x);
        if (len > best.len) best = { len, y: points[k].y };
      }
      return best.y;
    };
    const ys = buildDrawing(sampleDoc).wires.map((w) => trunkY(w.points));
    expect(new Set(ys).size).toBe(ys.length);
  });
});

// ============================================================
describe('PDF 경로가 노드 상자를 관통하지 않는다', () => {
  /** 배선 경로가 제 끝 노드(출발·도착) 상자를 지나는 선분 수 */
  function hits(doc: HarnessDocument): number {
    const lanes = assignLanes(doc, 'logical');
    let n = 0;
    buildDrawing(doc).wires.forEach((w, i) => {
      for (const b of [lanes.fromBox[i], lanes.toBox[i]]) {
        if (!b) continue;
        for (let k = 1; k < w.points.length; k++) {
          if (segHitsBox(w.points[k - 1], w.points[k], b)) n++;
        }
      }
    });
    return n;
  }

  it('샘플 문서 — 관통 0 (J1→SP1 이 박스 뒤로 사라지던 그 사례)', () => {
    expect(hits(sampleDoc)).toBe(0);
  });

  it('20본 팬아웃 — 관통 0', () => {
    expect(hits(fanoutDoc())).toBe(0);
  });

  /**
   * PDF 가 실제로 그리는 하우징 사각형도 지나지 않는다.
   * 위 시험이 쓰는 상자(connectorBox)는 이름표·캡션까지 포함한 **더 큰** 상자라
   * 이건 사실상 따라오지만, 하우징이 흰색으로 채워지는 그 사각형을 직접 재는 게
   * 원래 증상(선이 박스에 덮여 사라짐)과 맞다.
   */
  it('샘플 문서 — 제 하우징 사각형도 지나지 않는다', () => {
    const dr = buildDrawing(sampleDoc);
    const boxOf = new Map(dr.nodes.map((n) => [n.id, n.box]));
    let n = 0;
    sampleDoc.wires.forEach((wire, i) => {
      const ends = [
        wire.from.type === 'pin' ? wire.from.connectorId : wire.from.deviceId,
        wire.to.type === 'pin' ? wire.to.connectorId : wire.to.deviceId,
      ];
      const w = dr.wires[i];
      for (const id of ends) {
        const b = boxOf.get(id);
        if (!b) continue;
        for (let k = 1; k < w.points.length; k++) {
          if (segHitsBox(w.points[k - 1], w.points[k], b)) n++;
        }
      }
    });
    expect(n).toBe(0);
  });
});

// ============================================================
describe('PDF 밀도 — 20본 팬아웃', () => {
  const doc = fanoutDoc();

  it('배선 20본이 전부 그려진다', () => {
    expect(buildDrawing(doc).wires).toHaveLength(20);
  });

  it('가로 구간끼리 포개지는 쌍이 0', () => {
    const { horiz } = splitSegments(buildDrawing(doc).wires);
    expect(horiz.length).toBeGreaterThan(20);
    expect(overlapPairs(horiz)).toBe(0);
  });

  it('세로 구간끼리 포개지는 쌍이 0 (예전 PDF 는 레인이 0 이라 통째로 포개졌다)', () => {
    const { vert } = splitSegments(buildDrawing(doc).wires);
    expect(vert.length).toBeGreaterThan(20);
    expect(overlapPairs(vert)).toBe(0);
  });

  it('스텁 라벨 자리가 배선마다 다르다', () => {
    const labels = buildDrawing(doc).wires.map((w) => w.labelAt);
    const keys = new Set(labels.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(keys.size).toBe(labels.length);
  });

  /**
   * 대조군 — 겹침 0 이 우연이 아님을 보인다.
   * 레인을 끄면 이 배치에서 스무 본의 주행 구간이 거의 같은 높이로 몰린다.
   */
  it('레인을 끄면 실제로 포개진다 (대조군)', () => {
    const lanes = assignLanes(doc, 'logical');
    const flat = doc.wires.map((_, i) => ({
      points: routeWire(
        {
          sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
          targetX: lanes.to[i].x, targetY: lanes.to[i].y,
          sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
        },
        { sourceBox: lanes.fromBox[i], targetBox: lanes.toBox[i] },
      ).points,
    }));
    const { horiz, vert } = splitSegments(flat);
    expect(overlapPairs(horiz)).toBeGreaterThan(50);
    expect(overlapPairs(vert)).toBeGreaterThan(50);
  });
});

// ============================================================
describe('배선 끝점이 하우징 패드에 붙는다', () => {
  /**
   * 예전에는 pdfDraw 가 이름표 높이를 19 로(화면 geometry 는 17) 따로 적어 두어
   * 하우징 박스가 배선 끝점보다 2px 내려가 있었다. 끝점이 박스 변 위에 정확히
   * 앉는지 잰다 — 몇 px 라도 뜨면 종이에서 선이 패드에 안 닿아 보인다.
   */
  it.each([['샘플 문서', sampleDoc], ['20본 팬아웃', fanoutDoc()]] as [string, HarnessDocument][])(
    '%s: 모든 배선 끝점이 어느 노드 사각형의 변 위에 있다',
    (_name, doc) => {
      const dr = buildDrawing(doc);
      const onEdge = (p: Pt, b: Rect) => {
        const eps = 1e-6;
        const inX = p.x >= b.x - eps && p.x <= b.x + b.w + eps;
        const inY = p.y >= b.y - eps && p.y <= b.y + b.h + eps;
        const onV = (Math.abs(p.x - b.x) < eps || Math.abs(p.x - (b.x + b.w)) < eps) && inY;
        const onH = (Math.abs(p.y - b.y) < eps || Math.abs(p.y - (b.y + b.h)) < eps) && inX;
        return onV || onH;
      };
      for (const w of dr.wires) {
        for (const p of [w.points[0], w.points[w.points.length - 1]]) {
          expect(
            dr.nodes.some((n) => onEdge(p, n.box)),
            `배선 ${w.id} 끝점 ${JSON.stringify(p)} 이 어느 상자 변에도 없다`,
          ).toBe(true);
        }
      }
    },
  );
});
