/**
 * 배선 꺾임 수동 지정(`Wire.route`) — 못박는 자리.
 *
 * ── 왜 이 파일이 생겼나 (사용자 원문)
 * "선이 꺾여서 겹쳐서 구분이 힘듦. 선 꺾임 방향이나 위치도 수정 가능해야함."
 * 자동 레인 배정은 **겹치지 않게** 까지만 하고 어느 쪽이 읽기 좋은지는 모른다.
 * 그래서 사람이 축별로 값을 넣을 수 있게 했고, 이 파일이 그 약속 다섯 가지를
 * 붙잡는다.
 *
 *  1) 사람이 넣은 값이 자동값을 **이긴다** (그리고 실제로 그림이 달라진다)
 *  2) 지우면 **정확히** 예전 그림으로 돌아간다 (글자 하나까지)
 *  3) **0 은 "없음"이 아니다** — 0 을 넣으면 가운데 레인으로 끌려온다
 *  4) 한 가닥을 손봐도 **남의 배선은 움직이지 않는다**
 *  5) **화면과 PDF 가 같은 경로를 쓴다** — 직전 커밋에서 라벨 겹침을 화면에만
 *     고쳐 종이만 깨진 사고가 있었다. 새 기능도 같은 자리에서 갈라질 수 있다.
 *
 * 그리고 문서 왕복(parseDocument)과 스토어 액션·실행취소까지 함께 본다.
 * 판정은 **실제로 그려지는 경로**(planWires · buildDrawing)로 한다 —
 * "레인 값이 들어갔다"가 아니라 "그림이 그렇게 나온다"가 알고 싶은 것이다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sampleDoc } from '../fixtures/sampleDoc';
import { fanoutDoc } from '../fixtures/fanoutDoc';
import { laneSplitDoc } from '../fixtures/cableDoc';
import { rowOfConnectorsDoc } from '../fixtures/rowOfConnectors';
import { assignLanes, docToEdges, LANE_Y_STEP } from './docToFlow';
import { planWires, routeWire } from './wirePlan';
import type { OrthoEdgeData } from './OrthogonalEdge';
import {
  buildDrawing, drawFrameAndTitleBlock, drawDrawing, fitTransform, PAPER_PT, type PdfLike,
} from '../export/pdfDraw';
import { parseDocument } from '../store/persistence';
import { validateHarness } from '../store/validate';
import { toKit } from '../store/kit';
import { useHarnessStore } from '../store/harnessStore';
import type { HarnessDocument, WireRoute } from '../types';

/** 배선 하나에만 꺾임을 지정한 문서 */
function withRoute(doc: HarnessDocument, wireId: string, route: WireRoute): HarnessDocument {
  return {
    ...doc,
    wires: doc.wires.map((w) => (w.id === wireId ? { ...w, route } : w)),
  };
}

/** 실제로 그려지는 꺾임점 (화면·PDF·검증이 전부 이 함수를 지난다) */
const pointsOf = (doc: HarnessDocument) =>
  new Map(planWires(doc, 'logical').map((r) => [r.id, r.points]));

/**
 * 화면이 그리는 경로 — HarnessCanvas 가 OrthogonalEdge 에 넘기는 것과 같은 재료로 만든다.
 * (export/pdfRoute.test.ts 의 screenRoutes 와 같은 방식이다. 그쪽은 "PDF 가 화면을
 *  따라오는가"를, 여기서는 "수동 지정이 두 쪽에 똑같이 들어가는가"를 본다.)
 */
function screenRoutes(doc: HarnessDocument) {
  const lanes = assignLanes(doc, 'logical');
  return docToEdges(doc, new Set(), null, 'logical').map((e, i) => {
    const r = routeWire(
      {
        sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x, targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      },
      (e.data ?? {}) as OrthoEdgeData,
    );
    return { id: e.id, points: r.points, labelX: r.labelX, labelY: r.labelY };
  });
}

