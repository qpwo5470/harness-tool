/**
 * 도면 영역(pdfDraw) — 레퍼런스(이스턴웰스 render.py)에 맞춘 그림 규칙.
 *
 * 그림이 맞는지는 렌더해서 눈으로 봐야 한다. 여기서는 **그 그림을 받치는 규칙**만
 * 못박는다: 패드 번호가 가운데·굵게, 배선 끝 접점 번호, 미사용 핀 X, 끝단 심볼 판정,
 * 이름표 조각이 겹치지 않음, 핀 배열 뷰 경고가 잘리지 않고 접힘, 제목블록 행 지정.
 */
import { describe, it, expect } from 'vitest';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { Connector, HarnessDocument, PartLibraryItem } from '../types';
import {
  buildDrawing, drawDrawing, drawFrameAndTitleBlock, drawPinView, endGlyphOf, fitTransform,
  wrapSegments, PAD, PAPER_PT, C, type DrawText, type PdfLike, type TextStyle,
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
    setLineDashPattern: log('setLineDashPattern'), addPage: log('addPage'), setPage: log('setPage'),
    getNumberOfPages: () => 1, save: log('save'),
    // 대문자 Helvetica 처럼 **어림보다 넓게** 잰다 — 겹침 시험이 그 차이를 잡는다
    getTextWidth: (t: string) => [...t].length * 7,
    internal: { pageSize: { getWidth: () => PAPER_PT.A4.w, getHeight: () => PAPER_PT.A4.h } },
  };
  const text: DrawText = (t, x, y, s = {}) => {
    texts.push({ t, x, y, s });
    return [...t].length * (s.size ?? 9) * 0.5;   // 실제로 그린 폭은 일부러 좁게 돌려준다
  };
  return { pdf, ops, texts, text };
}

function draw(doc: HarnessDocument) {
  const r = rec();
  const dr = buildDrawing(doc);
  const xf = fitTransform(dr.bounds, { x: 30, y: 40, w: 760, h: 300 });
  drawDrawing(r.pdf, dr, xf, r.text);
  return { ...r, dr, xf };
}

describe('패드 번호 — 가운데 · 굵게 (render.py _draw_grid)', () => {
  it('하우징 패드 번호는 패드 한가운데 x 에 가운데 정렬로 굵게 찍힌다', () => {
    const { dr, xf, texts } = draw(sampleDoc);
    const n = dr.nodes.find((x) => x.kind === 'connector' && x.glyph === 'housing')!;
    const p = n.pads[0];
    const cx = xf.tx + (p.x + PAD / 2) * xf.scale;
    const hit = texts.find((t) => t.t === p.label && Math.abs(t.x - cx) < 1e-6);
    expect(hit, '패드 가운데 번호').toBeTruthy();
    expect(hit!.s.bold).toBe(true);
    expect(hit!.s.align).toBe('center');
  });
});

describe('접점 번호 (render.py contact_no)', () => {
  it('핀에 닿는 배선 끝마다 번호가 하나씩 선다', () => {
    const { dr } = draw(sampleDoc);
    // 스플라이스 끝은 번호가 뜻이 없어 세지 않는다
    const isPin = (e: HarnessDocument['wires'][number]['from']) =>
      e.type === 'pin' && sampleDoc.connectors.find((c) => c.id === e.connectorId)?.kind !== 'splice';
    const pinEnds = sampleDoc.wires.reduce((n, w) => n + (isPin(w.from) ? 1 : 0) + (isPin(w.to) ? 1 : 0), 0);
    expect(pinEnds).toBeGreaterThan(0);
    const ends = dr.wires.flatMap((w) => w.ends ?? []).filter((v) => v != null);
    expect(ends.length).toBe(pinEnds);
  });

  it('번호는 배선 끝(핸들) 바깥, 흰 바탕 위에 굵게 찍힌다', () => {
    const { dr, xf, texts, ops } = draw(sampleDoc);
    const w = dr.wires.find((x) => x.ends?.[0] != null)!;
    const a = w.points[0];
    const hits = texts.filter((t) => t.t === w.ends![0] && t.s.size != null && t.s.color === C.text2);
    expect(hits.length).toBeGreaterThan(0);
    // 끝점에서 가장 가까운 번호가 끝점 바로 바깥(첫 구간 안) ~ 40px 안에 있다.
    // 첫 구간이 짧으면 꺾임을 넘지 않게 안쪽으로 당기므로 하한은 스텁이 아니라 2px 다
    const d = Math.min(...hits.map((t) => Math.hypot(t.x - (xf.tx + a.x * xf.scale), t.y - (xf.ty + a.y * xf.scale)))) / xf.scale;
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(40);
    expect(ops.some((o) => o.op === 'setFillColor' && o.args[0] === C.white)).toBe(true);
  });
});

describe('미사용 핀 (Connector.unused)', () => {
  it('unused 에 적힌 핀은 pad.unused 이고 X 두 줄이 그어진다', () => {
    const c0 = sampleDoc.connectors[0];
    const doc: HarnessDocument = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c, i) => (i === 0 ? { ...c, unused: [c.pins[0].index] } : c)),
    };
    const base = draw(sampleDoc).ops.filter((o) => o.op === 'line').length;
    const { dr, ops } = draw(doc);
    const n = dr.nodes.find((x) => x.id === c0.id)!;
    expect(n.pads[0].unused).toBe(true);
    expect(n.pads.slice(1).every((p) => !p.unused)).toBe(true);
    expect(ops.filter((o) => o.op === 'line').length - base).toBe(2);
  });
});

