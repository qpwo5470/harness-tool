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
import type { HarnessDocument, KitDocument, PartLibraryItem, Wire } from '../types';
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
  truncateToWidth, wireWidthPx, C,
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

/**
 * 1페이지에 **정말로 한 장으로** 들어가는 하네스.
 * sampleDoc 은 스플라이스·장치·케이블까지 든 8품목짜리라 부품표가 넘친다 —
 * 넘칠 때 어떻게 되는지는 따로 검사하고, 여기서는 안 넘칠 때를 본다.
 */
function smallDoc(): HarnessDocument {
  return {
    ...sampleDoc,
    devices: [],
    cables: [],
    connectors: sampleDoc.connectors.filter((c) => c.id === 'con-a' || c.id === 'sp-1'),
    wires: [{
      id: 'w1',
      from: { type: 'pin', connectorId: 'con-a', pinId: 'a1' },
      to: { type: 'pin', connectorId: 'sp-1', pinId: 's1' },
      color: { base: 'red' },
      gauge: { system: 'awg', value: 22 },
      lengthMm: 800,
    }],
  };
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
  /**
   * 기본은 **A4 가로 1페이지** 다(개선안 §2-2). 배선도 · 접속표 · 부품표 ·
   * 핀 배열 뷰가 한 면에 있다 — 현장이 케이블 하나를 잡고 종이 한 장만 본다.
   */
  it('기본 배치는 A4 한 장이다', async () => {
    await downloadPdf(smallDoc());
    expect(rec.pages).toBe(1);
    expect(opCount('addPage')).toBe(0);
    expect((rec.ctorArgs[0] as { format: string }).format).toBe('a4');
    const p1 = textsOnPage(1);
    expect(p1).toContain('접속표 (FROM → TO)');
    expect(p1).toContain('부품');
    expect(p1).toContain('핀 배열 (실물 기준)');
  });

  it('3면 배치를 고르면 배선도 · 접속표 · 파트리스트 세 면이다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    expect(rec.pages).toBe(3);
    expect(opCount('addPage')).toBe(2); // 첫 면은 생성 시 이미 있다
  });

  it('DOM 스냅샷을 쓰지 않는다 — 선과 사각형으로 그린다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    // node 환경엔 canvas 가 없으니 addImage 가 한 번도 불리면 안 된다
    expect(opCount('addImage')).toBe(0);
    // 배선도 면(1면)에 선·사각형이 실제로 그려졌다
    const page1 = rec.ops.filter((o: Op) => o.page === 1);
    expect(page1.filter((o: Op) => o.op === 'line').length).toBeGreaterThan(10);
    expect(page1.filter((o: Op) => o.op === 'rect').length).toBeGreaterThan(5);
  });

  it('3면 배치의 용지는 기본 A3, 옵션으로 A4', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    expect((rec.ctorArgs[0] as { format: string }).format).toBe('a3');

    rec.reset();
    await downloadPdf(sampleDoc, { layout: 'sheets', paper: 'A4' });
    expect((rec.ctorArgs[0] as { format: string }).format).toBe('a4');
  });

  /**
   * 1페이지 배치의 좌표는 A4 가로 기준으로 손으로 정한 값이다(pdfDraw.ONEPAGE).
   * A3 로 비례해 늘리면 셀·글꼴 같은 절대 치수만 그대로라 검증된 배치가 아닌
   * 다른 그림이 된다 — 근거 없는 좌표를 지어내지 않고 A4 로 내린다.
   */
  it('1페이지 배치는 A3 를 달라고 해도 A4 로 그린다', async () => {
    await downloadPdf(sampleDoc, { layout: 'onepage', paper: 'A3' });
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
    await downloadPdf(smallDoc(), fakeEl);
    expect(rec.pages).toBe(1);
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

  /**
   * 개선안 §2-3 — 제작 도면에 길이·수량이 없으면 발주가 안 된다.
   * 3행 왼쪽에 `길이 … · 세트당 …`, 오른쪽에 날짜가 온다.
   */
  it('제목블록 3행에 길이와 세트당 수량을 적는다', async () => {
    await downloadPdf(sampleDoc, { perSet: 6 });
    // sampleDoc — w1 은 120mm, 케이블 심선 둘은 300mm → 범위로 적는다
    expect(textsOnPage(1)).toContain('길이 120~300mm · 세트당 6EA');
  });

  it('길이를 모르면 지어내지 않고 미상이라고 적는다', async () => {
    const doc: HarnessDocument = {
      ...sampleDoc,
      cables: [],
      wires: sampleDoc.wires.map((w) => {
        const { lengthMm: _drop, ...rest } = w;
        return rest;
      }),
    };
    await downloadPdf(doc);
    // 수량도 안 넘겼으니 둘 다 미상이다
    expect(textsOnPage(1)).toContain('길이 미상 · 세트당 미상');
  });

  it('모든 면 아래에 문서명 · 도번 · Rev · N/M 푸터가 붙는다', async () => {
    const doc: HarnessDocument = { ...sampleDoc, drawingNo: 'HW-001', rev: 'B' };
    await downloadPdf(doc, { layout: 'sheets' });
    const feet = allText().filter((s) => /\d+\/\d+$/.test(s));
    expect(feet).toEqual([
      '샘플 하네스 · HW-001 · Rev.B · 1/3',
      '샘플 하네스 · HW-001 · Rev.B · 2/3',
      '샘플 하네스 · HW-001 · Rev.B · 3/3',
    ]);
  });
});

