/**
 * Agent D 소유 — 배선도를 jsPDF **벡터**로 그리는 순수 함수 모음.
 *
 * 왜 스냅샷을 버렸나:
 * html-to-image 로 React Flow 뷰포트를 찍어 붙이면 (1) 해상도가 화면에 묶이고
 * (2) 줌·팬 상태에 따라 도면이 잘리고 (3) 글자가 이미지가 되어 A3 인쇄물에서
 * 뭉갠다. 게다가 도면 프레임·제목블록은 캔버스 밖 DOM 이라 아예 안 찍힌다.
 * 여기서는 화면과 **같은 규칙**으로 좌표를 다시 계산해 선과 글자로 그린다.
 *   - 패드 격자 · 노드 상자: canvas/geometry.ts (connectorLayout · deviceSize …)
 *   - 배선 경로 · 스텁 라벨 자리: canvas/wirePlan.ts 의 planWires — 화면과 같은 함수
 *   - 색 약호 · 전선 색: docToFlow 의 colorAbbr / strokeColor
 *
 * **이 파일에는 경로 계산이 없다.** 예전에는 여기 자체 라우팅(스텁 → 트렁크 →
 * 스텁)이 있었고, 화면이 route.ts 직교 라우터로 옮긴 뒤에도 따라오지 않아
 * 같은 문서에서 두 그림이 갈렸다(J1 박스를 화면은 돌아가고 PDF 는 관통했다).
 * 게다가 엣지 data 의 `lane` 을 읽고 있었는데 그 필드는 이미 `laneY`·`laneX` 로
 * 갈린 뒤라 **PDF 의 레인 분리가 통째로 0** 이었다. 자세한 배경은 wirePlan.ts.
 *
 * 이 파일이 하는 좌표 일은 **논리 px → 용지 pt 등비 변환** 하나뿐이다(fitTransform).
 *
 * 이 파일은 DOM 을 쓰지 않는다. 한글 글자 그리기는 호출부(pdf.ts)가 넘겨주는
 * DrawText 에 위임한다 — 브라우저에서는 Canvas 래스터, 그 밖에서는 pdf.text.
 */
import type { HarnessDocument } from '../types';
import { docToEdges, jacketPaint, nodePositions, refLabels } from '../canvas/docToFlow';
import { lengthResolver } from '../store/wireLength';
/**
 * 스텁 라벨을 더 이상 PDF 에 그리지 않으므로(§2-5) `stubWidth`·`isPaleOnWhite`
 * 재수출도 함께 걷어 냈다. 화면 쪽 계산은 `canvas/stubLabel.ts` 그대로다.
 */
import { planJackets, planWires, type JacketRun } from '../canvas/wirePlan';
/**
 * 치수와 격자 해석은 **화면과 같은 출처**를 쓴다.
 * 예전에는 여기에 PAD/PITCH/INSET 과 gridOf/cellOf 를 통째로 베껴 뒀는데,
 * 그러면 한쪽만 고쳐지고 두 값이 조용히 갈라진다(실제로 갈라졌다 — 좌표가 없는
 * 슬롯에서 캔버스는 견디고 PDF 는 터지는 상태였다).
 */
import {
  PAD as GEO_PAD, PITCH as GEO_PITCH, INSET as GEO_INSET,
  REF_BLOCK_H, MPN_CAPTION_H, DEV_ROW_H, DEV_PAD, LABEL_PAD_X,
  PIN_NUM_FS,
  connectorLayout, connectorLabelRects, connectorRefParts, housingOrigin,
  pinNumberAlign, type PinNumAlign,
  deviceSize, deviceRefParts, deviceCaption, deviceLabelRects,
  estimateTextWidth, labelsAlignRight,
} from '../canvas/geometry';
import { DEFAULT_STUB } from '../canvas/route';
import { colorAbbr } from '../canvas/stubLabel';
import { isStandaloneLug, seriesOf } from '../library/taxonomy';
import type { Connector, Orientation, PartLibraryItem } from '../types';

// ============================================================
// 0. jsPDF 최소 표면 — 테스트에서 가짜 객체를 끼울 수 있게 좁혀 둔다
// ============================================================

export interface PdfLike {
  setLineWidth(w: number): unknown;
  setDrawColor(c: string): unknown;
  setFillColor(c: string): unknown;
  setTextColor(c: string): unknown;
  setFontSize(n: number): unknown;
  setFont(name: string, style?: string): unknown;
  text(t: string, x: number, y: number, o?: { align?: string }): unknown;
  /** 현재 폰트·크기 기준 실제 텍스트 폭. 테스트 목에는 없을 수 있어 optional. */
  getTextWidth?(t: string): number;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  rect(x: number, y: number, w: number, h: number, style?: string): unknown;
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number): unknown;
  /** 원 — 링 러그 구멍. 테스트 목에는 없을 수 있어 optional (없으면 사각으로 대신한다) */
  circle?(x: number, y: number, r: number, style?: string): unknown;
  /** 삼각형 — 스플라이스 마름모 채우기. optional (없으면 윤곽선만) */
  triangle?(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style?: string): unknown;
  setLineDashPattern(pattern: number[], phase: number): unknown;
  addPage(): unknown;
  setPage(n: number): unknown;
  getNumberOfPages(): number;
  save(name: string): unknown;
  /**
   * 완성된 PDF 를 바이트로 꺼낸다. 브라우저 저장(save) 대신 ZIP 에 담을 때 쓴다.
   * 테스트 목에는 없을 수 있어 optional 이다.
   */
  output?(type: 'arraybuffer'): ArrayBuffer;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

export type TextStyle = {
  /** pt */
  size?: number;
  /** #rrggbb */
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** pt. 넘으면 잘라서 말줄임 */
  maxWidth?: number;
};

/** (text, x, y) 의 y 는 **베이스라인**이다 — jsPDF.text 와 같은 규약. */
/**
 * 텍스트를 그리고 **실제로 그린 폭**을 돌려준다.
 * 폭을 돌려주는 이유: 라벨을 조각내 이어 붙일 때(레퍼런스 + 이름 + 방향)
 * 추정 폭을 쓰면 ASCII 는 짧게·한글은 길게 어긋나 글자가 겹치거나 벌어진다.
 */
export type DrawText = (text: string, x: number, y: number, s?: TextStyle) => number;

// ============================================================
// 1. 색 — tokens.css 값을 그대로 옮겨 적는다
//    PDF 는 CSS 변수를 읽지 못하므로 하드코딩이 불가피하다.
//    (원칙: UI 강조는 스틸 --accent 하나, 빨강은 전선 색으로만)
// ============================================================

export const C = {
  text: '#1d1f20',       // --text
  text2: '#424244',      // --text-2
  text3: '#5d5d60',      // --text-3
  muted: '#7a7a7d',      // --muted
  muted2: '#b7b7ba',     // --muted-2
  lineStrong: '#424244', // --line-strong
  lineMid: '#b7b7ba',    // --line-mid
  line: '#d4d4d7',       // --line
  subtle: '#f5f5f8',     // --bg-subtle
  accent: '#5980a6',     // --accent
  splice: '#a16207',     // --wire-splice
  /**
   * --danger. 개선안 §2-14 가 "C 토큰에 danger 누락" 으로 잡은 것을 채운다.
   * 쓰는 자리는 하나다 — **핀 배열 뷰의 뷰 기준(view) 누락 경고**. 도면이
   * "이 배열이 실물이다" 라고 말하면서 어느 면인지는 말하지 않는 상태는
   * 오조립으로 직결되므로, 그 한 줄만은 다른 회색 글자들과 같은 색일 수 없다.
   */
  danger: '#b3261e',     // --danger
  white: '#ffffff',
} as const;

// ============================================================
// 2. 화면과 공유하는 치수 (nodes.tsx · canvas.css)
// ============================================================

/**
 * 패드 26 · 피치 30 · 이름표/캡션 높이 — 전부 canvas/geometry.ts 가 출처다.
 * 여기서 다시 숫자를 적으면 화면과 갈라진다. 실제로 갈라져 있었다:
 * 이름표 높이를 여기서만 19 로 적어 두어(geometry 는 17) 하우징 박스가 배선
 * 끝점보다 2px 아래에 그려졌다 — 선이 패드에 안 붙었다.
 */
export const PAD = GEO_PAD;
export const PITCH = GEO_PITCH;
export const INSET = GEO_INSET;

const LATCH_T = 4;
const LATCH_L = 18;
const REG = 8;      // 등록 마크 한 변

export type Paper = 'A3' | 'A4';

/** 가로(landscape) 기준 pt */
export const PAPER_PT: Record<Paper, { w: number; h: number }> = {
  A3: { w: 1190.55, h: 841.89 },
  A4: { w: 841.89, h: 595.28 },
};

/** 시트 여백 (프레임 바깥) */
export const SHEET_MARGIN = 22;
/**
 * 제목블록 — 오른쪽 칸 폭은 **고정**이다.
 *
 * 개선안 §2-3 으로 2행 → **3행**이 되었다(`TB_W 300 / TB_ROW 18 / TB_SIDE 92`).
 * 3행에 `길이 … · 세트당 …` 이 들어간다. 제작 도면에 길이·수량이 없으면 발주가
 * 안 되기 때문이고, 행을 하나 더 다는 것이 최소 변경이다.
 * side 가 78 → 92 로 넓어진 이유는 3행 오른쪽 칸이 날짜(`2026-08-25`, 10글자)를
 * 받기 때문이다 — 78pt 로는 9.5pt 날짜가 말줄임된다.
 */
export const TB = { w: 300, side: 92, rowH: 18, rows: 3 };

/**
 * 도면 한 종을 종이에 앉히는 두 가지 방식.
 *
 * ── 왜 둘을 다 두나
 * `onepage` (개선안 §2-2) 는 A4 가로 **한 장**에 배선도·접속표·부품표·핀 배열
 * 뷰·제목블록을 전부 넣는다. 현장에서 케이블 하나를 잡고 종이 한 장만 보면
 * 되는 형식이고, 실제 세트 문서(EW-에보카 10종)는 하네스당 배선이 최대 10본이라
 * 전부 한 장에 들어간다.
 *
 * 그런데 배선이 수십 본인 하네스는 접속표가 한 장에 들어가지 않는다. 그때
 * `onepage` 는 표를 **이어지는 면**으로 흘려 보내지만(정보를 버리지 않는다),
 * 애초에 큰 종이에 크게 뽑고 싶은 경우가 있다 — 그래서 옛 `sheets`
 * (배선도 / 접속표 / 파트리스트 3면, A3 기본)를 그대로 남긴다.
 *
 * ── 기본값이 `onepage` 인 근거
 * 이 툴이 실제로 내보내는 문서에서 하네스당 배선 수의 최댓값이 10본이고,
 * `onepage` 접속표는 11행까지 프레임 안에 들어간다. 즉 **기본 경로에서는
 * 언제나 한 장**이다. 3면 방식은 같은 하네스에 종이를 세 장 쓰면서 두 장은
 * 표만 있는 면이라, 현장에서 도면과 접속표를 따로 들고 대조해야 했다.
 */
export type SheetLayout = 'onepage' | 'sheets';

/**
 * `onepage` 배치 좌표 (A4 가로 = 842 × 595 pt). 개선안 §2-2 의 값 그대로다.
 *
 * ── 왜 A4 전용인가
 * 이 숫자들은 A4 가로 한 장을 손으로 나눠 정한 값이다(레퍼런스 `build.py` 의
 * `DRAW/TBL_RUN/TBL_PART/PINV`). A3 에 비례로 늘리면 셀 17×15pt·글꼴 8.5pt 같은
 * **절대 치수**만 그대로고 칸만 벌어져, 검증된 배치가 아닌 다른 그림이 된다.
 * 근거 없는 좌표를 지어내지 않는다 — `onepage` 를 고르면 용지는 A4 다
 * (호출부에서 A4 로 맞추고, 대화상자도 그 사실을 적는다).
 */
export const ONEPAGE = {
  draw: { x: 34, y: 40, w: 768, h: 306 },
  run: { x: 34, y: 380, w: 320 },
  part: { x: 372, y: 380, w: 236 },
  pinView: { x: 626, y: 380, w: 196 },
} as const;

// ============================================================
// 3. 순수 계산 헬퍼 (테스트 대상)
// ============================================================

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * 글자 폭 어림 — jsPDF.getTextWidth 는 한글을 못 재고(폰트가 없다) 테스트
 * 환경에는 Canvas 도 없다. 잘라내기 판단에만 쓰므로 어림으로 충분하다.
 *
 * 구현은 canvas/geometry.ts 로 옮겼다. 같은 어림이 **화면 노드의 경계 상자 폭**을
 * 정하기 때문이다(이름표가 하우징 밖으로 삐져나온 만큼 배선을 덮는다).
 * 여기서 따로 한 벌 더 두면 언젠가 한쪽만 고쳐진다 — 그래서 다시 내보내기만 한다.
 */
export { estimateTextWidth };

/** jsPDF 기본 폰트(WinAnsi)로 그릴 수 없는 글자가 섞였는가 */
export function needsRaster(text: string): boolean {
  return /[^ -ÿ]/.test(text);
}

