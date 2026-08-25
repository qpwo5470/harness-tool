/**
 * 핀 번호가 **배선이 붙는 자리**에서 읽히는가 — 회귀 시험.
 *
 * 잡으려는 결함:
 * 번호가 26px 패드 한가운데에 찍혀 있어서, 격자가 2열 이상이면 핸들과 최대
 * 6.5px 어긋났다. 43025-2400(24회로 2열)을 0° 로 두면 나가는 변의 핸들 순서가
 * **1·13·2·14·3·15…** 로 엇갈리는데(along 이 rank 로 갈린다), 번호가 칸 가운데라
 * 어느 선이 몇 번 핀에서 나왔는지 눈으로 따라갈 수 없었다.
 *
 * 여기서 못박는 것은 네 가지다.
 *  (1) 번호 상자의 along 중심 == 핸들의 along  (2px 이내)
 *  (2) 번호 상자가 **제 패드 안**에 있다 → 그래서
 *  (3) 겹치는 상자 쌍 = **0**  (빽빽한 24회로 2열, 네 방향 전부)
 *  (4) 화면(geometry)과 종이(pdfDraw)가 **같은 상자**를 쓴다
 *
 * (4)를 시험으로 못박는 이유: 직전 커밋이 스텁 라벨에서 정확히 이 사고를 냈다.
 * 화면만 고치고 종이는 예전 자리에 그려 같은 도면이 두 그림으로 갈렸다.
 */
import { describe, it, expect } from 'vitest';
import {
  INSET, PAD, PITCH, PIN_NUM_H, PIN_NUM_M,
  connectorLayout, housingOrigin, pinNumberAlign, pinNumberWidth,
} from './geometry';
import { buildDrawing } from '../export/pdfDraw';
import { instantiate } from '../library/seed';
import type { Connector, HarnessDocument, Orientation, PartLibraryItem, PinSlot, Vec2 } from '../types';

const DIRS: Orientation[] = [0, 90, 180, 270];

/** cols×rows 행 우선 배치 — seed.ts 의 grid() 와 같은 모양 */
function grid(cols: number, rows: number): PinSlot[] {
  const out: PinSlot[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x + 1;
      out.push({ index, label: String(index), offset: { x, y } });
    }
  }
  return out;
}

const housing = (pinLayout: PinSlot[], id = 'h-test'): PartLibraryItem => ({
  id, category: 'housing', name: '시험 하우징', mpn: 'TEST-0000',
  pinCount: pinLayout.length, pinLayout,
});

/** 43025-2400 과 같은 모양: 2행 × 12열, 24회로 */
const MF24 = housing(grid(12, 2), 'h-mf24');

function place(part: PartLibraryItem, o: Orientation, at: Vec2 = { x: 0, y: 0 }): Connector {
  return { ...instantiate(part, at), orientation: o };
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 겹치는 상자 쌍의 수 — 숫자로 못박기 위한 계산 */
function overlapPairs(boxes: Box[]): number {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) if (overlaps(boxes[i], boxes[k])) n++;
  }
  return n;
}

/** 번호 상자들 (하우징 박스 기준) + 핀 번호 */
function numBoxes(part: PartLibraryItem, o: Orientation) {
  const c = place(part, o);
  const g = connectorLayout(c, part);
  return c.pins.map((p) => {
    const label = String(p.label ?? part.pinLayout!.find((s) => s.index === p.index)?.label ?? p.index);
    return { index: p.index, label, box: g.pinNumberBox(p.index, label), g };
  });
}

