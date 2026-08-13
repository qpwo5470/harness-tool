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

/** 격자 칸 수 → 하우징 박스 크기 */
export function housingSize(cols: number, rows: number): { w: number; h: number } {
  return {
    w: cols * PITCH + INSET * 2 - (PITCH - PAD),
    h: rows * PITCH + INSET * 2 - (PITCH - PAD),
  };
}

/** 라이브러리 항목만으로 하우징 크기 — 드롭 위치 보정(HarnessCanvas)용 */
export function partHousingSize(item: PartLibraryItem): { w: number; h: number } {
  const layout = layoutCells(item.pinLayout);
  const cols = layout
    ? Math.max(...layout.map((s) => s.offset.x)) + 1
    : Math.max(1, item.pinCount ?? 2);
  const rows = layout ? Math.max(...layout.map((s) => s.offset.y)) + 1 : 1;
  return housingSize(cols, rows);
}

export type ConnectorLayout = {
  cols: number;
  rows: number;
  layout: PartLibraryItem['pinLayout'];
  boxW: number;
  boxH: number;
  /** 배선이 나가는 변 */
  side: Position;
  /** 화면에 그리는 핀 순서 (180°/270° 는 뒤집힌다) */
  orderedPins: Connector['pins'];
  /** 핀 번호 → 격자 칸 */
  cellOf(index: number): Vec2;
  /** 핀 번호 → 변을 따라간 위치(px) */
  along(index: number): number;
  /** 핀 번호 → 하우징 박스 좌상단 기준 핸들 좌표 */
  handleOffset(index: number): Vec2;
};

/**
 * 논리 뷰 하우징 심볼의 기하.
 *
 * 핸들을 노드 **가장자리**에 두는 규칙과, 변과 평행한 축에 핀이 몰려 있을 때
 * (예: 4핀 1행 커넥터가 왼쪽으로 나가는 경우) 핸들 4개가 한 점에 겹치지 않도록
 * 핀 순서로 고르게 펴는 규칙까지 여기 담는다. 두 규칙 다 실제 버그에서 나왔다
 * (nodes.tsx 머리말 참고).
 */