/** 폭에 맞춰 자르고 말줄임. 자를 게 없으면 원문 그대로 돌려준다. */
export function truncateToWidth(text: string, size: number, maxW: number): string {
  if (maxW <= 0) return '';
  if (estimateTextWidth(text, size) <= maxW) return text;
  const mark = needsRaster(text) ? '…' : '..';
  const markW = estimateTextWidth(mark, size);
  const chars = [...text];
  let out = '';
  let w = 0;
  for (const ch of chars) {
    const cw = estimateTextWidth(ch, size);
    if (w + cw + markW > maxW) break;
    out += ch;
    w += cw;
  }
  return out + mark;
}

/**
 * 전선 굵기(논리 px). **흑백 인쇄 대비** — 색만으로 구분하지 않도록
 * 게이지가 굵을수록 선도 굵게 그린다. 스텁의 색 약호가 세 번째 단서다.
 */
export function wireWidthPx(gauge: { system: 'awg' | 'mm2'; value: number }): number {
  if (gauge.system === 'mm2') {
    return Math.min(3.2, Math.max(1.2, 1.0 + gauge.value * 1.4));
  }
  // AWG 는 숫자가 작을수록 굵다
  if (gauge.value <= 16) return 3.0;
  if (gauge.value <= 18) return 2.4;
  if (gauge.value <= 22) return 1.8;
  if (gauge.value <= 26) return 1.4;
  return 1.1;
}

/**
 * 종이 위 전선 굵기(pt) — 논리 굵기(wireWidthPx)를 축척대로 줄이되 **하한**을 둔다.
 *
 * 왜 하한인가: 부품이 많은 도면은 축척이 0.4 안팎까지 내려가, AWG22(1.8px)가
 * 0.7pt — 90dpi 화면에서 1px 짜리 실선이 된다. 레퍼런스(build.py)는 같은 전선을
 * 1.6px × 축척(≈1.3) ≈ 2pt 로, 합선 뒤 굵은 가닥은 2.6px ≈ 3.3pt 로 그린다.
 * 그 굵기를 **축척과 무관하게** 지키려고 `논리 px × 1.1` 을 pt 하한으로 쓴다:
 *   AWG16 3.3 · AWG18 2.6 · AWG20/22 2.0 · AWG24/26 1.5 · AWG28 1.2 (pt)
 * 게이지 순서는 그대로라 흑백에서도 굵기로 구분된다. 화면과 공유하는
 * wireWidthPx 는 건드리지 않는다 — 이 배율은 종이에서만 쓴다.
 * 레인 간격(12px)이 축척 0.4 에서 4.8pt 라 가장 굵은 3.3pt 도 이웃 선과 붙지 않는다.
 */
export const PDF_WIRE_PT_PER_PX = 1.1;
export function pdfWireWidthPt(widthPx: number, scale: number): number {
  return Math.max(widthPx * scale, widthPx * PDF_WIRE_PT_PER_PX);
}

export type Transform = { scale: number; tx: number; ty: number };

/**
 * 도면 전체가 페이지에 들어가도록 **등비** 변환을 만든다.
 * 화면의 줌·팬 상태는 쓰지 않는다 — 인쇄물은 언제나 같은 그림이어야 한다.
 *
 * 확대 상한이 2 → **1.6** 로 내려왔다(개선안 §2-2). 2배까지 키우면 배선이 두
 * 본뿐인 하네스(EW-01 파스톤↔페룰)에서 패드가 52pt 짜리 사각형이 되어, 도면이
 * 아니라 도해처럼 보인다. 1.6 은 레퍼런스 구현이 12장을 뽑아 보고 정한 값이고
 * 여기서도 같은 값을 쓴다 — 상수를 갈라 두면 두 그림이 갈린다.
 */
export function fitTransform(bounds: Rect, area: Rect, maxScale = 1.6): Transform {
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  const scale = Math.max(0.05, Math.min(area.w / bw, area.h / bh, maxScale));
  return {
    scale,
    tx: area.x + (area.w - bw * scale) / 2 - bounds.x * scale,
    ty: area.y + (area.h - bh * scale) / 2 - bounds.y * scale,
  };
}

/** 표 페이지 분할 — n 개씩 자른다 */
export function chunk<T>(rows: T[], n: number): T[][] {
  if (n <= 0) return rows.length ? [rows] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out.length ? out : [[]];
}

// ============================================================
// 4. 도면 모델 만들기 (문서 → 좌표)
// ============================================================

export type PadBox = {
  label: string;
  x: number;
  y: number;
  assigned: boolean;
  /**
   * 핀 번호 글자가 앉는 사각형 (논리 px, 절대).
   * 화면과 **같은 함수**(geometry.pinNumberBox)에서 받는다 — 여기서 다시 패드
   * 가운데를 잡으면 종이에서만 번호가 핸들과 어긋난다. 장치 단자는 이 개념이
   * 없어 비운다(단자는 x·y 가 곧 글자 시작점이다).
   */
  num?: Rect;
  numAlign?: PinNumAlign;
  /** 이 도면에서 일부러 비우는 핀(Connector.unused) — 패드에 X 를 긋는다 */
  unused?: boolean;
  /** 핀 id — 배선 끝 번호(접점 번호)를 찾을 때 쓴다. 장치 단자는 없다 */
  pinId?: string;
  /** 핸들(배선 끝점) 절대 좌표 — geometry.handleOffset 그대로 */
  handle?: Pt;
};

/**
 * 끝단 심볼 종류 (레퍼런스 render.py 의 End.kind 에 대응).
 *
 * **데이터가 가르는 것만** 따로 그린다 —
 *  · `splice`  — Connector.kind === 'splice'  → 마름모 (render.py 의 SP1)
 *  · `faston`  — 파스톤 계열 **REC**(id `…-rec`) → 리셉터클 + 넥 + 압착 배럴
 *  · `ferrule` — 페룰 계열 → 절연 칼라 + 금속 관
 *  · `lug`     — 링·Y형 러그 → 압착 배럴 + 혀(링은 구멍, Y형은 홈)
 *  · `free`    — 납처리 전선단 (render.py `_draw_free`) — 하우징 없이 굵은 심선 토막 + 색 약호
 *  · `barrel`  — DC 배럴잭 (render.py `_draw_barrel`) — +/− 패드 + 배럴 측단면
 *  · `dsub`    — D-SUB (render.py `_draw_grid` 의 dsub) — 격자 + 배선 반대쪽 모서리를 깎은 D 쉘
 *  · `housing` — 그 밖 전부 (하우징 격자).
 *
 * 판정 근거는 **부품의 `endKind`** 가 먼저다(명시적 표시). 없으면 예전처럼 taxonomy
 * (러그 계열 id) 로 가른다. 납처리 전선단·배럴잭·D-SUB 는 taxonomy 에 계열이 없어
 * `endKind` 가 있을 때만 그린다 — 이름·품번으로 추측하지 않는다.
 */
export type EndGlyph = 'housing' | 'splice' | 'faston' | 'ferrule' | 'lug' | 'free' | 'barrel' | 'dsub';

/**
 * 커넥터 → 끝단 심볼.
 *
 * 심볼은 **장식**이다. 배선 끝점(핸들)은 언제나 geometry 가 정한 하우징 박스 변 위에
 * 있고, 심볼은 그 자리에 맞춰 그린다. 그래서 핸들과 맞출 수 없는 방향에서는 심볼을
 * 버리고 하우징 격자로 남긴다(틀린 그림보다 일반 그림이 낫다):
 *  · 러그·파스톤·페룰·납처리·배럴 — 심볼을 가로로 눕혀 그리므로 **배선이 좌우로
 *    나가고(0°/180°) 그리는 격자가 한 열**일 때만.
 *  · 배럴은 추가로 극이 **2개 이하**일 때만(센터·슬리브 두 극의 그림이다).
 *  · D-SUB 는 격자를 그대로 쓰고 외곽선만 바꾸므로 어느 방향이든 된다.
 */
export function endGlyphOf(c: Connector, part: PartLibraryItem | undefined, drawCols = 1): EndGlyph {
  if (c.kind === 'splice') return 'splice';
  const sideways = (c.orientation === 0 || c.orientation === 180) && drawCols === 1;
  const ek = part?.endKind;
  if (ek) {
    if (ek === 'dsub') return 'dsub';
    if (!sideways) return 'housing';
    if (ek === 'free') return 'free';
    if (ek === 'barrel') return c.pins.length <= 2 ? 'barrel' : 'housing';
    // 파스톤 심볼은 리셉터클(암) 그림이다 — 탭(수)으로 적힌 부품에 씌우지 않는다
    if (ek === 'faston') return part.gender === 'plug' || part.gender === 'header' ? 'housing' : 'faston';
    if (ek === 'ferrule') return 'ferrule';
    if (ek === 'ring' || ek === 'fork') return 'lug';
    return 'housing';
  }
  if (!part || !isStandaloneLug(part)) return 'housing';
  if (!sideways) return 'housing';
  const key = seriesOf(part)?.key;
  if (key === 'lug-faston') return /-rec$/.test(part.id) ? 'faston' : 'housing';
  if (key === 'lug-ferrule') return 'ferrule';
  if (key === 'lug-ring' || key === 'lug-fork') return 'lug';
  return 'housing';
}

export type NodeBox = {
  id: string;
  ref: string;
  name: string;
  mpn?: string;
  kind: 'connector' | 'splice' | 'device';
  /** 하우징 사각형 (논리 좌표) */
  box: Rect;
  /** 레퍼런스 라벨 보조 글자 ("← 0° 왼쪽"). 장치는 빈 문자열 */
  dir: string;
  /** 레퍼런스 라벨 베이스라인 (왼쪽 끝) */
  refAt: Pt;
  mpnAt: Pt;
  /**
   * 이름표·캡션이 차지하는 사각형 (논리 px).
   * 커넥터는 화면과 **같은 함수**(geometry.connectorLabelRects)에서 받는다 —
   * 그래야 왼쪽/오른쪽 정렬이 화면과 갈리지 않는다. 도면 경계(boundsOf)도 이걸 쓴다.
   */
  labelRects: Rect[];
  /**
   * 종이 경계 전용 — labelRects 를 실제 글꼴 폭만큼 넓힌 것. 화면 상자(labelRects)는
   * geometry 와 1px 도 다르면 안 되므로 따로 둔다. 없으면 labelRects 를 쓴다.
   */
  inkRects?: Rect[];
  pads: PadBox[];
  /** 래치 돌기 (장치는 없음) */
  latch?: Rect;
  color: string;
  /** 장치는 점선 테두리 */
  dashed: boolean;
  /** 끝단 심볼 종류 — 장치는 'housing' 이지만 kind 로 따로 그린다 */
  glyph?: EndGlyph;
  /** 링(true) / Y형(false) — glyph 'lug' 에서만 뜻이 있다 */
  ring?: boolean;
  /** 커넥터 방향 (장치는 없음) */
  orientation?: Orientation;
  /** 이름표를 하우징 오른쪽 변에 맞추는가 (geometry.labelsAlignRight) */
  alignRight?: boolean;
  /** 압착부에 절연 슬리브를 씌우는가 (Connector.sleeve) */
  sleeve?: boolean;
  /**
   * 납처리 전선단(glyph 'free') — 패드(핀)마다 거기 붙은 전선의 색 약호.
   * 화면·접속표와 같은 colorAbbr 이다. 전선이 없는 핀은 빈 문자열.
   */
  wireAbbr?: string[];
  /** 배럴잭(glyph 'barrel') — 외경·내경 표기 (`⌀5.5`). 부품 spec 에 있을 때만 */
  barrelDia?: { outer?: string; inner?: string };
};

export type WirePath = {
  id: string;
  points: Pt[];
  color: string;
  /** 논리 px */
  width: number;
  abbr: string;
  signal?: string;
  /** 스텁 라벨 중심 — 도착 패드 옆 */
  labelAt: Pt;
  /**
   * 양 끝의 접점 번호 (render.py `contact_no`) — [출발, 도착].
   * 커넥터 핀에 닿는 끝에만 있다. 장치 단자·스플라이스 끝은 null.
   */
  ends?: [string | null, string | null];
};

/**
 * 케이블 자켓 한 벌 — 심선이 나란히 가는 구간을 감싸는 슬리브 윤곽.
 * 사각형·이름표 자리는 **화면과 같은 함수**(wirePlan.planJackets)에서 통째로 온다.
 */
export type JacketShape = {
  cableId: string;
  runs: JacketRun[];
  /** #rrggbb 또는 색 이름 — 화면과 같은 보정(docToFlow.jacketPaint) */
  color: string;
  /** 자켓색 미지정이면 점선. 색을 지어내지 않는다는 뜻을 그림으로 말한다 */
  dashed: boolean;
  label: string;
  labelAt: Pt | null;
};

export type Drawing = { nodes: NodeBox[]; wires: WirePath[]; jackets: JacketShape[]; bounds: Rect };

/**
 * 문서 → 그릴 것들. 좌표계는 **화면 캔버스와 같은 논리 px** 이다.
 * 용지 pt 로 옮기는 일은 drawDrawing 의 fitTransform 하나가 맡는다.
 *
 * 노드 자리(폴백 포함)는 nodePositions, 하우징 격자는 connectorLayout,
 * 장치 상자는 deviceSize — 전부 화면이 쓰는 그 함수다. 배선은 planWires.
 */
