/**
 * 캔버스 기하 — 렌더(nodes.tsx)와 배선 계획(docToFlow.ts)이 같은 숫자를 쓰게 하는 단일 출처.
 *
 * 왜 따로 뺐나:
 * docToFlow 는 배선 구간을 **노드 좌상단 x** 로만 잡고 있었다. 12핀 커넥터는
 * 폭이 368px 이라 구간이 통째로 어긋났고, 그 위에서 돌린 레인 채색은 헛돌았다.
 * 그렇다고 nodes.tsx 의 PAD/PITCH/INSET 을 docToFlow 에 베껴 쓰면 다음에 하나만
 * 고쳐지고 두 값이 조용히 갈라진다. 그래서 상수도 계산도 여기 한 곳에만 둔다.
 *
 * React/DOM 을 쓰지 않는다 — 순수 계산만. (Position 은 문자열 enum 이라 값으로 필요)
 */
import { Position } from '@xyflow/react';
import type { Connector, Device, Orientation, PartLibraryItem, PinSlot, Vec2, ViewMode } from '../types';

/** 패드 26px + 간격 4px = 30px 피치 (Claude Design 스펙) */
export const PAD = 26;
export const PITCH = 30;
/** 하우징 박스 안쪽 여백 */
export const INSET = 6;
/** 물리 뷰 핀 크기 */
export const PIN_PHYS = 12;
/** 물리 뷰 핀 격자 피치 */
export const PIN_PHYS_PITCH = PIN_PHYS + 8;

/**
 * 하우징 위(또는 아래)에 붙는 레퍼런스 라벨 한 줄의 높이.
 * canvas.css 의 .hz-ref (11.5px + margin-bottom 2px) 근사값이다.
 * 렌더는 CSS 가 하고 여기서는 **핸들 좌표 추정에만** 쓴다 — 몇 px 오차는
 * 레인 배정 결과를 바꾸지 않는다(레인 간격이 10px 단위라서).
 */
export const REF_BLOCK_H = 17;

/**
 * 하우징 아래 MPN 캡션 한 줄의 높이.
 * canvas.css 의 .hz-mpn (10px · line-height normal ≈ 12px + margin-top 2px) 근사값.
 * 이름표와 마찬가지로 **흰 배경**이라 배선을 가린다 — 그래서 경계 상자에 넣는다.
 */
export const MPN_CAPTION_H = 14;

/* ── 이름표·MPN 캡션의 **폭** ──────────────────────────────────────────────────
 *
 * 왜 높이만으로는 모자랐나 (실측):
 * 예전 connectorBox 는 이름표·캡션의 높이만 상자에 넣고 폭은 하우징 폭 그대로
 * 뒀다. 그런데 이름표는 하우징보다 훨씬 넓다 — 1행 10P 를 좌우로 두면 하우징은
 * 38px 인데 이름표("J1 10P 스트립 → 180° 오른쪽")는 140px 을 넘는다. 라벨은 흰
 * 배경이고 배선은 노드보다 아래층(zIndex 0)이라, 라우터가 모르는 그 140px 뒤로
 * 배선이 들어가면 화면에서 통째로 사라진다. 20본 문서를 띄워 경로를 4px 간격으로
 * 훑은 결과 실제로 한 가닥이 세 지점에서 이름표에 가려져 있었다.
 *
 * 그래서 폭도 여기서 계산해 상자에 넣는다. 글꼴 크기·padding·gap 은 canvas.css 의
 * .hz-ref / .hz-mpn 값을 그대로 옮겨 적은 것이고, PDF(pdfDraw)도 같은 숫자를 쓴다.
 */

/** .hz-ref 조각별 글꼴 크기 (b · .hz-ref-name · .hz-ref-dir) */
const REF_FS = { ref: 11, name: 11.5, dir: 10 };
/** .hz-ref 의 조각 사이 gap */
const REF_GAP = 4;
/** .hz-mpn 글꼴 크기 */
const MPN_FS = 10;
/** .hz-ref · .hz-mpn 의 좌우 padding (한쪽) */
export const LABEL_PAD_X = 2;

/**
 * 글자 폭 어림. 한글·CJK 는 전각(1em), ASCII 는 절반쯤이다.
 *
 * 왜 geometry 에 있나: 이 값이 **경계 상자의 폭**을 정한다. 화면과 PDF 가 다른
 * 어림을 쓰면 두 그림이 갈린다. 원래 export/pdfDraw.ts 에 있었고(글자 잘라내기
 * 판단용) 지금은 그쪽이 여기서 다시 내보낸다.
 *
 * 실제 글꼴을 재지 않는 어림이라 몇 px 어긋난다. 위험한 쪽은 **좁게** 잡는 것인데
 * (라벨이 상자 밖으로 나가 다시 배선을 덮는다), 라우터가 상자에서 12px
 * (route.DEFAULT_CLEARANCE) 더 띄우므로 그만큼이 완충이다.
 */
