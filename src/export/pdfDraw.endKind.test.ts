/**
 * 끝단 종류(PartLibraryItem.endKind) — 도면 기호 선택과 그 그림의 규칙.
 *
 * 그림이 맞는지는 렌더해서 눈으로 본다. 여기서는 **기호를 고르는 규칙**과
 * 기호가 지켜야 할 약속만 못박는다:
 *  · endKind 가 taxonomy 보다 먼저다. 핸들과 맞출 수 없는 방향이면 일반 격자로 남는다.
 *  · 배선 끝점은 기호가 바뀌어도 geometry 핸들 그대로다(기호는 장식).
 *  · 배럴 지름은 부품 spec 에 있을 때만 적는다 — 5.5/2.1 을 지어내지 않는다.
 *  · 납처리 끝은 색 약호가 끝을 말하고 접점 번호는 붙지 않는다.
 *  · 도면 이름은 shortName 이 먼저다.
 */
import { describe, it, expect } from 'vitest';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { Connector, HarnessDocument, PartLibraryItem, Wire } from '../types';
import {
  buildDrawing, drawDrawing, drawPinViews, dsubOutline, endGlyphOf, fitTransform, pdfWireWidthPt,
  wireWidthPx, PAPER_PT, type DrawText, type PdfLike, type TextStyle,
} from './pdfDraw';

type Txt = { t: string; x: number; y: number; s: TextStyle };
type Op = { op: string; args: unknown[] };

function rec(): { pdf: PdfLike; ops: Op[]; texts: Txt[]; text: DrawText } {
  const ops: Op[] = [];
  const texts: Txt[] = [];
  const log = (op: string) => (...args: unknown[]) => void ops.push({ op, args });
  const pdf: PdfLike = {
    setLineWidth: log('setLineWidth'), setDrawColor: log('setDrawColor'),
    setFillColor: log('setFillColor'), setTextColor: log('setTextColor'),
    setFontSize: log('setFontSize'), setFont: log('setFont'), text: log('text'),
    line: log('line'), rect: log('rect'), addImage: log('addImage'),
    triangle: log('triangle'),
    setLineDashPattern: log('setLineDashPattern'), addPage: log('addPage'), setPage: log('setPage'),
    getNumberOfPages: () => 1, save: log('save'),
    getTextWidth: (t: string) => [...t].length * 7,
    internal: { pageSize: { getWidth: () => PAPER_PT.A4.w, getHeight: () => PAPER_PT.A4.h } },
  };
  const text: DrawText = (t, x, y, s = {}) => {
    texts.push({ t, x, y, s });
    return [...t].length * (s.size ?? 9) * 0.5;
  };
  return { pdf, ops, texts, text };
}

// ── 부품 ────────────────────────────────────────────────────────────────
const FREE: PartLibraryItem = {
  id: 'lib-free-end-4p', category: 'housing', name: '납처리 전선단 4가닥', shortName: '납처리 전선단',
  endKind: 'free', spec: { 처리: '피복탈거 · 납처리' }, pinCount: 4,
  pinLayout: [1, 2, 3, 4].map((i) => ({ index: i, label: String(i), offset: { x: i - 1, y: 0 } })),
};
const BARREL: PartLibraryItem = {
  id: 'lib-dc-barrel', category: 'housing', name: 'DC 배럴잭 암 5.5/2.1', shortName: 'DC 배럴잭 암',
  endKind: 'barrel', mpn: '미정', spec: { 외경: '5.5mm', 내경: '2.1mm' }, pinCount: 2,
  pinLayout: [
    { index: 1, label: '+', offset: { x: 0, y: 0 } },
    { index: 2, label: '−', offset: { x: 1, y: 0 } },
  ],
};
const DSUB: PartLibraryItem = {
  id: 'lib-dsub-9p-f', category: 'housing', name: 'D-SUB 9P 암 (DB-9F)', shortName: 'D-SUB 9P 암',
  endKind: 'dsub', mpn: 'DB-9F', pinCount: 9,
  pinLayout: [
    ...[1, 2, 3, 4, 5].map((n, i) => ({ index: n, label: String(n), offset: { x: i, y: 0 } })),
    ...[6, 7, 8, 9].map((n, i) => ({ index: n, label: String(n), offset: { x: i, y: 1 } })),
  ],
  layout: [[5, 4, 3, 2, 1], [null, 9, 8, 7, 6]],
  view: '결합면 기준',
};