export function buildDrawing(doc: HarnessDocument): Drawing {
  const refs = refLabels(doc);
  const nodes: NodeBox[] = [];
  // 폴백 좌표까지 화면과 한 출처에서 받는다 — 예전에는 여기서 다시 세고 있었다
  const at = nodePositions(doc, 'logical');

  for (const c of doc.connectors) {
    const housing = doc.usedParts.find((p) => p.id === c.housingId);
    const p0 = at.get(c.id)!;

    // 격자·박스·핸들 위치는 화면(nodes.tsx)과 **같은 계산**을 쓴다
    const g = connectorLayout(c, housing);
    const { layout, boxW, boxH } = g;
    const o = c.orientation;
    // 배선이 위(90°)로 나가면 화면에서도 라벨을 아래에 둔다 — 선이 글자를 뚫지 않게.
    // 그 규칙(=하우징 박스가 노드 좌상단에서 얼마나 내려오는가)은 housingOrigin 하나에 산다.
    const labelFirst = o !== 90;
    const org = housingOrigin(o);
    const box: Rect = { x: p0.x + org.x, y: p0.y + org.y, w: boxW, h: boxH };
    const isSplice = c.kind === 'splice';

    const numAlign = pinNumberAlign(o);
    // `unused` 는 숫자로도 라벨로도 들어온다(`3` / `'+'`) — 둘 다 문자열로 맞춰 본다
    const unusedSet = new Set((c.unused ?? []).map((v) => String(v)));
    const pads: PadBox[] = c.pins.map((pin) => {
      // cellOf 는 **그리는 격자** 칸이다 — 방향에 맞춰 세운 뒤의 좌표(geometry.drawGrid).
      // 저장된 pinLayout.offset(정의 기준)을 여기서 쓰면 화면과 그림이 갈린다.
      const cell = g.cellOf(pin.index);
      const slot = layout?.find((s) => s.index === pin.index);
      const label = String(pin.label ?? slot?.label ?? pin.index);
      // 번호 자리도 화면과 한 출처다. 상자는 하우징 기준이라 절대 좌표로 옮긴다.
      const nb = g.pinNumberBox(pin.index, label);
      return {
        label,
        x: box.x + INSET + cell.x * PITCH,
        y: box.y + INSET + cell.y * PITCH,
        assigned: Boolean(slot?.signal),
        num: { x: box.x + nb.x, y: box.y + nb.y, w: nb.w, h: nb.h },
        numAlign,
        unused: unusedSet.has(String(pin.index)) || unusedSet.has(label),
        pinId: pin.id,
        // 핸들(배선 끝점) 자리 — 화면과 같은 함수. 스플라이스 심볼이 여기서 선을 당긴다
        handle: { x: box.x + g.handleOffset(pin.index).x, y: box.y + g.handleOffset(pin.index).y },
      };
    });
    const glyph = endGlyphOf(c, housing, g.cols);

    const latch: Rect =
      o === 0 ? { x: box.x - LATCH_T - 1, y: box.y + boxH / 2 - LATCH_L / 2, w: LATCH_T, h: LATCH_L }
      : o === 180 ? { x: box.x + boxW + 1, y: box.y + boxH / 2 - LATCH_L / 2, w: LATCH_T, h: LATCH_L }
      : o === 90 ? { x: box.x + boxW / 2 - LATCH_L / 2, y: box.y - LATCH_T - 1, w: LATCH_L, h: LATCH_T }
      : { x: box.x + boxW / 2 - LATCH_L / 2, y: box.y + boxH + 1, w: LATCH_L, h: LATCH_T };

    /**
     * 이름표 글자와 그 사각형은 **화면과 같은 함수**에서 받는다.
     * 예전에는 화살표·방향 낱말을 여기서 따로 조립했는데, 그 글자 폭이 지금은
     * 노드 경계 상자의 폭을 정한다(라벨이 하우징 밖으로 나간 만큼 배선을 덮으므로).
     * 두 벌을 두면 상자와 그림이 갈린다.
     */
    const parts = connectorRefParts(c, housing, refs.get(c.id));
    const rects = connectorLabelRects(c, housing, p0, refs.get(c.id));
    const alignRight = labelsAlignRight(o);

    /*
     * 캡션 — 페룰·러그는 MPN 뒤에 **적용 전선**을 붙인다(레퍼런스 `노랑 · 1.0mm²`).
     * 색은 붙이지 않는다: 절연 목깃 색은 규격마다 달라 부품 데이터가 적지 않는다
     * (seed.ts 페룰 비고). 있는 값(spec.적용전선)만 쓴다.
     */
    const wireSpec = housing?.spec?.['적용전선'];
    /*
     * 납처리 전선단은 품번이 없다(사는 물건이 아니라 가공 지시). 레퍼런스는 그 자리에
     * 가공 내용(`피복탈거·납처리`)을 적는다 — 부품 spec 의 `처리` 가 있을 때만 쓴다.
     * 이 글자는 geometry 가 캡션 칸을 잡지 않은 자리(MPN 없음)에 앉으므로 종이 경계
     * (inkRects)에만 넣는다.
     */
    const freeNote = glyph === 'free' && !housing?.mpn ? housing?.spec?.['처리']?.trim() || undefined : undefined;
    const caption = (glyph === 'ferrule' || glyph === 'lug') && housing?.mpn && wireSpec && /mm²/.test(wireSpec)
      ? `${housing.mpn} · ${wireSpec}`
      : housing?.mpn ?? freeNote;
    /*
     * 경계(boundsOf)용 이름표 사각형은 **조금 넓혀** 센다. geometry 의 폭 어림은
     * ASCII 를 0.52em 으로 잡는데 PDF 의 실제 글자(Helvetica 대문자 ≈0.65em)는
     * 더 넓어, 도면 끝의 이름표가 영역 밖으로 삐져나왔다. 넓히는 쪽은 overhang
     * 방향(핸들 반대쪽)뿐이다. 이 값은 종이 경계에만 쓰이고 화면 상자는 그대로다.
     */
    const widen = (r: Rect, w: number): Rect => {
      const nw = Math.max(r.w, w);
      return { x: alignRight ? r.x + r.w - nw : r.x, y: r.y, w: nw, h: r.h };
    };
    const refRect = widen(rects.ref, rects.ref.w * 1.15);
    const mpnRect = rects.mpn
      ? widen(rects.mpn, estimateTextWidth(caption ?? '', 10) * 1.15 + LABEL_PAD_X * 2)
      : freeNote
        ? widen(
          { x: box.x, y: box.y + boxH, w: boxW, h: MPN_CAPTION_H },
          estimateTextWidth(freeNote, 10) * 1.15 + LABEL_PAD_X * 2,
        )
        : undefined;

    /*
     * 도면 이름은 짧은 이름이 먼저다(`D-SUB 9P 암`). 표시명은 발주용이라 길어
     * 도면 머리에서 방향 글자까지 밀어낸다. 이름표 **상자**는 geometry 가 긴 이름으로
     * 잰 것이므로 짧은 이름은 언제나 그 안에 든다 — 경계가 줄지 않을 뿐 겹치지 않는다.
     */
    const short = housing?.shortName?.trim();
    const name = short ? (isSplice ? '⑂ ' : '') + short : parts.name;

    // 납처리 전선단 — 핀마다 붙은 전선의 색 약호 (화면·접속표와 같은 colorAbbr)
    let wireAbbr: string[] | undefined;
    if (glyph === 'free') {
      wireAbbr = pads.map((p) => {
        const w = doc.wires.find((x) =>
          [x.from, x.to].some((e) => e.type === 'pin' && e.connectorId === c.id && e.pinId === p.pinId));
        return w ? colorAbbr(w.color.base, w.color.stripe) : '';
      });
    }
    // 배럴잭 — 외경·내경은 부품 spec 에 적힌 값만 쓴다(5.5/2.1 을 지어내지 않는다)
    let barrelDia: NodeBox['barrelDia'];
    const extra: Rect[] = [];
    if (glyph === 'barrel') {
      /*
       * 지름 기호는 `Ø`(U+00D8) 로 쓴다. 제도 기호 `⌀`(U+2300)는 Latin-1 밖이라 래스터로
       * 나가는데, 한글 글꼴에 그 글자가 없으면 두부(☒)로 찍혔다(실측). `Ø` 는
       * Helvetica 에 있어 벡터로 그대로 나간다.
       */
      const dia = (v?: string) => {
        const t = v?.trim();
        if (!t) return undefined;
        return `Ø${t.replace(/^[⌀Ø]\s*/, '').replace(/\s*mm$/i, '')}`;
      };
      barrelDia = { outer: dia(housing?.spec?.['외경']), inner: dia(housing?.spec?.['내경']) };
      // 배럴 통은 하우징 박스 **밖**(배선 반대쪽)에 붙는다 — 종이 경계에 넣는다
      const bx = o === 180 ? box.x - BARREL_W : box.x + boxW;
      extra.push({ x: bx, y: box.y - 6, w: BARREL_W, h: boxH + 10 });
    }

    nodes.push({
      id: c.id,
      ref: parts.ref,
      name,
      mpn: caption,
      kind: isSplice ? 'splice' : 'connector',
      box,
      dir: parts.dir,
      // 라벨이 위면 하우징 위, 아래면 (하우징 → MPN → 라벨) 순서.
      // x 는 사각형 왼쪽 + padding — o=180 은 그 사각형이 왼쪽으로 밀려 있다.
      refAt: {
        x: rects.ref.x + LABEL_PAD_X,
        y: labelFirst ? box.y - 5 : box.y + boxH + MPN_CAPTION_H + 11,
      },
      mpnAt: { x: (rects.mpn?.x ?? box.x) + LABEL_PAD_X, y: box.y + boxH + 11 },
      labelRects: [rects.ref, ...(rects.mpn ? [rects.mpn] : [])],
      inkRects: [refRect, ...(mpnRect ? [mpnRect] : []), ...extra],
      pads,
      latch,
      color: isSplice ? C.splice : C.lineStrong,
      dashed: false,
      glyph,
      ring: glyph === 'lug'
        ? (housing?.endKind ? housing.endKind === 'ring' : /^lib-lug-ring-/.test(housing?.id ?? ''))
        : undefined,
      orientation: o,
      alignRight,
      sleeve: Boolean(c.sleeve),
      ...(wireAbbr ? { wireAbbr } : {}),
      ...(barrelDia ? { barrelDia } : {}),
    });
  }

  for (const d of doc.devices) {
    const p0 = at.get(d.id)!;
    const terms = d.terminals ?? [];
    // 상자 크기·단자 줄 높이도 화면(geometry.deviceSize)에서 온다.
    // 여기서 따로 어림하면 단자 핸들(deviceAnchor)이 그려진 줄과 어긋난다 —
    // 실제로 그랬다(여기 DEV_ROW 16 · 화면 DEV_ROW_H 19).
    // ref 를 함께 넘기는 이유: 블록 폭이 **이름표 글자 폭**에 달렸다(장치는 상자를
    // 옆으로 넓히는 대신 블록 자체를 넓힌다 — geometry.deviceSize 머리말).
    const devRef = refs.get(d.id);
    const { w: boxW, h: boxH } = deviceSize(d, devRef);
    const box: Rect = { x: p0.x, y: p0.y + REF_BLOCK_H, w: boxW, h: boxH };
    // 장치 라벨은 언제나 왼쪽 정렬이다 — 블록이 이미 라벨보다 넓어 어느 쪽으로도
    // 삐져나오지 않으므로 커넥터처럼 넘치는 방향을 고를 필요가 없다.
    const parts = deviceRefParts(d, devRef);
    const rects = deviceLabelRects(d, p0, devRef);

    nodes.push({
      id: d.id,
      ref: parts.ref,
      name: parts.name,
      mpn: deviceCaption(d),
      kind: 'device',
      box,
      dir: '',
      refAt: { x: box.x + LABEL_PAD_X, y: box.y - 5 },
      mpnAt: { x: box.x + LABEL_PAD_X, y: box.y + boxH + 11 },
      labelRects: [rects.ref, rects.caption],
      pads: terms.map((t, k) => ({
        label: t,
        x: box.x + DEV_PAD,
        y: box.y + DEV_PAD + k * DEV_ROW_H,
        assigned: false,
      })),
      color: C.muted,
      dashed: true,
    });
  }

  // ── 배선: 경로·라벨 자리는 화면과 **같은 함수**(planWires)에서 통째로 받는다 ──
  // 여기서 다시 계산하지 않는다. 색 약호·전선 색·굵기만 문서에서 붙인다.
  const wires: WirePath[] = [];
  const edges = docToEdges(doc, new Set(), null, 'logical');
  const routes = new Map(planWires(doc, 'logical').map((r) => [r.id, r]));
  // 접점 번호 — 핀 id → 패드 번호. 스플라이스 끝은 번호가 뜻이 없어 넣지 않는다.
  const pinNo = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== 'connector') continue;
    // 납처리 전선단은 번호 대신 **색 약호**가 끝을 말한다(render.py: 그 끝엔 접점 번호가 없다).
    // 둘 다 찍으면 토막 하나에 글자가 둘 붙어 어느 쪽이 무엇인지 헷갈린다.
    if (n.glyph === 'free') continue;
    for (const p of n.pads) if (p.pinId) pinNo.set(`${n.id}/${p.pinId}`, p.label);
  }
  const endNo = (ep: HarnessDocument['wires'][number]['from']): string | null =>
    ep.type === 'pin' ? pinNo.get(`${ep.connectorId}/${ep.pinId}`) ?? null : null;
  for (const e of edges) {
    const wire = doc.wires.find((w) => w.id === e.id);
    const route = routes.get(e.id);
    if (!wire || !route) continue;

    const data = (e.data ?? {}) as { abbr?: string; signal?: string };
    const stroke = (e.style?.stroke as string | undefined) ?? C.text;

    wires.push({
      id: e.id,
      points: route.points,
      color: stroke,
      width: wireWidthPx(wire.gauge),
      abbr: data.abbr ?? '',
      signal: data.signal,
      // 스텁 라벨도 같은 출처 — 화면 .hz-stub 과 같은 자리(도착 패드 직전 구간)
      labelAt: { x: route.labelX, y: route.labelY },
      // planWires 의 points 는 출발(from) 핸들에서 시작해 도착(to) 핸들에서 끝난다
      ends: [endNo(wire.from), endNo(wire.to)],
    });
  }

  // ── 자켓: 사각형·이름표 자리도 화면과 **같은 함수**(planJackets)에서 받는다 ──
  // 색만 문서에서 붙인다(화면과 같은 jacketPaint).
  const jackets: JacketShape[] = planJackets(doc, 'logical')
    .filter((j) => j.runs.length > 0)
    .map((j) => {
      const paint = jacketPaint(j.jacketColor);
      return {
        cableId: j.cableId,
        runs: j.runs,
        color: paint.color,
        dashed: paint.dashed,
        label: j.label,
        labelAt: j.labelAt,
      };
    });

  return { nodes, wires, jackets, bounds: boundsOf(nodes, wires, jackets) };
}