export function estimateTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 32;
    if (c >= 0x1100) w += 1.0;                      // 한글·CJK 전각
    else if (c >= 0x0080) w += 0.62;                // 기호·화살표
    else if ('iIl.,:;\'`|! '.includes(ch)) w += 0.30;
    else if ('mwMW'.includes(ch)) w += 0.80;
    else w += 0.52;
  }
  return w * size;
}

/** 방향 화살표·낱말 — 화면(.hz-ref-dir)과 PDF 가 **같은 글자**를 그린다 */
const ARROW: Record<Orientation, string> = { 0: '←', 90: '↑', 180: '→', 270: '↓' };
const DIRWORD: Record<Orientation, string> = { 0: '왼쪽', 90: '위쪽', 180: '오른쪽', 270: '아래쪽' };

/** 이름표(.hz-ref) 조각. 화면도 PDF 도 이 셋을 이 순서로 그린다. */
export type RefLabelParts = { ref: string; name: string; dir: string };

/**
 * 커넥터 이름표 글자.
 * 폭 계산과 실제 렌더가 **같은 문자열**을 봐야 상자가 라벨을 정확히 덮는다 —
 * 그래서 글자를 만드는 자리도 여기 하나뿐이다.
 */
export function connectorRefParts(
  connector: Connector,
  housing?: PartLibraryItem,
  ref?: string,
): RefLabelParts {
  const isSplice = connector.kind === 'splice';
  const o = connector.orientation;
  return {
    ref: ref ?? (isSplice ? 'SP' : 'J'),
    name: (isSplice ? '⑂ ' : '') + (housing?.name ?? connector.kind),
    dir: `${ARROW[o]} ${o}° ${DIRWORD[o]}`,
  };
}

/** 이름표 상자 폭 — padding + [ref] + gap + [name] + gap + [dir] + padding */
export function refLabelWidth(p: RefLabelParts): number {
  const w = estimateTextWidth(p.ref, REF_FS.ref)
    + (p.name ? REF_GAP + estimateTextWidth(p.name, REF_FS.name) : 0)
    + (p.dir ? REF_GAP + estimateTextWidth(p.dir, REF_FS.dir) : 0);
  return w + LABEL_PAD_X * 2;
}

/** MPN 캡션 상자 폭 */
export function mpnCaptionWidth(mpn: string): number {
  return estimateTextWidth(mpn, MPN_FS) + LABEL_PAD_X * 2;
}

/**
 * 이름표·캡션을 하우징 **오른쪽 변에 맞춰** 붙이는가 (= 왼쪽으로 넘치게 하는가).
 *
 * 라벨은 하우징보다 넓어 반드시 한쪽으로 삐져나온다. 삐져나온 자리는 흰 배경이라
 * 경계 상자에 넣어야 하는데, 상자를 **핸들이 있는 쪽으로** 넓히면 핸들이 상자
 * 속으로 들어가 스텁부터 회피 대상이 된다 — 그러면 "핸들 방향으로 stub 만큼 곧게
 * 나온다"는 약속이 깨지고 경로가 망가진다(route.ts 머리말).
 *
 * 그래서 overhang 은 언제나 **핸들이 없는 쪽**으로 몬다:
 *   o=180 — 핸들이 오른쪽 변  → 오른쪽 정렬(왼쪽으로 넘침)
 *   o=0   — 핸들이 왼쪽 변    → 왼쪽 정렬(오른쪽으로 넘침)
 *   o=90·270 — 핸들이 위·아래 변이라 좌우 어느 쪽으로 넘쳐도 걸리지 않는다.
 *              게다가 이 둘은 격자가 눕도록 서서(drawGrid) 박스가 이미 넓으니
 *              overhang 자체가 작다. 0° 와 같이 왼쪽 정렬로 둔다.
 */
export function labelsAlignRight(o: Orientation): boolean {
  return o === 180;
}

/** 배선이 나가는 변 → React Flow Position */
export function handleSideOf(o: Orientation): Position {
  return o === 0 ? Position.Left
    : o === 90 ? Position.Top
    : o === 180 ? Position.Right
    : Position.Bottom;
}

/** 가로로 빠져나가는 변인가 (Left/Right) */
export function isHorizontalSide(p: Position): boolean {
  return p === Position.Left || p === Position.Right;
}

/**
 * pinLayout 정규화 — **격자에 실제로 앉힐 수 있는 슬롯만** 남긴다.
 *
 * 왜 필요한가: pinLayout 은 CSV·JSON 가져오기와 저장 파일에서 그대로 들어온다.
 * `offset` 이 없는 슬롯 하나면 `s.offset.x` 에서 TypeError 가 나 캔버스 전체가
 * 하얗게 죽었다(실제로 재현됨). 음수 좌표는 죽지는 않지만 패드를 하우징 박스
 * 바깥에 그려 도면이 조용히 틀어진다.
 *
 * 그래서 여기서 한 번만 걸러 낸다 — 쓸 수 없는 슬롯은 배치에서 빠지고,
 * 그 핀은 아래 `gridOf` 의 "정의 밖 핀" 경로로 떨어진다(사라지지 않는다).
 * 남는 게 없으면 undefined 를 돌려 1행 기본 배치로 간다.
 */