describe('핀 번호가 핸들 자리에 앉는다', () => {
  it.each(DIRS)('%s° — 번호 상자의 along 중심이 핸들과 같다', (o) => {
    const c = place(MF24, o);
    const g = connectorLayout(c, MF24);
    const vertical = o === 0 || o === 180;

    for (const pin of c.pins) {
      const label = String(pin.index);
      const b = g.pinNumberBox(pin.index, label);
      const center = vertical ? b.y + b.h / 2 : b.x + b.w / 2;
      /**
       * 정확히 같지는 않다. 상자를 패드 밖으로 내보내지 않으므로(clamp) along 이
       * 칸 가장자리에 가까울수록 밀린다 — 어긋남의 상한은 `상자 절반 + 여백 −
       * along 이 칸 안에서 가장자리까지 떨어진 거리` 다. 2열(깊이 2) · 두 자리
       * 표기에서 실측 최대 2.32px(90°/270°, 세로 축이 아니라 가로 축이라 상자
       * 폭이 걸린다). 3px 이면 26px 패드 안에서 어느 핸들인지 헷갈릴 여지가 없다.
       *
       * 정말 중요한 것은 절대 오차가 아니라 **순서**다 — 아래 시험이 그걸 잰다.
       */
      expect(Math.abs(center - g.along(pin.index))).toBeLessThanOrEqual(3);
    }
  });

  /**
   * 변을 따라 읽은 **번호의 순서**가 핸들의 순서와 같아야 한다.
   * 이게 사용자가 하려던 일이다 — 선을 따라 변에 닿은 다음, 그 자리에서 수직으로
   * 눈을 옮겨 번호를 읽는다. 순서가 뒤집히면 clamp 오차가 몇 px 이든 못 읽는다.
   */
  it.each(DIRS)('%s° — 변을 따라 읽은 번호 순서가 핸들 순서와 같다', (o) => {
    const c = place(MF24, o);
    const g = connectorLayout(c, MF24);
    const vertical = o === 0 || o === 180;
    const byHandle = [...c.pins].sort((a, b) => g.along(a.index) - g.along(b.index));
    const center = (i: number) => {
      const b = g.pinNumberBox(i, String(i));
      return vertical ? b.y + b.h / 2 : b.x + b.w / 2;
    };
    const byNumber = [...c.pins].sort((a, b) => center(a.index) - center(b.index));
    expect(byNumber.map((p) => p.index)).toEqual(byHandle.map((p) => p.index));
  });

  it.each(DIRS)('%s° — 번호는 배선이 나가는 변 쪽 패드 모서리에 붙는다', (o) => {
    const c = place(MF24, o);
    const g = connectorLayout(c, MF24);
    for (const pin of c.pins) {
      const cell = g.cellOf(pin.index);
      const cx = INSET + cell.x * PITCH;
      const cy = INSET + cell.y * PITCH;
      const b = g.pinNumberBox(pin.index, String(pin.index));
      if (o === 0) expect(b.x).toBe(cx + PIN_NUM_M);                      // 왼쪽 변
      if (o === 180) expect(b.x + b.w).toBe(cx + PAD - PIN_NUM_M);        // 오른쪽 변
      if (o === 90) expect(b.y).toBe(cy + PIN_NUM_M);                     // 위 변
      if (o === 270) expect(b.y + b.h).toBe(cy + PAD - PIN_NUM_M);        // 아래 변
    }
    // 정렬도 같은 규칙에서 나온다 — PDF 가 이 값으로 기준점을 잡는다
    expect(pinNumberAlign(o)).toBe(o === 0 ? 'left' : o === 180 ? 'right' : 'center');
  });

  /**
   * 깊이 1(한 줄짜리 격자)은 along 이 정확히 칸 가운데(PAD/2)로 떨어진다.
   * 그 경우 번호도 along 축으로는 예전과 같은 자리에 있어야 한다 — 대다수 커넥터가
   * 여기 해당하므로, 이 변경이 그쪽 도면을 흔들지 않는다는 것을 못박는다.
   */
  it('1열 커넥터는 along 축 자리가 예전(칸 가운데)과 같다', () => {
    const part = housing(grid(6, 1), 'h-1row');
    const c = place(part, 0);
    const g = connectorLayout(c, part);
    for (const pin of c.pins) {
      const cell = g.cellOf(pin.index);
      const b = g.pinNumberBox(pin.index, String(pin.index));
      expect(b.y + b.h / 2).toBeCloseTo(INSET + cell.y * PITCH + PAD / 2, 9);
    }
  });
});