/**
 * 경계 상자에 **스텁 라벨을 세지 않는다** (개선안 §2-5).
 *
 * PDF 는 더 이상 스텁 라벨을 그리지 않는다(drawDrawing 의 §2-5 주석 참고).
 * 그리지도 않을 상자를 경계에 넣으면 도면이 그만큼 작게 축소돼, 라벨을 뺀
 * 이득(넓게 그린 배선)이 그대로 사라진다. 화면은 여전히 hover 시 라벨을 펴므로
 * `wires[].labelAt` 은 그대로 남는다 — 자리를 계산하는 곳은 wirePlan 한 곳이다.
 */
function boundsOf(nodes: NodeBox[], wires: WirePath[], jackets: JacketShape[] = []): Rect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const hit = (x: number, y: number) => {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  };
  for (const n of nodes) {
    hit(n.box.x - LATCH_T - 2, n.box.y - LATCH_T - 2);
    hit(n.box.x + n.box.w + LATCH_T + 2, n.box.y + n.box.h + LATCH_T + 2);
    // 라벨은 박스 밖으로 삐져나온다 — 잘리지 않게 그 사각형을 그대로 센다.
    // (o=180 은 **왼쪽으로** 넘치므로 폭만 더하던 예전 식으로는 잘렸다)
    for (const r of [...n.labelRects, ...(n.inkRects ?? [])]) {
      hit(r.x, r.y);
      hit(r.x + r.w, r.y + r.h);
    }
  }
  for (const w of wires) {
    for (const p of w.points) hit(p.x, p.y);
  }
  // 자켓 윤곽과 이름표도 잘리면 안 된다 — 윤곽은 심선 바깥으로 나가 있고,
  // 이름표는 그 위에 얹히므로 배선만 세면 종이 끝에서 잘린다.
  for (const j of jackets) {
    for (const r of j.runs) {
      hit(r.x, r.y);
      hit(r.x + r.w, r.y + r.h);
    }
    if (j.labelAt) {
      hit(j.labelAt.x, j.labelAt.y - JACKET_LABEL_PX);
      hit(j.labelAt.x + estimateTextWidth(j.label, JACKET_LABEL_PX), j.labelAt.y);
    }
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: 100, h: 100 };
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

/** 자켓 이름표 글꼴 크기 (논리 px) — canvas.css 의 .hz-jacket-label 과 같은 값 */
export const JACKET_LABEL_PX = 10;

// ============================================================
// 5. 그리기
// ============================================================

/**
 * 제목블록 3행 왼쪽 칸 — `길이 800mm · 세트당 6EA` (개선안 §2-3).
 *
 * ## 길이를 지어내지 않는다
 * 숫자는 전부 `store/wireLength.ts` 의 해석기에서 온다 — 화면·접속표·자재표가
 * 쓰는 그 함수다. 여기서 `w.lengthMm ?? 0` 같은 제 규칙을 쓰면 케이블 심선이
 * 0mm 로 잡혀 "길이 0mm" 짜리 제작 지시가 나간다.
 *
 * 값이 여러 가지면 하나로 뭉개지 않고 범위(`800~1600mm`)로 적는다. 모르는
 * 가닥이 섞여 있으면 그 사실도 함께 적는다(`· 일부 미상`). 하나도 모르면
 * `길이 미상` 이다 — 빈칸으로 두면 "길이 지정 없음" 과 구별되지 않는다.
 *
 * ## 수량(`perSet`)이 왜 밖에서 오나
 * 세트당 수량은 `HarnessSet.items[].perSet` 에 있고 `HarnessDocument` 에는
 * 없다(types 는 동결 계약이라 필드를 새로 만들지 않는다). 그래서 세트를 아는
 * 호출부가 `store/kit.perSetOf` 로 뽑아 넘긴다. 안 넘어오면 `세트당 미상` 이다.
 */
export function titleBlockExtra(doc: HarnessDocument, perSet?: number): string {
  const lengthOf = lengthResolver(doc);
  const known: number[] = [];
  let missing = 0;
  for (const w of doc.wires) {
    const { mm } = lengthOf(w);
    if (mm == null) missing += 1;
    else known.push(mm);
  }
  const uniq = [...new Set(known)].sort((a, b) => a - b);
  const len =
    uniq.length === 0 ? '길이 미상'
    : uniq.length === 1 ? `길이 ${uniq[0]}mm`
    : `길이 ${uniq[0]}~${uniq[uniq.length - 1]}mm`;
  const qty = perSet != null && Number.isFinite(perSet) ? `세트당 ${perSet}EA` : '세트당 미상';
  return [len + (missing > 0 && uniq.length > 0 ? ' · 일부 미상' : ''), qty].join(' · ');
}

/**
 * 전선 구간 위 길이 표기 문구 (개선안 §2-7) — `800mm  (6EA)`.
 * 제목블록 3행과 **같은 해석기**를 쓴다. 같은 종이 위의 두 숫자가 갈리면
 * 어느 쪽이 맞는지 아무도 모른다.
 */
export function dimensionLabel(doc: HarnessDocument, perSet?: number): string {
  const lengthOf = lengthResolver(doc);
  const uniq = [...new Set(doc.wires.map((w) => lengthOf(w).mm).filter((v): v is number => v != null))]
    .sort((a, b) => a - b);
  const len =
    uniq.length === 0 ? '길이 미상'
    : uniq.length === 1 ? `${uniq[0]}mm`
    : `${uniq[0]}~${uniq[uniq.length - 1]}mm`;
  return perSet != null && Number.isFinite(perSet) ? `${len}  (${perSet}EA)` : len;
}

/**
 * 제목블록 3행의 글자를 **통째로** 지정한다 — 하네스 문서가 아닌 면(세트 표지,
 * 구매품 면, 제조사 도면 캡처 면 …)도 같은 프레임·제목블록을 쓰게 하려는 것이다.
 * 레퍼런스 build.py `frame(title, no, sub, extra)` 와 같은 칸 배치:
 *   1행 `title`(굵게) | `no`  ·  2행 `line2` | `rev`  ·  3행 `line3` | `date`
 * 빈 문자열은 그대로 빈칸이다(대시로 바꾸지 않는다 — 호출부가 정한 글자를 그린다).
 */
export type TitleRows = {
  title: string;
  no: string;
  line2: string;
  rev: string;
  line3: string;
  date: string;
};

export type SheetInfo = {
  /** 세트당 수량 — 제목블록 3행과 치수 표기에 쓴다. 없으면 '미상' */
  perSet?: number;
  /** 주면 제목블록 글자를 문서에서 만들지 않고 이것을 그대로 그린다 */
  rows?: TitleRows;
};

/** 프레임 + 제목블록(3행)을 그리고, 도면이 들어갈 안쪽 영역을 돌려준다. */
export function drawFrameAndTitleBlock(
  pdf: PdfLike,
  doc: HarnessDocument,
  text: DrawText,
  page: { w: number; h: number },
  info: SheetInfo = {},
): Rect {
  const m = SHEET_MARGIN;
  const frame: Rect = { x: m, y: m, w: page.w - m * 2, h: page.h - m * 2 };

  pdf.setLineDashPattern([], 0);
  pdf.setDrawColor(C.lineMid);
  pdf.setLineWidth(0.8);
  pdf.rect(frame.x, frame.y, frame.w, frame.h, 'S');

  // ── 제목블록: 프레임 우하단, 3행. 오른쪽 칸 폭 고정 ──────────────────────
  const tbW = Math.min(TB.w, frame.w * 0.5);
  const side = TB.side;
  const rowH = TB.rowH;
  const rows = TB.rows;
  const tbX = frame.x + frame.w - tbW;
  const tbY = frame.y + frame.h - rowH * rows;

  pdf.setFillColor(C.white);
  pdf.rect(tbX, tbY, tbW, rowH * rows, 'F');
  pdf.setDrawColor(C.lineMid);
  pdf.setLineWidth(0.8);
  pdf.line(tbX, tbY, tbX + tbW, tbY);              // 위 테두리
  pdf.line(tbX, tbY, tbX, tbY + rowH * rows);      // 왼 테두리
  pdf.setDrawColor(C.line);
  pdf.setLineWidth(0.5);
  for (let i = 1; i < rows; i++) {
    pdf.line(tbX, tbY + rowH * i, tbX + tbW, tbY + rowH * i);       // 행 구분
  }
  pdf.line(tbX + tbW - side, tbY, tbX + tbW - side, tbY + rowH * rows); // 오른 칸 구분

  const mainW = tbW - side - 12;
  const sideW = side - 12;
  const dash = '—';
  /** [왼쪽 글자, 크기, 굵게, 색, 오른쪽 글자] */
  const r = info.rows;
  const lines: [string, number, boolean, string, string][] = r ? [
    [r.title, 10, true, C.text, r.no],
    [r.line2, 9, false, C.muted, r.rev],
    [r.line3, 9, false, C.muted, r.date],
  ] : [
    [doc.name || '이름 없는 하네스', 10, true, C.text, doc.drawingNo?.trim() || dash],
    [`SCALE 1:1 · 논리 · 배선 ${doc.wires.length}`, 9, false, C.muted,
      doc.rev?.trim() ? `Rev.${doc.rev.trim()}` : dash],
    // 3행 — 제작 도면에 길이·수량이 없으면 발주가 안 된다(§2-3).
    // 오른쪽 칸은 날짜다. **지어내지 않는다** — 문서에 적힌 갱신일만 쓴다.
    [titleBlockExtra(doc, info.perSet), 9, false, C.muted, (doc.updatedAt ?? '').slice(0, 10) || dash],
  ];
  lines.forEach(([main, size, bold, color, right], i) => {
    const y = tbY + rowH * i + 12.5;
    text(main, tbX + 6, y, { size, bold, color, maxWidth: mainW });
    text(right, tbX + tbW - side + 6, y, { size: 9.5, color: C.text3, maxWidth: sideW });
  });

  // 도면 영역 = 프레임 안쪽에서 제목블록 높이만큼 비워 둔다
  const pad = 14;
  return {
    x: frame.x + pad,
    y: frame.y + pad,
    w: frame.w - pad * 2,
    h: frame.h - pad * 2 - rowH * rows - 6,
  };
}

export type DrawingOptions = {
  /** 도면 위에 얹을 치수 문구 (`800mm  (6EA)`). 없으면 치수선을 그리지 않는다 */
  dimension?: string;
};