export function layoutCells(layout?: PinSlot[]): PinSlot[] | undefined {
  if (!layout?.length) return undefined;
  const ok = layout.filter(
    (s) =>
      Number.isInteger(s?.offset?.x) && Number.isInteger(s?.offset?.y) &&
      s.offset.x >= 0 && s.offset.y >= 0,
  );
  return ok.length ? ok : undefined;
}

/**
 * 하우징 pinLayout 에서 격자 크기를 역산. 없으면 1행으로 편다.
 *
 * 여기서 나오는 cols/rows 는 **부품 정의 기준**(회전 전)이다. 방향에 맞춰 세우는
 * 일은 `drawGrid`(그리기 전용)가 따로 한다 — 저장 데이터를 돌리지 않기 위해서다.
 *
 * **정의 밖 핀(extra)** — 하우징 정의가 줄었는데(6P→2P) 이미 놓인 커넥터의
 * 핀은 그대로 남아 있는 경우가 있다. 예전에는 `(index-1) % cols` 폴백이
 * 박스 **바깥** 좌표를 내주어 패드가 허공에 떠 있었고, 운이 나쁘면 살아 있는
 * 핀 자리와 겹쳐 그렸다. 지금은 정의된 격자 **아래 줄**에 차례로 앉히고
 * 박스 높이를 그만큼 늘린다 — 도면에 남아 있다는 사실이 보여야 하고
 * (검증 탭이 `핀 수 초과` 로 따로 잡는다), 겹치지는 않아야 한다.
 */
export function gridOf(connector: Connector, housing?: PartLibraryItem) {
  const layout = layoutCells(housing?.pinLayout);
  if (layout) {
    const cols = Math.max(...layout.map((s) => s.offset.x)) + 1;
    const defined = Math.max(...layout.map((s) => s.offset.y)) + 1;
    const known = new Set(layout.map((s) => s.index));
    const orphans = connector.pins.filter((p) => !known.has(p.index));
    const extra = new Map<number, Vec2>();
    orphans.forEach((p, k) => {
      extra.set(p.index, { x: k % cols, y: defined + Math.floor(k / cols) });
    });
    const rows = defined + Math.ceil(orphans.length / cols);
    return { cols, rows, layout, extra };
  }
  return {
    cols: connector.pins.length || 1,
    rows: 1,
    layout: undefined,
    extra: undefined as Map<number, Vec2> | undefined,
  };
}

/**
 * 격자 한 칸의 치수. 캔버스와 세트 개요 썸네일이 **같은 식**을 다른 축척으로 쓴다.
 *
 * 왜 축척을 밖에서 받나: 썸네일(SetOverview)이 이 식을 제 파일에 베껴 두고 있었다.
 * 그래서 커넥터 격자를 방향에 맞춰 세우도록 고친 뒤에도(drawGrid) 썸네일만 옛 모양을
 * 그렸다 — 같은 하네스인데 카드와 도면이 다르게 생겼다. 식은 여기 하나뿐이고
 * 썸네일은 숫자(pad/pitch/inset)만 줄여 쓴다.
 */
export type GridMetrics = { pad: number; pitch: number; inset: number };

/** 캔버스(논리 뷰) 축척 */
export const CANVAS_GRID: GridMetrics = { pad: PAD, pitch: PITCH, inset: INSET };

/** 격자 칸 수 → 박스 크기 */
export function gridBoxSize(
  cols: number,
  rows: number,
  m: GridMetrics = CANVAS_GRID,
): { w: number; h: number } {
  return {
    w: cols * m.pitch + m.inset * 2 - (m.pitch - m.pad),
    h: rows * m.pitch + m.inset * 2 - (m.pitch - m.pad),
  };
}

/** 격자 칸 수 → 하우징 박스 크기 (캔버스 축척) */
export function housingSize(cols: number, rows: number): { w: number; h: number } {
  return gridBoxSize(cols, rows, CANVAS_GRID);
}

/**
 * 격자 칸 수를 **긴 축 기준**으로 줄인다 — 세트 개요 썸네일처럼 작은 그림에서만 쓴다.
 *
 * 왜 여기 있나: 썸네일은 캔버스와 **같은 격자**(방향까지 반영한 drawGrid 결과)를
 * 축소해 그려야 한다. 자르는 규칙까지 썸네일 파일에 두면 "20P 는 카드에서 몇 칸인가"가
 * 두 곳에서 갈린다 — 격자 규칙이 한 곳에서만 나온다는 약속이 다시 깨진다.
 *
 * 왜 축마다 다른 상한을 두지 않나: 가로 상한과 세로 상한이 다르면 **가로·세로 비율의
 * 방향이 뒤집힌다**. 예전 썸네일은 MAX_COLS 8 · MAX_ROWS 3 이었고, 1열 10행 커넥터가
 * 1×3 으로 눌려 세로로 긴 커넥터가 카드에서는 세로로 짧아 보였다. 긴 축만 잘라
 * 비례로 줄이면 어느 쪽이 긴지가 보존된다(전치는 곧 방향 표시라 뭉개면 안 된다).
 */