// ============================================================
// 도면 안의 치수 표기 (개선안 §2-7)
// ============================================================
describe('전선 구간 길이 표기', () => {
  it('도면 위에 길이와 세트당 수량을 적는다', async () => {
    await downloadPdf(sampleDoc, { perSet: 6 });
    expect(textsOnPage(1)).toContain('120~300mm  (6EA)');
  });

  it('수량을 모르면 길이만 적는다 — 숫자를 지어내지 않는다', async () => {
    await downloadPdf(sampleDoc);
    expect(textsOnPage(1)).toContain('120~300mm');
  });
});

// ============================================================
describe('접속표', () => {
  it('buildRunList 의 모든 행을 FROM · TO · 게이지까지 적는다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    const rows = buildRunList(sampleDoc);
    expect(rows.length).toBe(3);
    const p2 = textsOnPage(2);
    expect(p2).toContain('접속표 (FROM → TO)');
    // 종이에서는 **도면 레퍼런스**로 적는다 (§2-12) — 같은 면의 배선도가
    // 커넥터를 J1·J2 로 부르는데 표만 부품명으로 적으면 되짚어야 한다.
    expect(p2).toContain('J1-1');
    expect(p2).toContain('SP1-1');
    // 색은 약호 + 이름을 함께 — 흑백 인쇄 대비
    expect(p2.some((s) => s.startsWith('R/W red/white'))).toBe(true);
  });

  /**
   * 개선안 §2-12 — 신호 열. 스텁 라벨을 도면에서 뺐으므로(§2-5) 신호명을
   * 읽을 자리가 여기밖에 없다. 열이 사라지면 정보가 사라진다.
   */
  it('신호 열이 있고, 좁은 배치에서도 남는다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    expect(textsOnPage(2)).toContain('신호');
    // 전폭 표에서는 게이지까지 7열
    expect(textsOnPage(2)).toContain('게이지');

    rec.reset();
    await downloadPdf(sampleDoc);
    const p1 = textsOnPage(1);
    expect(p1).toContain('신호');
    // 좁은 표(320pt)에서는 게이지를 접는다 — 같은 면의 부품표가 `AWG22 · red`
    // 로 이미 적으므로 종이에서 정보가 사라지지 않는다.
    expect(p1).not.toContain('게이지');
    expect(p1.some((s) => s.startsWith('AWG22'))).toBe(true);
  });

  /**
   * 케이블 심선(w2 · w3)은 개별 길이가 없고 cbl-1(300mm)을 따른다.
   * 예전에는 길이 칸이 `—` 라 종이만 보고 자를 수 없었다. 값을 적되 그 값이
   * 이 심선에 직접 지정된 것이 아님을 함께 밝힌다.
   */
  it('케이블 심선의 재단 길이를 적고 출처를 밝힌다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    const p2 = textsOnPage(2);
    expect(p2.filter((s) => s === '300 (케이블)')).toHaveLength(2); // w2 · w3
    expect(p2).toContain('120'); // w1 은 배선에 직접 입력된 길이
  });

  it('행이 넘치면 페이지를 나누고 헤더를 페이지마다 반복한다', async () => {
    await downloadPdf(docWithWires(140), { layout: 'sheets' });
    // 배선도 1 + 접속표 2 + 파트리스트 1 이상
    expect(rec.pages).toBeGreaterThan(3);
    const headCount = allText().filter((s) => s === 'FROM').length;
    expect(headCount).toBeGreaterThanOrEqual(2);
    // 나뉜 장에는 몇 장 중 몇 장인지 적힌다
    expect(allText().some((s) => /^140본 · 1\/\d+$/.test(s))).toBe(true);
  });

  it('A4 는 A3 보다 접속표 페이지가 더 많이 필요하다', async () => {
    await downloadPdf(docWithWires(100), { layout: 'sheets', paper: 'A3' });
    const a3 = rec.pages;
    rec.reset();
    await downloadPdf(docWithWires(100), { layout: 'sheets', paper: 'A4' });
    expect(rec.pages).toBeGreaterThan(a3);
  });

  /**
   * 1페이지 배치라도 **행을 버리지 않는다.** 한 장에 담자고 접속표를 잘라 내면
   * 그 도면으로는 하네스를 만들 수 없다 — 넘친 몫은 이어지는 면으로 흘린다.
   */
  it('1페이지에 안 들어가는 접속표는 이어지는 면으로 넘긴다', async () => {
    await downloadPdf(docWithWires(40));
    expect(rec.pages).toBeGreaterThan(1);
    expect(allText()).toContain('접속표 (FROM → TO) — 이어짐');
    expect(allText().some((s) => s.startsWith('40본 · 이어짐'))).toBe(true);
    // 첫 면 11행 + 나머지 29행 = 40행. 한 줄도 사라지지 않는다.
    const lens = allText().filter((s) => /^1\d\d$/.test(s));
    expect(new Set(lens).size).toBe(40);
  });
});

