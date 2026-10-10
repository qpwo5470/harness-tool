/**
 * Agent D 소유 — 브라우저 출력 (PDF 다운로드).
 *
 * 이 툴의 핵심 산출물은 **인쇄해서 현장에 들고 가는 종이**다. 그래서 PDF 는
 * 화면 스냅샷이 아니라 벡터로 다시 그린다(pdfDraw.ts).
 *
 * 종이에 앉히는 방식은 두 가지다(pdfDraw.SheetLayout):
 *   · `onepage` (기본) — A4 가로 **한 장**. 배선도 · 접속표 · 부품표 · 핀 배열
 *     뷰 · 제목블록이 전부 한 면에 있다(개선안 §2-2). 표가 넘치면 이어지는
 *     면으로 흘려 보낸다 — 한 장에 못 넣는다고 행을 버리지는 않는다.
 *   · `sheets` — 옛 3면 방식(배선도 / 접속표 / 파트리스트), A3 기본.
 *     배선이 수십 본이라 큰 종이에 크게 뽑아야 하는 하네스를 위해 남겨 둔다.
 *
 * 세 면 방식의 구성:
 *   1) 배선도 (프레임 · 제목블록 · 하우징 심볼 · 직교/45° 배선 · 치수 표기)
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
import type { Endpoint, HarnessDocument, KitDocument } from '../types';
import { buildPartList, buildRunList, type PartRow, type RunRow } from './exporters';
import { formatLength, unitLabel, type LengthUnit } from './units';
import { refLabels, strokeColor } from '../canvas/docToFlow';
import { letterAt, perSetOf } from '../store/kit';
import {
  NOTE, PART_COLS_PAPER, appendixTitleRows, appendixWarning, collectDatasheets, colorLabel,
  coverRows, coverRowsPerPage, dateText, drawAppendixPage, drawCoverPage, drawNote,
  drawPurchasedPage, loadDatasheetImages, noteHeight, noteText, padNet, paperPartRows,
  revText, withLibraryFacts, wrapText,
} from './pdfPages';
import {
  C, HEAD_H, ONEPAGE, PAPER_PT, ROW_H, SHEET_MARGIN, TB, chunk, drawDrawingInto,
  drawFrameAndTitleBlock, drawPinViews, drawSheet, drawTable, estimateTextWidth,
  needsRaster, truncateToWidth,
  type Cell, type Col, type DrawText, type Paper, type PdfLike, type SheetLayout,
  type TextStyle,
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

/**
 * 잘라내기 전용 — **실제로 그릴 폭**으로 자른다.
 *
 * `estimateTextWidth` 는 ASCII 를 한 글자 0.52em 으로 어림한다. 그런데 jsPDF
 * 기본 폰트(Helvetica)의 **대문자**는 0.65em 쯤이라, `N1 JST XHP-5 XH …` 처럼
 * 대문자가 많은 문자열에서 20% 넘게 적게 잡혔다. 그러면 잘리지 않은 채로
 * 칸을 넘어 옆 칸 글자를 덮는다 — A3 접속표의 NET 칸에서 실제로 그랬다.
 *
 * 벡터로 그리는 문자열(Latin-1)은 jsPDF 가 정확히 재 줄 수 있으므로 그 값을
 * 쓰고, 래스터로 나가는 한글이나 목(mock) 환경에서는 예전 어림으로 내려간다.
 * **경계 상자 계산은 건드리지 않는다** — 그쪽은 화면과 공유하는 값이라
 * 여기서 다른 수를 쓰면 두 그림이 갈린다(pdfDraw 머리말).
 */
function fitToWidth(pdf: PdfLike, text: string, size: number, maxW: number): string {
  if (typeof pdf.getTextWidth !== 'function') return truncateToWidth(text, size, maxW);
  pdf.setFontSize(size);
  /*
   * 섞인 문자열(`N1 JST XHP-5 XH 하우징 (5P)#1`)은 조각마다 다르게 잰다.
   * Latin-1 조각은 그대로 벡터로 나가므로 jsPDF 가 정확히 재고, 한글 조각은
   * 래스터라 여기서 잴 수 없으므로 예전 어림(전각 1em)을 쓴다. 한글 어림은
   * 실제와 거의 맞고, 어긋나던 것은 **대문자 ASCII** 쪽이었다.
   */
  const measure = (v: string): number => {
    let w = 0;
    for (const run of v.match(/[ -ÿ]+|[^ -ÿ]+/g) ?? []) {
      w += needsRaster(run) ? estimateTextWidth(run, size) : (pdf.getTextWidth?.(run) ?? 0);
    }
    return w;
  };
  if (measure(text) <= maxW) return text;
  const mark = needsRaster(text) ? '…' : '..';
  const markW = measure(mark);
  let out = '';
  for (const ch of text) {
    if (measure(out + ch) + markW > maxW) break;
    out += ch;
  }
  return out + mark;
}