export function clampGrid(cols: number, rows: number, max: number): { cols: number; rows: number } {
  const long = Math.max(cols, rows);
  if (long <= max) return { cols, rows };
  const s = max / long;
  return { cols: Math.max(1, Math.round(cols * s)), rows: Math.max(1, Math.round(rows * s)) };
}

/**
 * 정의 격자 → **그리는 격자**.
 *
 * 왜 필요한가 (실측한 결함):
 * `pinLayout` 의 offset 은 **부품 정의 기준**이라 1행 N핀 커넥터는 언제나 가로로
 * 긴 격자다. 그걸 그대로 그리면 배선이 좌우로 나가는(0°/180°) 커넥터에서
 * 핸들 N 개가 **짧은 변**(1행 = 38px)에 몰린다. 10P 는 3.8px, 20P 는 1.9px 간격 —
 * 어느 핀에서 나온 선인지 눈으로 구분할 수 없다(20본 밀도 도면에서 확인).
 *
 * 그래서 **그릴 때만** 격자를 세운다: 배선이 나가는 변에 칸이 많은 축을 붙여
 * 핀이 그 변을 따라 줄지어 서게 한다. 그러면 나가는 변의 길이가 핀 수에 비례해
 * 핸들이 PITCH(30px) 간격으로 놓인다. 실제 하네스 도면의 커넥터 심볼이 그렇고,
 * 물리 뷰가 박스를 통째로 rotate 하는 것과도 결이 같다.
 *
 * **전치(transpose)이지 회전이 아닌 이유**: 좌상단 등록 마크가 "1번 핀 위치"를
 * 뜻한다(nodes.tsx·pdfDraw 둘 다 박스 좌상단에 그린다). 90°·180° 회전은 1번 핀을
 * 다른 모서리로 보내 그 표식을 거짓말로 만든다. 전치는 (0,0) 을 제자리에 두면서
 * 긴 축만 세운다.
 *
 * 저장 데이터(`pinLayout.offset`)는 **건드리지 않는다**. 같은 부품을 방향만 바꿔
 * 놓아도 정의가 흔들리면 안 되기 때문이다(types/index.ts 는 동결 계약).
 */
export function drawGrid(
  defCols: number,
  defRows: number,
  o: Orientation,
): { cols: number; rows: number; transposed: boolean; edgeVertical: boolean } {
  // 배선이 나가는 변이 세로인가 (0°=왼쪽 · 180°=오른쪽)
  const edgeVertical = o === 0 || o === 180;
  // 나가는 변에 핀을 줄 세운다 = 칸이 많은 축을 그 변에 붙인다.
  // (칸 수가 같으면 정의 그대로 둔다 — 굳이 뒤집을 이유가 없다)
  const transposed = edgeVertical ? defCols > defRows : defRows > defCols;
  return {
    cols: transposed ? defRows : defCols,
    rows: transposed ? defCols : defRows,
    transposed,
    edgeVertical,
  };
}

/**
 * 라이브러리 항목만으로 하우징 크기 — 드롭 위치 보정(HarnessCanvas)용.
 * 방향 기본값이 0° 인 이유: `seed.instantiate` 가 드롭한 커넥터를 0° 로 만든다.
 * 드롭 직후 화면에 그려지는 크기와 같아야 커서가 부품 가운데에 온다.
 */
export function partHousingSize(item: PartLibraryItem, o: Orientation = 0): { w: number; h: number } {
  const layout = layoutCells(item.pinLayout);
  const defCols = layout
    ? Math.max(...layout.map((s) => s.offset.x)) + 1
    : Math.max(1, item.pinCount ?? 2);
  const defRows = layout ? Math.max(...layout.map((s) => s.offset.y)) + 1 : 1;
  const { cols, rows } = drawGrid(defCols, defRows, o);
  return housingSize(cols, rows);
}

export type ConnectorLayout = {
  /** **그리는** 격자 열 수 (정의 격자를 방향에 맞춰 세운 뒤) */
  cols: number;
  /** **그리는** 격자 행 수 */
  rows: number;
  /** 부품 정의 격자 (회전 전) — 저장된 pinLayout 과 같은 좌표계 */
  defCols: number;
  defRows: number;
  /** 정의 격자를 전치해서 그리는가 (drawGrid 참고) */
  transposed: boolean;
  layout: PartLibraryItem['pinLayout'];
  boxW: number;
  boxH: number;
  /** 배선이 나가는 변 */
  side: Position;
  /** 화면에 그리는 핀 순서 (180°/270° 는 뒤집힌다) */
  orderedPins: Connector['pins'];
  /** 핀 번호 → **그리는** 격자 칸 (패드를 찍는 자리) */
  cellOf(index: number): Vec2;
  /** 핀 번호 → **부품 정의** 격자 칸 (핀맵 에디터·속성 패널이 쓰는 좌표계) */
  defCellOf(index: number): Vec2;
  /** 핀 번호 → 변을 따라간 위치(px) */
  along(index: number): number;
  /** 핀 번호 → 하우징 박스 좌상단 기준 핸들 좌표 */
  handleOffset(index: number): Vec2;
};