/** 배선도 본체 — 자켓 → 배선 → 하우징 → 치수 표기 순으로 겹친다. */
export function drawDrawing(
  pdf: PdfLike,
  dr: Drawing,
  xf: Transform,
  text: DrawText,
  opts: DrawingOptions = {},
): void {
  const X = (v: number) => xf.tx + v * xf.scale;
  const Y = (v: number) => xf.ty + v * xf.scale;
  const S = (v: number) => v * xf.scale;
  const fs = (px: number) => Math.max(3.6, Math.min(14, px * xf.scale));

  // ── 케이블 자켓 (배선보다 아래) ──────────────────────────────────────────
  // 윤곽만 그린다 — 채우면 안쪽 심선의 색이 덮여 어느 가닥이 무슨 색인지 못 읽는다.
  // `line` 이 아니라 `rect` 로 그리는 이유는 각진 사각형이 곧 자켓 도형이기 때문이다.
  for (const j of dr.jackets) {
    pdf.setDrawColor(j.color);
    pdf.setLineWidth(Math.max(0.3, S(1.4)));
    pdf.setLineDashPattern(j.dashed ? [S(7), S(4)] : [], 0);
    for (const r of j.runs) pdf.rect(X(r.x), Y(r.y), S(r.w), S(r.h), 'S');
    pdf.setLineDashPattern([], 0);
    // 윤곽만으로는 **어느** 케이블인지 알 수 없다 — 화면과 같은 자리에 이름을 적는다
    if (j.labelAt) {
      text(j.label, X(j.labelAt.x), Y(j.labelAt.y), { size: fs(JACKET_LABEL_PX), bold: true, color: j.color });
    }
  }

  // ── 배선 ────────────────────────────────────────────────────────────────
  pdf.setLineDashPattern([], 0);
  for (const w of dr.wires) {
    pdf.setDrawColor(w.color);
    pdf.setLineWidth(pdfWireWidthPt(w.width, xf.scale));
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1];
      const b = w.points[i];
      pdf.line(X(a.x), Y(a.y), X(b.x), Y(b.y));
    }
  }

  // ── 끝단 심볼 (하우징 · 러그 · 스플라이스) ───────────────────────────────
  const pen: Pen = { pdf, X, Y, S, fs, text };
  for (const n of dr.nodes) {
    if (n.kind === 'device') drawDeviceNode(pen, n);
    else if (n.glyph === 'splice') drawSpliceGlyph(pen, n);
    else if (n.glyph === 'faston') drawFastonGlyph(pen, n);
    else if (n.glyph === 'ferrule') drawFerruleGlyph(pen, n);
    else if (n.glyph === 'lug') drawLugGlyph(pen, n);
    else if (n.glyph === 'free') drawFreeGlyph(pen, n);
    else if (n.glyph === 'barrel') drawBarrelGlyph(pen, n);
    else drawHousingGrid(pen, n);
    drawNodeLabels(pen, n);
  }

  // ── 접점 번호 (render.py `contact_no`) ──────────────────────────────────
  // 배선이 커넥터에 닿는 지점, 스텁 바로 바깥에 작은 굵은 번호를 흰 바탕으로 얹는다.
  // 2열 커넥터(Micro-Fit 10P)에서 안쪽 열로 가는 선이 어느 핀인지 이걸로 읽는다.
  for (const w of dr.wires) {
    if (!w.ends || w.points.length < 2) continue;
    const [a, b] = w.ends;
    if (a != null) drawContactNo(pen, w.points[0], w.points[1], a);
    if (b != null) drawContactNo(pen, w.points[w.points.length - 1], w.points[w.points.length - 2], b);
  }

  /*
   * ── 스텁 라벨은 **그리지 않는다** (개선안 §2-5)
   *
   * 예전에는 도착 패드 옆 22px 자리에 `[색약호][신호명]` 상자를 얹었다. 10P
   * 케이블이면 그 상자가 열 개 서고, 패드 안 핀 번호까지 합쳐 스무 개 남짓한
   * 작은 글자가 커넥터 앞 좁은 띠에 몰려 판독이 되지 않았다(레퍼런스 구현이
   * 12장을 뽑아 보고 뺀 이유가 그것이다).
   *
   * ── 뺀 정보는 어디서 읽나 (대안이 없으면 빼지 않는다)
   *  · 색   — 선 색 그 자체 + 접속표 `색` 열의 **약호 + 이름 + 견본**.
   *           흑백으로 뽑아도 약호(R/W)가 남으므로 단서가 사라지지 않는다.
   *  · 신호 — 접속표 `신호` 열(개선안 §2-12). 이 작업에서 그 열을 새로 넣었다.
   *  · 굵기 — 선 굵기가 게이지를 따른다(wireWidthPx).
   *
   * ── 화면은 그대로다
   * 화면은 강조된 가닥에서만 신호명을 편다(hover). 자리를 계산하는 곳은
   * `wirePlan` 하나이고 여기서도 `wires[].labelAt` 을 그대로 들고 있으므로,
   * "그리는 규칙" 만 종이와 화면이 다른 것이지 **기하가 갈라진 것이 아니다**.
   */

  // ── 전선 구간 위 길이 표기 (개선안 §2-7) ────────────────────────────────
  //
  // 왜 도면 안에 있어야 하나: 외주 도면에서 가장 먼저 찾는 정보가 전장이다.
  // 지금까지는 접속표·물리 뷰에만 있어, 배선도만 떼어 보낸 사람은 길이를 몰랐다.
  //
  // 왜 **논리 px 이 아니라 용지 pt 로** 그리나: 이 글자는 축척을 따라가면 안 된다.
  // 부품이 많은 도면은 scale 이 0.4 까지 내려가는데, 레퍼런스처럼 11px 을 그대로
  // 축소하면 4pt 가 되어 인쇄물에서 못 읽는다. 도면 요소가 아니라 **치수선**이므로
  // 종이 기준 크기를 갖는 것이 제도상으로도 맞다.
  if (opts.dimension) {
    const cx = X(dr.bounds.x + dr.bounds.w / 2);
    const top = Y(dr.bounds.y);
    const t = opts.dimension;
    const size = 11;
    const w = estimateTextWidth(t, size) + 12;
    const base = top - DIM_GAP;              // 글자 베이스라인
    pdf.setLineDashPattern([], 0);
    pdf.setFillColor(C.white);
    pdf.rect(cx - w / 2, base - 11, w, 16, 'F');
    text(t, cx, base + 1, { size, bold: true, color: C.text, align: 'center' });
    // 양쪽 지시선 — 이 치수가 **구간 전체**를 가리킨다는 뜻을 그림으로 말한다
    pdf.setDrawColor(C.muted);
    pdf.setLineWidth(0.8);
    pdf.line(cx - w / 2 - 30, base - 3, cx - w / 2 - 4, base - 3);
    pdf.line(cx + w / 2 + 4, base - 3, cx + w / 2 + 30, base - 3);
  }
}

// ============================================================
// 5-1. 끝단 심볼 — 레퍼런스(이스턴웰스 render.py)와 같은 그림 언어
//
// 모든 치수는 **논리 px** 이고 pen.X/Y/S 가 용지 pt 로 옮긴다. 심볼은 언제나
// geometry 가 정한 하우징 박스(`n.box`) **안**에 그린다 — 배선 끝점(핸들)이
// 그 박스 변 위에 있으므로, 심볼이 박스를 벗어나면 선이 심볼에 닿지 않는다.
// ============================================================

/** 그리기 도구 묶음 — 논리 px → pt 변환과 글자 함수 */
export type Pen = {
  pdf: PdfLike;
  X: (v: number) => number;
  Y: (v: number) => number;
  S: (v: number) => number;
  /** 논리 px 글꼴 크기 → pt (읽히는 하한·상한으로 자른다) */
  fs: (px: number) => number;
  text: DrawText;
};

/**
 * 글자 폭(pt) — **그리기 전에** 잰다. 이름표를 오른쪽 정렬하려면 전체 폭을 먼저
 * 알아야 하기 때문이다. Latin-1 조각은 jsPDF 가 정확히 재고(Helvetica 대문자는
 * 어림 0.52em 보다 넓다), 래스터로 나가는 한글 조각은 전각 어림(1em)을 쓴다 —
 * pdf.ts 의 fitToWidth 와 같은 규칙이다.
 */
export function measureText(pdf: PdfLike, t: string, size: number, bold = false): number {
  if (!t) return 0;
  if (typeof pdf.getTextWidth !== 'function') return estimateTextWidth(t, size);
  pdf.setFontSize(size);
  pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  let w = 0;
  for (const run of t.match(/[ -ÿ]+|[^ -ÿ]+/g) ?? []) {
    w += needsRaster(run) ? estimateTextWidth(run, size) : pdf.getTextWidth(run);
  }
  return Math.max(w, 0);
}

/**
 * 이름표 `J1  JST-XH 10P  → 180° 오른쪽` + MPN 캡션.
 *
 * 조각마다 **먼저 재고** 자리를 정한 뒤, 실제로 그린 폭과 잰 폭 중 큰 쪽만큼
 * 다음 조각을 민다 — 어느 쪽 값이 틀려도 글자가 겹치지 않는다(예전에는 방향
 * 글자가 이름 위에 겹쳐 찍혔다). 오른쪽 정렬(o=180)은 하우징 오른쪽 변에
 * 끝을 맞춘다 — geometry.labelsAlignRight 와 같은 규칙.
 */
function drawNodeLabels(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S, fs, text } = pen;
  // 레퍼런스 번호(J1)는 굵게, 이름보다 한 치 크게 — 도면에서 가장 먼저 찾는 글자다.
  // (render.py 는 11 굵게 + Barlow 700 이라 같은 크기로도 도드라졌다. Helvetica Bold 는
  // 그만큼 두껍지 않아 크기로 보탠다.) 조각마다 재고 미는 규칙은 그대로라 겹치지 않는다.
  const sRef = fs(12.5);
  const sName = fs(11.5);
  const sDir = fs(10);
  const gap1 = Math.max(S(6), 2);
  const gap2 = Math.max(S(8), 3);
  const wRef = measureText(pdf, n.ref, sRef, true);
  const wName = measureText(pdf, n.name, sName);
  const wDir = measureText(pdf, n.dir, sDir);
  const total = wRef + (n.name ? gap1 + wName : 0) + (n.dir ? gap2 + wDir : 0);
  const right = X(n.box.x + n.box.w - LABEL_PAD_X);
  let lx = n.alignRight ? right - total : X(n.refAt.x);
  const ly = Y(n.refAt.y);
  lx += Math.max(wRef, text(n.ref, lx, ly, { size: sRef, bold: true, color: C.text }));
  if (n.name) {
    lx += gap1;
    lx += Math.max(wName, text(n.name, lx, ly, { size: sName, color: C.text }));
  }
  if (n.dir) {
    lx += gap2;
    text(n.dir, lx, ly, { size: sDir, color: C.muted });
  }
  if (n.mpn) {
    const my = Y(n.mpnAt.y);
    if (n.alignRight) text(n.mpn, right, my, { size: fs(10), color: C.text3, align: 'right' });
    else text(n.mpn, X(n.mpnAt.x), my, { size: fs(10), color: C.text3 });
  }
}

/** 좌상단 등록 마크 = 1번 핀 기준점 */
function drawRegMark(pen: Pen, b: Rect, color: string): void {
  const { pdf, X, Y, S } = pen;
  pdf.setLineDashPattern([], 0);
  pdf.setDrawColor(color);
  pdf.setLineWidth(Math.max(0.5, S(2)));
  pdf.line(X(b.x), Y(b.y), X(b.x + REG), Y(b.y));
  pdf.line(X(b.x), Y(b.y), X(b.x), Y(b.y + REG));
}

/** 장치 블록 — 점선 상자 + 단자 이름 (예전 그림 그대로) */
function drawDeviceNode(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S, fs, text } = pen;
  pdf.setFillColor(C.white);
  pdf.setDrawColor(n.color);
  pdf.setLineWidth(Math.max(0.4, S(1.5)));
  pdf.setLineDashPattern([S(3), S(2)], 0);
  pdf.rect(X(n.box.x), Y(n.box.y), S(n.box.w), S(n.box.h), 'FD');
  pdf.setLineDashPattern([], 0);
  drawRegMark(pen, n.box, n.color);
  for (const p of n.pads) {
    // 단자 이름 베이스라인 — 줄(DEV_ROW_H) 안에서 세로 가운데.
    // 핸들(deviceAnchor)이 줄 중앙(p.y + DEV_ROW_H/2)에 있으므로 글자도 거기 맞춘다.
    text(p.label, X(p.x), Y(p.y + DEV_ROW_H / 2 + 4), { size: fs(11), color: C.text2 });
  }
}

/** 패드 번호 — 굵게, 패드 **한가운데**(render.py `_draw_grid`). 넘치면 글꼴을 줄인다 */
function padNumber(pen: Pen, label: string, cx: number, cy: number, box: number, color: string, px = PIN_NUM_FS): void {
  const { X, Y, S, fs, text } = pen;
  const est = estimateTextWidth(label, px) * 1.2;   // 굵은 글꼴 여유
  const size = est > box - 4 ? Math.max(6, (px * (box - 4)) / est) : px;
  text(label, X(cx), Y(cy + size * 0.36), {
    size: fs(size), bold: true, color, align: 'center', maxWidth: S(box - 2),
  });
}

/**
 * 하우징 격자 — render.py `_draw_grid` 와 같은 그림.
 *  · 래치 돌기(배선 나가는 변) · 하우징 박스 · **결합면 띠**(배선 반대쪽 변) · 등록 마크
 *  · 패드: 쓰는 핀은 회색 바탕, `Connector.unused` 는 흰 바탕 + X
 *  · 번호: 굵게, 패드 한가운데
 *
 * ── 번호를 핸들 자리(geometry.pinNumberBox)에서 패드 가운데로 옮긴 이유
 * 2열 커넥터(Micro-Fit 10P)에서 번호가 패드마다 위·아래로 엇갈려 찍혀, 격자가
 * 반 칸씩 어긋난 계단처럼 보였다(_비교/web/w-11). 격자 자체는 처음부터 반듯했다.
 * 어느 선이 몇 번 핀인지는 이제 **배선 끝의 접점 번호**(drawContactNo)가 말한다 —
 * 레퍼런스가 같은 문제를 같은 방법으로 푼다. `pads[].num` 은 화면과의 계약이라
 * 그대로 계산해 둔다(화면은 지금도 그 자리에 번호를 찍는다).
 */