const pinsOf = (cid: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${cid}-p${i + 1}`, index: i + 1 }));
const P = (connectorId: string, pinId: string) => ({ type: 'pin' as const, connectorId, pinId });
const wire = (id: string, from: Wire['from'], to: Wire['to'], base: string): Wire => ({
  id, from, to, color: { base }, gauge: { system: 'awg', value: 22 }, lengthMm: 1800,
});

/** 납처리 4가닥(180°, 왼쪽) → 배럴 2극(0°, 오른쪽). 1·4 만 잇는다(2·3 은 빈 핀). */
function ledDoc(barrel: PartLibraryItem = BARREL, barrelO: Connector['orientation'] = 0): HarnessDocument {
  const w1: Connector = {
    id: 'w1', kind: 'connector', housingId: FREE.id, orientation: 180,
    positions: { logical: { x: 40, y: 60 } }, pins: pinsOf('w1', 4),
  };
  const j1: Connector = {
    id: 'j1', kind: 'connector', housingId: barrel.id, orientation: barrelO,
    positions: { logical: { x: 480, y: 70 } }, pins: pinsOf('j1', 2),
  };
  return {
    ...sampleDoc,
    connectors: [w1, j1],
    devices: [],
    cables: [],
    wires: [
      wire('wr', P('w1', 'w1-p4'), P('j1', 'j1-p1'), 'red'),
      wire('wb', P('w1', 'w1-p1'), P('j1', 'j1-p2'), 'black'),
    ],
    usedParts: [FREE, barrel],
  };
}

function render(doc: HarnessDocument) {
  const r = rec();
  const dr = buildDrawing(doc);
  const xf = fitTransform(dr.bounds, { x: 30, y: 40, w: 760, h: 300 });
  drawDrawing(r.pdf, dr, xf, r.text);
  return { ...r, dr, xf };
}

// ============================================================

describe('endGlyphOf — endKind 가 먼저다', () => {
  const conn = (over: Partial<Connector> = {}): Connector => ({
    id: 'c', kind: 'connector', housingId: 'p', pins: [{ id: 'p1', index: 1 }],
    orientation: 180, positions: {}, ...over,
  });
  const part = (endKind: PartLibraryItem['endKind'], over: Partial<PartLibraryItem> = {}): PartLibraryItem => ({
    id: 'lib-x', category: 'housing', name: 'x', pinCount: 1, endKind, ...over,
  });

  it.each([
    ['free', 'free'],
    ['barrel', 'barrel'],
    ['dsub', 'dsub'],
    ['faston', 'faston'],
    ['ferrule', 'ferrule'],
    ['ring', 'lug'],
    ['fork', 'lug'],
  ] as const)('endKind %s → %s', (ek, want) => {
    expect(endGlyphOf(conn(), part(ek))).toBe(want);
  });

  it('endKind 는 taxonomy 판정을 이긴다 (탭 id 라도 endKind 가 리셉터클이면 파스톤)', () => {
    expect(endGlyphOf(conn(), part('faston', { id: 'lib-lug-faston-110-tab', category: 'terminal' }))).toBe('faston');
    expect(endGlyphOf(conn(), part('ring', { id: 'lib-jst-xhp-10p' }))).toBe('lug');
  });

  it('endKind 가 없으면 예전 taxonomy 판정 그대로', () => {
    expect(endGlyphOf(conn(), part(undefined, { id: 'lib-lug-ferrule-0508', category: 'terminal' }))).toBe('ferrule');
    expect(endGlyphOf(conn(), part(undefined, { id: 'lib-jst-xhp-3p' }))).toBe('housing');
  });

  it('파스톤 심볼은 리셉터클 그림 — 수(plug/header)로 적힌 부품은 일반 격자', () => {
    expect(endGlyphOf(conn(), part('faston', { gender: 'plug' }))).toBe('housing');
    expect(endGlyphOf(conn(), part('faston', { gender: 'header' }))).toBe('housing');
    expect(endGlyphOf(conn(), part('faston', { gender: 'receptacle' }))).toBe('faston');
  });

  it.each([90, 270] as const)('위·아래(%s°)로 나가면 가로로 눕는 기호는 일반 격자 — D-SUB 만 남는다', (o) => {
    for (const ek of ['free', 'barrel', 'faston', 'ferrule', 'ring', 'fork'] as const) {
      expect(endGlyphOf(conn({ orientation: o }), part(ek)), ek).toBe('housing');
    }
    expect(endGlyphOf(conn({ orientation: o }), part('dsub'))).toBe('dsub');
  });

  it('그리는 격자가 두 열 이상이면 가로 기호는 일반 격자', () => {
    expect(endGlyphOf(conn(), part('free'), 2)).toBe('housing');
    expect(endGlyphOf(conn(), part('dsub'), 2)).toBe('dsub');
  });

  it('배럴은 극이 둘 이하일 때만 — 셋 이상이면 그림이 거짓말이 된다', () => {
    const three = conn({ pins: [1, 2, 3].map((i) => ({ id: `p${i}`, index: i })) });
    expect(endGlyphOf(three, part('barrel'))).toBe('housing');
  });

  it('스플라이스는 endKind 와 무관하게 splice', () => {
    expect(endGlyphOf(conn({ kind: 'splice' }), part('free'))).toBe('splice');
  });
});

describe('buildDrawing — 납처리 · 배럴', () => {
  it('부품 endKind 로 기호가 서고, 도면 이름은 shortName', () => {
    const dr = buildDrawing(ledDoc());
    const w1 = dr.nodes.find((n) => n.id === 'w1')!;
    const j1 = dr.nodes.find((n) => n.id === 'j1')!;
    expect(w1.glyph).toBe('free');
    expect(j1.glyph).toBe('barrel');
    expect(w1.name).toBe('납처리 전선단');
    expect(j1.name).toBe('DC 배럴잭 암');
  });

  it('배선 끝점은 기호와 무관하게 geometry 핸들 그대로다', () => {
    const dr = buildDrawing(ledDoc());
    const w1 = dr.nodes.find((n) => n.id === 'w1')!;
    const j1 = dr.nodes.find((n) => n.id === 'j1')!;
    const wr = dr.wires.find((w) => w.id === 'wr')!;
    const h4 = w1.pads.find((p) => p.pinId === 'w1-p4')!.handle!;
    const hp = j1.pads.find((p) => p.pinId === 'j1-p1')!.handle!;
    expect(wr.points[0]).toEqual(h4);
    expect(wr.points[wr.points.length - 1]).toEqual(hp);
  });

  it('납처리 끝: 핀마다 붙은 전선의 색 약호, 빈 핀은 빈칸 · 접점 번호 없음', () => {
    const dr = buildDrawing(ledDoc());
    const w1 = dr.nodes.find((n) => n.id === 'w1')!;
    expect(w1.wireAbbr).toEqual(['B', '', '', 'R']);
    const wr = dr.wires.find((w) => w.id === 'wr')!;
    expect(wr.ends?.[0]).toBeNull();          // 납처리 쪽
    expect(wr.ends?.[1]).toBe('+');           // 배럴 쪽은 극 이름
  });

  it('납처리 끝은 품번 대신 spec.처리 를 캡션으로 적는다', () => {
    const dr = buildDrawing(ledDoc());
    expect(dr.nodes.find((n) => n.id === 'w1')!.mpn).toBe('피복탈거 · 납처리');
  });

  it('그림: 약호 글자가 서고, 납처리 패드 번호(1~4)는 찍지 않는다', () => {
    const { texts } = render(ledDoc());
    expect(texts.some((t) => t.t === 'R' && t.s.bold)).toBe(true);
    expect(texts.some((t) => t.t === 'B' && t.s.bold)).toBe(true);
    for (const n of ['2', '3']) expect(texts.some((t) => t.t === n), `핀 ${n}`).toBe(false);
  });

  it('배럴 지름은 spec 에 있을 때만 — 없으면 5.5/2.1 을 지어내지 않는다', () => {
    const withSpec = render(ledDoc());
    expect(withSpec.dr.nodes.find((n) => n.id === 'j1')!.barrelDia).toEqual({ outer: 'Ø5.5', inner: 'Ø2.1' });
    expect(withSpec.texts.some((t) => t.t === 'Ø5.5')).toBe(true);
    expect(withSpec.texts.some((t) => t.t === 'Ø2.1')).toBe(true);

    const bare: PartLibraryItem = { ...BARREL, spec: {}, name: 'DC 배럴잭', mpn: undefined };
    const noSpec = render(ledDoc(bare));
    expect(noSpec.texts.some((t) => /5\.5|2\.1|[⌀Ø]/.test(t.t))).toBe(false);
  });

  it('배럴 통은 하우징 박스 밖 배선 반대쪽 — 종이 경계(bounds)가 그만큼 넓다', () => {
    const dr = buildDrawing(ledDoc());
    const j1 = dr.nodes.find((n) => n.id === 'j1')!;
    expect(dr.bounds.x + dr.bounds.w).toBeGreaterThanOrEqual(j1.box.x + j1.box.w + 44 - 1e-6);
  });
});

describe('D-SUB 쉘', () => {
  it.each([0, 90, 180, 270] as const)('%s° — 배선이 나가는 변은 깎지 않는다 (핸들이 그 변 위에 있다)', (o) => {
    const b = { x: 10, y: 20, w: 68, h: 158 };
    const pts = dsubOutline(b, o);
    expect(pts).toHaveLength(6);
    const on = (pred: (p: { x: number; y: number }) => boolean) => pts.filter(pred).length;
    // 배선 변의 두 모서리가 그대로 꼭짓점이다
    if (o === 0) expect(on((p) => p.x === b.x && (p.y === b.y || p.y === b.y + b.h))).toBe(2);
    if (o === 180) expect(on((p) => p.x === b.x + b.w && (p.y === b.y || p.y === b.y + b.h))).toBe(2);
    if (o === 90) expect(on((p) => p.y === b.y && (p.x === b.x || p.x === b.x + b.w))).toBe(2);
    if (o === 270) expect(on((p) => p.y === b.y + b.h && (p.x === b.x || p.x === b.x + b.w))).toBe(2);
    // 꼭짓점은 전부 박스 안
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(b.x);
      expect(p.x).toBeLessThanOrEqual(b.x + b.w);
      expect(p.y).toBeGreaterThanOrEqual(b.y);
      expect(p.y).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  it('D-SUB 부품은 dsub 기호 — 격자 패드는 그대로, 외곽은 다각형(삼각형 채움)', () => {
    const j2: Connector = {
      id: 'j2', kind: 'connector', housingId: DSUB.id, orientation: 0,
      positions: { logical: { x: 300, y: 40 } }, pins: pinsOf('j2', 9),
    };
    const doc: HarnessDocument = { ...sampleDoc, connectors: [j2], devices: [], cables: [], wires: [], usedParts: [DSUB] };
    const { dr, ops, texts } = render(doc);
    const n = dr.nodes[0];
    expect(n.glyph).toBe('dsub');
    expect(n.name).toBe('D-SUB 9P 암');
    expect(ops.filter((o) => o.op === 'triangle').length).toBeGreaterThanOrEqual(4);
    for (const k of ['1', '5', '6', '9']) expect(texts.some((t) => t.t === k), `패드 ${k}`).toBe(true);
  });

  it('핀 배열 뷰 머리도 shortName', () => {
    const j2: Connector = {
      id: 'j2', kind: 'connector', housingId: DSUB.id, orientation: 0,
      positions: { logical: { x: 300, y: 40 } }, pins: pinsOf('j2', 9),
    };
    const doc: HarnessDocument = { ...sampleDoc, connectors: [j2], devices: [], cables: [], wires: [], usedParts: [DSUB] };
    const r = rec();
    drawPinViews(r.pdf, doc, r.text, { x: 0, y: 0, w: 200, bottom: 400 });
    expect(r.texts.some((t) => t.t.includes('D-SUB 9P 암') && !t.t.includes('DB-9F'))).toBe(true);
  });

  it('납처리 · 배럴 · 스플라이스는 핀 배열 뷰에 "미등록" 경고를 띄우지 않는다', () => {
    const r = rec();
    drawPinViews(r.pdf, ledDoc(), r.text, { x: 0, y: 0, w: 200, bottom: 400 });
    expect(r.texts.some((t) => /등록된 실물 배열이 없다/.test(t.t))).toBe(false);
    expect(r.texts.some((t) => /핀 배열 없음/.test(t.t))).toBe(true);
  });
});

describe('이름표 — 레퍼런스 번호가 이름보다 크고 굵다', () => {
  it('J 번호 글꼴 > 이름 글꼴', () => {
    const { texts, dr } = render(ledDoc());
    const j1 = dr.nodes.find((n) => n.id === 'j1')!;
    const ref = texts.find((t) => t.t === j1.ref)!;
    const name = texts.find((t) => t.t === j1.name)!;
    expect(ref.s.bold).toBe(true);
    expect(ref.s.size!).toBeGreaterThan(name.s.size!);
  });
});

describe('전선 굵기 (종이)', () => {
  const g = (value: number) => wireWidthPx({ system: 'awg', value });

  it('축척이 작아도 하한을 지킨다 — AWG22 는 축척 0.4 에서도 ≈2pt', () => {
    expect(pdfWireWidthPt(g(22), 0.4)).toBeGreaterThanOrEqual(1.9);
    expect(pdfWireWidthPt(g(22), 0.4)).toBeLessThanOrEqual(2.2);
  });

  it('게이지 순서는 그대로 (굵은 전선이 굵게)', () => {
    for (const s of [0.4, 1, 1.6]) {
      expect(pdfWireWidthPt(g(16), s)).toBeGreaterThan(pdfWireWidthPt(g(18), s));
      expect(pdfWireWidthPt(g(18), s)).toBeGreaterThan(pdfWireWidthPt(g(22), s));
      expect(pdfWireWidthPt(g(22), s)).toBeGreaterThan(pdfWireWidthPt(g(28), s));
    }
  });

  it('도면은 그 굵기로 선을 긋는다', () => {
    const { ops, xf } = render(ledDoc());
    const want = pdfWireWidthPt(g(22), xf.scale);
    expect(ops.some((o) => o.op === 'setLineWidth' && Math.abs((o.args[0] as number) - want) < 1e-9)).toBe(true);
  });
});