/**
 * 논리 뷰 하우징 심볼의 기하.
 *
 * 두 규칙이 여기 산다. 둘 다 실제 도면에서 무너진 걸 보고 넣었다.
 *
 * (1) **격자를 방향에 맞춰 세운다** (drawGrid). 배선이 나가는 변에 핀이 줄지어
 *     서야 핸들이 PITCH 간격으로 벌어진다. 예전에는 1행 10P 를 0°/180° 로 두면
 *     핸들 10개가 38px 변에 3.8px 간격으로 뭉갰다.
 *
 * (2) 핸들은 핀 셀이 아니라 노드 **가장자리**에 둔다. 셀에 붙이면 배선이 도형
 *     한가운데에서 시작하는 것처럼 보인다(nodes.tsx 머리말).
 *
 * 격자가 2행 이상이면 같은 "변 자리"에 핀이 여러 개 겹친다(예: 2×5 몰렉스는
 * 한 자리에 2핀). 그 경우 패드 폭(PAD) 안에서 안쪽 순서(rank)만큼 나눠 앉힌다 —
 * 핸들이 한 점에 겹치면 원하는 핀을 고를 수 없기 때문이다(실제로 왼쪽 끝을
 * 끌었더니 4번 핀이 잡혔다). 깊이가 1이면 식이 정확히 `PAD/2`(칸 가운데)로
 * 떨어져 예전 좌표와 같다.
 */
export function connectorLayout(connector: Connector, housing?: PartLibraryItem): ConnectorLayout {
  const { cols: defCols, rows: defRows, layout, extra } = gridOf(connector, housing);
  const o = connector.orientation;
  const side = handleSideOf(o);

  const { cols, rows, transposed, edgeVertical } = drawGrid(defCols, defRows, o);
  const { w: boxW, h: boxH } = housingSize(cols, rows);

  // 180°/270° 는 핀 순서가 뒤집혀 보여야 한다(도면을 반대에서 읽는 경우).
  // 패드는 셀 좌표로 절대 배치하므로 이 순서는 DOM 순서(읽기 순서)만 바꾼다.
  const flipped = o === 180 || o === 270;
  const orderedPins = flipped ? [...connector.pins].reverse() : connector.pins;

  /** 부품 정의 기준 칸 — 저장된 offset 그대로 */
  const defCellOf = (index: number): Vec2 => {
    const slot = layout?.find((s) => s.index === index);
    if (slot) return slot.offset;
    // 하우징 정의에 없는 핀 — gridOf 가 잡아 둔 아래 줄 자리 (박스 안이고 겹치지 않는다)
    const spill = extra?.get(index);
    if (spill) return spill;
    const i = index - 1;
    return { x: i % defCols, y: Math.floor(i / defCols) };
  };

  /** 그리는 칸 — 정의 칸을 방향에 맞춰 세운 것. 전치라 1:1 대응이 깨지지 않는다. */
  const cellOf = (index: number): Vec2 => {
    const c = defCellOf(index);
    return transposed ? { x: c.y, y: c.x } : c;
  };

  // 나가는 변에서 안쪽으로 들어가는 칸 수 = 한 자리에 겹치는 핀 수
  const depth = Math.max(1, edgeVertical ? cols : rows);

  const along = (index: number): number => {
    const cell = cellOf(index);
    const at = edgeVertical ? cell.y : cell.x;    // 변을 따라간 몇 번째 자리인가
    const rank = edgeVertical ? cell.x : cell.y;  // 변에서 몇 번째 안쪽인가
    return INSET + at * PITCH + ((rank + 0.5) / depth) * PAD;
  };

  const handleOffset = (index: number): Vec2 => {
    const a = along(index);
    if (o === 90) return { x: a, y: 0 };
    if (o === 270) return { x: a, y: boxH };
    if (o === 0) return { x: 0, y: a };
    return { x: boxW, y: a };
  };

  return {
    cols, rows, defCols, defRows, transposed, layout, boxW, boxH,
    side, orderedPins, cellOf, defCellOf, along, handleOffset,
  };
}

/**
 * 노드 좌상단(React Flow position) → 하우징 박스 좌상단.
 * 90° 는 라벨을 아래에 두므로(선이 글자를 뚫지 않게) 박스가 맨 위에 온다.
 */
export function housingOrigin(o: Orientation): Vec2 {
  return { x: 0, y: o === 90 ? 0 : REF_BLOCK_H };
}