function drawHousingGrid(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S } = pen;
  const b = n.box;
  const o = n.orientation ?? 0;

  // 래치 돌기 (방향을 그림으로 읽게 하는 장치)
  if (n.latch) {
    pdf.setLineDashPattern([], 0);
    pdf.setFillColor(n.color);
    pdf.rect(X(n.latch.x), Y(n.latch.y), S(n.latch.w), S(n.latch.h), 'F');
  }

  // 결합면 띠 — 배선 반대쪽 변. 위·아래 방향은 그 자리에 캡션·이름표가 붙어 있어 얇게(2.5)
  const t = o === 0 || o === 180 ? 6 : 2.5;
  // D-SUB 는 그 변의 양 끝이 깎여 있다 — 띠도 깎인 자리만큼 줄여 쉘 변에 붙인다
  const e = n.glyph === 'dsub' ? DSUB_CF : 3;
  const mf: Rect =
    o === 180 ? { x: b.x - t, y: b.y + e, w: t, h: b.h - e * 2 }
    : o === 0 ? { x: b.x + b.w, y: b.y + e, w: t, h: b.h - e * 2 }
    : o === 90 ? { x: b.x + e, y: b.y + b.h, w: b.w - e * 2, h: t }
    : { x: b.x + e, y: b.y - t, w: b.w - e * 2, h: t };
  pdf.setFillColor(C.subtle);
  pdf.setDrawColor(C.lineStrong);
  pdf.setLineWidth(Math.max(0.3, S(1.2)));
  pdf.rect(X(mf.x), Y(mf.y), S(mf.w), S(mf.h), 'FD');

  // 하우징 박스 — D-SUB 는 배선 반대쪽 두 모서리를 깎은 D 쉘(render.py dsub)
  pdf.setFillColor(C.white);
  pdf.setDrawColor(n.color);
  pdf.setLineWidth(Math.max(0.4, S(1.5)));
  if (n.glyph === 'dsub') drawPolygon(pen, dsubOutline(b, o));
  else pdf.rect(X(b.x), Y(b.y), S(b.w), S(b.h), 'FD');
  drawRegMark(pen, b, n.color);

  for (const p of n.pads) {
    pdf.setLineDashPattern([], 0);
    pdf.setFillColor(p.unused ? C.white : C.subtle);
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.25, S(1)));
    pdf.rect(X(p.x), Y(p.y), S(PAD), S(PAD), 'FD');
    if (p.unused) {
      // 의도적 미사용 핀 — X (render.py: 원본 도면 표기 승계)
      pdf.setDrawColor(C.muted2);
      pdf.setLineWidth(Math.max(0.25, S(1)));
      pdf.line(X(p.x + 5), Y(p.y + 5), X(p.x + PAD - 5), Y(p.y + PAD - 5));
      pdf.line(X(p.x + PAD - 5), Y(p.y + 5), X(p.x + 5), Y(p.y + PAD - 5));
    }
    // 미사용 번호도 **읽혀야 한다** — muted2 는 흰 종이 대비 2.1:1 이라 muted 를 쓴다
    padNumber(pen, p.label, p.x + PAD / 2, p.y + PAD / 2, PAD, p.unused ? C.muted : C.text);
  }
}

/** 압착 배럴 — 회색 바탕 + 크림프 날개 2쌍 (파스톤·러그 공용) */
function crimpBarrel(pen: Pen, x: number, cy: number, w: number, h: number): void {
  const { pdf, X, Y, S } = pen;
  pdf.setFillColor(C.subtle);
  pdf.setDrawColor(C.lineStrong);
  pdf.setLineWidth(Math.max(0.35, S(1.5)));
  pdf.rect(X(x), Y(cy - h / 2), S(w), S(h), 'FD');
  pdf.setLineWidth(Math.max(0.25, S(1)));
  for (const f of [0.34, 0.66]) {
    pdf.line(X(x + w * f), Y(cy - h / 2), X(x + w * f), Y(cy + h / 2));
  }
}

/** 배선이 오른쪽(180°)으로 나가는가 — 러그 심볼은 0°/180° 만 받는다(endGlyphOf) */
const wireRight = (n: NodeBox): boolean => (n.orientation ?? 0) === 180;

/**
 * 파스톤 REC (render.py `_draw_faston`) — 리셉터클 박스 + 넥 + 압착 배럴.
 * 전선은 배럴에 붙으므로 배럴이 핸들 쪽, 리셉터클(탭이 꽂히는 입)이 반대쪽이다.
 * 폭은 하우징 박스(38)에 맞춰 레퍼런스(22·10·20)를 16·6·16 으로 줄였다.
 */
function drawFastonGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S } = pen;
  const b = n.box;
  const rw = 16, nw = 6, bw = 16;
  const rh = 20, nh = 8, bh = 14;
  const right = wireRight(n);
  for (const p of n.pads) {
    const cy = p.y + PAD / 2;
    const rx = right ? b.x : b.x + bw + nw;
    const nx = right ? rx + rw : b.x + bw;
    const bx = right ? nx + nw : b.x;
    const mx = right ? rx : rx + rw - 3;
    pdf.setLineDashPattern([], 0);
    // 넥
    pdf.setFillColor(C.white);
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.3, S(1.2)));
    pdf.rect(X(nx), Y(cy - nh / 2), S(nw), S(nh), 'FD');
    crimpBarrel(pen, bx, cy, bw, bh);
    // 리셉터클 + 탭이 꽂히는 입
    pdf.setFillColor(C.white);
    pdf.setLineWidth(Math.max(0.35, S(1.5)));
    pdf.rect(X(rx), Y(cy - rh / 2), S(rw), S(rh), 'FD');
    pdf.setFillColor(C.subtle);
    pdf.setLineWidth(Math.max(0.3, S(1.2)));
    pdf.rect(X(mx), Y(cy - 7), S(3), S(14), 'FD');
    padNumber(pen, p.label, rx + rw / 2 + (right ? 1.5 : -1.5), cy, rw - 3, C.text, 10);
    if (n.sleeve) {
      // 절연 슬리브(수축튜브) — 배럴 + 넥을 덮는 점선 (render.py 와 같은 자리)
      pdf.setDrawColor(C.muted);
      pdf.setLineWidth(Math.max(0.3, S(1.2)));
      pdf.setLineDashPattern([S(4), S(3)], 0);
      pdf.rect(X(Math.min(nx, bx)), Y(cy - bh / 2 - 4), S(nw + bw), S(bh + 8), 'S');
      pdf.setLineDashPattern([], 0);
    }
  }
}

/**
 * 절연 페룰 (render.py `_draw_ferrule`) — 절연 칼라 + 가는 금속 관.
 * 전선은 칼라 쪽으로 들어가므로 칼라가 핸들 쪽이다. 칼라는 **칠하지 않는다** —
 * 목깃 색은 규격마다 달라 데이터에 없고, 도면의 색은 전선 색 하나뿐이어야 한다.
 */
function drawFerruleGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S } = pen;
  const b = n.box;
  const cw = 14, ch = 18, tw = 24, th = 8;
  const right = wireRight(n);
  for (const p of n.pads) {
    const cy = p.y + PAD / 2;
    const cx = right ? b.x + tw : b.x;
    const tx = right ? b.x : b.x + cw;
    pdf.setLineDashPattern([], 0);
    pdf.setFillColor(C.subtle);
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.25, S(1)));
    pdf.rect(X(tx), Y(cy - th / 2), S(tw), S(th), 'FD');
    pdf.setFillColor(C.white);
    pdf.setLineWidth(Math.max(0.35, S(1.5)));
    pdf.rect(X(cx), Y(cy - ch / 2), S(cw), S(ch), 'FD');
    padNumber(pen, p.label, cx + cw / 2, cy, cw, C.text, 10);
  }
}

/**
 * 링·Y형 러그 — 압착 배럴(핸들 쪽) + 혀(반대쪽). 링은 구멍, Y형은 끝이 트인 홈.
 * 레퍼런스에는 없는 계열이라(그 세트에 러그가 없다) 같은 그림 언어로 만들었다:
 * 배럴은 파스톤과 같은 크림프 표기, 혀는 하우징과 같은 1.5 윤곽.
 */
function drawLugGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S } = pen;
  const b = n.box;
  const bw = 14, bh = 12, tw = 24, th = 20;
  const right = wireRight(n);
  for (const p of n.pads) {
    const cy = p.y + PAD / 2;
    const tx = right ? b.x : b.x + bw;
    const bx = right ? b.x + tw : b.x;
    pdf.setLineDashPattern([], 0);
    pdf.setFillColor(C.white);
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.35, S(1.5)));
    pdf.rect(X(tx), Y(cy - th / 2), S(tw), S(th), 'FD');
    const hx = tx + tw / 2;
    if (n.ring) {
      if (pdf.circle) pdf.circle(X(hx), Y(cy), S(5), 'S');
      else pdf.rect(X(hx - 5), Y(cy - 5), S(10), S(10), 'S');
    } else {
      // Y형 — 혀 끝(배선 반대쪽)에서 가운데까지 트인 홈
      const edge = right ? tx : tx + tw;
      pdf.setFillColor(C.white);
      pdf.rect(X(Math.min(edge, hx)), Y(cy - 3.5), S(Math.abs(hx - edge)), S(7), 'F');
      pdf.line(X(edge), Y(cy - 3.5), X(hx), Y(cy - 3.5));
      pdf.line(X(edge), Y(cy + 3.5), X(hx), Y(cy + 3.5));
      pdf.line(X(hx), Y(cy - 3.5), X(hx), Y(cy + 3.5));
    }
    crimpBarrel(pen, bx, cy, bw, bh);
    // 번호는 배럴 위에 흰 바탕 없이 — 배럴이 좁아 글꼴을 줄인다
    padNumber(pen, p.label, bx + bw / 2, cy, bw, C.text, 9);
  }
}

/** D-SUB 쉘 모서리 깎기 (render.py `cf = 12`) */
const DSUB_CF = 12;

/**
 * D-SUB 쉘 외곽 — 하우징 박스에서 **배선 반대쪽 변**의 두 모서리를 깎은 육각형.
 * 배선이 나가는 변(핸들이 있는 변)은 그대로 둔다 — 핸들이 그 변 위에 있어야 한다.
 */
export function dsubOutline(b: Rect, o: Orientation): Pt[] {
  const cf = Math.min(DSUB_CF, b.w / 3, b.h / 3);
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (o === 0) {          // 배선 왼쪽 → 오른쪽 변을 깎는다
    return [{ x: x0, y: y0 }, { x: x1 - cf, y: y0 }, { x: x1, y: y0 + cf },
      { x: x1, y: y1 - cf }, { x: x1 - cf, y: y1 }, { x: x0, y: y1 }];
  }
  if (o === 180) {        // 배선 오른쪽 → 왼쪽 변
    return [{ x: x0 + cf, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 },
      { x: x0 + cf, y: y1 }, { x: x0, y: y1 - cf }, { x: x0, y: y0 + cf }];
  }
  if (o === 90) {         // 배선 위 → 아래 변
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 - cf },
      { x: x1 - cf, y: y1 }, { x: x0 + cf, y: y1 }, { x: x0, y: y1 - cf }];
  }
  // 270 — 배선 아래 → 위 변
  return [{ x: x0 + cf, y: y0 }, { x: x1 - cf, y: y0 }, { x: x1, y: y0 + cf },
    { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 + cf }];
}

/**
 * 볼록 다각형 — 현재 채움색으로 칠하고(삼각형 부채꼴) 현재 선색·굵기로 윤곽을 긋는다.
 * jsPDF 표면에 다각형이 없어 triangle + line 으로 짓는다. triangle 이 없으면 윤곽만.
 */
function drawPolygon(pen: Pen, pts: Pt[]): void {
  const { pdf, X, Y } = pen;
  if (pts.length < 3) return;
  pdf.setLineDashPattern([], 0);
  if (pdf.triangle) {
    for (let i = 1; i < pts.length - 1; i++) {
      pdf.triangle(X(pts[0].x), Y(pts[0].y), X(pts[i].x), Y(pts[i].y), X(pts[i + 1].x), Y(pts[i + 1].y), 'F');
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pdf.line(X(a.x), Y(a.y), X(b.x), Y(b.y));
  }
}

/** 납처리 심선 토막 길이 (render.py `_draw_free` 의 20) */
const FREE_STUB = 20;

/**
 * 납처리 전선단 (render.py `_draw_free`) — 하우징이 없다.
 * 핀마다 핸들에서 안쪽으로 **굵은 심선 토막**(납처리한 끝) + 끝의 절단면 표시 +
 * 그 너머에 전선 색 약호. 배선은 핸들에서 그대로 이어지므로 선이 토막에 붙는다.
 * 약호는 핸들 **반대쪽**으로 붙인다 — 넘쳐도 배선이 없는 쪽으로 넘친다.
 */
function drawFreeGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S, fs, text } = pen;
  const right = wireRight(n);
  n.pads.forEach((p, i) => {
    const h = p.handle ?? { x: right ? n.box.x + n.box.w : n.box.x, y: p.y + PAD / 2 };
    const inner = right ? h.x - FREE_STUB : h.x + FREE_STUB;
    pdf.setLineDashPattern([], 0);
    pdf.setDrawColor(C.text);
    pdf.setLineWidth(Math.max(1, S(4)));
    pdf.line(X(Math.min(h.x, inner)), Y(h.y), X(Math.max(h.x, inner)), Y(h.y));
    // 절단면 — 토막 끝의 짧은 세로선
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.4, S(1.5)));
    pdf.line(X(inner), Y(h.y - 5), X(inner), Y(h.y + 5));
    const ab = n.wireAbbr?.[i];
    if (ab) {
      text(ab, X(right ? inner - 4 : inner + 4), Y(h.y + 3.5), {
        size: fs(10), bold: true, color: C.text3, align: right ? 'right' : 'left',
      });
    }
  });
}

