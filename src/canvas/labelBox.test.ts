/**
 * 이름표·MPN 캡션이 배선을 덮지 않는가 — 못박는 자리.
 *
 * ── 화면에서 확인한 결함
 * 커넥터 노드는 [이름표(.hz-ref)] [하우징] [MPN 캡션(.hz-mpn)] 순으로 쌓인다.
 * 이름표와 캡션은 **흰 배경**이고 배선은 노드보다 아래층(zIndex 0)이라 글자 상자가
 * 배선을 덮는다. 예전 connectorBox 는 이 둘의 **높이**만 상자에 넣고 폭은 하우징
 * 폭 그대로 뒀다 — 그런데 1행 10P 를 좌우로 두면 하우징은 38px 인데 이름표는
 * 140px 을 넘는다. 라우터가 모르는 100px 뒤로 배선이 들어가 사라졌다.
 * (배선 20본짜리 문서를 띄우고 경로를 4px 간격으로 훑으며 `elementsFromPoint` 로
 *  센 결과, w9 가 세 지점에서 라벨에 가려져 있었다. 나머지 19본은 0.)
 *
 * ── 여기서 재는 것
 *   1) 1행 10P 를 0°·180° 로 둔 커넥터의 **이름표 사각형**을 직접 만들고,
 *      경로의 어떤 선분도 그 사각형을 지나지 않는다(선분·사각형 교차 판정을 직접 쓴다).
 *   2) 밀도 문서에서 라벨에 가려지는 배선 0본.
 *   3) **대조군** — 라벨 폭을 상자에 넣지 않고 라벨을 왼쪽 정렬로 두면(예전 상태)
 *      실제로 가려진다. 고친 것이 무엇인지 시험이 증명해야 한다.
 *   4) 상자를 넓혀도 **핸들은 상자 변 위**에 남는다. 핸들이 상자 속으로 들어가면
 *      스텁부터 회피 대상이 돼 경로가 망가진다(route.ts 머리말).
 */
import { describe, it, expect } from 'vitest';
import { assignLanes, refLabels, nodePositions } from './docToFlow';
import { planWires } from './wirePlan';
import { routeOrthogonal, type Box, type Pt } from './route';
import {
  REF_BLOCK_H, MPN_CAPTION_H,
  connectorBox, connectorLabelRects, connectorLayout, connectorRefParts,
  housingOrigin, pinAnchor, refLabelWidth, mpnCaptionWidth,
} from './geometry';
import { fanoutDoc, labelOverhangDoc, conn, strip } from '../fixtures/fanoutDoc';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { HarnessDocument, Orientation, PartLibraryItem } from '../types';

/* ── 판정기 — 라우터를 믿지 않고 직접 쓴다 ───────────────────────────────────── */

/** 축 정렬 선분이 사각형 **속**을 지나는가. 변에 닿기만 하는 건 아니다(핸들이 변 위에 있다). */
function segHitsRect(p: Pt, q: Pt, b: Box, eps = 1e-6): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x1 > b.x + eps && x0 < b.x + b.w - eps
    && y1 > b.y + eps && y0 < b.y + b.h - eps;
}

/** 판정기 자체가 맞는지 먼저 확인한다 — 0 이 나왔을 때 믿을 수 있어야 한다 */
describe('선분·사각형 교차 판정', () => {
  const b: Box = { x: 10, y: 10, w: 100, h: 20 };
  it('사각형을 가로지르는 선분은 걸린다', () => {
    expect(segHitsRect({ x: 0, y: 20 }, { x: 200, y: 20 }, b)).toBe(true);
    expect(segHitsRect({ x: 50, y: 0 }, { x: 50, y: 100 }, b)).toBe(true);
  });
  it('변에 닿기만 하거나 비켜 가는 선분은 안 걸린다', () => {
    expect(segHitsRect({ x: 0, y: 10 }, { x: 200, y: 10 }, b)).toBe(false);  // 위 변에 딱
    expect(segHitsRect({ x: 110, y: 0 }, { x: 110, y: 100 }, b)).toBe(false); // 오른 변에 딱
    expect(segHitsRect({ x: 0, y: 40 }, { x: 200, y: 40 }, b)).toBe(false);   // 아래로 비켜감
  });
});

/* ── 라벨 사각형 모으기 ───────────────────────────────────────────────────── */

/** 문서 안 모든 커넥터의 이름표·캡션 사각형 (지금 구현이 그리는 자리) */
function labelRectsOf(doc: HarnessDocument): { id: string; rect: Box }[] {
  const at = nodePositions(doc, 'logical');
  const refs = refLabels(doc);
  const out: { id: string; rect: Box }[] = [];
  for (const c of doc.connectors) {
    const housing = doc.usedParts.find((p) => p.id === c.housingId);
    const r = connectorLabelRects(c, housing, at.get(c.id)!, refs.get(c.id));
    out.push({ id: c.id, rect: r.ref });
    if (r.mpn) out.push({ id: c.id, rect: r.mpn });
  }
  return out;
}

