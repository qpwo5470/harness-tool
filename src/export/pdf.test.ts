/**
 * Agent D 소유 — PDF 출력 테스트.
 *
 * jsPDF 를 목으로 두고 **무엇을 그렸는지**를 본다. 픽셀을 비교하는 게 아니라
 * "몇 면인가 · 제목블록에 무엇이 적혔나 · 접속표가 몇 줄인가 · 넘치면 나뉘는가 ·
 * 세트는 하네스 수 × 3면인가" 를 검사한다. 스냅샷 방식에서는 아무것도 검사할
 * 수 없었던 것들이다.
 *
 * 이 파일은 node 환경에서 돈다(=document 가 없다). 그래서 한글 래스터 경로가
 * 꺼지고 pdf.text 폴백을 타므로 그려진 글자를 문자열로 볼 수 있다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HarnessDocument, KitDocument, Wire } from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import { buildPartList, buildRunList } from './exporters';

// ── jsPDF 목 ────────────────────────────────────────────────────────────────
type Op = { op: string; args: unknown[]; page: number };

const rec = vi.hoisted(() => ({
  ops: [] as { op: string; args: unknown[]; page: number }[],
  ctorArgs: [] as unknown[],
  saved: [] as string[],
  pages: 0,
  reset() {
    this.ops = [];
    this.ctorArgs = [];
    this.saved = [];
    this.pages = 0;
  },
}));

vi.mock('jspdf', () => {
  class FakePdf {
    private pageCount = 1;
    private cur = 1;
    private w: number;
    private h: number;
    internal: { pageSize: { getWidth(): number; getHeight(): number } };

    constructor(opts: { format?: string } = {}) {
      rec.ctorArgs.push(opts);
      const a3 = String(opts.format ?? 'a3').toLowerCase() === 'a3';
      // 가로(landscape)
      this.w = a3 ? 1190.55 : 841.89;
      this.h = a3 ? 841.89 : 595.28;
      const self = this;
      this.internal = { pageSize: { getWidth: () => self.w, getHeight: () => self.h } };
      rec.pages = 1;
    }
    private log(op: string, ...args: unknown[]) {
      rec.ops.push({ op, args, page: this.cur });
      return this;
    }
    setLineWidth(...a: unknown[]) { return this.log('setLineWidth', ...a); }
    setDrawColor(...a: unknown[]) { return this.log('setDrawColor', ...a); }
    setFillColor(...a: unknown[]) { return this.log('setFillColor', ...a); }
    setTextColor(...a: unknown[]) { return this.log('setTextColor', ...a); }
    setFontSize(...a: unknown[]) { return this.log('setFontSize', ...a); }
    setFont(...a: unknown[]) { return this.log('setFont', ...a); }
    text(...a: unknown[]) { return this.log('text', ...a); }
    line(...a: unknown[]) { return this.log('line', ...a); }
    rect(...a: unknown[]) { return this.log('rect', ...a); }
    addImage(...a: unknown[]) { return this.log('addImage', ...a); }
    setLineDashPattern(...a: unknown[]) { return this.log('setLineDashPattern', ...a); }
    addPage() {
      this.pageCount += 1;
      this.cur = this.pageCount;
      rec.pages = this.pageCount;
      return this.log('addPage');
    }
    setPage(n: number) {
      this.cur = n;
      return this.log('setPage', n);
    }
    getNumberOfPages() { return this.pageCount; }
    save(name: string) {
      rec.saved.push(name);
      return this.log('save', name);
    }
  }
  return { jsPDF: FakePdf };
});

// 목이 걸린 뒤에 불러와야 한다
const { downloadPdf, downloadKitPdf, partLines } = await import('./pdf');
const {
  buildDrawing, chunk, estimateTextWidth, fitTransform, needsRaster,
  truncateToWidth, wireWidthPx,
} = await import('./pdfDraw');

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 그려진 모든 글자 (페이지 정보 포함) */
function texts(): { s: string; page: number }[] {
  return rec.ops
    .filter((o: Op) => o.op === 'text')
    .map((o: Op) => ({ s: String(o.args[0]), page: o.page }));
}
function allText(): string[] {
  return texts().map((t) => t.s);
}
function textsOnPage(n: number): string[] {
  return texts().filter((t) => t.page === n).map((t) => t.s);
}
function opCount(op: string): number {
  return rec.ops.filter((o: Op) => o.op === op).length;
}