/** 배럴 통 폭 (render.py `self.w = 38 + 44` 의 44) — 하우징 박스 밖, 배선 반대쪽 */
export const BARREL_W = 44;

/**
 * DC 배럴잭 (render.py `_draw_barrel`) — 접점 하우징(+/− 패드) + 배럴 측단면.
 *
 * 하우징 박스·패드·핸들은 geometry 그대로다(배선이 거기 붙는다). 배럴 통은 박스
 * **밖, 배선 반대쪽**에 붙인다 — 외통 · 개구부 · 센터핀. 패드에서 배럴 안으로
 * 가는 결선은 극 이름이 `+`(센터) / `−`(슬리브) 일 때만 긋는다 — 다른 이름이면
 * 어느 쪽이 센터인지 데이터가 말하지 않으므로 지어내지 않는다.
 * 외경·내경(⌀) 글자도 부품 spec 에 있을 때만 적는다.
 */
function drawBarrelGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S, fs, text } = pen;
  const b = n.box;
  const right = wireRight(n);          // 배선이 오른쪽 → 배럴은 왼쪽
  const bx = right ? b.x - BARREL_W : b.x + b.w;
  const y = b.y;
  const hh = b.h;
  const cy = y + hh / 2;
  pdf.setLineDashPattern([], 0);

  // 배럴 외통
  pdf.setFillColor(C.white);
  pdf.setDrawColor(C.lineStrong);
  pdf.setLineWidth(Math.max(0.4, S(1.5)));
  pdf.rect(X(bx + 2), Y(y + 10), S(40), S(hh - 20), 'FD');
  // 개구부 (배선 반대쪽 끝)
  const ox = right ? bx + 2 : bx + 40;
  pdf.setFillColor(C.lineStrong);
  pdf.rect(X(ox), Y(y + 6), S(2), S(hh - 12), 'F');
  // 센터핀
  pdf.rect(X(bx + 6), Y(cy - 4), S(32), S(8), 'F');
  // 치수 표기 — spec 에 있을 때만
  const dc = bx + BARREL_W / 2;
  if (n.barrelDia?.outer) text(n.barrelDia.outer, X(dc), Y(y + 6), { size: fs(9), bold: true, color: C.text3, align: 'center' });
  if (n.barrelDia?.inner) text(n.barrelDia.inner, X(dc), Y(y + hh + 1), { size: fs(9), bold: true, color: C.text3, align: 'center' });

  // 접점 하우징 (툴 표준 패드)
  pdf.setFillColor(C.white);
  pdf.setDrawColor(n.color);
  pdf.setLineWidth(Math.max(0.4, S(1.5)));
  pdf.rect(X(b.x), Y(b.y), S(b.w), S(b.h), 'FD');
  drawRegMark(pen, b, n.color);
  // 하우징 → 배럴 내부 결선 (패드 바깥 변 → 센터핀 / 외통)
  const tx = right ? b.x : b.x + b.w;
  const inX = right ? bx + 38 : bx + 6;
  for (const p of n.pads) {
    const pole = p.label.trim();
    const to = pole === '+' ? cy : /^[−-]$/.test(pole) ? y + 10 : null;
    if (to == null) continue;
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.25, S(1)));
    pdf.line(X(tx), Y(p.y + PAD / 2), X(inX), Y(to));
  }
  for (const p of n.pads) {
    pdf.setFillColor(p.unused ? C.white : C.subtle);
    pdf.setDrawColor(C.lineStrong);
    pdf.setLineWidth(Math.max(0.25, S(1)));
    pdf.rect(X(p.x), Y(p.y), S(PAD), S(PAD), 'FD');
    padNumber(pen, p.label, p.x + PAD / 2, p.y + PAD / 2, PAD, p.unused ? C.muted : C.text, 13);
  }
}

/**
 * 스플라이스 (render.py 의 SP1) — 채운 마름모 + 각 핸들에서 마름모로 모이는 선.
 * 하우징 박스·패드는 그리지 않는다. 스플라이스에는 "핀" 이 없고 한 점에서 합선될
 * 뿐이라, 번호 칸을 그리면 존재하지 않는 핀 배열을 지어내는 셈이다.
 */
function drawSpliceGlyph(pen: Pen, n: NodeBox): void {
  const { pdf, X, Y, S } = pen;
  const b = n.box;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  pdf.setLineDashPattern([], 0);
  pdf.setDrawColor(C.text);
  pdf.setLineWidth(Math.max(0.4, S(1.6)));
  for (const p of n.pads) {
    const h = p.handle;
    if (!h) continue;
    pdf.line(X(h.x), Y(h.y), X(cx), Y(cy));
  }
  const r = 9;   // 13px 정사각형을 45° 돌린 마름모의 반 대각선
  pdf.setFillColor(C.text);
  if (pdf.triangle) {
    pdf.triangle(X(cx - r), Y(cy), X(cx), Y(cy - r), X(cx + r), Y(cy), 'F');
    pdf.triangle(X(cx - r), Y(cy), X(cx), Y(cy + r), X(cx + r), Y(cy), 'F');
  } else {
    pdf.line(X(cx - r), Y(cy), X(cx), Y(cy - r));
    pdf.line(X(cx), Y(cy - r), X(cx + r), Y(cy));
    pdf.line(X(cx + r), Y(cy), X(cx), Y(cy + r));
    pdf.line(X(cx), Y(cy + r), X(cx - r), Y(cy));
  }
}

/** 접점 번호 글꼴 (render.py contact_no 8.5px 굵게) */
const CONTACT_FS = 8.5;

/**
 * 접점 번호 (render.py `contact_no`) — 배선이 커넥터에 닿는 끝에서 스텁(14)만큼
 * 나간 자리에 흰 바탕 작은 굵은 번호. `end` 는 핸들, `next` 는 그다음 꺾임점이다.
 * 첫 구간이 짧으면 번호를 그 구간 안으로 당긴다(꺾임 너머로 넘어가지 않게).
 */
function drawContactNo(pen: Pen, end: Pt, next: Pt, label: string): void {
  const { pdf, X, Y, S, fs, text } = pen;
  const dx = next.x - end.x;
  const dy = next.y - end.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const w = estimateTextWidth(label, CONTACT_FS) * 1.15 + 6;
  const h = 13;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const ext = horiz ? w : h;
  const off = Math.max(2, Math.min(DEFAULT_STUB + 2, len - ext));
  let r: Rect;
  if (horiz) {
    const sx = end.x + Math.sign(dx) * off;
    r = { x: dx > 0 ? sx : sx - w, y: end.y - h / 2, w, h };
  } else {
    const sy = end.y + Math.sign(dy) * off;
    r = { x: end.x - w / 2, y: dy > 0 ? sy : sy - h, w, h };
  }
  pdf.setLineDashPattern([], 0);
  pdf.setFillColor(C.white);
  pdf.rect(X(r.x), Y(r.y), S(r.w), S(r.h), 'F');
  text(label, X(r.x + r.w / 2), Y(r.y + r.h / 2 + 3), {
    size: fs(CONTACT_FS), bold: true, color: C.text2, align: 'center',
  });
}

/** 치수 표기가 도면 위쪽에서 차지하는 높이(pt) — 이만큼 도면 영역을 비운다 */
export const DIM_ROW_H = 22;
/** 도면 상단에서 치수 글자 베이스라인까지(pt) */
const DIM_GAP = 6;

/** 한 장짜리 배선도(프레임·제목블록 포함)를 현재 페이지에 그린다. */
export function drawSheet(
  pdf: PdfLike,
  doc: HarnessDocument,
  text: DrawText,
  page: { w: number; h: number },
  info: SheetInfo = {},
): void {
  const area = drawFrameAndTitleBlock(pdf, doc, text, page, info);
  drawDrawingInto(pdf, doc, text, area, info);
}

/**
 * 도면 하나를 주어진 사각형 안에 앉힌다 — 프레임·제목블록은 건드리지 않는다.
 * `sheets` 의 1면과 `onepage` 의 상단 도면이 **같은 함수**를 쓴다. 두 배치가
 * 각자 fitTransform 을 부르면 치수 표기 자리(DIM_ROW_H)를 한쪽만 비워 두는 일이
 * 생긴다 — 그 순간 종이 두 장이 다른 그림이 된다.
 */
export function drawDrawingInto(
  pdf: PdfLike,
  doc: HarnessDocument,
  text: DrawText,
  area: Rect,
  info: SheetInfo = {},
): void {
  const dr = buildDrawing(doc);
  if (!dr.nodes.length && !dr.wires.length) {
    text('배선도에 그릴 부품이 없다.', area.x + area.w / 2, area.y + area.h / 2, {
      size: 11, color: C.muted, align: 'center',
    });
    return;
  }
  // 치수 표기가 앉을 자리를 위에서 덜어 낸 뒤 등비 변환을 만든다.
  // 그래야 치수 글자가 프레임 밖으로 넘치지 않는다.
  const inner: Rect = {
    x: area.x, y: area.y + DIM_ROW_H, w: area.w, h: Math.max(20, area.h - DIM_ROW_H),
  };
  const dim = doc.wires.length ? dimensionLabel(doc, info.perSet) : '';
  drawDrawing(pdf, dr, fitTransform(dr.bounds, inner), text, dim ? { dimension: dim } : {});
}

// ============================================================
// 6. 표 — `sheets` 의 전폭 표와 `onepage` 의 좁은 표가 **한 함수**를 쓴다
//    (열 비율만 다르다. 두 벌을 두면 행 높이·헤더 규칙이 조용히 갈라진다.)
// ============================================================

/** 표 한 줄 높이 · 헤더 높이 — 개선안 §1 이 "유지" 로 못박은 값 */
export const ROW_H = 15;
export const HEAD_H = 18;

export type Col = { title: string; w: number; align?: 'left' | 'right' | 'center' };

/** 셀 하나 — 문자열이거나, 색 견본이 붙는 칸 */
export type Cell = string | { swatch: string; text: string };

/** 비율(합 1.0)을 실제 폭으로 편다 */
export function layoutCols(cols: Col[], total: number): number[] {
  const sum = cols.reduce((n, c) => n + c.w, 0) || 1;
  return cols.map((c) => (c.w / sum) * total);
}

export type TableSpec = {
  x: number;
  y: number;
  w: number;
  /** 표 위 제목. 비우면 제목줄을 그리지 않는다 */
  title?: string;
  /** 제목줄 오른쪽 끝의 작은 글자 (`10본`, `3품목`) */
  note?: string;
  cols: Col[];
  rows: Cell[][];
  /** 행이 하나도 없을 때 적을 말 */
  empty?: string;
};

/** 표 하나를 그리고 **표가 끝난 y** 를 돌려준다 (아래에 비고를 붙일 수 있게). */
export function drawTable(pdf: PdfLike, text: DrawText, t: TableSpec): number {
  const { x, y, w } = t;
  const widths = layoutCols(t.cols, w);
  if (t.title) {
    text(t.title, x, y - 8, { size: 12, bold: true, color: C.text, maxWidth: w - 60 });
  }
  if (t.note) text(t.note, x + w, y - 8, { size: 9, color: C.muted, align: 'right' });

  pdf.setLineDashPattern([], 0);
  pdf.setFillColor(C.subtle);
  pdf.rect(x, y, w, HEAD_H, 'F');
  let hx = x;
  t.cols.forEach((c, i) => {
    const tx = c.align === 'right' ? hx + widths[i] - 4
      : c.align === 'center' ? hx + widths[i] / 2
      : hx + 4;
    text(c.title, tx, y + 12.5, {
      size: 8.5, bold: true, color: C.text3, align: c.align, maxWidth: widths[i] - 8,
    });
    hx += widths[i];
  });
  pdf.setDrawColor(C.lineStrong);
  pdf.setLineWidth(0.7);
  pdf.line(x, y + HEAD_H, x + w, y + HEAD_H);

  let ry = y + HEAD_H;
  for (const row of t.rows) {
    ry += ROW_H;
    let cx = x;
    row.forEach((cell, i) => {
      const col = t.cols[i];
      if (typeof cell !== 'string') {
        // 색 견본은 **보조** 단서다 — 흑백으로 뽑으면 사라지므로
        // 같은 칸에 적는 약호(R/W)가 본 단서다.
        pdf.setFillColor(cell.swatch);
        pdf.setDrawColor(C.lineMid);
        pdf.setLineWidth(0.3);
        pdf.setLineDashPattern([], 0);
        pdf.rect(cx + 4, ry - 11.5, 8, 8, 'FD');
        text(cell.text, cx + 16, ry - 4.5, { size: 8.5, color: C.text, maxWidth: widths[i] - 24 });
      } else if (cell) {
        const tx = col.align === 'right' ? cx + widths[i] - 4
          : col.align === 'center' ? cx + widths[i] / 2
          : cx + 4;
        text(cell, tx, ry - 4.5, {
          size: 8.5, color: C.text, align: col.align, maxWidth: widths[i] - 8,
        });
      }
      cx += widths[i];
    });
    pdf.setDrawColor(C.line);
    pdf.setLineWidth(0.3);
    pdf.line(x, ry, x + w, ry);
  }
  if (!t.rows.length && t.empty) {
    text(t.empty, x + 4, ry + 16, { size: 9, color: C.muted });
    ry += 16;
  }
  return ry;
}

