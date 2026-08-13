/**
 * Agent D 소유 — 브라우저 출력 (PDF 다운로드).
 *
 * 이 툴의 핵심 산출물은 **인쇄해서 현장에 들고 가는 종이**다. 그래서 PDF 는
 * 화면 스냅샷이 아니라 벡터로 다시 그린다(pdfDraw.ts). 한 하네스당 세 면:
 *   1) 배선도 (프레임 · 제목블록 · 하우징 심볼 · 직교 배선 · 스텁 라벨)
 *   2) 접속표 — buildRunList()
 *   3) 파트리스트 — buildPartList() (분류별 소계)
 *
 * 한글 처리
 * ---------
 * jsPDF 의 기본 14 폰트는 WinAnsi 라 한글을 한 글자도 못 그린다. 한글 TTF 를
 * 임베드하면 번들이 수 MB 늘어난다(이 앱 전체보다 크다). 그래서:
 *   - Latin-1 범위 밖 글자가 섞인 문자열만 **Canvas 에 4배 오버샘플로 그려
 *     PNG 로 삽입**한다. 숫자·품번·AWG·색 약호 같은 ASCII 는 벡터 텍스트라
 *     그대로 선명하고 검색된다.
 *   - Canvas 가 없는 환경(테스트·SSR)에서는 pdf.text 로 폴백한다.
 *   - 같은 글자는 캐시해 재사용한다(접속표에서 같은 단어가 수십 번 나온다).
 */
import { jsPDF } from 'jspdf';
import type { HarnessDocument, KitDocument } from '../types';
import { buildPartList, buildRunList, type PartRow, type RunRow } from './exporters';
import { colorAbbr, strokeColor } from '../canvas/docToFlow';
import {
  C, PAPER_PT, SHEET_MARGIN, chunk, drawSheet, estimateTextWidth, needsRaster,
  truncateToWidth, type DrawText, type Paper, type PdfLike, type TextStyle,
} from './pdfDraw';

// ============================================================
// 한글 래스터 텍스트
// ============================================================

type Raster = { url: string; w: number; h: number };

/** 같은 (글자 · 크기 · 색 · 굵기) 조합은 한 번만 그린다 */
const rasterCache = new Map<string, Raster | null>();

/** 오버샘플 배수 — 300dpi 인쇄에서 글자 가장자리가 뭉개지지 않는 최소치 */
const OVERSAMPLE = 4;