/** 와이어를 n 본 가진 문서 (표 페이지 분할 확인용) */
function docWithWires(n: number): HarnessDocument {
  const wires: Wire[] = Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    from: { type: 'pin', connectorId: 'con-a', pinId: 'a1' },
    to: { type: 'pin', connectorId: 'sp-1', pinId: 's1' },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
    lengthMm: 100 + i,
  }));
  return { ...sampleDoc, wires };
}

function kitOf(...docs: HarnessDocument[]): KitDocument {
  return {
    schemaVersion: 2,
    id: 'kit-1',
    name: '자판기 1대분',
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    harnesses: docs,
    set: {
      id: 'set-1', pn: 'KIT-2408', name: '자판기 1대분',
      items: docs.map((d) => ({ harnessId: d.id, perSet: 1 })),
      orderQty: 1,
    },
  };
}

beforeEach(() => rec.reset());

// ============================================================
describe('downloadPdf — 페이지 구성', () => {
  it('하네스 하나는 배선도 · 접속표 · 파트리스트 세 면이다', async () => {
    await downloadPdf(sampleDoc);
    expect(rec.pages).toBe(3);
    expect(opCount('addPage')).toBe(2); // 첫 면은 생성 시 이미 있다
  });

  it('DOM 스냅샷을 쓰지 않는다 — 선과 사각형으로 그린다', async () => {
    await downloadPdf(sampleDoc);
    // node 환경엔 canvas 가 없으니 addImage 가 한 번도 불리면 안 된다
    expect(opCount('addImage')).toBe(0);
    // 배선도 면(1면)에 선·사각형이 실제로 그려졌다
    const page1 = rec.ops.filter((o: Op) => o.page === 1);
    expect(page1.filter((o: Op) => o.op === 'line').length).toBeGreaterThan(10);
    expect(page1.filter((o: Op) => o.op === 'rect').length).toBeGreaterThan(5);
  });

  it('용지는 기본 A3, 옵션으로 A4', async () => {
    await downloadPdf(sampleDoc);
    expect((rec.ctorArgs[0] as { format: string }).format).toBe('a3');

    rec.reset();
    await downloadPdf(sampleDoc, { paper: 'A4' });
    expect((rec.ctorArgs[0] as { format: string }).format).toBe('a4');
  });

  it('파일명은 문서명에서 만들고, 옵션으로 덮어쓸 수 있다', async () => {
    await downloadPdf(sampleDoc);
    expect(rec.saved[0]).toBe('샘플-하네스.pdf');

    rec.reset();
    await downloadPdf(sampleDoc, { filename: 'ABC-도면.pdf' });
    expect(rec.saved[0]).toBe('ABC-도면.pdf');
  });

  it('옛 호출부가 넘기던 DOM 요소는 무시하고 그대로 그린다', async () => {
    const fakeEl = { nodeType: 1 } as unknown as HTMLElement;
    await downloadPdf(sampleDoc, fakeEl);
    expect(rec.pages).toBe(3);
    expect(opCount('addImage')).toBe(0);
  });
});

// ============================================================
describe('제목블록 · 푸터', () => {
  it('문서명 · 도번 · SCALE 1:1 · Rev 를 1면에 적는다', async () => {
    const doc: HarnessDocument = { ...sampleDoc, drawingNo: 'HW-001', rev: 'B' };
    await downloadPdf(doc);
    const p1 = textsOnPage(1);
    expect(p1).toContain('샘플 하네스');
    expect(p1).toContain('HW-001');
    expect(p1).toContain('Rev.B');
    expect(p1.some((s) => s.startsWith('SCALE 1:1'))).toBe(true);
  });

  it('도번 · Rev 가 없으면 지어내지 않고 — 로 둔다', async () => {
    await downloadPdf(sampleDoc); // drawingNo · rev 없음
    const p1 = textsOnPage(1);
    expect(p1.filter((s) => s === '—').length).toBe(2);
    expect(p1.some((s) => s.includes('Rev.'))).toBe(false);
  });

  it('모든 면 아래에 문서명 · 도번 · Rev · N/M 푸터가 붙는다', async () => {
    const doc: HarnessDocument = { ...sampleDoc, drawingNo: 'HW-001', rev: 'B' };
    await downloadPdf(doc);
    const feet = allText().filter((s) => /\d+\/\d+$/.test(s));
    expect(feet).toEqual([
      '샘플 하네스 · HW-001 · Rev.B · 1/3',
      '샘플 하네스 · HW-001 · Rev.B · 2/3',
      '샘플 하네스 · HW-001 · Rev.B · 3/3',
    ]);
  });
});