// ============================================================
// 7. 핀 배열 미니 뷰 (개선안 §2-8) — 이 도면에서 **가장 중요한 추가**
// ============================================================

/*
 * ── 왜 필요한가
 * 이 툴의 도면은 "배선이 나가는 변에 긴 축을 붙인다" 는 작도 규칙을 따른다
 * (geometry.drawGrid). 그래서 10P 1열 커넥터가 도면에서는 **세로로 선다**.
 * 실물은 가로 한 줄이다. 조립자가 도면 좌표를 실물 배열로 믿고 압착하면 그대로
 * 오조립이라, 실물 배열을 **따로** 작은 격자로 찍는다.
 *
 * ── 세 가지 금기 (전부 오조립으로 직결된다)
 *  (1) `pinLayout` 으로 대신 그리지 않는다. 그건 도면 좌표다 — 그걸로 그리면
 *      "실물 배열" 이라는 제목이 거짓말이 되고, 이 뷰의 존재 이유가 사라진다.
 *  (2) `view` 가 비면 **배열을 그리지 않는다.** 커넥터는 뒤집으면 번호가 좌우로
 *      뒤집힌다. 뷰 기준 없는 배열은 절반의 확률로 거울상이므로, 아무것도 안
 *      그리는 편이 낫다(사람이 실물을 본다). 대신 그 사실을 --danger 로 적는다.
 *  (3) `layout` 이 없으면 뷰 자체를 그리지 않는다. 근거 없는 배열은 아무것도
 *      없는 것보다 나쁘다(types/index.ts 의 `layout` 주석).
 */

/** 미니 뷰 셀 — 개선안 §2-8 의 17×15pt · 간격 2 */
const PV_CELL_W = 17;
const PV_CELL_H = 15;
const PV_GAP = 2;


/**
 * 낱말 덩어리(segments)를 폭에 맞춰 줄로 묶는다 — 덩어리 안에서는 줄을 바꾸지
 * 않는다. 한 덩어리가 혼자서도 폭을 넘으면 그때만 글자 단위로 쪼갠다(말줄임 없음).
 * 폭은 geometry.estimateTextWidth 어림에 10% 여유를 둔다 — 한글은 전각 어림이
 * 실제와 거의 맞고, ASCII 대문자는 어림보다 넓다(pdf.ts fitToWidth 머리말).
 */
export function wrapSegments(segments: string[], size: number, maxW: number): string[] {
  const W = (t: string) => estimateTextWidth(t, size) * 1.1;
  const lines: string[] = [];
  let line = '';
  const pushChars = (seg: string) => {
    // 덩어리 하나가 폭을 넘는다 — 글자 단위로 쪼갠다
    for (const ch of seg) {
      if (line && W(line + ch) > maxW) { lines.push(line); line = ''; }
      line += ch;
    }
  };
  for (const seg of segments) {
    if (!seg) continue;
    const cand = line ? `${line} ${seg}` : seg;
    if (W(cand) <= maxW) { line = cand; continue; }
    if (line) { lines.push(line); line = ''; }
    if (W(seg) <= maxW) line = seg;
    else pushChars(seg);
  }
  if (line) lines.push(line);
  return lines;
}

/** 공백 단위로 줄을 접는다 (wrapSegments 의 낱말판) */
export function wrapText(text: string, size: number, maxW: number): string[] {
  return wrapSegments(text.split(/\s+/), size, maxW);
}

/**
 * 커넥터 하나의 실물 핀 배열을 그리고 **쓴 높이**를 돌려준다.
 * 그릴 것이 없으면 0 을 돌려준다(= 자리를 차지하지 않는다).
 */
export function drawPinView(
  pdf: PdfLike,
  text: DrawText,
  at: { x: number; y: number; w: number },
  block: {
    ref: string;
    name: string;
    mpn?: string;
    layout?: (number | string | null)[][];
    view?: string;
    unused?: (number | string)[];
    sleeve?: boolean;
  },
): number {
  const { x, y, w } = at;
  const lay = block.layout;
  if (!lay?.length) return 0;                       // 금기 (3)

  /*
   * 제목·출처 줄은 **자르지 않고 줄을 접는다.** 말줄임(…)으로 끊으면 하필 뒤쪽의
   * "실물 대조 필요" 같은 지시가 사라진다 — 이 칸에서 가장 중요한 글자다.
   * 레퍼런스(render.py pin_layout): 제목 9 굵게 · 출처(view) 8 회색 · 11pt 간격.
   */
  const LINE = 11;
  let cy = y;
  for (const ln of wrapText(`${block.ref} ${block.name}`, 9, w)) {
    text(ln, x, cy, { size: 9, bold: true, color: C.text });
    cy += LINE;
  }
  const viewText = block.view?.trim() ?? '';

  if (!viewText) {
    // 금기 (2) — 배열은 그리지 않고, 왜 안 그렸는지를 --danger 로 말한다.
    // "뷰 기준 없음" 은 한 덩어리로 둔다 — 그 낱말이 둘로 갈리면 경고로 안 읽힌다.
    const segs = [block.mpn ? `${block.mpn} ·` : '', '뷰 기준 없음 —', '배열 생략,', '실물 대조 필요'];
    for (const ln of wrapSegments(segs.filter(Boolean), 8, w)) {
      text(ln, x, cy, { size: 8, color: C.danger });
      cy += LINE;
    }
    return cy - y + 4;
  }
  // 출처 줄 — view 그대로 (MPN 은 바로 옆 부품표에 있다. 레퍼런스도 view 만 적는다)
  for (const ln of wrapText(viewText, 8, w)) {
    text(ln, x, cy, { size: 8, color: C.muted });
    cy += LINE;
  }

  const cols = Math.max(...lay.map((r) => r.length));
  // 폭이 모자라면 **등비 축소**. 칸을 줄이거나 줄을 접으면 배열이 달라 보인다.
  const sc = Math.min(1, (w - 2) / (cols * (PV_CELL_W + PV_GAP)));
  // 격자 윗변 — 레퍼런스는 제목 베이스라인 + 18 (= 두 줄일 때). 줄이 늘면 그만큼 내린다.
  const top = cy - LINE + 7;
  // `unused` 는 숫자로도 문자로도 들어온다(`3` / `'+'`). String() 으로 맞춘다 —
  // 규격상 N/C 인 핀이 X 없이 빈 패드로 보이면 "아직 안 그린 핀" 과 구별되지 않는다.
  const unused = new Set((block.unused ?? []).map((v) => String(v)));

  lay.forEach((row, ri) => {
    row.forEach((v, ci) => {
      if (v == null) return;                        // 회로가 없는 빈 자리
      const cx = x + ci * (PV_CELL_W + PV_GAP) * sc;
      const cy = top + ri * (PV_CELL_H + PV_GAP) * sc;
      const cw = PV_CELL_W * sc;
      const ch = PV_CELL_H * sc;
      pdf.setLineDashPattern([], 0);
      pdf.setFillColor(C.subtle);
      pdf.setDrawColor(C.lineStrong);
      pdf.setLineWidth(0.8);
      pdf.rect(cx, cy, cw, ch, 'FD');
      text(String(v), cx + cw / 2, cy + ch / 2 + 3.2, {
        size: 8.5, bold: true, color: C.text, align: 'center',
      });
      if (unused.has(String(v))) {
        // 의도적 미사용 핀 — X 두 줄 (개선안 §2-10)
        pdf.setDrawColor(C.muted2);
        pdf.setLineWidth(1);
        const m = Math.min(cw, ch) * 0.22;
        pdf.line(cx + m, cy + m, cx + cw - m, cy + ch - m);
        pdf.line(cx + cw - m, cy + m, cx + m, cy + ch - m);
      }
    });
  });

  let h = top - y + lay.length * (PV_CELL_H + PV_GAP) * sc + 10;
  if (block.sleeve) {
    // 절연 슬리브 (개선안 §2-11) — 점선 사각 + 라벨. 부품표에는 이미 별도
    // 품목으로 한 줄 서 있다(exporters.ts). 도면에도 보여야 현장이 씌운다.
    const bh = lay.length * (PV_CELL_H + PV_GAP) * sc + 6;
    pdf.setDrawColor(C.muted);
    pdf.setLineWidth(1.2);
    pdf.setLineDashPattern([4, 3], 0);
    pdf.rect(x - 3, top - 3, Math.min(w, cols * (PV_CELL_W + PV_GAP) * sc) + 4, bh, 'S');
    pdf.setLineDashPattern([], 0);
    text('절연 슬리브', x, top + bh + 6, { size: 8, color: C.muted, maxWidth: w });
    h += 10;
  }
  return h;
}

/**
 * 도면에 놓인 커넥터들의 실물 핀 배열을 세로로 이어 그린다.
 * 제목은 `refLabels(doc)` + 부품명, 부제는 MPN + 뷰 기준 — 도면의 이름표와
 * **같은 레퍼런스**를 쓴다(J1 이 도면에서는 J1, 표에서도 J1 이어야 한다).
 */
export function drawPinViews(
  pdf: PdfLike,
  doc: HarnessDocument,
  text: DrawText,
  box: { x: number; y: number; w: number; bottom: number },
): void {
  const refs = refLabels(doc);
  text('핀 배열 (실물 기준)', box.x, box.y - 8, { size: 12, bold: true, color: C.text });
  let cur = box.y + 6;
  // 1극 끝단(러그·페룰·파스톤)은 "배열" 이 없다 — 핀 하나를 칸으로 그리거나
  // "배열 미등록" 경고를 띄우면 없는 숙제를 만든다. 도면집도 이 칸을 비워 둔다.
  // 납처리 전선단(하우징이 없다)·DC 배럴잭(센터·슬리브가 동심원이라 행·열이 없다)도
  // 배열이 없는 끝단이다 — 부품의 endKind 가 그렇게 말할 때만 뺀다.
  const multi = (c: HarnessDocument['connectors'][number]) => {
    const p = doc.usedParts.find((x) => x.id === c.housingId);
    if (p?.endKind === 'free' || p?.endKind === 'barrel') return false;
    // 스플라이스는 한 점에서 합선될 뿐 "핀 배열" 이 없다(drawSpliceGlyph 머리말)
    if (c.kind === 'splice') return false;
    return !!p && Math.max(p.pinCount ?? 0, c.pins.length) > 1;
  };
  const list = doc.connectors.filter(multi);
  if (!list.length && doc.connectors.length) {
    const noGrid = doc.connectors.some((c) => {
      const k = doc.usedParts.find((x) => x.id === c.housingId)?.endKind;
      return k === 'free' || k === 'barrel';
    });
    text(noGrid ? '배열이 없는 끝단뿐이다 — 핀 배열 없음.' : '1극 끝단만 있다 — 핀 배열 없음.',
      box.x, box.y + 10, { size: 8.5, color: C.muted, maxWidth: box.w });
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (cur > box.bottom - 20) {
      // 조용히 멈추지 않는다 — 빠진 커넥터가 있다는 사실을 종이에 남긴다.
      const rest = list.slice(i).map((x) => refs.get(x.id) ?? '?').join('·');
      text(`자리 부족 — ${rest} 생략`, box.x, Math.min(cur, box.bottom) - 4, { size: 8, color: C.danger, maxWidth: box.w });
      break;
    }
    const part = doc.usedParts.find((p) => p.id === c.housingId)!;
    // 도면 칸은 좁다 — 짧은 출처 표기(viewBrief)가 있으면 그것을, 없으면 긴 설명에서
    // 마크다운 기호만 걷어 쓴다. 긴 설명 원문은 부록·라이브러리에 남는다.
    const view = part.view ? (part.viewBrief ?? part.view.replace(/\*\*|`/g, '')) : undefined;
    const used = drawPinView(pdf, text, { x: box.x, y: cur, w: box.w }, {
      ref: refs.get(c.id) ?? '?',
      // 도면 이름표와 같은 이름 — 짧은 이름이 있으면 그것(좁은 칸에서 줄이 덜 접힌다)
      name: part.shortName?.trim() || part.name,
      ...(part.mpn ? { mpn: part.mpn } : {}),
      ...(part.layout ? { layout: part.layout } : {}),
      ...(view ? { view } : {}),
      ...(c.unused ? { unused: c.unused } : {}),
      ...(c.sleeve ? { sleeve: c.sleeve } : {}),
    });
    if (used > 0) cur += used + 6;
  }
  if (cur === box.y + 6) {
    // 한 개도 못 그렸다 — **왜** 비었는지 적는다. 빈 칸은 "이 커넥터는 배열이
    // 없다" 가 아니라 "라이브러리에 아직 안 적었다" 는 뜻이다.
    // 자르지 않고 접는다 — 뒤쪽의 "무엇을 적어야 하는가" 가 이 문장의 본론이다
    const segs = ['등록된 실물 배열이 없다 —', '부품 라이브러리에', 'layout · view 를', '적어야 한다.'];
    wrapSegments(segs, 8.5, box.w).forEach((ln, i) => {
      text(ln, box.x, cur + 4 + i * 11, { size: 8.5, color: C.muted });
    });
  }
}