/** jsPDF 인스턴스 하나에 묶인 텍스트 그리기 함수를 만든다 */
export function createTextDrawer(pdf: PdfLike): DrawText {
  return (raw: string, x: number, y: number, s: TextStyle = {}) => {
    const size = s.size ?? 9;
    const color = s.color ?? C.text;
    const t = s.maxWidth != null ? fitToWidth(pdf, String(raw), size, s.maxWidth) : String(raw);
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
  /**
   * 페이지 번호(1-base) → 그 면의 푸터 머리(`세트 · 하네스 · 도번 · Rev`).
   * 쪽 번호(`p/N`)는 전체 면 수를 알아야 하므로 마지막에 한 번에 붙인다.
   */
  pageFeet: string[];
  /** 세트 이름 — 세트 PDF 의 푸터 맨 앞에 붙는다. 단일 하네스 PDF 에는 없다. */
  setName?: string;
  /**
   * 치수 단위. 도면은 **여유율을 곱하지 않은 도면 길이**를 이 단위로만 바꿔
   * 적는다 — 종이는 현장이 자르는 치수다(README §6).
   */
  unit: LengthUnit;
  layout: SheetLayout;
  /** 세트당 수량 — 제목블록 3행과 치수 표기에 쓴다(§2-3 · §2-7) */
  perSet?: number;
};

/** 표 위쪽 시작선 (제목 아래) */
const TABLE_TOP = SHEET_MARGIN + 42;
/** 푸터 위 여백 */
const FOOT_GAP = 26;
/**
 * 표 최대 폭. A3 폭에 그대로 맞추면 열이 화면 반쪽만큼 벌어져 FROM 과 TO 가
 * 눈으로 이어지지 않는다. 표는 왼쪽에 붙여 두고 폭을 묶는다.
 */
const MAX_TABLE_W = 760;

/** 이 페이지에서 표가 차지할 x · 폭 */
function tableRect(ctx: Ctx): { x: number; w: number } {
  return { x: SHEET_MARGIN, w: Math.min(ctx.pageW - SHEET_MARGIN * 2, MAX_TABLE_W) };
}

/**
 * 접속표 FROM/TO 에 적는 끝점 표기 — `J1-1` · `J1 (+)` (개선안 §2-12 마지막 줄).
 *
 * ## 왜 CSV 의 `from`/`to` 와 다른 글자인가
 * CSV 의 `describeEndpoint` 는 `JST XHP-10 XH 하우징 (10P)#1` 처럼 **부품명**으로
 * 적는다. 그 헤더는 받는 쪽 엑셀 매크로가 참조하는 발표된 인터페이스라 못
 * 건드린다(exporters.RUN_CSV_COLUMNS 주석). 그런데 같은 종이 위의 배선도는
 * 커넥터를 `J1`·`J2` 로 부른다 — 표가 부품명으로 적으면 읽는 사람이 이름을
 * 레퍼런스로 되짚어야 한다. **한 장짜리 도면에서는 그 되짚기가 곧 오독이다.**
 * 그래서 종이에서만 도면 레퍼런스로 적고, CSV 는 그대로 둔다.
 *
 * ## 왜 숫자가 아니면 괄호인가
 * `-` 와 `−` 가 붙으면(`J1--`) 판독이 안 된다. 숫자 핀은 `J1-1`, 그 밖은
 * `J1 (+)` 로 갈라 적는다.
 */
function endpointRef(doc: HarnessDocument, refs: Map<string, string>, e: Endpoint): string {
  if (e.type === 'device') {
    const d = doc.devices.find((x) => x.id === e.deviceId);
    const ref = refs.get(e.deviceId) ?? d?.name ?? e.deviceId;
    return e.terminal ? `${ref} (${e.terminal})` : ref;
  }
  const c = doc.connectors.find((x) => x.id === e.connectorId);
  const pin = c?.pins.find((p) => p.id === e.pinId);
  const ref = refs.get(e.connectorId) ?? e.connectorId;
  const label = String(pin?.label ?? pin?.index ?? '?');
  return /^\d+$/.test(label) ? `${ref}-${label}` : `${ref} (${label})`;
}

/**
 * 푸터 머리 — `<세트> · <이름> · <도번> · <Rev>` (도면집 형식).
 * 없는 값은 만들어내지 않는다 — 전부 '—'. 세트 이름은 세트 PDF 에서만 붙는다.
 */
function footHead(ctx: Ctx, name: string, no?: string, rev?: string): string {
  return [ctx.setName?.trim(), name, no?.trim() || '—', revText(rev)].filter(Boolean).join(' · ');
}

function startPage(ctx: Ctx, foot: string): void {
  if (ctx.pageFeet.length > 0) ctx.pdf.addPage();
  ctx.pageFeet.push(foot);
}

/** 하네스 면 하나를 시작한다 */
function startDocPage(ctx: Ctx, doc: HarnessDocument): void {
  startPage(ctx, footHead(ctx, doc.name || '이름 없는 하네스', doc.drawingNo, doc.rev));
}

function stampFooters(ctx: Ctx): void {
  const m = ctx.pageFeet.length;
  for (let i = 0; i < m; i++) {
    ctx.pdf.setPage(i + 1);
    ctx.text(`${ctx.pageFeet[i]} · ${i + 1}/${m}`, ctx.pageW / 2, ctx.pageH - 12, {
      size: 8, color: C.muted, align: 'center',
    });
  }
}

// ============================================================
// 접속표 (FROM → TO)
// ============================================================

/**
 * 접속표 열 구성 — **용지 폭에 따라 접는다** (개선안 §2-12 의 단서).
 *
 * 개선안은 `NET / FROM / TO / 색 / 신호 / 길이` 6열을 제시하면서 "이 세트는 전
 * 가닥 게이지가 같아 뺐다. 툴에서는 게이지까지 7열로 두거나 용지 폭에 따라 열을
 * 접는 편이 낫다" 는 단서를 달았다. 툴은 게이지가 섞인 하네스를 그린다 —
 * 그래서 **접을 수 있을 때만 접는다**:
 *
 *  · `sheets` (전폭 ≤760pt) → **7열.** 게이지를 남긴다. 폭이 충분하고, 이 면은
 *    접속표만 있는 면이라 게이지를 읽을 다른 표가 같은 종이에 없다.
 *  · `onepage` (320pt) → **6열.** 320pt 에 7열이면 한 칸이 45pt 라 `AWG22` 와
 *    `1600 (케이블)` 이 나란히 말줄임된다. 게이지는 **같은 면의 부품표**가
 *    `AWG22 · red` 로 이미 적으므로 종이에서 정보가 사라지지 않는다.
 *
 * `RUN_CSV_COLUMNS`(CSV 열의 단일 출처)와 어긋나지 않는다 — 거기에도 `신호`가
 * 있고, 여기서 새로 만든 열은 하나도 없다. 종이가 CSV 의 부분집합이다.
 */
function runCols(unit: LengthUnit, compact: boolean): Col[] {
  /*
   * 좁은 표의 머리는 도면집처럼 `길이` 만 적는다 — 칸이 좁아 `길이 (mm)` 가
   * 잘린다. 단위는 표 제목줄 오른쪽(`10본 · mm`)에 남겨 둔다(addOnePage).
   */
  const len = {
    title: compact ? '길이' : `길이 (${unitLabel(unit)})`,
    w: 0.12,
    align: 'right' as const,
  };
  if (compact) {
    /*
     * 320pt 를 여섯으로 나눈 값. 개선안의 `.11/.19/.19/.22/.17/.12` 를 **실제
     * 내용 폭을 재서** 조정했다 — 그 비율은 색 이름이 `R 빨강` 처럼 두 글자인
     * 세트를 놓고 정한 값이라, 툴이 적는 영문 색 이름에는 맞지 않는다.
     *
     * 320pt 안에서 다 담을 수는 없어 **무엇을 자를지 골라야 했다** (실측):
     *  · `W/Br white/brown` 은 약호까지 75pt, `Master Rx` 는 40pt. 둘 다
     *    온전히 넣으면 FROM·TO·길이가 잘린다.
     *  · 잘린 `Mast..` 는 **아무 말도 하지 않는다.** 그런데 신호명을 도면에서
     *    뺀 근거가 바로 이 열이다(§2-5) — 이 열이 잘리면 그 근거가 무너진다.
     *  · 반대로 색 이름은 잘려도 **약호(W/Br)와 견본과 선 색**이 남는다.
     *    같은 사실을 말하는 단서가 셋이나 더 있다.
     * 예전에는 그래서 좁은 표에서 색 이름을 빼고 약호만 적었다. 지금은 이름을
     * 도면집처럼 **한글 두 글자**(`R 빨강`, `W/O 흰/주황`)로 적으므로 영문
     * 이름(`white/brown`)보다 훨씬 짧다 — 색 칸에 .21, 신호에 .25 를 준다.
     * 길이 칸은 `300 (케이블)` 이 들어가야 해서 .16 을 유지한다.
     */
    return [
      { title: 'NET', w: 0.10 },
      { title: 'FROM', w: 0.14 },
      { title: 'TO', w: 0.14 },
      { title: '색', w: 0.21 },
      { title: '신호', w: 0.25 },
      { ...len, w: 0.16 },
    ];
  }
  /*
   * 전폭 표(≤760pt)는 7열이다. 예전 6열에서 FROM·TO 가 각각 .23 이었는데,
   * 그 폭은 `JST XHP-5 XH 하우징 (5P)#1` 같은 **부품명**을 담으려던 것이다.
   * 지금은 도면 레퍼런스(`J1-1`)로 적으므로 .16 이면 남는다 — 그 몫을 새
   * `신호` 열과, 네트 이름이 긴 문서를 위해 NET 에 돌린다.
   */
  return [
    { title: 'NET', w: 0.18 },
    { title: 'FROM', w: 0.16 },
    { title: 'TO', w: 0.16 },
    { title: '색', w: 0.16 },
    { title: '신호', w: 0.14 },
    { title: '게이지', w: 0.08, align: 'right' },
    len,
  ];
}

function runCells(
  doc: HarnessDocument,
  refs: Map<string, string>,
  r: RunRow,
  unit: LengthUnit,
  compact: boolean,
): Cell[] {
  const [base, stripe] = r.color.split('/');
  /*
   * 좁은 표에서는 **네트 코드만** 적는다(`N1`). 32pt 칸에 `N1 +12V_MAIN` 을
   * 넣으면 `N1 …` 으로 잘려 코드조차 못 읽는다 — 이름을 잘라 붙이는 것보다
   * 코드를 온전히 남기는 편이 낫다. 이름은 도면의 네트 라벨과 접속표 CSV 의
   * `net` 열에 그대로 있으므로 종이에서 사실이 사라지지는 않는다.
   */
  // 종이에서는 `N01` 처럼 두 자리로 — 열이 맞아 눈으로 따라가기 쉽다(도면집 형식).
  const code = r.netCode ? padNet(r.netCode) : '';
  const net = compact
    ? (code || r.net || '—')
    : (code ? (r.net ? `${code} ${r.net}` : code) : (r.net || '—'));
  // 색은 흑백 인쇄를 대비해 **약호**를 적고 견본을 보조로 붙인다.
  // 이름은 한글(`R 빨강`, `W/O 흰/주황`) — 모르는 색 이름은 원문 그대로.
  const color: Cell = base
    ? { swatch: strokeColor(base), text: colorLabel(base, stripe) }
    : '—';
  // 케이블 심선은 케이블 길이로 재단된다 — 값은 적되 어디서 온 값인지 밝힌다.
  // 그냥 숫자만 적으면 이 심선에 직접 지정된 길이처럼 읽힌다.
  const num = r.lengthMm ? formatLength(Number(r.lengthMm), unit) : '';
  const len = num ? (r.lengthSource === 'cable' ? `${num} (케이블)` : num) : '—';
  const w = doc.wires.find((x) => x.id === r.wireId);
  const from = w ? endpointRef(doc, refs, w.from) : (r.from || '—');
  const to = w ? endpointRef(doc, refs, w.to) : (r.to || '—');
  const signal = r.signal || '—';
  return compact
    ? [net, from, to, color, signal, len]
    : [net, from, to, color, signal, r.gauge || '—', len];
}

function runRowCells(ctx: Ctx, doc: HarnessDocument, compact: boolean): Cell[][] {
  const refs = refLabels(doc);
  return buildRunList(doc).map((r) => runCells(doc, refs, r, ctx.unit, compact));
}

function drawRunList(ctx: Ctx, doc: HarnessDocument): void {
  const rows = runRowCells(ctx, doc, false);
  const cols = runCols(ctx.unit, false);
  const { x, w } = tableRect(ctx);
  const bottom = ctx.pageH - FOOT_GAP;
  const perPage = Math.max(1, Math.floor((bottom - (TABLE_TOP + HEAD_H)) / ROW_H));
  const pages = chunk(rows, perPage);

  pages.forEach((page, pi) => {
    startDocPage(ctx, doc);
    // 헤더는 **페이지마다 반복** — 넘어간 장만 봐도 무슨 열인지 알아야 한다
    drawTable(ctx.pdf, ctx.text, {
      x, y: TABLE_TOP, w,
      title: '접속표 (FROM → TO)',
      note: pages.length > 1 ? `${rows.length}본 · ${pi + 1}/${pages.length}` : `${rows.length}본`,
      cols, rows: page, empty: '배선이 없다.',
    });
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

/**
 * 파트리스트 줄 → 표 셀.
 *
 * 분류 머리줄·소계는 `drawTable` 의 평범한 행으로 접어 넣는다. 띠 대신 `[분류]`
 * 꼴로 적어 표를 그리는 함수를 하나만 남긴다.
 */
function partCells(lines: PartLine[]): Cell[][] {
  return lines.map((ln) =>
    ln.kind === 'group' ? [`[${ln.title}]`, '', '']
    // 소계는 **품목 칸 왼쪽**에 적는다. 비고 칸(오른쪽)에 두면 그 줄이 바로 위
    // 부품의 비고처럼 읽힌다 — 좁은 표에서 실제로 그렇게 보였다.
    : ln.kind === 'sub' ? [ln.label, '', '']
    : [ln.row.part || '—', String(ln.row.qty), ln.row.detail || '—'],
  );
}

function drawPartList(ctx: Ctx, doc: HarnessDocument): void {
  // 도면의 파트리스트도 **도면 길이 그대로**다. 발주용 여유율은 파트리스트
  // CSV 에만 붙는다(export/bundle.ts 의 bodyOf 주석).
  const rows = buildPartList(doc, { unit: ctx.unit });
  const lines = partLines(rows);
  const { x, w } = tableRect(ctx);
  const bottom = ctx.pageH - FOOT_GAP;
  const perPage = Math.max(1, Math.floor((bottom - (TABLE_TOP + HEAD_H)) / ROW_H));
  const pages = chunk(partCells(lines), perPage);
  const totalQty = rows.reduce((n, r) => n + r.qty, 0);
  const note = `${rows.length}품목 · 합계 ${totalQty}개`;

  pages.forEach((page, pi) => {
    startDocPage(ctx, doc);
    drawTable(ctx.pdf, ctx.text, {
      x, y: TABLE_TOP, w,
      title: '파트리스트',
      note: pages.length > 1 ? `${note} · ${pi + 1}/${pages.length}` : note,
      cols: PART_COLS, rows: page, empty: '부품이 없다.',
    });
  });
}

// ============================================================
// A4 가로 1페이지 (개선안 §2-2)
// ============================================================

/**
 * 한 면에 들어가는 표 행 수.
 *
 * 표 아래 끝은 프레임 안쪽(= 용지 높이 - 여백 - 8)이다. 제목블록은 오른쪽
 * 300pt 만 차지하므로 왼쪽 접속표는 프레임 바닥까지 내려갈 수 있고, 부품표는
 * 제목블록 위에서 멈춰야 한다 — 그래서 둘의 상한이 다르다.
 */
function onePageRows(y: number, bottom: number): number {
  return Math.max(1, Math.floor((bottom - (y + HEAD_H)) / ROW_H));
}

/** 제목블록 위쪽 y — 제목블록과 겹칠 수 있는 표는 여기서 멈춘다 */
function titleBlockTop(ctx: Ctx): number {
  return ctx.pageH - SHEET_MARGIN - TB.rowH * TB.rows - 8;
}

/**
 * 1페이지 배치의 **이어지는 면** — 프레임과 제목블록을 다시 그린다.
 *
 * 예전 이어지는 면은 프레임도 제목블록도 없는 맨종이에 표 두 줄만 있었다
 * (EW-05 실측). 떨어져 나간 한 장이 **어느 도면의 몇 번째 장인지** 말하지
 * 못하면 현장에서 그 장은 버려진다. 표는 전폭이지만 제목블록 위에서 멈춘다.
 */
function contRect(ctx: Ctx): { x: number; w: number; cap: number } {
  const x = SHEET_MARGIN + 12;
  const w = Math.min(ctx.pageW - x * 2, MAX_TABLE_W);
  const cap = Math.max(1, Math.floor((titleBlockTop(ctx) - 4 - (TABLE_TOP + HEAD_H)) / ROW_H));
  return { x, w, cap };
}

function startContPage(ctx: Ctx, doc: HarnessDocument): void {
  startDocPage(ctx, doc);
  drawFrameAndTitleBlock(ctx.pdf, doc, ctx.text, { w: ctx.pageW, h: ctx.pageH },
    ctx.perSet != null ? { perSet: ctx.perSet } : {});
}

/**
 * A4 가로 한 장 — 배선도 · 접속표 · 부품표(+비고) · 핀 배열 뷰 · 제목블록.
 *
 * 표가 한 면에 안 들어가면 **버리지 않고** 이어지는 면으로 흘려 보낸다.
 * 한 장에 담자고 행을 지우면 그 도면으로는 하네스를 만들 수 없다.
 */
function addOnePage(ctx: Ctx, doc: HarnessDocument): void {
  startDocPage(ctx, doc);
  const page = { w: ctx.pageW, h: ctx.pageH };
  const info = ctx.perSet != null ? { perSet: ctx.perSet } : {};
  drawFrameAndTitleBlock(ctx.pdf, doc, ctx.text, page, info);

  // ── 상단 도면 (§2-2 의 DRAW 좌표 그대로) ────────────────────────────────
  drawDrawingInto(ctx.pdf, doc, ctx.text, { ...ONEPAGE.draw }, info);

  const frameBottom = ctx.pageH - SHEET_MARGIN - 8;
  const tbTop = titleBlockTop(ctx);
  const u = unitLabel(ctx.unit);

  // ── 접속표 (6열, §2-12) ─────────────────────────────────────────────────
  const runAll = runRowCells(ctx, doc, true);
  const runCap = onePageRows(ONEPAGE.run.y, frameBottom);
  const runHere = runAll.slice(0, runCap);
  const runRest = runAll.slice(runCap);
  /*
   * 표 머리 오른쪽 글자(note)는 **짧게** 둔다. 세 표가 18pt 간격으로 붙어 있어서
   * (pdfDraw.ONEPAGE — 접속표 끝 354 → 부품 372, 부품 끝 608 → 핀 배열 626)
   * `6품목 · 이어짐` 처럼 길어지면 오른쪽 이웃 표의 제목(`부품`, `핀 배열 (실물 기준)`)과
   * 한 줄로 붙어 읽혔다. '이어짐' 은 왼쪽 제목 쪽으로 옮긴다(제목 칸은 여유가 있다).
   */
  drawTable(ctx.pdf, ctx.text, {
    ...ONEPAGE.run,
    title: runRest.length ? '접속표 (FROM → TO) · 이어짐' : '접속표 (FROM → TO)',
    // 머리가 `길이` 뿐이라 단위를 여기 남긴다
    note: `${runAll.length}본 · ${u}`,
    cols: runCols(ctx.unit, true),
    rows: runHere,
    empty: '배선이 없다.',
  });

  /*
   * ── 부품표 + 비고 ──────────────────────────────────────────────────────
   * 도면집 형식(`J1 부품명 | 1 | MPN`, `전선 AWG22 | 10 | 1600mm / 본`) —
   * pdfPages.paperPartRows 주석. 아래에 비고 블록이 붙으므로 **비고 높이를
   * 빼고** 상한을 잡는다. 예전 상한은 제목블록까지 표만 셌기 때문에 비고를
   * 둘 자리가 없었고, 넘친 행은 프레임 없는 맨종이로 갔다.
   *
   * 도면 레퍼런스별 한 줄이 칸을 넘치면, 같은 부품끼리 `J1·J3` 으로 묶어 다시
   * 센다(정보는 같고 줄만 준다). 그래도 넘치면 이어지는 면으로.
   */
  const avail = tbTop - 2 - (ONEPAGE.part.y + HEAD_H);
  const capFor = (lines: number) => Math.floor((avail - (lines ? noteHeight(lines) : 0)) / ROW_H);
  const noteAll = wrapText(noteText(doc), ONEPAGE.part.w, NOTE.size);
  let partAll = paperPartRows(doc, ctx.unit, false);
  if (partAll.length > capFor(noteAll.length)) {
    const grouped = paperPartRows(doc, ctx.unit, true);
    if (grouped.length < partAll.length) partAll = grouped;
  }
  // 비고가 길어 표가 한 줄도 못 서면, 비고 뒷부분을 이어지는 면으로 넘긴다
  let noteHere = noteAll.length;
  while (noteHere > 1 && capFor(noteHere) < Math.min(partAll.length, 1)) noteHere -= 1;
  const partCap = Math.max(1, capFor(noteHere));
  const partHere = partAll.slice(0, partCap);
  const partRest = partAll.slice(partCap);
  const noteRest = noteAll.slice(noteHere);
  const partEnd = drawTable(ctx.pdf, ctx.text, {
    ...ONEPAGE.part,
    title: partRest.length ? '부품 · 이어짐' : '부품',
    note: `${partAll.length}품목`,
    cols: PART_COLS_PAPER,
    rows: partHere,
    empty: '부품이 없다.',
  });
  drawNote(ctx.text, ONEPAGE.part.x, partEnd,
    noteRest.length ? [...noteAll.slice(0, noteHere - 1), `${noteAll[noteHere - 1]} …(다음 면)`] : noteAll);

  // ── 핀 배열 뷰 (§2-8) ───────────────────────────────────────────────────
  drawPinViews(ctx.pdf, doc, ctx.text, { ...ONEPAGE.pinView, bottom: tbTop });

  // ── 넘친 표는 이어지는 면으로 (프레임 · 제목블록 포함) ─────────────────
  if (runRest.length) {
    const { x, w, cap } = contRect(ctx);
    // 이어지는 면은 전폭이므로 **7열**로 다시 만든다(게이지가 살아난다).
    const wide = runRowCells(ctx, doc, false).slice(runCap);
    chunk(wide, cap).forEach((p, i, all) => {
      startContPage(ctx, doc);
      drawTable(ctx.pdf, ctx.text, {
        x, y: TABLE_TOP, w,
        title: '접속표 (FROM → TO) — 이어짐',
        note: `${runAll.length}본 중 ${runCap + 1}~${runAll.length} · ${i + 1}/${all.length}`,
        cols: runCols(ctx.unit, false), rows: p,
      });
    });
  }
  if (partRest.length || noteRest.length) {
    const { x, w, cap } = contRect(ctx);
    const pages = partRest.length ? chunk(partRest, cap) : [[]];
    pages.forEach((p, i, all) => {
      startContPage(ctx, doc);
      const end = drawTable(ctx.pdf, ctx.text, {
        x, y: TABLE_TOP, w,
        title: '부품 — 이어짐',
        note: `${partAll.length}품목 중 ${partCap + 1}~${partAll.length} · ${i + 1}/${all.length}`,
        cols: PART_COLS_PAPER, rows: p,
      });
      // 첫 면에 다 못 적은 비고는 마지막 이어지는 면에 **전부** 다시 적는다
      if (noteRest.length && i === all.length - 1) {
        drawNote(ctx.text, x, end, wrapText(noteText(doc), w, NOTE.size));
      }
    });
  }
}

// ============================================================
// 공개 API
// ============================================================

export type PdfOptions = {
  /**
   * 용지. `layout: 'onepage'` 이면 **A4 로 맞춰진다** — 1페이지 배치 좌표가
   * A4 가로 기준으로 정해져 있고, 근거 없는 좌표를 지어내지 않기 때문이다
   * (pdfDraw.ONEPAGE 주석). `sheets` 는 A3 가 기본이다.
   */
  paper?: Paper;
  /** 기본 mm — 화면·저장값과 같은 단위다 */
  unit?: LengthUnit;
  /** 기본 `onepage` (A4 한 장). 배선이 많으면 `sheets` (A3 3면) */
  layout?: SheetLayout;
  /** 세트당 수량 — 제목블록 3행·치수 표기에 쓴다. 모르면 '미상' 으로 찍힌다 */
  perSet?: number;
  filename?: string;
};

/**
 * 바이트 생성 옵션.
 * `images` 는 **미리 읽어 둔** 데이터시트 캡처(`{ [datasheet.src]: dataURL }`)다.
 * 바이트 생성은 동기라 여기서 네트워크를 탈 수 없다 — 없으면 부록을 건너뛴다.
 */
export type PdfBytesOptions = {
  paper?: Paper;
  unit?: LengthUnit;
  layout?: SheetLayout;
  perSet?: number;
  images?: Record<string, string>;
};

export type KitPdfOptions = {
  paper?: Paper;
  unit?: LengthUnit;
  layout?: SheetLayout;
  images?: Record<string, string>;
};

/**
 * 배치와 용지를 함께 정한다.
 * `onepage` + A3 는 **조용히 A4 로 내린다** — 아무것도 안 그리거나 좌표를
 * 지어내는 것보다 낫고, 대화상자는 A3 를 고를 수 없게 막아 이 강제가 사용자
 * 눈에 보이지 않는 일이 없게 한다.
 */
function paperFor(layout: SheetLayout, paper?: Paper): Paper {
  if (layout === 'onepage') return 'A4';
  return paper ?? 'A3';
}

function makeCtx(
  paper: Paper,
  unit: LengthUnit = 'mm',
  layout: SheetLayout = 'onepage',
  perSet?: number,
): Ctx {
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
    pageFeet: [],
    unit,
    layout,
    ...(perSet != null ? { perSet } : {}),
  };
}

/**
 * 하네스 한 종 → 면들.
 *
 * 구매품(`purchased`)은 결선도 대신 `구매 품목` 면 하나다 — 제작 대상이 아닌데
 * 결선도를 그리면 제작 지시로 읽힌다.
 *
 * 그리기 전에 스냅샷의 빈 칸(실물 배열·원본 도면)을 라이브러리에서 채운다
 * (pdfPages.withLibraryFacts — 같은 id·MPN 이고 비어 있을 때만, 덮지 않는다).
 */
function addHarness(ctx: Ctx, raw: HarnessDocument): void {
  const doc = withLibraryFacts(raw);
  if (doc.purchased) {
    startDocPage(ctx, doc);
    drawPurchasedPage(ctx.pdf, ctx.text, { w: ctx.pageW, h: ctx.pageH }, doc, ctx.unit, ctx.perSet);
    return;
  }
  if (ctx.layout === 'onepage') {
    addOnePage(ctx, doc);
    return;
  }
  startDocPage(ctx, doc);
  drawSheet(ctx.pdf, doc, ctx.text, { w: ctx.pageW, h: ctx.pageH },
    ctx.perSet != null ? { perSet: ctx.perSet } : {});
  drawRunList(ctx, doc);
  drawPartList(ctx, doc);
}

/**
 * 부록 — 커넥터 핀 번호(제조사 원본 도면 캡처). 두 장씩 한 면.
 * 이미지가 미리 읽혀 있지 않은 캡처는 뺀다. 하나도 없으면 부록 자체가 없다.
 */
function addAppendix(
  ctx: Ctx, docs: HarnessDocument[], images: Record<string, string> | undefined,
  rev: string, date: string,
): void {
  if (!images) return;
  const entries = collectDatasheets(docs.map(withLibraryFacts)).filter((e) => !!images[e.ds.src]);
  if (!entries.length) return;
  const warning = appendixWarning(entries);
  chunk(entries, 2).forEach((two, i) => {
    const letter = letterAt(i);
    const rows = appendixTitleRows(two, letter, rev, date);
    startPage(ctx, [ctx.setName?.trim(), rows.title, '—', rev].filter(Boolean).join(' · '));
    drawAppendixPage(ctx.pdf, ctx.text, { w: ctx.pageW, h: ctx.pageH }, two, images, rows, warning);
  });
}

/** 파일명에 못 쓰는 글자를 다듬는다 */
function safeName(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'harness';
}

function buildHarnessCtx(doc: HarnessDocument, opts: PdfBytesOptions = {}): Ctx {
  const layout = opts.layout ?? 'onepage';
  const ctx = makeCtx(paperFor(layout, opts.paper), opts.unit ?? 'mm', layout, opts.perSet);
  addHarness(ctx, doc);
  addAppendix(ctx, [doc], opts.images, revText(doc.rev), dateText(doc.updatedAt));
  stampFooters(ctx);
  return ctx;
}

/**
 * 하네스 한 종의 PDF 를 **바이트로** 만든다 (저장하지 않는다).
 *
 * 세트 내보내기는 파일을 하나씩 내려받는 대신 ZIP 한 개로 묶는다(브라우저가
 * 연속 다운로드를 막는다). 봉투에 담으려면 바이트가 필요하므로 저장과 생성을
 * 갈라 둔다.
 */
export function harnessPdfBytes(doc: HarnessDocument, opts?: PdfBytesOptions): Uint8Array<ArrayBuffer> {
  const ctx = buildHarnessCtx(doc, opts);
  const buf = ctx.pdf.output?.('arraybuffer');
  if (!buf) throw new Error('이 환경에서는 PDF 바이트를 만들 수 없습니다');
  return new Uint8Array(buf);
}

/** 이 문서들의 데이터시트 캡처를 읽어 둔다 (브라우저 전용 — 실패하면 빈 맵) */
export async function preloadDatasheets(docs: HarnessDocument[]): Promise<Record<string, string>> {
  try {
    return await loadDatasheetImages(collectDatasheets(docs.map(withLibraryFacts)));
  } catch {
    return {};
  }
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
  const images = await preloadDatasheets([doc]);
  const ctx = buildHarnessCtx(doc, { ...opts, images });
  ctx.pdf.save(opts.filename ?? `${safeName(doc.name || 'harness')}.pdf`);
}

/** 세트 전체를 한 PDF 로 — 도면 목록 + 하네스마다의 면 + 부록 */
export async function downloadKitPdf(
  kit: KitDocument,
  opts?: { paper?: Paper; unit?: LengthUnit; layout?: SheetLayout },
): Promise<void> {
  const images = await preloadDatasheets(kit.harnesses);
  const ctx = buildKitCtx(kit, { ...opts, images });
  ctx.pdf.save(`${safeName(kit.set.pn || kit.name || 'harness-kit')}.pdf`);
}

/** 세트 PDF 를 바이트로 (시험·미리보기용). 부록은 `images` 를 넘길 때만 */
export function kitPdfBytes(kit: KitDocument, opts?: KitPdfOptions): Uint8Array<ArrayBuffer> {
  const ctx = buildKitCtx(kit, opts);
  const buf = ctx.pdf.output?.('arraybuffer');
  if (!buf) throw new Error('이 환경에서는 PDF 바이트를 만들 수 없습니다');
  return new Uint8Array(buf);
}

function buildKitCtx(kit: KitDocument, opts?: KitPdfOptions): Ctx {
  const layout: SheetLayout = opts?.layout ?? 'onepage';
  const ctx = makeCtx(paperFor(layout, opts?.paper), opts?.unit ?? 'mm', layout);
  ctx.setName = kit.set.name?.trim() || kit.name?.trim() || undefined;

  // ── 도면 목록 (표지) ────────────────────────────────────────────────────
  if (kit.harnesses.length) {
    const page = { w: ctx.pageW, h: ctx.pageH };
    const rows = coverRows(kit, ctx.unit);
    const parts = chunk(rows, coverRowsPerPage(page));
    parts.forEach((p, i) => {
      startPage(ctx, [ctx.setName, '도면 목록', kit.set.pn?.trim() || '—', revText(kit.set.rev)]
        .filter(Boolean).join(' · '));
      drawCoverPage(ctx.pdf, ctx.text, page, kit, ctx.unit, p, rows.length, i, parts.length);
    });
  }

  // 세트당 수량은 하네스마다 다르다 — 면을 그리기 직전에 그 하네스 것으로 바꾼다.
  for (const h of kit.harnesses) {
    ctx.perSet = perSetOf(kit.set, h.id);
    addHarness(ctx, h);
  }
  ctx.perSet = undefined;
  if (!kit.harnesses.length) {
    startPage(ctx, [ctx.setName, '—', '—'].filter(Boolean).join(' · '));
    ctx.text('세트에 하네스가 없다.', ctx.pageW / 2, ctx.pageH / 2, {
      size: 12, color: C.muted, align: 'center',
    });
  }
  addAppendix(ctx, kit.harnesses, opts?.images, revText(kit.set.rev), dateText(kit.updatedAt));
  stampFooters(ctx);
  return ctx;
}