/**
 * **대조군 재료** — 고치기 전 그림.
 *   · 경계 상자: 하우징 폭만 (라벨 폭을 안 넣는다)
 *   · 라벨 자리: 방향과 무관하게 왼쪽 정렬 (언제나 오른쪽으로 넘친다)
 * 나머지(끝점·레인)는 지금과 같게 둔다 — 달라진 것 하나만 보이게.
 */
function legacyBoxes(doc: HarnessDocument) {
  const at = nodePositions(doc, 'logical');
  const refs = refLabels(doc);
  const box = new Map<string, Box>();
  const labels: { id: string; rect: Box }[] = [];
  for (const c of doc.connectors) {
    const housing = doc.usedParts.find((p) => p.id === c.housingId);
    const p = at.get(c.id)!;
    const g = connectorLayout(c, housing);
    const mpnH = housing?.mpn ? MPN_CAPTION_H : 0;
    box.set(c.id, { x: p.x, y: p.y, w: g.boxW, h: REF_BLOCK_H + g.boxH + mpnH });
    const boxY = p.y + (c.orientation === 90 ? 0 : REF_BLOCK_H);
    const refW = refLabelWidth(connectorRefParts(c, housing, refs.get(c.id)));
    labels.push({
      id: c.id,
      rect: {
        x: p.x,
        y: c.orientation === 90 ? boxY + g.boxH + mpnH : p.y,
        w: refW, h: REF_BLOCK_H,
      },
    });
    if (housing?.mpn) {
      labels.push({
        id: c.id,
        rect: { x: p.x, y: boxY + g.boxH, w: mpnCaptionWidth(housing.mpn), h: MPN_CAPTION_H },
      });
    }
  }
  return { box, labels };
}

/**
 * **두 번째 대조군 재료** — 라벨은 왼쪽 정렬로 두고(= 핸들이 있는 쪽으로 넘치게)
 * 상자만 그 폭까지 넓힌 경우. 가림은 사라지지만 핸들이 상자 **속**으로 들어간다.
 */
function wideLeftBoxes(doc: HarnessDocument) {
  const { box, labels } = legacyBoxes(doc);
  const at = nodePositions(doc, 'logical');
  const refs = refLabels(doc);
  for (const c of doc.connectors) {
    const housing = doc.usedParts.find((p) => p.id === c.housingId);
    const g = connectorLayout(c, housing);
    const w = Math.max(
      g.boxW,
      refLabelWidth(connectorRefParts(c, housing, refs.get(c.id))),
      housing?.mpn ? mpnCaptionWidth(housing.mpn) : 0,
    );
    box.set(c.id, { ...box.get(c.id)!, x: at.get(c.id)!.x, w });
  }
  return { box, labels };
}

/** 지금 구현이 그리는 경로 */
function routesNow(doc: HarnessDocument) {
  return planWires(doc, 'logical').map((r) => r.points);
}

/** 대조군 경로 — 상자만 바꿔 끼우고 레인·끝점은 지금과 같게 둔다 */
function routesLegacy(doc: HarnessDocument, box = legacyBoxes(doc).box) {
  const lanes = assignLanes(doc, 'logical');
  const idOf = (e: HarnessDocument['wires'][number]['from']) =>
    e.type === 'pin' ? e.connectorId : e.deviceId;
  return doc.wires.map((w, i) => routeOrthogonal({
    sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
    targetX: lanes.to[i].x, targetY: lanes.to[i].y,
    sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
    laneY: lanes.laneY[i], laneX: lanes.laneX[i],
    sourceBox: box.get(idOf(w.from)) ?? lanes.fromBox[i],
    targetBox: box.get(idOf(w.to)) ?? lanes.toBox[i],
  }).points);
}

/** 라벨 사각형을 지나는 배선 수 · 선분 수 */
function coverage(paths: Pt[][], labels: { rect: Box }[]) {
  let segs = 0;
  const wires = new Set<number>();
  paths.forEach((pts, i) => {
    for (const l of labels) {
      for (let k = 1; k < pts.length; k++) {
        if (segHitsRect(pts[k - 1], pts[k], l.rect)) { segs++; wires.add(i); }
      }
    }
  });
  return { segs, wires: wires.size };
}

/* ── 시험 ─────────────────────────────────────────────────────────────────── */