export function connectorLayout(connector: Connector, housing?: PartLibraryItem): ConnectorLayout {
  const { cols, rows, layout, extra } = gridOf(connector, housing);
  const { w: boxW, h: boxH } = housingSize(cols, rows);
  const o = connector.orientation;
  const side = handleSideOf(o);

  // 180°/270° 는 핀 순서가 뒤집혀 보여야 한다(도면을 반대에서 읽는 경우).
  const flipped = o === 180 || o === 270;
  const orderedPins = flipped ? [...connector.pins].reverse() : connector.pins;

  const cellOf = (index: number): Vec2 => {
    const slot = layout?.find((s) => s.index === index);
    if (slot) return slot.offset;
    // 하우징 정의에 없는 핀 — gridOf 가 잡아 둔 아래 줄 자리 (박스 안이고 겹치지 않는다)
    const spill = extra?.get(index);
    if (spill) return spill;
    const i = index - 1;
    return { x: i % cols, y: Math.floor(i / cols) };
  };

  // 변과 평행한 축에 실제로 놓인 칸 수 — 좌우로 나가면 행 수, 위아래로 나가면 열 수
  const alongVertical = o === 0 || o === 180;
  const spanCount = alongVertical ? rows : cols;
  const spreadByIndex = spanCount < orderedPins.length;
  const edgeLength = alongVertical ? boxH : boxW;

  const along = (index: number): number => {
    const i = orderedPins.findIndex((p) => p.index === index);
    if (spreadByIndex) return ((Math.max(0, i) + 0.5) / orderedPins.length) * edgeLength;
    const cell = cellOf(index);
    return INSET + (alongVertical ? cell.y : cell.x) * PITCH + PAD / 2;
  };

  const handleOffset = (index: number): Vec2 => {
    const a = along(index);
    if (o === 90) return { x: a, y: 0 };
    if (o === 270) return { x: a, y: boxH };
    if (o === 0) return { x: 0, y: a };
    return { x: boxW, y: a };
  };

  return { cols, rows, layout, boxW, boxH, side, orderedPins, cellOf, along, handleOffset };
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
 * 커넥터 노드의 경계 상자.
 *
 * **이름표(.hz-ref)와 MPN 캡션(.hz-mpn)까지 포함한다.** 둘 다 흰 배경이라
 * 아래층(zIndex 0)에 그려지는 배선을 가린다 — 실제로 SP1 이름표 뒤로 주행 구간이
 * 사라지는 걸 화면에서 확인했다. 세 조각의 세로 순서는 방향(o)에 따라 바뀌지만
 * (90° 는 이름표가 아래) 합계 높이는 같으므로 순서는 따지지 않는다.
 *
 * 폭은 **하우징 박스 폭 그대로** 둔다. 이름표가 좁은 커넥터(스플라이스 등)에서
 * 박스보다 오른쪽으로 삐져나오지만, 폭을 늘리면 변에 붙어 있어야 할 핸들이
 * 상자 **안쪽**으로 들어가 스텁부터 회피 대상이 돼 버린다. 글자 폭은 CSS 가
 * 정하는 값이라 여기서 정확히 알 수도 없다. → 남은 한계로 적어 둔다.
 */
export function connectorBox(
  connector: Connector,
  housing: PartLibraryItem | undefined,
  nodePos: Vec2,
  view: ViewMode = 'logical',
): NodeBox {
  const layout = layoutCells(housing?.pinLayout);
  if (view === 'physical' && layout) {
    // 물리 뷰는 박스를 통째로 rotate 한다 — 90°/270° 는 중심을 축으로 가로·세로가 바뀐다.
    const w = (Math.max(...layout.map((s) => s.offset.x)) + 1) * PIN_PHYS_PITCH;
    const h = (Math.max(...layout.map((s) => s.offset.y)) + 1) * PIN_PHYS_PITCH;
    const swap = connector.orientation === 90 || connector.orientation === 270;
    const bw = swap ? h : w;
    const bh = swap ? w : h;
    return { x: nodePos.x + (w - bw) / 2, y: nodePos.y + (h - bh) / 2, w: bw, h: bh };
  }
  const g = connectorLayout(connector, housing);
  return {
    x: nodePos.x,
    y: nodePos.y,
    w: g.boxW,
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

/** 장치 블록 크기 — 단자 이름 길이로 폭을 어림한다(글꼴 폭 ≈ 6.5px/글자) */
export function deviceSize(device: Device): { w: number; h: number } {
  const terms = device.terminals ?? [];
  const longest = terms.reduce((m, t) => Math.max(m, t.length), 3);
  return {
    w: Math.max(48, longest * 6.5 + 8 + DEV_PAD * 2),
    h: Math.max(20, terms.length * DEV_ROW_H + DEV_PAD * 2),
  };
}

/**
 * 장치 블록 핸들의 절대 좌표.
 * 단자 핸들은 오른쪽 변, 단자 없는 기본 핸들(`__node`)은 왼쪽 변 가운데다.
 */
export function deviceAnchor(
  device: Device,
  terminal: string | undefined,
  nodePos: Vec2,
): { x: number; y: number; side: Position } {
  const { w, h } = deviceSize(device);
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
 * 장치 노드의 경계 상자 — 커넥터와 같은 이유로 이름표·캡션 높이를 포함한다.
 * DeviceNode 는 캡션("장치 · 단자 N")을 항상 그리므로 조건 없이 더한다.
 */
export function deviceBox(device: Device, nodePos: Vec2): NodeBox {
  const { w, h } = deviceSize(device);
  return { x: nodePos.x, y: nodePos.y, w, h: REF_BLOCK_H + h + MPN_CAPTION_H };
}