// ============================================================
describe('사람이 넣은 값이 자동값을 이긴다', () => {
  it('assignLanes 가 지정한 축만 바꾸고 자동값은 그대로 돌려준다', () => {
    const base = assignLanes(sampleDoc, 'logical');
    const doc = withRoute(sampleDoc, 'w2', { laneY: 77 });
    const lanes = assignLanes(doc, 'logical');
    const i = doc.wires.findIndex((w) => w.id === 'w2');

    expect(lanes.laneY[i]).toBe(77);
    // 자동값은 "지금 자동은 몇인가"를 패널이 말하는 근거다 — 지정에 흔들리면 안 된다
    expect(lanes.autoLaneY[i]).toBe(base.autoLaneY[i]);
    // 건드리지 않은 축은 자동 그대로
    expect(lanes.laneX[i]).toBe(lanes.autoLaneX[i]);
  });

  it('그림이 실제로 달라진다 (대조군 — 값만 들어가고 선은 그대로면 아무 소용이 없다)', () => {
    const before = pointsOf(sampleDoc).get('w2')!;
    const after = pointsOf(withRoute(sampleDoc, 'w2', { laneY: 77 })).get('w2')!;
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('laneX 도 그림을 바꾼다', () => {
    const before = pointsOf(sampleDoc).get('w2')!;
    const after = pointsOf(withRoute(sampleDoc, 'w2', { laneX: 60 })).get('w2')!;
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('지우면 정확히 예전 그림으로 돌아간다 (글자 하나까지)', () => {
    const before = planWires(sampleDoc, 'logical');
    const touched = withRoute(sampleDoc, 'w2', { laneY: 77, laneX: 60 });
    // 필드를 통째로 뺀 문서 = "자동으로" 를 누른 뒤의 문서
    const cleared: HarnessDocument = {
      ...touched,
      wires: touched.wires.map(({ route: _drop, ...rest }) => rest),
    };
    expect(planWires(cleared, 'logical')).toEqual(before);
  });
});

// ============================================================
describe('0 은 "없음"이 아니다', () => {
  /**
   * 왜 이 시험이 따로 있나: `w.route?.laneY || auto` 처럼 참거짓으로 가르면 0 이
   * 조용히 자동값으로 되돌아간다. 그러면 사람이 **가운데로 끌어온** 배선이 파일을
   * 다시 열 때마다 원위치한다 — 화면이 조용히 거짓말하는 부류다.
   */
  it('자동값이 0 이 아닌 배선에 0 을 넣으면 가운데로 끌려온다', () => {
    const lanes = assignLanes(fanoutDoc(), 'logical');
    const doc = fanoutDoc();
    // 자동값이 0 이 아닌 배선을 고른다 (0 이면 이 시험이 헛돈다)
    const i = lanes.autoLaneY.findIndex((v) => v !== 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const id = doc.wires[i].id;

    const zeroed = withRoute(doc, id, { laneY: 0 });
    expect(assignLanes(zeroed, 'logical').laneY[i]).toBe(0);
    expect(JSON.stringify(pointsOf(zeroed).get(id)))
      .not.toBe(JSON.stringify(pointsOf(doc).get(id)));
  });

  it('왕복해도 0 이 살아남는다', () => {
    const doc = withRoute(sampleDoc, 'w2', { laneY: 0 });
    const back = parseDocument(JSON.stringify(toKit(doc)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.kit.harnesses[0].wires.find((w) => w.id === 'w2')?.route).toEqual({ laneY: 0 });
  });
});

// ============================================================
describe('손댄 가닥만 움직인다 — 자동 배정을 흔들지 않는다', () => {
  /**
   * ── 여기가 이번 작업에서 판단이 갈렸던 자리다
   * 처음에는 "케이블 심선을 이웃 높이로 몰까" 판단(laneCost)을 **사람 지정까지
   * 얹은 실제 경로**로 쟀다. 그려질 그림을 재는 것이 이 레포의 태도라서다(§10-2).
   * 그런데 `laneSplitDoc` 에서 w1 을 한 칸 내렸더니 **w2·w4 의 꺾임점까지 바뀌었다**
   * (이 시험이 그렇게 잡았다). 그러면 w2 를 고치려다 w1 이 돌아오는 되돌이에 갇힌다 —
   * 손댈 방법이 없어서 만든 기능이 도로 손댈 수 없는 상태를 만든다.
   *
   * 그래서 자동 배정은 사람 지정을 **전혀 보지 않고** 돌리고, 지정은 맨 마지막에
   * 그 배선에만 얹는다(docToFlow.assignLanes 주석). 그 성질을 여기서 못박는다.
   */
  const cases: [string, HarnessDocument, number][] = [
    ['20본 팬아웃', fanoutDoc(), 7],
    ['레인 갈림(케이블)', laneSplitDoc(), 0],
    ['샘플 하네스', sampleDoc, 1],
  ];

  it.each(cases)('%s: 한 본만 옮기면 그 한 본만 움직인다', (_name, doc, k) => {
    const target = doc.wires[k].id;
    const before = pointsOf(doc);
    const after = pointsOf(withRoute(doc, target, { laneY: 90 }));

    const moved = doc.wires
      .filter((w) => JSON.stringify(after.get(w.id)) !== JSON.stringify(before.get(w.id)))
      .map((w) => w.id);
    expect(moved).toEqual([target]);
  });

  it.each(cases)('%s: laneX 를 옮겨도 마찬가지다', (_name, doc, k) => {
    const target = doc.wires[k].id;
    const before = pointsOf(doc);
    const after = pointsOf(withRoute(doc, target, { laneX: 44 }));

    const moved = doc.wires
      .filter((w) => JSON.stringify(after.get(w.id)) !== JSON.stringify(before.get(w.id)))
      .map((w) => w.id);
    expect(moved).toEqual([target]);
  });
});

// ============================================================
describe('화면과 PDF 가 같은 경로를 쓴다 (수동 지정이 들어간 문서에서도)', () => {
  const docs: [string, HarnessDocument][] = [
    ['샘플 · laneY 지정', withRoute(sampleDoc, 'w2', { laneY: 77 })],
    ['샘플 · 두 축 지정', withRoute(sampleDoc, 'w1', { laneY: -40, laneX: 34 })],
    ['샘플 · 0 지정', withRoute(sampleDoc, 'w3', { laneY: 0 })],
    ['20본 팬아웃 · 한 본 지정', withRoute(fanoutDoc(), fanoutDoc().wires[7].id, { laneY: 200 })],
  ];

  it.each(docs)('%s: PDF 꺾임점이 화면 경로와 완전히 같다', (_name, doc) => {
    const screen = screenRoutes(doc);
    const pdf = buildDrawing(doc).wires;
    expect(pdf).toHaveLength(screen.length);
    pdf.forEach((w, i) => {
      expect(w.id, `배선 ${i}`).toBe(screen[i].id);
      expect(w.points, `배선 ${w.id}`).toEqual(screen[i].points);
    });
  });

  it.each(docs)('%s: 스텁 라벨 자리도 같이 따라간다', (_name, doc) => {
    const screen = screenRoutes(doc);
    buildDrawing(doc).wires.forEach((w, i) => {
      expect(w.labelAt, `배선 ${w.id}`).toEqual({ x: screen[i].labelX, y: screen[i].labelY });
    });
  });

  /**
   * 대조군 — 이 시험이 정말 무언가를 붙잡는지 보인다.
   * 지정을 뺀 문서로 그린 PDF 는 지정한 문서의 화면 경로와 **달라야** 한다.
   * (달라지지 않으면 위 시험은 아무것도 확인하지 않는 것이다.)
   */
  it('지정을 빼면 PDF 도 달라진다 — 종이가 지정을 실제로 반영한다', () => {
    const doc = withRoute(sampleDoc, 'w2', { laneY: 77 });
    const withOverride = buildDrawing(doc).wires.find((w) => w.id === 'w2')!.points;
    const without = buildDrawing(sampleDoc).wires.find((w) => w.id === 'w2')!.points;
    expect(JSON.stringify(withOverride)).not.toBe(JSON.stringify(without));
  });

  /**
   * 여기까지는 `buildDrawing` 이 내놓은 꺾임점만 봤다. **종이에 실제로 찍힌 선**까지
   * 되짚는다 — jsPDF 의 `line()` 호출을 받아 적고 등비 변환(fitTransform)을 되돌려
   * 화면 좌표가 그대로 나오는지 본다. 직전 커밋의 사고(화면만 고치고 종이는 예전
   * 그대로)가 정확히 이 층에서 드러났다.
   */
  it('종이 좌표를 역변환하면 지정한 그대로의 화면 꺾임점이 나온다', () => {
    const doc = withRoute(sampleDoc, 'w2', { laneY: 77, laneX: 26 });
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const noop = () => undefined;
    const pdf: PdfLike = {
      setLineWidth: noop, setDrawColor: noop, setFillColor: noop, setTextColor: noop,
      setFontSize: noop, setFont: noop, text: noop, rect: noop, addImage: noop,
      setLineDashPattern: noop, addPage: noop, setPage: noop,
      getNumberOfPages: () => 1, save: noop,
      line: (x1, y1, x2, y2) => void lines.push({ x1, y1, x2, y2 }),
      internal: { pageSize: { getWidth: () => PAPER_PT.A3.w, getHeight: () => PAPER_PT.A3.h } },
    };
    const page = { w: PAPER_PT.A3.w, h: PAPER_PT.A3.h };
    const area = drawFrameAndTitleBlock(pdf, doc, () => 0, page);
    lines.length = 0;                                   // 프레임·제목블록 선은 버린다
    const dr = buildDrawing(doc);
    const xf = fitTransform(dr.bounds, area);
    drawDrawing(pdf, dr, xf, () => 0);

    // drawDrawing 은 배선을 맨 먼저 그린다(하우징이 그 위를 덮는 순서라서)
    const count = dr.wires.reduce((n, w) => n + w.points.length - 1, 0);
    const segs = lines.slice(0, count);
    const screen = screenRoutes(doc);
    const expected = screen.flatMap((w) => w.points.slice(1).map((q, k) => ({ p: w.points[k], q })));
    expect(segs).toHaveLength(expected.length);

    const inv = (v: number, off: number) => (v - off) / xf.scale;
    segs.forEach((s, k) => {
      const { p, q } = expected[k];
      expect(inv(s.x1, xf.tx)).toBeCloseTo(p.x, 6);
      expect(inv(s.y1, xf.ty)).toBeCloseTo(p.y, 6);
      expect(inv(s.x2, xf.tx)).toBeCloseTo(q.x, 6);
      expect(inv(s.y2, xf.ty)).toBeCloseTo(q.y, 6);
    });
  });
});

// ============================================================
describe('손으로 옮겨도 상자 회피는 그대로 걸린다', () => {
  /**
   * ── 재 보고 알게 된 것 (처음엔 반대를 예상했다)
   * "손으로 잘못 옮기면 선이 하우징 뒤로 들어가 사라지고, 그걸 검증이 잡아야 한다"
   * 는 시험을 먼저 썼는데 **관통이 한 건도 나오지 않았다.** 이유는 라우터의 순서다:
   * laneY 는 주행 구간의 **기준 y** 에 얹히고, 그다음에 `pushAside` 가 그 선을
   * 상자 밖으로 밀어낸다. 즉 사람이 상자 한복판을 가리켜도 라우터가 도로 끌어낸다.
   * 지어낸 기대 대신 **실제로 성립하는 성질**을 못박는다 — 손으로 옮기는 기능이
   * 도면을 망가뜨릴 수 없다는 것이 여기서 얻는 보장이다.
   *
   * (그래서 속성 패널이 "값을 넣어도 그림이 안 바뀝니다" 라고 말해야 하는 경우가
   *  생긴다 — 상자가 이미 그보다 멀리 밀어 놓았을 때다.)
   */
  const crossings = (doc: HarnessDocument) =>
    validateHarness(doc).filter((i) => i.id === 'wire-crosses-part').length;

  it.each([0, -12, 40, -200, 400])('한 줄 배치에서 laneY=%s 를 줘도 관통이 늘지 않는다', (v) => {
    const doc = rowOfConnectorsDoc();
    const pushed: HarnessDocument = {
      ...doc,
      wires: doc.wires.map((w) => ({ ...w, route: { laneY: v } })),
    };
    expect(crossings(pushed)).toBeLessThanOrEqual(crossings(doc));
  });
});

// ============================================================
describe('문서 왕복 (parseDocument)', () => {
  it('두 축을 그대로 보존한다', () => {
    const doc = withRoute(sampleDoc, 'w1', { laneY: -18, laneX: 20 });
    const back = parseDocument(JSON.stringify(toKit(doc)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.kit.harnesses[0].wires.find((w) => w.id === 'w1')?.route)
      .toEqual({ laneY: -18, laneX: 20 });
  });

  it('쓴 적 없는 문서에는 필드를 붙이지 않는다 (없던 변경이 형상관리에 보이지 않게)', () => {
    const back = parseDocument(JSON.stringify(toKit(sampleDoc)));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    for (const w of back.kit.harnesses[0].wires) {
      expect(Object.prototype.hasOwnProperty.call(w, 'route')).toBe(false);
    }
  });

  it('못 쓰는 값(문자·NaN·빈 객체)은 조용히 떨어뜨린다 — 도면이 NaN 으로 그려지지 않게', () => {
    const kit = JSON.parse(JSON.stringify(toKit(sampleDoc)));
    kit.harnesses[0].wires[0].route = { laneY: '위로', laneX: 12 };
    kit.harnesses[0].wires[1].route = {};
    const back = parseDocument(JSON.stringify(kit));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const ws = back.kit.harnesses[0].wires;
    expect(ws[0].route).toEqual({ laneX: 12 });
    expect(Object.prototype.hasOwnProperty.call(ws[1], 'route')).toBe(false);
  });

  it('왕복한 문서가 같은 그림을 그린다', () => {
    const doc = withRoute(sampleDoc, 'w2', { laneY: 77, laneX: 30 });
    const back = parseDocument(JSON.stringify(toKit(doc)));
    if (!back.ok) throw new Error(back.reason);
    expect(planWires(back.kit.harnesses[0], 'logical').map((r) => r.points))
      .toEqual(planWires(doc, 'logical').map((r) => r.points));
  });
});

// ============================================================
describe('스토어 액션 setWireRoute', () => {
  const S = () => useHarnessStore.getState();
  const routeOf = (id: string) => S().doc.wires.find((w) => w.id === id)?.route;

  beforeEach(() => S().replaceDoc(sampleDoc));

  it('축 하나만 지정하고, 다른 축은 건드리지 않는다', () => {
    S().setWireRoute!('w2', { laneY: 24 });
    expect(routeOf('w2')).toEqual({ laneY: 24 });
    S().setWireRoute!('w2', { laneX: 10 });
    expect(routeOf('w2')).toEqual({ laneY: 24, laneX: 10 });
  });

  it('null 이면 그 축만 지운다', () => {
    S().setWireRoute!('w2', { laneY: 24, laneX: 10 });
    S().setWireRoute!('w2', { laneY: null });
    expect(routeOf('w2')).toEqual({ laneX: 10 });
  });

  it('두 축이 다 없어지면 필드 자체를 지운다', () => {
    S().setWireRoute!('w2', { laneY: 24, laneX: 10 });
    S().setWireRoute!('w2', { laneY: null, laneX: null });
    const w = S().doc.wires.find((x) => x.id === 'w2')!;
    expect(Object.prototype.hasOwnProperty.call(w, 'route')).toBe(false);
  });

  it('0 을 넣으면 지정으로 남는다 (지움이 아니다)', () => {
    S().setWireRoute!('w2', { laneY: 0 });
    expect(routeOf('w2')).toEqual({ laneY: 0 });
  });

  it('한 번 누르면 실행취소 한 단계 — ⌘Z 로 정확히 되돌아간다', () => {
    expect(S().canUndo()).toBe(false);
    S().setWireRoute!('w2', { laneY: LANE_Y_STEP });
    expect(S().canUndo()).toBe(true);
    S().undo();
    expect(routeOf('w2')).toBeUndefined();
  });

  it('"자동으로" 한 번은 실행취소 한 단계다 (두 축을 반만 되돌리지 않는다)', () => {
    S().setWireRoute!('w2', { laneY: 24, laneX: 10 });
    S().setWireRoute!('w2', { laneY: null, laneX: null });
    S().undo();
    expect(routeOf('w2')).toEqual({ laneY: 24, laneX: 10 });
  });

  it('같은 값 재입력·없는 값 삭제는 히스토리를 쌓지 않는다', () => {
    S().setWireRoute!('w2', { laneY: 24 });
    S().setWireRoute!('w2', { laneY: 24 });
    S().setWireRoute!('w2', { laneX: null });
    S().undo();
    expect(routeOf('w2')).toBeUndefined();   // 한 단계로 처음 상태까지 돌아온다
  });

  it('없는 배선 id 는 아무 일도 하지 않는다', () => {
    S().setWireRoute!('없는배선', { laneY: 24 });
    expect(S().canUndo()).toBe(false);
  });
});