/** 노드가 화면에서 차지하는 사각형 (배선이 뒤로 숨지 않게 라우터에 넘긴다) */
export type NodeBox = { x: number; y: number; w: number; h: number };

/**
 * 논리 뷰에서 이름표·MPN 캡션이 실제로 차지하는 사각형 (절대 좌표).
 *
 * 화면(nodes.tsx)은 이 자리를 CSS 로, PDF(pdfDraw)는 같은 좌표를 글자 시작점으로
 * 쓴다. 경계 상자(connectorBox)도 이 사각형들을 그대로 합쳐 만든다 — 세 곳이
 * 같은 함수를 봐야 "라우터가 아는 상자"와 "화면에 그려진 글자"가 어긋나지 않는다.
 *
 * 세로 순서는 방향에 따라 바뀐다:
 *   o≠90 — [이름표] [하우징] [MPN]
 *   o=90 — [하우징] [MPN] [이름표]  (배선이 위로 나가므로 글자를 아래로 내린다)
 * 어느 쪽이든 합계 높이는 REF_BLOCK_H + boxH + (MPN 있으면 MPN_CAPTION_H) 로 같다.
 */
export function connectorLabelRects(
  connector: Connector,
  housing: PartLibraryItem | undefined,
  nodePos: Vec2,
  ref?: string,
): { ref: NodeBox; mpn?: NodeBox } {
  const g = connectorLayout(connector, housing);
  const o = connector.orientation;
  const org = housingOrigin(o);
  const boxX = nodePos.x + org.x;
  const boxY = nodePos.y + org.y;
  const alignRight = labelsAlignRight(o);
  /** 하우징 폭 슬롯 안에서 한쪽 변에 맞춘다 — 넘치는 쪽이 곧 overhang 방향이다 */
  const place = (w: number, y: number, h: number): NodeBox => ({
    x: alignRight ? boxX + g.boxW - w : boxX,
    y, w, h,
  });

  const mpnH = housing?.mpn ? MPN_CAPTION_H : 0;
  const mpnY = boxY + g.boxH;
  return {
    ref: place(
      refLabelWidth(connectorRefParts(connector, housing, ref)),
      o === 90 ? mpnY + mpnH : nodePos.y,
      REF_BLOCK_H,
    ),
    mpn: housing?.mpn ? place(mpnCaptionWidth(housing.mpn), mpnY, MPN_CAPTION_H) : undefined,
  };
}

/**
 * 커넥터 노드의 경계 상자.
 *
 * **이름표(.hz-ref)와 MPN 캡션(.hz-mpn)까지 포함한다** — 높이도 폭도. 둘 다 흰
 * 배경이라 아래층(zIndex 0)에 그려지는 배선을 가린다. 실제로 SP1 이름표 뒤로
 * 주행 구간이 사라지는 걸 화면에서 확인했고, 폭을 안 넣던 시절에는 1행 10P 를
 * 좌우로 둔 커넥터의 이름표(140px+)가 하우징(38px) 밖으로 100px 넘게 삐져나와
 * 그 뒤로 배선이 들어갔다.
 *
 * 넓히는 방향은 **핸들이 없는 쪽 하나뿐**이다(labelsAlignRight 참고). 그래서
 * 핸들은 어느 방향에서도 상자 **변 위**에 남는다 — 상자 속으로 들어가면 스텁부터
 * 회피 대상이 돼 경로가 망가진다.
 */
export function connectorBox(
  connector: Connector,
  housing: PartLibraryItem | undefined,
  nodePos: Vec2,
  view: ViewMode = 'logical',
  ref?: string,
): NodeBox {
  const layout = layoutCells(housing?.pinLayout);
  if (view === 'physical' && layout) {
    // 물리 뷰는 박스를 통째로 rotate 한다 — 90°/270° 는 중심을 축으로 가로·세로가 바뀐다.
    // (물리 뷰 노드에는 이름표·캡션이 없다 — nodes.tsx 의 물리 분기 참고)
    const w = (Math.max(...layout.map((s) => s.offset.x)) + 1) * PIN_PHYS_PITCH;
    const h = (Math.max(...layout.map((s) => s.offset.y)) + 1) * PIN_PHYS_PITCH;
    const swap = connector.orientation === 90 || connector.orientation === 270;
    const bw = swap ? h : w;
    const bh = swap ? w : h;
    return { x: nodePos.x + (w - bw) / 2, y: nodePos.y + (h - bh) / 2, w: bw, h: bh };
  }
  const g = connectorLayout(connector, housing);
  const org = housingOrigin(connector.orientation);
  const rects = connectorLabelRects(connector, housing, nodePos, ref);
  // 하우징 + 라벨 사각형들의 합집합. 라벨은 한쪽으로만 넘치므로 반대쪽 변은 그대로다.
  const parts = [
    { x: nodePos.x + org.x, w: g.boxW },
    rects.ref,
    ...(rects.mpn ? [rects.mpn] : []),
  ];
  const x = Math.min(...parts.map((p) => p.x));
  const right = Math.max(...parts.map((p) => p.x + p.w));
  return {
    x,
    y: nodePos.y,
    w: right - x,
    h: REF_BLOCK_H + g.boxH + (housing?.mpn ? MPN_CAPTION_H : 0),
  };
}