// ============================================================
describe('파트리스트', () => {
  it('분류별로 묶고 소계를 붙인다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    const rows = buildPartList(sampleDoc);
    const cats = [...new Set(rows.map((r) => r.category))];
    const p3 = textsOnPage(3);
    expect(p3).toContain('파트리스트');
    for (const c of cats) expect(p3).toContain(`[${c}]`);
    expect(p3.filter((s) => s.startsWith('소계 ')).length).toBe(cats.length);
  });

  /**
   * 1페이지의 부품 칸은 세로로 7줄뿐이다. 분류 머리줄·소계까지 넣으면
   * 5품목짜리 하네스가 11줄이 되어 절반이 다음 면으로 넘어간다 — 한 장에
   * 담자고 만든 배치에서 부품표만 두 장이 되는 것은 앞뒤가 안 맞는다.
   */
  it('1페이지 부품표는 분류 머리줄 없이 평평하게 적는다', async () => {
    const doc = smallDoc();
    await downloadPdf(doc);
    const p1 = textsOnPage(1);
    expect(p1).toContain('부품');
    expect(p1.some((s) => s.startsWith('소계 '))).toBe(false);
    expect(p1.some((s) => s.startsWith('['))).toBe(false);
    for (const r of buildPartList(doc)) expect(p1).toContain(r.part);
  });

  /** 넘치면 이어지는 면으로 — 부품표도 행을 버리지 않는다 */
  it('1페이지에 안 들어가는 부품표는 이어지는 면으로 넘긴다', async () => {
    await downloadPdf(sampleDoc);   // 8품목 · 칸은 7줄
    expect(rec.pages).toBeGreaterThan(1);
    expect(allText()).toContain('부품 — 이어짐');
    for (const r of buildPartList(sampleDoc)) expect(allText()).toContain(r.part);
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
    await downloadKitPdf(kitOf(sampleDoc, b), { layout: 'sheets' });
    expect(rec.pages).toBe(6);
    expect(rec.saved[0]).toBe('KIT-2408.pdf');
  });

  it('기본 배치에서는 하네스당 한 장이다', async () => {
    const a = smallDoc();
    const b: HarnessDocument = { ...a, id: 'doc-2', name: 'B 하네스', drawingNo: 'HW-002' };
    await downloadKitPdf(kitOf(a, b));
    expect(rec.pages).toBe(2);
  });

  it('푸터는 그 면이 속한 하네스를 가리킨다', async () => {
    const b: HarnessDocument = { ...sampleDoc, id: 'doc-2', name: 'B 하네스', drawingNo: 'HW-002' };
    await downloadKitPdf(kitOf(sampleDoc, b), { layout: 'sheets' });
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
// 핀 배열 미니 뷰 (개선안 §2-8)
// ============================================================
describe('핀 배열 (실물 기준)', () => {
  /** layout / view 를 마음대로 바꿔 끼울 수 있는 최소 문서 */
  function docWithPart(over: Partial<PartLibraryItem>, conn: Record<string, unknown> = {}): HarnessDocument {
    const base = smallDoc();
    const housing = base.usedParts.find((p) => p.id === base.connectors[0].housingId)!;
    return {
      ...base,
      connectors: base.connectors.map((c, i) => (i === 0 ? { ...c, ...conn } : c)),
      usedParts: base.usedParts.map((p) => (p.id === housing.id ? { ...p, ...over } : p)),
    } as HarnessDocument;
  }

  it('layout 과 view 가 다 있으면 배열을 격자로 그린다', async () => {
    await downloadPdf(docWithPart({ layout: [[4, 3], [2, 1]], view: '결합면 기준' }));
    const p1 = textsOnPage(1);
    expect(p1).toContain('핀 배열 (실물 기준)');
    // 제목은 도면 레퍼런스 + 부품명, 부제는 MPN + 뷰 기준
    expect(p1.some((s) => s.startsWith('J1 '))).toBe(true);
    expect(p1.some((s) => s.includes('결합면 기준'))).toBe(true);
    for (const n of ['1', '2', '3', '4']) expect(p1).toContain(n);
  });

  /**
   * **뷰 기준이 없으면 배열을 그리지 않는다.** 커넥터는 뒤집으면 번호가 좌우로
   * 뒤집히므로, 뷰 없는 배열은 절반의 확률로 거울상이다 — 아무것도 안 그리는
   * 편이 낫고(사람이 실물을 본다), 그 사실은 --danger 로 말한다.
   */
  it('view 가 비면 배열을 그리지 않고 --danger 로 알린다', async () => {
    await downloadPdf(docWithPart({ layout: [['A', 'B']] }));
    const p1 = textsOnPage(1);
    expect(p1.some((s) => s.includes('뷰 기준 없음'))).toBe(true);
    // 배열 칸의 글자(A·B)는 한 개도 나오면 안 된다
    expect(p1).not.toContain('A');
    expect(p1).not.toContain('B');
    // 경고는 --danger 색이다 (개선안 §2-14 가 잡은 누락 토큰)
    expect(rec.ops.some((o: Op) => o.op === 'setTextColor' && o.args[0] === C.danger)).toBe(true);
  });

  it('layout 이 없으면 뷰 자체를 그리지 않고 왜 비었는지 적는다', async () => {
    await downloadPdf(smallDoc());  // 씨앗 하우징에 layout 이 없다
    const p1 = textsOnPage(1);
    expect(p1).toContain('핀 배열 (실물 기준)');
    expect(p1.some((s) => s.includes('등록된 실물 배열이 없다'))).toBe(true);
  });

  /**
   * `layout` 을 `pinLayout` 으로 대신 그리면 이 기능의 존재 이유가 사라진다 —
   * `pinLayout` 은 "배선이 나가는 변에 긴 축" 이라는 **작도 규칙**을 따르는
   * 도면 좌표이고, 조립자가 그걸 실물로 믿으면 그대로 오조립이다.
   */
  it('pinLayout 만 있는 부품은 미니 뷰에 나오지 않는다', async () => {
    const doc = docWithPart({
      pinLayout: [{ index: 1, offset: { x: 0, y: 0 } }, { index: 2, offset: { x: 1, y: 0 } }],
      view: '결합면 기준',
    });
    await downloadPdf(doc);
    expect(textsOnPage(1).some((s) => s.includes('등록된 실물 배열이 없다'))).toBe(true);
  });

  it('unused 는 X 두 줄로, sleeve 는 점선 사각 + 라벨로 그린다', async () => {
    await downloadPdf(docWithPart(
      { layout: [[1, 2]], view: '결합면 기준' },
      // 숫자로도 문자로도 들어온다 — String() 으로 맞춰 비교한다
      { unused: ['2'], sleeve: true },
    ));
    expect(textsOnPage(1)).toContain('절연 슬리브');
    // 점선 패턴이 한 번은 켜졌다 (슬리브 사각형)
    expect(rec.ops.some((o: Op) =>
      o.op === 'setLineDashPattern' && Array.isArray(o.args[0]) && (o.args[0] as number[]).length === 2,
    )).toBe(true);
  });
});

// ============================================================
describe('스텁 라벨 (개선안 §2-5)', () => {
  /**
   * PDF 에서는 스텁 라벨을 그리지 않는다. 10P 케이블이면 상자 열 개가 패드 앞
   * 좁은 띠에 몰려 판독이 안 됐다. 색은 선 색과 접속표 `색` 열이, 신호는
   * 접속표 `신호` 열이 대신한다 — 뺀 정보에 대안이 있다.
   */
  it('색 약호를 도면에 찍지 않는다 — 표에서 읽는다', async () => {
    await downloadPdf(sampleDoc, { layout: 'sheets' });
    // 1면(배선도)에는 없고
    expect(textsOnPage(1).some((s) => s === 'R/W')).toBe(false);
    // 2면(접속표)의 색 칸에는 약호가 남아 있다
    expect(textsOnPage(2).some((s) => s.startsWith('R/W '))).toBe(true);
  });
});

// ============================================================
describe('pdfDraw 순수 함수', () => {
  it('buildDrawing 은 화면과 같은 격자·레인으로 좌표를 만든다', () => {
    const dr = buildDrawing(sampleDoc);
    // 커넥터 3 + 장치 1
    expect(dr.nodes).toHaveLength(4);
    expect(dr.wires).toHaveLength(sampleDoc.wires.length);

    /**
     * JST XH 4P(정의 4열 1행)를 0°(배선이 왼쪽으로) 로 놓은 커넥터다.
     * 화면과 마찬가지로 **나가는 변에 핀이 줄지어 서도록** 세워 그리므로
     * 폭 = 1*30+8 = 38, 높이 = 4*30+12-4 = 128 이다(예전 128×38 의 전치).
     * 예전 값은 핸들 4개를 38px 변에 9.5px 간격으로 몰아넣던 그림이었다 —
     * 10P·20P 로 가면 3.8px·1.9px 가 되어 못 쓴다. geometry.drawGrid 참고.
     */
    const j1 = dr.nodes.find((n) => n.id === 'con-a')!;
    expect(j1.ref).toBe('J1');
    expect(j1.box.w).toBe(38);
    expect(j1.box.h).toBe(128);
    expect(j1.pads).toHaveLength(4);
    // 패드 피치 30 유지 (세로로 섰으므로 y 로 벌어진다)
    expect(j1.pads[1].y - j1.pads[0].y).toBe(30);
    expect(j1.pads[1].x - j1.pads[0].x).toBe(0);

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
    // 작은 도면을 무한정 키우지는 않는다. 상한은 2 → 1.6 으로 내려왔다(§2-2) —
    // 2배까지 키우면 배선 두 본짜리 하네스에서 패드가 52pt 사각형이 되어
    // 도면이 아니라 도해처럼 보인다.
    expect(fitTransform({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 1000, h: 1000 }).scale).toBe(1.6);
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
    // 게이지는 부품표에 `AWG22 · red/white` 로 나온다 — `·` 는 Latin-1 이라
    // 통째로 벡터 텍스트다(래스터로 넘어가지 않는다).
    expect(allText().some((s) => s.startsWith('AWG22'))).toBe(true);
    expect(allText().some((s) => s.includes('하네스'))).toBe(false);
  });
});