// ============================================================
describe('접속표', () => {
  it('buildRunList 의 모든 행을 FROM · TO · 게이지까지 적는다', async () => {
    await downloadPdf(sampleDoc);
    const rows = buildRunList(sampleDoc);
    expect(rows.length).toBe(3);
    const p2 = textsOnPage(2);
    expect(p2).toContain('접속표 (FROM → TO)');
    for (const r of rows) {
      expect(p2).toContain(r.from);
      expect(p2).toContain(r.to);
    }
    // 색은 약호 + 이름을 함께 — 흑백 인쇄 대비
    expect(p2.some((s) => s.startsWith('R/W red/white'))).toBe(true);
  });

  it('행이 넘치면 페이지를 나누고 헤더를 페이지마다 반복한다', async () => {
    await downloadPdf(docWithWires(140));
    // 배선도 1 + 접속표 2 + 파트리스트 1 이상
    expect(rec.pages).toBeGreaterThan(3);
    const headCount = allText().filter((s) => s === 'FROM').length;
    expect(headCount).toBeGreaterThanOrEqual(2);
    // 나뉜 장에는 몇 장 중 몇 장인지 적힌다
    expect(allText().some((s) => /^140본 · 1\/\d+$/.test(s))).toBe(true);
  });

  it('A4 는 A3 보다 접속표 페이지가 더 많이 필요하다', async () => {
    await downloadPdf(docWithWires(100), { paper: 'A3' });
    const a3 = rec.pages;
    rec.reset();
    await downloadPdf(docWithWires(100), { paper: 'A4' });
    expect(rec.pages).toBeGreaterThan(a3);
  });
});

// ============================================================
describe('파트리스트', () => {
  it('분류별로 묶고 소계를 붙인다', async () => {
    await downloadPdf(sampleDoc);
    const rows = buildPartList(sampleDoc);
    const cats = [...new Set(rows.map((r) => r.category))];
    const p3 = textsOnPage(3);
    expect(p3).toContain('파트리스트');
    for (const c of cats) expect(p3).toContain(c);
    expect(p3.filter((s) => s.startsWith('소계 ')).length).toBe(cats.length);
  });

  it('partLines 는 분류마다 머리줄 + 행 + 소계를 만든다', () => {
    const lines = partLines([
      { category: '커넥터', part: 'A', qty: 2 },
      { category: '커넥터', part: 'B', qty: 1 },
      { category: '와이어', part: 'AWG22 · red', qty: 3 },
    ]);
    expect(lines.map((l) => l.kind)).toEqual(['group', 'row', 'row', 'sub', 'group', 'row', 'sub']);
    expect(lines[3]).toEqual({ kind: 'sub', label: '소계 2품목 · 3개' });
  });
});

// ============================================================
describe('downloadKitPdf — 세트 묶음', () => {
  it('하네스 수 × 3면을 한 PDF 에 이어 붙인다', async () => {
    const b: HarnessDocument = { ...sampleDoc, id: 'doc-2', name: 'B 하네스', drawingNo: 'HW-002' };
    await downloadKitPdf(kitOf(sampleDoc, b));
    expect(rec.pages).toBe(6);
    expect(rec.saved[0]).toBe('KIT-2408.pdf');
  });

  it('푸터는 그 면이 속한 하네스를 가리킨다', async () => {
    const b: HarnessDocument = { ...sampleDoc, id: 'doc-2', name: 'B 하네스', drawingNo: 'HW-002' };
    await downloadKitPdf(kitOf(sampleDoc, b));
    const feet = allText().filter((s) => /\d+\/\d+$/.test(s));
    expect(feet).toHaveLength(6);
    expect(feet[0]).toBe('샘플 하네스 · — · — · 1/6');
    expect(feet[3]).toBe('B 하네스 · HW-002 · — · 4/6');
  });

  it('하네스가 없으면 빈 면 하나로 끝난다', async () => {
    await downloadKitPdf(kitOf());
    expect(rec.pages).toBe(1);
    expect(allText()).toContain('세트에 하네스가 없다.');
  });
});