/** 논리 뷰: 노드 좌표 기준 핀 핸들의 절대 좌표 */
export function pinAnchor(
  connector: Connector,
  housing: PartLibraryItem | undefined,
  pinIndex: number,
  nodePos: Vec2,
): { x: number; y: number; side: Position } {
  const g = connectorLayout(connector, housing);
  const org = housingOrigin(connector.orientation);
  const off = g.handleOffset(pinIndex);
  return { x: nodePos.x + org.x + off.x, y: nodePos.y + org.y + off.y, side: g.side };
}

/**
 * 물리 뷰: 박스를 통째로 rotate(o) 하므로 칸 중심을 박스 중심 기준으로 회전한다.
 * (레이아웃 좌상단은 transform 과 무관하게 nodePos 로 남는다)
 */
export function pinAnchorPhysical(
  connector: Connector,
  housing: PartLibraryItem | undefined,
  pinIndex: number,
  nodePos: Vec2,
): { x: number; y: number; side: Position } {
  const layout = layoutCells(housing?.pinLayout);
  const o = connector.orientation;
  const side = o === 0 ? Position.Top
    : o === 90 ? Position.Right
    : o === 180 ? Position.Bottom
    : Position.Left;
  if (!layout?.length) return { x: nodePos.x, y: nodePos.y, side };

  const w = (Math.max(...layout.map((s) => s.offset.x)) + 1) * PIN_PHYS_PITCH;
  const h = (Math.max(...layout.map((s) => s.offset.y)) + 1) * PIN_PHYS_PITCH;
  const slot = layout.find((s) => s.index === pinIndex);
  const cx = (slot?.offset.x ?? 0) * PIN_PHYS_PITCH + 4 + PIN_PHYS / 2;
  const cy = (slot?.offset.y ?? 0) * PIN_PHYS_PITCH + 4 + PIN_PHYS / 2;
  const rad = (o * Math.PI) / 180;
  const dx = cx - w / 2;
  const dy = cy - h / 2;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  return { x: nodePos.x + w / 2 + rx, y: nodePos.y + h / 2 + ry, side };
}

/** 장치 블록 단자 한 줄 높이 (.hz-dev-term 11px/1.5 + gap 2px 근사) */
export const DEV_ROW_H = 19;
/** 장치 블록 하우징 padding (.hz-housing-dev) */
export const DEV_PAD = 6;
/** 단자 이름 글꼴 크기 (.hz-dev-term) */
const DEV_TERM_FS = 11;
/** 단자 줄 좌우 padding 한쪽 (.hz-dev-term) */
const DEV_TERM_PAD_X = 4;

/**
 * 장치 이름표(.hz-ref) 글자. 커넥터와 같은 세 조각 구조를 쓰되 방향 칸은 비운다 —
 * 장치 블록은 회전하지 않으므로(핸들이 좌·우로 고정) 적을 방향이 없다.
 * 폭 계산과 렌더가 **같은 문자열**을 봐야 상자가 글자를 정확히 덮는다.
 */
export function deviceRefParts(device: Device, ref?: string): RefLabelParts {
  return { ref: ref ?? 'D', name: device.name, dir: '' };
}

/** 장치 캡션(.hz-mpn) 글자 — DeviceNode 와 PDF 가 같은 문자열을 그린다 */
export function deviceCaption(device: Device): string {
  return `장치 · 단자 ${(device.terminals ?? []).length}`;
}

/**
 * 장치 블록 크기.
 *
 * ── 왜 이름표 폭까지 재나 (실측한 결함)
 * 예전에는 **단자 이름 길이**로만 폭을 잡았다("longest * 6.5"). 그런데 화면에서
 * 실제로 넓은 것은 블록 위에 붙는 이름표다("D1 리어 도어 락 액추에이터 모듈" 은
 * 200px 을 넘는데 블록은 48px 이었다). 이름표는 흰 배경이고 배선은 노드보다
 * 아래층(zIndex 0)이라, 라우터가 모르는 그 폭 뒤로 배선이 들어가면 화면에서
 * 통째로 사라진다. 커넥터에서 이미 겪은 그대로다(connectorBox 머리말).
 *
 * ── 왜 상자를 옆으로 넓히지 않고 **블록 자체**를 넓히나
 * 커넥터는 이름표가 삐져나온 만큼을 경계 상자에만 더하고 그 방향을 핸들 반대쪽으로
 * 몰았다(labelsAlignRight). 장치는 그 수가 안 통한다 — 단자 핸들이 오른쪽 변,
 * 기본 핸들(`__node`)이 왼쪽 변이라 **양쪽 다 핸들**이어서 어느 쪽으로 넓혀도
 * 핸들이 상자 속으로 들어가고, 그러면 스텁부터 회피 대상이 돼 경로가 망가진다.
 *
 * 블록 자체를 넓히면 핸들이 **넓어진 변 위로 함께 옮겨 간다**(deviceAnchor 가
 * 같은 w 를 쓴다). 상자 = 블록이므로 핸들은 언제나 변 위에 남고, 이름표는 상자
 * 안에 들어가며, 이름을 자르거나 줄바꿈할 일도 없다. 제조 도면에서 장치 이름을
 * 생략(…)하는 것은 선택지가 아니다 — 그 이름이 곧 조립 지시다.
 *
 * 단자 이름 폭도 글자 수가 아니라 estimateTextWidth 로 잰다. 한글 단자명("전원",
 * "접지")은 글자 수가 절반이라 예전 식(6.5px/글자)으로는 상자보다 넓게 그려져
 * 같은 이유로 배선을 덮었다.
 */