describe('이름표·캡션이 배선을 덮지 않는다 — 되돌아오는 배치 10본', () => {
  const doc = labelOverhangDoc();

  it('배선 10본을 만든다', () => {
    expect(doc.wires).toHaveLength(10);
  });

  /**
   * 대조군이 먼저다. 이 배치가 정말 결함을 재현하는지 보이지 않으면
   * 아래 0 이 무엇을 뜻하는지 알 수 없다.
   * (실측: 라벨 폭을 상자에 안 넣으면 10본 중 6본이 이름표·캡션에 가려진다)
   */
  it('대조군 — 라벨 폭을 상자에 안 넣으면 실제로 가려진다', () => {
    const { labels } = legacyBoxes(doc);
    const hit = coverage(routesLegacy(doc), labels);
    expect(hit.wires).toBeGreaterThan(0);
    expect(hit.segs).toBeGreaterThan(0);
  });

  it('지금 구현 — 라벨에 가려지는 배선 0본', () => {
    const hit = coverage(routesNow(doc), labelRectsOf(doc));
    expect(hit.wires).toBe(0);
    expect(hit.segs).toBe(0);
  });

  /**
   * 왜 **정렬까지** 바꿨나 — 두 번째 대조군.
   *
   * 라벨을 왼쪽 정렬(= o=180 이면 핸들이 있는 오른쪽으로 넘침)로 둔 채 상자만
   * 그 폭까지 넓혀도 가림은 0 이 된다. 하지만 그러면 핸들이 상자 **속**에 들어가
   * 스텁부터 회피 대상이 된다: 라우터는 스텁을 라벨 폭 전체(+여백) 밖으로 밀고,
   * 그 결과 열 가닥이 **전부 같은 길이**로 튀어나온다(실측 14~104px → 전부 121px).
   * 핀마다 다른 자리에서 갈라지던 부채꼴이 한 줄로 뭉치는 것 —
   * 그래서 넓히는 방향을 핸들 반대쪽으로 몰았다(geometry.labelsAlignRight).
   */
  it('대조군 2 — 핸들 쪽으로 넓히면 스텁이 전부 같은 길이로 밀려난다', () => {
    const stubs = (paths: Pt[][]) =>
      paths.map((p) => Math.abs(p[0].x - p[1].x) + Math.abs(p[0].y - p[1].y));

    const pushed = stubs(routesLegacy(doc, wideLeftBoxes(doc).box));
    expect(new Set(pushed).size).toBe(1);              // 열 가닥이 한 값으로 뭉친다
    expect(Math.min(...pushed)).toBeGreaterThan(100);  // 라벨 폭만큼 통째로 밀렸다

    const keep = stubs(routesNow(doc));
    expect(Math.min(...keep)).toBe(14);                // route.DEFAULT_STUB 그대로 붙는다
    expect(new Set(keep).size).toBeGreaterThan(1);     // 핀마다 다른 자리에서 갈라진다
  });
});

describe('1행 10P 이름표 사각형 — 0°·180° 둘 다', () => {
  /** 한 커넥터가 제 이름표 사각형을 지나는지: 방향만 바꿔 같은 배치를 돌린다 */
  const docFor = (o: Orientation): HarnessDocument => {
    const h10: PartLibraryItem = { ...strip('lib-strip-10', 10), mpn: 'SMH250-10' };
    // 상대는 반대 방향으로 등을 지게 둔다 — 경로가 제 하우징 옆구리를 스치며
    // 이름표 띠를 지나는 배치라야 이 시험이 물린다.
    const A = conn('J-A', h10.id, 10, o, 400, 40);
    const B = conn('J-B', h10.id, 10, o === 0 ? 180 : 0, o === 0 ? 40 : 900, 400);
    return {
      schemaVersion: 1, id: `one-${o}`, name: '1행 10P',
      createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
      connectors: [A, B], devices: [], wires: Array.from({ length: 10 }, (_, k) => ({
        id: `w${k}`,
        from: { type: 'pin' as const, connectorId: A.id, pinId: A.pins[k].id },
        to: { type: 'pin' as const, connectorId: B.id, pinId: B.pins[9 - k].id },
        color: { base: 'red' },
        gauge: { system: 'awg' as const, value: 22 },
      })), cables: [], usedParts: [h10],
    };
  };

  it.each([[0], [180]] as [Orientation][])('%i° — 경로가 이름표 사각형을 지나지 않는다', (o) => {
    const doc = docFor(o);
    const hit = coverage(routesNow(doc), labelRectsOf(doc));
    expect(hit.segs).toBe(0);
  });

  it('180° 이름표는 하우징 **왼쪽으로** 넘친다 (핸들이 오른쪽 변이라서)', () => {
    const doc = docFor(180);
    const c = doc.connectors[0];
    const housing = doc.usedParts[0];
    const at = { x: 400, y: 40 };
    const g = connectorLayout(c, housing);
    const r = connectorLabelRects(c, housing, at, 'J1');
    expect(r.ref.w).toBeGreaterThan(g.boxW);          // 이름표가 하우징보다 넓다
    expect(r.ref.x).toBeLessThan(at.x);               // 왼쪽으로 넘친다
    expect(r.ref.x + r.ref.w).toBeCloseTo(at.x + g.boxW, 6); // 오른쪽 변에 딱 맞는다
  });

  it('0° 이름표는 하우징 **오른쪽으로** 넘친다 (핸들이 왼쪽 변이라서)', () => {
    const doc = docFor(0);
    const c = doc.connectors[0];
    const r = connectorLabelRects(c, doc.usedParts[0], { x: 400, y: 40 }, 'J1');
    expect(r.ref.x).toBe(400);
    expect(r.ref.w).toBeGreaterThan(connectorLayout(c, doc.usedParts[0]).boxW);
  });
});