// ============================================================
describe('pdfDraw 순수 함수', () => {
  it('buildDrawing 은 화면과 같은 격자·레인으로 좌표를 만든다', () => {
    const dr = buildDrawing(sampleDoc);
    // 커넥터 3 + 장치 1
    expect(dr.nodes).toHaveLength(4);
    expect(dr.wires).toHaveLength(sampleDoc.wires.length);

    // JST XH 4P: 4열 1행 → 폭 = 4*30 + 12 - 4 = 128, 높이 = 30 + 8 = 38
    const j1 = dr.nodes.find((n) => n.id === 'con-a')!;
    expect(j1.ref).toBe('J1');
    expect(j1.box.w).toBe(128);
    expect(j1.box.h).toBe(38);
    expect(j1.pads).toHaveLength(4);
    // 패드 피치 30 유지
    expect(j1.pads[1].x - j1.pads[0].x).toBe(30);

    // 스플라이스는 SP1 이고 장치는 점선 테두리
    expect(dr.nodes.find((n) => n.id === 'sp-1')!.ref).toBe('SP1');
    expect(dr.nodes.find((n) => n.id === 'dev-pi')!.dashed).toBe(true);

    // 배선은 직교 — 모든 구간이 수평 아니면 수직이다
    for (const w of dr.wires) {
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1];
        const b = w.points[i];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
      }
    }
    // 색 약호가 스텁 라벨에 실린다 (흑백 인쇄용 단서)
    expect(dr.wires[0].abbr).toBe('R/W');
  });

  it('fitTransform 은 등비로 줄이고 가운데에 놓는다', () => {
    const xf = fitTransform({ x: 0, y: 0, w: 2000, h: 1000 }, { x: 0, y: 0, w: 1000, h: 1000 });
    expect(xf.scale).toBeCloseTo(0.5);
    expect(xf.tx).toBeCloseTo(0);
    expect(xf.ty).toBeCloseTo(250); // 세로 가운데
    // 작은 도면을 무한정 키우지는 않는다
    expect(fitTransform({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 1000, h: 1000 }).scale).toBe(2);
  });

  it('전선 굵기는 게이지를 따른다 — 흑백에서도 굵기로 구분된다', () => {
    expect(wireWidthPx({ system: 'awg', value: 16 })).toBeGreaterThan(
      wireWidthPx({ system: 'awg', value: 24 }),
    );
    expect(wireWidthPx({ system: 'mm2', value: 2 })).toBeGreaterThan(
      wireWidthPx({ system: 'mm2', value: 0.5 }),
    );
  });

  it('한글은 래스터가 필요하고 ASCII 는 벡터 그대로다', () => {
    expect(needsRaster('커넥터')).toBe(true);
    expect(needsRaster('→')).toBe(true);
    expect(needsRaster('AWG22 · red/white')).toBe(false); // · 는 Latin-1
    expect(needsRaster('J1 HW-001')).toBe(false);
  });

  it('폭을 넘는 글자는 말줄임한다', () => {
    expect(truncateToWidth('짧다', 9, 200)).toBe('짧다');
    const cut = truncateToWidth('아주아주아주긴하네스이름', 9, 40);
    expect(cut.length).toBeLessThan('아주아주아주긴하네스이름'.length);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateTextWidth('AB', 10)).toBeCloseTo(10.4);
  });

  it('chunk 는 표를 페이지 수만큼 자른다', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 5)).toEqual([[]]);
  });
});

// ============================================================
// 한글 폰트 — 이 블록은 모듈 캐시를 더럽히므로 **파일 맨 끝**에 둔다
// ============================================================
describe('한글 처리', () => {
  it('브라우저(Canvas)가 있으면 한글만 이미지로 넣고 ASCII 는 벡터로 남긴다', async () => {
    const drawn: string[] = [];
    const fakeCanvas = () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        font: '',
        textBaseline: '',
        fillStyle: '',
        measureText: (s: string) => ({ width: s.length * 10 }),
        fillText: (s: string) => drawn.push(s),
      }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    });
    const prev = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { createElement: fakeCanvas };
    try {
      await downloadPdf({ ...sampleDoc, drawingNo: 'HW-001' });
    } finally {
      if (prev === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prev;
    }

    // 한글은 Canvas 로 그려 addImage 로 들어간다
    expect(drawn).toContain('샘플 하네스');
    expect(opCount('addImage')).toBeGreaterThan(0);
    // 같은 글자는 캐시해 한 번만 그린다
    expect(drawn.filter((s) => s === '샘플 하네스')).toHaveLength(1);
    // ASCII(품번 · 게이지)는 벡터 텍스트 그대로 — 인쇄물에서 검색된다
    expect(allText()).toContain('HW-001');
    expect(allText()).toContain('AWG22');
    expect(allText().some((s) => s.includes('하네스'))).toBe(false);
  });
});