function rasterText(text: string, size: number, color: string, bold: boolean): Raster | null {
  if (typeof document === 'undefined') return null;
  const key = `${size}|${color}|${bold ? 1 : 0}|${text}`;
  const hit = rasterCache.get(key);
  if (hit !== undefined) return hit;

  let out: Raster | null = null;
  try {
    const px = size * OVERSAMPLE;
    const font = `${bold ? 600 : 400} ${px}px "IBM Plex Sans KR", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
    const probe = document.createElement('canvas').getContext('2d');
    if (probe) {
      probe.font = font;
      const w = Math.max(1, Math.ceil(probe.measureText(text).width));
      const h = Math.ceil(px * 1.32);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = color;
        ctx.fillText(text, 0, Math.round(px));
        out = { url: cv.toDataURL('image/png'), w: w / OVERSAMPLE, h: h / OVERSAMPLE };
      }
    }
  } catch {
    out = null; // 캔버스가 막힌 환경 — 벡터 폴백으로 내려간다
  }
  if (rasterCache.size > 800) rasterCache.clear();
  rasterCache.set(key, out);
  return out;
}

/** jsPDF 인스턴스 하나에 묶인 텍스트 그리기 함수를 만든다 */
export function createTextDrawer(pdf: PdfLike): DrawText {
  return (raw: string, x: number, y: number, s: TextStyle = {}) => {
    const size = s.size ?? 9;
    const color = s.color ?? C.text;
    const t = s.maxWidth != null ? truncateToWidth(String(raw), size, s.maxWidth) : String(raw);
    if (!t) return 0;

    if (needsRaster(t)) {
      const r = rasterText(t, size, color, s.bold ?? false);
      if (r) {
        const x0 = s.align === 'center' ? x - r.w / 2 : s.align === 'right' ? x - r.w : x;
        // y 는 베이스라인이고 래스터는 상단 기준이라 ascent(≈size) 만큼 올린다
        pdf.addImage(r.url, 'PNG', x0, y - size, r.w, r.h);
        return r.w;
      }
    }
    pdf.setFontSize(size);
    pdf.setFont('helvetica', s.bold ? 'bold' : 'normal');
    pdf.setTextColor(color);
    if (s.align && s.align !== 'left') pdf.text(t, x, y, { align: s.align });
    else pdf.text(t, x, y);
    // **실제로 그린 폭**을 돌려준다. 조각을 이어 붙일 때 추정치를 쓰면
    // ASCII 는 짧게·한글은 길게 어긋나 글자가 겹치거나 벌어진다(실제로 그랬다).
    return pdf.getTextWidth?.(t) ?? estimateTextWidth(t, size);
  };
}

// ============================================================
// 페이지 뼈대
// ============================================================

type Ctx = {
  pdf: PdfLike;
  text: DrawText;
  pageW: number;
  pageH: number;
  /** 페이지 번호(1-base) → 그 면이 속한 하네스. 푸터를 마지막에 한 번에 찍는다. */
  pageDocs: HarnessDocument[];
};

/** 표 위쪽 시작선 (제목 아래) */
const TABLE_TOP = SHEET_MARGIN + 42;
/** 푸터 위 여백 */
const FOOT_GAP = 26;
const ROW_H = 15;
const HEAD_H = 18;
/**
 * 표 최대 폭. A3 폭에 그대로 맞추면 열이 화면 반쪽만큼 벌어져 FROM 과 TO 가
 * 눈으로 이어지지 않는다. 표는 왼쪽에 붙여 두고 폭을 묶는다.
 */
const MAX_TABLE_W = 760;

/** 이 페이지에서 표가 차지할 x · 폭 */
function tableRect(ctx: Ctx): { x: number; w: number } {
  return { x: SHEET_MARGIN, w: Math.min(ctx.pageW - SHEET_MARGIN * 2, MAX_TABLE_W) };
}

function startPage(ctx: Ctx, doc: HarnessDocument): void {
  if (ctx.pageDocs.length > 0) ctx.pdf.addPage();
  ctx.pageDocs.push(doc);
}

/** 없는 값은 만들어내지 않는다 — 전부 '—' */
function footerText(doc: HarnessDocument, n: number, m: number): string {
  const no = doc.drawingNo?.trim() || '—';
  const rev = doc.rev?.trim() ? `Rev.${doc.rev.trim()}` : '—';
  return `${doc.name || '이름 없는 하네스'} · ${no} · ${rev} · ${n}/${m}`;
}

function stampFooters(ctx: Ctx): void {
  const m = ctx.pageDocs.length;
  for (let i = 0; i < m; i++) {
    ctx.pdf.setPage(i + 1);
    ctx.text(footerText(ctx.pageDocs[i], i + 1, m), ctx.pageW / 2, ctx.pageH - 16, {
      size: 8, color: C.muted, align: 'center',
    });
  }
}

// ============================================================
// 표 공통
// ============================================================

type Col = { title: string; w: number; align?: 'left' | 'right' | 'center' };

/** 비율(합 1.0)을 실제 폭으로 편다 */
function layoutCols(cols: Col[], total: number): number[] {
  const sum = cols.reduce((n, c) => n + c.w, 0) || 1;
  return cols.map((c) => (c.w / sum) * total);
}

function drawTableHead(ctx: Ctx, cols: Col[], widths: number[], x: number, y: number, w: number): void {
  ctx.pdf.setFillColor(C.subtle);
  ctx.pdf.setLineDashPattern([], 0);
  ctx.pdf.rect(x, y, w, HEAD_H, 'F');
  let cx = x;
  cols.forEach((c, i) => {
    const inner = widths[i] - 8;
    const tx = c.align === 'right' ? cx + widths[i] - 4 : c.align === 'center' ? cx + widths[i] / 2 : cx + 4;
    ctx.text(c.title, tx, y + 12.5, { size: 8.5, bold: true, color: C.text3, align: c.align, maxWidth: inner });
    cx += widths[i];
  });
  ctx.pdf.setDrawColor(C.lineStrong);
  ctx.pdf.setLineWidth(0.7);
  ctx.pdf.line(x, y + HEAD_H, x + w, y + HEAD_H);
}

function drawCells(
  ctx: Ctx,
  cells: string[],
  cols: Col[],
  widths: number[],
  x: number,
  y: number,
  style: { bold?: boolean; color?: string; size?: number } = {},
): void {
  let cx = x;
  cells.forEach((v, i) => {
    if (v) {
      const inner = widths[i] - 8;
      const tx = cols[i].align === 'right' ? cx + widths[i] - 4
        : cols[i].align === 'center' ? cx + widths[i] / 2
        : cx + 4;
      ctx.text(v, tx, y, {
        size: style.size ?? 8.5,
        bold: style.bold,
        color: style.color ?? C.text,
        align: cols[i].align,
        maxWidth: inner,
      });
    }
    cx += widths[i];
  });
}

// ============================================================
// 2면 — 접속표 (FROM → TO)
// ============================================================

const RUN_COLS: Col[] = [
  { title: 'NET', w: 0.16 },
  { title: 'FROM', w: 0.23 },
  { title: 'TO', w: 0.23 },
  { title: '색', w: 0.15 },
  { title: '게이지', w: 0.10, align: 'right' },
  { title: '길이 (mm)', w: 0.13, align: 'right' },
];

function runCells(r: RunRow): string[] {
  const [base, stripe] = r.color.split('/');
  const net = r.netCode ? (r.net ? `${r.netCode} ${r.net}` : r.netCode) : (r.net || '—');
  // 색은 흑백 인쇄를 대비해 **약호 + 이름**을 함께 적는다
  const color = base ? `${colorAbbr(base, stripe)} ${r.color}` : '—';
  // 케이블 심선은 케이블 길이로 재단된다 — 값은 적되 어디서 온 값인지 밝힌다.
  // 그냥 숫자만 적으면 이 심선에 직접 지정된 길이처럼 읽힌다.
  const len = r.lengthMm
    ? (r.lengthSource === 'cable' ? `${r.lengthMm} (케이블)` : r.lengthMm)
    : '—';
  return [net, r.from || '—', r.to || '—', color, r.gauge || '—', len];
}

function drawRunList(ctx: Ctx, doc: HarnessDocument): void {
  const rows = buildRunList(doc);
  const { x, w } = tableRect(ctx);
  const widths = layoutCols(RUN_COLS, w);
  const bottom = ctx.pageH - FOOT_GAP;
  const perPage = Math.max(1, Math.floor((bottom - (TABLE_TOP + HEAD_H)) / ROW_H));
  const pages = chunk(rows, perPage);

  pages.forEach((page, pi) => {
    startPage(ctx, doc);
    ctx.text('접속표 (FROM → TO)', x, SHEET_MARGIN + 20, { size: 12, bold: true, color: C.text });
    ctx.text(
      pages.length > 1 ? `${rows.length}본 · ${pi + 1}/${pages.length}` : `${rows.length}본`,
      x + w, SHEET_MARGIN + 20,
      { size: 9, color: C.muted, align: 'right' },
    );
    // 헤더는 **페이지마다 반복** — 넘어간 장만 봐도 무슨 열인지 알아야 한다
    drawTableHead(ctx, RUN_COLS, widths, x, TABLE_TOP, w);

    let y = TABLE_TOP + HEAD_H;
    for (const r of page) {
      y += ROW_H;
      const cells = runCells(r);
      const colorText = cells[3];
      cells[3] = ''; // 색 칸은 견본과 함께 따로 그린다
      drawCells(ctx, cells, RUN_COLS, widths, x, y - 4.5);

      // 색 견본은 **보조** 단서다 — 흑백으로 뽑으면 사라지므로
      // 같은 칸에 적는 약호(R/W)가 본 단서다.
      const cellX = x + widths[0] + widths[1] + widths[2];
      const base = r.color.split('/')[0];
      if (base) {
        ctx.pdf.setFillColor(strokeColor(base));
        ctx.pdf.setDrawColor(C.lineMid);
        ctx.pdf.setLineWidth(0.3);
        ctx.pdf.setLineDashPattern([], 0);
        ctx.pdf.rect(cellX + 4, y - 11.5, 8, 8, 'FD');
      }
      ctx.text(colorText, cellX + (base ? 16 : 4), y - 4.5, {
        size: 8.5, color: C.text, maxWidth: widths[3] - (base ? 24 : 8),
      });

      ctx.pdf.setDrawColor(C.line);
      ctx.pdf.setLineWidth(0.3);
      ctx.pdf.line(x, y, x + w, y);
    }
    if (!page.length) {
      ctx.text('배선이 없다.', x + 4, TABLE_TOP + HEAD_H + 16, { size: 9, color: C.muted });
    }
  });
}

// ============================================================
// 3면 — 파트리스트 (분류별 · 소계)
// ============================================================

const PART_COLS: Col[] = [
  { title: '품목', w: 0.52 },
  { title: '수량', w: 0.14, align: 'right' },
  { title: '비고', w: 0.34 },
];

type PartLine =
  | { kind: 'group'; title: string }
  | { kind: 'row'; row: PartRow }
  | { kind: 'sub'; label: string };

/** 분류별로 묶고 소계 줄을 끼워 넣은 출력 줄 목록 */
export function partLines(rows: PartRow[]): PartLine[] {
  const order: string[] = [];
  const byCat = new Map<string, PartRow[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) {
      byCat.set(r.category, []);
      order.push(r.category);
    }
    byCat.get(r.category)!.push(r);
  }
  const out: PartLine[] = [];
  for (const cat of order) {
    const list = byCat.get(cat)!;
    out.push({ kind: 'group', title: cat });
    for (const row of list) out.push({ kind: 'row', row });
    const qty = list.reduce((n, r) => n + r.qty, 0);
    out.push({ kind: 'sub', label: `소계 ${list.length}품목 · ${qty}개` });
  }
  return out;
}

function drawPartList(ctx: Ctx, doc: HarnessDocument): void {
  const rows = buildPartList(doc);
  const lines = partLines(rows);
  const { x, w } = tableRect(ctx);
  const widths = layoutCols(PART_COLS, w);
  const bottom = ctx.pageH - FOOT_GAP;
  const perPage = Math.max(1, Math.floor((bottom - (TABLE_TOP + HEAD_H)) / ROW_H));
  const pages = chunk(lines, perPage);
  const totalQty = rows.reduce((n, r) => n + r.qty, 0);

  pages.forEach((page, pi) => {
    startPage(ctx, doc);
    ctx.text('파트리스트', x, SHEET_MARGIN + 20, { size: 12, bold: true, color: C.text });
    ctx.text(
      pages.length > 1
        ? `${rows.length}품목 · 합계 ${totalQty}개 · ${pi + 1}/${pages.length}`
        : `${rows.length}품목 · 합계 ${totalQty}개`,
      x + w, SHEET_MARGIN + 20,
      { size: 9, color: C.muted, align: 'right' },
    );
    drawTableHead(ctx, PART_COLS, widths, x, TABLE_TOP, w);

    let y = TABLE_TOP + HEAD_H;
    for (const ln of page) {
      y += ROW_H;
      if (ln.kind === 'group') {
        ctx.pdf.setFillColor(C.subtle);
        ctx.pdf.setLineDashPattern([], 0);
        ctx.pdf.rect(x, y - ROW_H + 2, w, ROW_H - 2, 'F');
        ctx.text(ln.title, x + 4, y - 4.5, { size: 9, bold: true, color: C.text2, maxWidth: w - 8 });
      } else if (ln.kind === 'sub') {
        ctx.text(ln.label, x + w - 4, y - 4.5, { size: 8.5, bold: true, color: C.text3, maxWidth: w - 8 });
        ctx.pdf.setDrawColor(C.lineStrong);
        ctx.pdf.setLineWidth(0.6);
        ctx.pdf.line(x, y, x + w, y);
        continue;
      } else {
        drawCells(
          ctx,
          [ln.row.part || '—', String(ln.row.qty), ln.row.detail || '—'],
          PART_COLS, widths, x, y - 4.5,
        );
      }
      ctx.pdf.setDrawColor(C.line);
      ctx.pdf.setLineWidth(0.3);
      ctx.pdf.line(x, y, x + w, y);
    }
    if (!page.length) {
      ctx.text('부품이 없다.', x + 4, TABLE_TOP + HEAD_H + 16, { size: 9, color: C.muted });
    }
  });
}

// ============================================================
// 공개 API
// ============================================================

export type PdfOptions = {
  /** 기본 A3 (가로). 좁은 프린터만 있으면 A4 */
  paper?: Paper;
  filename?: string;
};

function makeCtx(paper: Paper): Ctx {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: paper.toLowerCase(),
  }) as unknown as PdfLike;
  const w = Number(pdf.internal?.pageSize?.getWidth?.());
  const h = Number(pdf.internal?.pageSize?.getHeight?.());
  return {
    pdf,
    text: createTextDrawer(pdf),
    pageW: Number.isFinite(w) && w > 0 ? w : PAPER_PT[paper].w,
    pageH: Number.isFinite(h) && h > 0 ? h : PAPER_PT[paper].h,
    pageDocs: [],
  };
}

/**
 * 하네스 한 종 → 세 면(배선도 · 접속표 · 파트리스트).
 *
 * 물리 뷰(구간·전장·구간 길이)는 아직 PDF 로 나가지 않는다 — 이 세 면의 숫자는
 * 전부 **배선 길이**(store/wireLength.ts)에서 오므로 사람이 넣은 구간 길이와
 * 겹칠 일이 없다. 나중에 물리 면을 더한다면 화면과 같은 산출
 * (`physical/segments.ts` 의 `buildPhysicalModel`)을 그대로 써야 한다.
 * 여기서 다시 계산하면 화면과 종이가 다른 숫자를 말하게 된다.
 */
function addHarness(ctx: Ctx, doc: HarnessDocument): void {
  startPage(ctx, doc);
  drawSheet(ctx.pdf, doc, ctx.text, { w: ctx.pageW, h: ctx.pageH });
  drawRunList(ctx, doc);
  drawPartList(ctx, doc);
}

/** 파일명에 못 쓰는 글자를 다듬는다 */
function safeName(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'harness';
}

export function downloadPdf(doc: HarnessDocument, opts?: PdfOptions): Promise<void>;
/**
 * @deprecated 옛 호출부(App.tsx)가 넘기던 React Flow DOM 요소. 이제 스냅샷을
 * 찍지 않으므로 **무시된다**. 호출부가 정리되면 이 오버로드를 지우면 된다.
 */
export function downloadPdf(doc: HarnessDocument, legacyEl: HTMLElement | null): Promise<void>;
export async function downloadPdf(
  doc: HarnessDocument,
  arg?: PdfOptions | HTMLElement | null,
): Promise<void> {
  const opts: PdfOptions = arg && typeof (arg as HTMLElement).nodeType === 'number' ? {} : ((arg as PdfOptions) ?? {});
  const paper: Paper = opts.paper ?? 'A3';
  const ctx = makeCtx(paper);
  addHarness(ctx, doc);
  stampFooters(ctx);
  ctx.pdf.save(opts.filename ?? `${safeName(doc.name || 'harness')}.pdf`);
}

/** 세트 전체를 한 PDF 로 — 하네스마다 위 세 면을 이어 붙인다 */
export async function downloadKitPdf(kit: KitDocument, opts?: { paper?: Paper }): Promise<void> {
  const paper: Paper = opts?.paper ?? 'A3';
  const ctx = makeCtx(paper);
  for (const h of kit.harnesses) addHarness(ctx, h);
  if (!kit.harnesses.length) {
    startPage(ctx, {
      schemaVersion: 1, id: kit.id, name: kit.name, createdAt: kit.createdAt,
      updatedAt: kit.updatedAt, connectors: [], devices: [], wires: [], usedParts: [],
    });
    ctx.text('세트에 하네스가 없다.', ctx.pageW / 2, ctx.pageH / 2, {
      size: 12, color: C.muted, align: 'center',
    });
  }
  stampFooters(ctx);
  ctx.pdf.save(`${safeName(kit.set.pn || kit.name || 'harness-kit')}.pdf`);
}