export function deviceSize(device: Device, ref?: string): { w: number; h: number } {
  const terms = device.terminals ?? [];
  const termW = terms.reduce((m, t) => Math.max(m, estimateTextWidth(t, DEV_TERM_FS)), 0)
    + DEV_TERM_PAD_X * 2 + DEV_PAD * 2;
  return {
    w: Math.max(
      48,
      termW,
      refLabelWidth(deviceRefParts(device, ref)),
      mpnCaptionWidth(deviceCaption(device)),
    ),
    h: Math.max(20, terms.length * DEV_ROW_H + DEV_PAD * 2),
  };
}

/**
 * 장치 블록 핸들의 절대 좌표.
 * 단자 핸들은 오른쪽 변, 단자 없는 기본 핸들(`__node`)은 왼쪽 변 가운데다.
 *
 * `ref` 를 받는 이유: 블록 폭이 이름표 글자 폭에 달렸고(deviceSize) 이름표 첫
 * 조각이 도면 레퍼런스("D1"·"D12")다. 상자와 다른 ref 로 여기를 부르면 오른쪽
 * 변 핸들이 상자 변에서 몇 px 어긋난다 — 그래서 호출부가 같은 값을 넘긴다.
 */
export function deviceAnchor(
  device: Device,
  terminal: string | undefined,
  nodePos: Vec2,
  ref?: string,
): { x: number; y: number; side: Position } {
  const { w, h } = deviceSize(device, ref);
  const top = nodePos.y + REF_BLOCK_H;
  const terms = device.terminals ?? [];
  const i = terminal ? terms.indexOf(terminal) : -1;
  if (i < 0) return { x: nodePos.x, y: top + h / 2, side: Position.Left };
  return {
    x: nodePos.x + w,
    y: top + DEV_PAD + i * DEV_ROW_H + DEV_ROW_H / 2,
    side: Position.Right,
  };
}

/**
 * 논리 뷰에서 장치 이름표·캡션이 차지하는 사각형 (절대 좌표).
 * 커넥터의 connectorLabelRects 와 같은 자리 — 화면·PDF·경계 상자가 한 함수를 본다.
 *
 * 세로 순서는 언제나 [이름표] [블록] [캡션] 이다. 장치는 회전하지 않으므로
 * 커넥터처럼 90° 에서 순서를 뒤집는 경우가 없다.
 *
 * 두 사각형 모두 **왼쪽 정렬**이다. 블록이 이미 둘보다 넓게 잡혀 있어(deviceSize)
 * 어느 쪽으로도 삐져나오지 않는다 — 커넥터처럼 넘치는 방향을 고를 필요가 없다.
 */
export function deviceLabelRects(
  device: Device,
  nodePos: Vec2,
  ref?: string,
): { ref: NodeBox; caption: NodeBox } {
  const { h } = deviceSize(device, ref);
  return {
    ref: {
      x: nodePos.x, y: nodePos.y,
      w: refLabelWidth(deviceRefParts(device, ref)), h: REF_BLOCK_H,
    },
    caption: {
      x: nodePos.x, y: nodePos.y + REF_BLOCK_H + h,
      w: mpnCaptionWidth(deviceCaption(device)), h: MPN_CAPTION_H,
    },
  };
}

/**
 * 장치 노드의 경계 상자 — 커넥터와 같은 이유로 이름표·캡션 높이를 포함한다.
 * DeviceNode 는 캡션("장치 · 단자 N")을 항상 그리므로 조건 없이 더한다.
 *
 * 폭은 블록 폭 그대로다. 블록이 이미 이름표·캡션을 담을 만큼 넓기 때문이다
 * (deviceSize 머리말). 그래서 상자를 옆으로 늘리지 않아도 라벨이 상자 밖으로
 * 나가지 않고, 좌·우 변의 핸들은 상자 변 위에 그대로 남는다.
 */
export function deviceBox(device: Device, nodePos: Vec2, ref?: string): NodeBox {
  const { w, h } = deviceSize(device, ref);
  return { x: nodePos.x, y: nodePos.y, w, h: REF_BLOCK_H + h + MPN_CAPTION_H };
}