describe('끝단 심볼 판정 — 데이터가 가르는 것만', () => {
  const conn = (over: Partial<Connector> = {}): Connector => ({
    id: 'c', kind: 'connector', housingId: 'p', pins: [{ id: 'p1', index: 1 }],
    orientation: 180, positions: {}, ...over,
  });
  const lug = (id: string): PartLibraryItem => ({ id, category: 'terminal', name: id, pinCount: 1 });

  it.each([
    ['lib-lug-faston-110-rec', 'faston'],
    ['lib-lug-faston-110-tab', 'housing'],
    ['lib-lug-ferrule-0508', 'ferrule'],
    ['lib-lug-ring-2-4', 'lug'],
    ['lib-lug-fork-2-4', 'lug'],
    ['lib-jst-sxh-001t', 'housing'],
  ])('%s → %s', (id, want) => {
    expect(endGlyphOf(conn(), lug(id))).toBe(want);
  });

  it('스플라이스는 kind 로 판정한다', () => {
    expect(endGlyphOf(conn({ kind: 'splice' }), undefined)).toBe('splice');
  });

  it('위·아래로 나가는 러그는 일반 격자로 남긴다 (심볼과 핸들이 맞지 않는다)', () => {
    expect(endGlyphOf(conn({ orientation: 90 }), lug('lib-lug-ferrule-0508'))).toBe('housing');
  });

  it('하우징 부품은 언제나 housing', () => {
    const h: PartLibraryItem = { id: 'lib-jst-xhp-10p', category: 'housing', name: 'XHP-10', pinCount: 10 };
    expect(endGlyphOf(conn(), h)).toBe('housing');
  });
});

describe('이름표 — 조각이 겹치지 않는다', () => {
  it('ref · 이름 · 방향 조각은 앞 조각의 (잰 폭과 그린 폭 중 큰 쪽) 뒤에서 시작한다', () => {
    const { texts, dr } = draw(sampleDoc);
    for (const n of dr.nodes.filter((x) => x.kind === 'connector')) {
      const i = texts.findIndex((t) => t.t === n.ref && t.s.bold && t.s.size != null && t.s.color === C.text);
      expect(i).toBeGreaterThanOrEqual(0);
      const [r, name, dir] = texts.slice(i, i + 3);
      expect(name.t).toBe(n.name);
      expect(dir.t).toBe(n.dir);
      // 목 getTextWidth 는 한 글자 7pt — 그 폭을 넘어서야 겹치지 않는다
      expect(name.x).toBeGreaterThanOrEqual(r.x + [...r.t].length * 7 - 1e-6);
      expect(dir.x).toBeGreaterThanOrEqual(name.x + [...name.t].length * 7 - 1e-6);
    }
  });
});

describe('핀 배열 뷰 — 뷰 기준 경고는 자르지 않고 접는다', () => {
  it('좁은 칸에서도 경고 전체가 줄로 나뉘어 그려지고 말줄임이 없다', () => {
    const { pdf, text, texts } = rec();
    const h = drawPinView(pdf, text, { x: 0, y: 0, w: 90 }, {
      ref: 'J1', name: 'JST XHP-10 XH 하우징 (10P)', mpn: 'XHP-10', layout: [[1, 2]],
    });
    const danger = texts.filter((t) => t.s.color === C.danger).map((t) => t.t);
    expect(danger.length).toBeGreaterThan(1);
    const all = danger.join(' ');
    expect(all).toContain('뷰 기준 없음');
    expect(all).toContain('실물 대조 필요');
    expect(all).not.toMatch(/…|\.\.$/);
    expect(texts.every((t) => t.s.maxWidth == null)).toBe(true);
    expect(h).toBeGreaterThan(11 * danger.length);
    // 배열은 그리지 않는다 (금기 2)
    expect(texts.some((t) => t.t === '1' || t.t === '2')).toBe(false);
  });

  it('wrapSegments 는 덩어리 안에서 줄을 바꾸지 않는다', () => {
    const lines = wrapSegments(['XHP-10 ·', '뷰 기준 없음 —', '배열 생략,', '실물 대조 필요'], 8, 70);
    expect(lines.some((l) => l.includes('뷰 기준 없음'))).toBe(true);
    expect(lines.join(' ')).toBe('XHP-10 · 뷰 기준 없음 — 배열 생략, 실물 대조 필요');
  });

  it('덩어리 하나가 폭을 넘으면 글자 단위로 쪼개되 버리지 않는다', () => {
    const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    expect(wrapSegments([s], 10, 40).join('')).toBe(s);
  });
});

describe('제목블록 — rows 로 글자를 통째로 지정', () => {
  it('rows 를 주면 문서가 아니라 그 글자를 3행에 그린다', () => {
    const { pdf, text, texts } = rec();
    drawFrameAndTitleBlock(pdf, sampleDoc, text, PAPER_PT.A4, {
      rows: { title: '세트 표지', no: 'EW-00', line2: '구매품 · 제작 대상 아님', rev: 'Rev.B', line3: '12종', date: '2026-10-07' },
    });
    const t = texts.map((x) => x.t);
    for (const s of ['세트 표지', 'EW-00', '구매품 · 제작 대상 아님', 'Rev.B', '12종', '2026-10-07']) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain(sampleDoc.name);
    const title = texts.find((x) => x.t === '세트 표지')!;
    expect(title.s.bold).toBe(true);
  });

  it('rows 가 없으면 예전대로 문서에서 만든다 (이름 · SCALE · 길이)', () => {
    const { pdf, text, texts } = rec();
    drawFrameAndTitleBlock(pdf, sampleDoc, text, PAPER_PT.A4, { perSet: 2 });
    const t = texts.map((x) => x.t);
    expect(t).toContain(sampleDoc.name);
    expect(t.some((s) => s.startsWith('SCALE 1:1 · 논리 · 배선 '))).toBe(true);
    expect(t.some((s) => s.includes('세트당 2EA'))).toBe(true);
  });
});