describe('빽빽한 커넥터에서 번호가 겹치지 않는다 (24회로 2열)', () => {
  /**
   * 이 커넥터가 최악이다: 0°/180° 에서 격자가 2열 12행으로 서고, 나가는 변의
   * along 간격이 **13px** 까지 좁아진다(같은 자리에 두 핀). 번호 글자 높이가
   * 12px 이라 변 위에 그대로 늘어놓으면 1px 만 남는다 — 그래서 안 그런다.
   */
  it.each(DIRS)('%s° — 겹치는 상자 쌍 = 0', (o) => {
    const items = numBoxes(MF24, o);
    expect(items).toHaveLength(24);
    expect(overlapPairs(items.map((i) => i.box))).toBe(0);
  });

  it.each(DIRS)('%s° — 번호 상자는 제 패드 안에 있다 (겹치지 않는 근거)', (o) => {
    for (const { index, box, g } of numBoxes(MF24, o)) {
      const cell = g.cellOf(index);
      const cx = INSET + cell.x * PITCH;
      const cy = INSET + cell.y * PITCH;
      expect(box.x).toBeGreaterThanOrEqual(cx);
      expect(box.y).toBeGreaterThanOrEqual(cy);
      expect(box.x + box.w).toBeLessThanOrEqual(cx + PAD);
      expect(box.y + box.h).toBeLessThanOrEqual(cy + PAD);
    }
  });

  /**
   * 0° 에서 왼쪽 변의 핸들 순서는 1·13·2·14… 로 엇갈린다. 그 순서대로 읽었을 때
   * 번호가 실제로 서로 다른 자리에 있어야 한다 — 이게 사용자가 못 읽던 그 자리다.
   */
  it('0° 에서 변을 따라 읽은 핀 순서가 1·13·2·14… 이고 번호 자리가 모두 다르다', () => {
    const c = place(MF24, 0);
    const g = connectorLayout(c, MF24);
    const byEdge = [...c.pins].sort((a, b) => g.along(a.index) - g.along(b.index));
    expect(byEdge.slice(0, 6).map((p) => p.index)).toEqual([1, 13, 2, 14, 3, 15]);

    // 이웃한 두 핸들(13px)의 번호는 **다른 열**에 있어 가로로 갈린다
    const b1 = g.pinNumberBox(1, '1');
    const b13 = g.pinNumberBox(13, '13');
    expect(overlaps(b1, b13)).toBe(false);
    expect(b13.x - b1.x).toBe(PITCH);   // 한 칸(30px) 안쪽

    const at = new Set(byEdge.map((p) => {
      const b = g.pinNumberBox(p.index, String(p.index));
      return `${b.x},${b.y}`;
    }));
    expect(at.size).toBe(24);
  });

  /** 표기가 길어도(한글 신호명) 상자는 패드를 넘지 않는다 — 넘으면 옆 칸을 덮는다 */
  it('긴 표기도 패드 폭을 넘지 않는다', () => {
    expect(pinNumberWidth('A1-무정전전원')).toBeLessThanOrEqual(PAD - PIN_NUM_M * 2);
    expect(pinNumberWidth('24')).toBeLessThan(PAD - PIN_NUM_M * 2);
    // 높이는 고정이고 패드(26) 안에 들어간다
    expect(PIN_NUM_H + PIN_NUM_M * 2).toBeLessThanOrEqual(PAD);
  });
});

describe('화면과 PDF 가 같은 번호 자리를 쓴다', () => {
  const doc = (o: Orientation): HarnessDocument => ({
    schemaVersion: 1,
    id: 'doc-1', name: '핀 번호 시험',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    connectors: [place(MF24, o, { x: 100, y: 60 })],
    devices: [], wires: [], usedParts: [MF24],
  });

  it.each(DIRS)('%s° — pdfDraw 의 pad.num 이 geometry.pinNumberBox 와 같다', (o) => {
    const d = doc(o);
    const c = d.connectors[0];
    const p0 = c.positions.logical!;
    const g = connectorLayout(c, MF24);
    const org = housingOrigin(o);
    const n = buildDrawing(d).nodes.find((x) => x.id === c.id)!;

    expect(n.pads).toHaveLength(24);
    expect(overlapPairs(n.pads.map((p) => p.num!))).toBe(0);

    for (const p of n.pads) {
      const idx = Number(p.label);
      const want = g.pinNumberBox(idx, p.label);
      // 논리 절대 좌표 = 노드 자리 + 하우징 원점 + 상자
      expect(p.num).toEqual({
        x: p0.x + org.x + want.x,
        y: p0.y + org.y + want.y,
        w: want.w, h: want.h,
      });
      expect(p.numAlign).toBe(pinNumberAlign(o));
    }
  });
});