describe('경계 상자가 라벨을 실제로 덮는다', () => {
  const h10: PartLibraryItem = { ...strip('lib-strip-10', 10), mpn: 'SMH250-10' };

  it.each([[0], [90], [180], [270]] as [Orientation][])(
    '%i° — 이름표·캡션 사각형이 경계 상자 안에 들어간다',
    (o) => {
      const c = conn('J-A', h10.id, 10, o, 300, 200);
      const at = { x: 300, y: 200 };
      const b = connectorBox(c, h10, at, 'logical', 'J1');
      const r = connectorLabelRects(c, h10, at, 'J1');
      for (const rect of [r.ref, r.mpn!]) {
        expect(rect.x).toBeGreaterThanOrEqual(b.x - 1e-6);
        expect(rect.x + rect.w).toBeLessThanOrEqual(b.x + b.w + 1e-6);
        expect(rect.y).toBeGreaterThanOrEqual(b.y - 1e-6);
        expect(rect.y + rect.h).toBeLessThanOrEqual(b.y + b.h + 1e-6);
      }
    },
  );

  /**
   * 상자를 넓히되 **핸들이 있는 쪽으로는 넓히지 않는다**. 핸들이 상자 속으로
   * 들어가면 스텁부터 회피 대상이 돼 "핸들 방향으로 stub 만큼 곧게 나온다"는
   * 약속이 깨진다(route.ts 머리말). 가로로 나가는 0°·180° 를 잰다 —
   * 90°/270° 는 위·아래 변으로 나가므로 가로로 넓혀도 걸리지 않는다.
   */
  it.each([[0], [180]] as [Orientation][])('%i° — 핸들이 상자 변 위에 남는다', (o) => {
    const c = conn('J-A', h10.id, 10, o, 300, 200);
    const at = { x: 300, y: 200 };
    const b = connectorBox(c, h10, at, 'logical', 'J1');
    for (const pin of c.pins) {
      const a = pinAnchor(c, h10, pin.index, at);
      const onEdge = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.x - (b.x + b.w)) < 1e-6;
      expect(onEdge, `${o}° 핀 ${pin.index} 이 상자 안(${a.x}, 상자 ${b.x}~${b.x + b.w})`).toBe(true);
    }
  });

  /**
   * 하우징 자리 불변 — geometry 는 **노드 좌상단 x == 하우징 x** 를 전제로
   * 핸들·패드를 계산한다. 이름표를 오른쪽에 맞춘다고 하우징까지 밀리면
   * 화면·PDF·라우터가 전부 어긋난다. 네 방향 모두에서 확인한다.
   */
  it('네 방향 모두 하우징이 노드 좌상단 x 에 붙어 있다', () => {
    const at = { x: 300, y: 200 };
    for (const o of [0, 90, 180, 270] as Orientation[]) {
      expect(housingOrigin(o).x, `${o}°`).toBe(0);
      const c = conn('J-A', h10.id, 10, o, at.x, at.y);
      const g = connectorLayout(c, h10);
      // 가로로 나가는 방향은 핸들 x 가 곧 하우징의 좌·우 변이다 — 그 값으로 확인
      if (o === 0) expect(pinAnchor(c, h10, 1, at).x).toBe(at.x);
      if (o === 180) expect(pinAnchor(c, h10, 1, at).x).toBe(at.x + g.boxW);
      // 위·아래로 나가는 방향은 패드 격자가 하우징 안(INSET~boxW-INSET)에 있다
      if (o === 90 || o === 270) {
        const a = pinAnchor(c, h10, 1, at).x;
        expect(a).toBeGreaterThan(at.x);
        expect(a).toBeLessThan(at.x + g.boxW);
      }
    }
  });
});

describe('기존 문서도 라벨에 안 가린다', () => {
  it('20본 팬아웃 — 0본', () => {
    const doc = fanoutDoc();
    expect(coverage(routesNow(doc), labelRectsOf(doc)).wires).toBe(0);
  });

  it('샘플 문서 — 0본', () => {
    expect(coverage(routesNow(sampleDoc), labelRectsOf(sampleDoc)).wires).toBe(0);
  });
});
