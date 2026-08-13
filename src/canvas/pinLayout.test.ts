/**
 * 핀맵 정의 → 캔버스 기하 회귀 시험.
 *
 * 여기 있는 입력은 전부 **실제로 재현한 결함**에서 그대로 가져왔다:
 *  - offset 이 없는 슬롯 하나에 `connectorLayout` 이 TypeError 로 터졌다(캔버스 전체가 죽는다)
 *  - 음수 offset 이 패드를 하우징 박스 **밖**에 그렸다
 *  - 하우징 정의를 6P→2P 로 줄이면 남은 핀이 박스 밖 좌표를 받았다
 *  - pinCount 와 pinLayout 이 어긋난 부품이 자리 없는 핀을 만들었다
 */
import { describe, it, expect } from 'vitest';
import {
  INSET, PAD, PITCH,
  connectorLayout, gridOf, housingSize, layoutCells, partHousingSize, pinAnchor,
} from './geometry';
import { instantiate } from '../library/seed';
import type { Connector, PartLibraryItem, PinSlot } from '../types';

/** cols×rows 행 우선 배치 (핀맵 에디터가 만드는 모양) */
function grid(cols: number, rows: number, total = cols * rows): PinSlot[] {
  return Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    label: String(i + 1),
    offset: { x: i % cols, y: Math.floor(i / cols) },
  }));
}

const housing = (pinLayout: PinSlot[], over: Partial<PartLibraryItem> = {}): PartLibraryItem => ({
  id: 'custom-h', category: 'housing', name: '시험 하우징',
  pinCount: pinLayout.length, pinLayout, ...over,
});

const place = (part: PartLibraryItem): Connector => instantiate(part, { x: 0, y: 0 });

describe('핀맵 정의가 하우징 심볼로 그대로 나온다', () => {
  it.each([
    ['1핀', 1, 1],
    ['홀수 5핀 1열', 5, 1],
    ['2열 3행', 2, 3],
    ['3열 2행', 3, 2],
    ['24핀 2열', 2, 12],
  ])('%s — 격자와 박스 크기가 정의를 따른다', (_label, cols, rows) => {
    const part = housing(grid(cols, rows));
    const c = place(part);
    const g = connectorLayout(c, part);

    expect(c.pins).toHaveLength(cols * rows);
    expect([g.cols, g.rows]).toEqual([cols, rows]);
    expect({ w: g.boxW, h: g.boxH }).toEqual(housingSize(cols, rows));
    // 패드는 격자 칸 좌표 그대로 — 도면에 정의한 자리에 찍힌다
    expect(g.cellOf(1)).toEqual({ x: 0, y: 0 });
    expect(g.cellOf(cols * rows)).toEqual({ x: cols - 1, y: rows - 1 });
    // 모든 패드가 박스 안에 들어간다
    for (const p of c.pins) {
      const cell = g.cellOf(p.index);
      expect(INSET + cell.x * PITCH + PAD).toBeLessThanOrEqual(g.boxW);
      expect(INSET + cell.y * PITCH + PAD).toBeLessThanOrEqual(g.boxH);
    }
  });

  it('홀수 핀이 2열에 들어가면 마지막 줄이 덜 찬 채로 그려진다 (5핀 2열 3행)', () => {
    const part = housing(grid(2, 3, 5));
    const g = connectorLayout(place(part), part);
    expect([g.cols, g.rows]).toEqual([2, 3]);
    expect(g.cellOf(5)).toEqual({ x: 0, y: 2 });
  });

  it('pinLayout 이 없으면 핀 수만큼 1열로 편다', () => {
    const part: PartLibraryItem = {
      id: 'custom-nolayout', category: 'housing', name: '배치 없음', pinCount: 5,
    };
    const c = place(part);
    const g = connectorLayout(c, part);
    expect(c.pins).toHaveLength(5);
    expect([g.cols, g.rows]).toEqual([5, 1]);
    expect(partHousingSize(part)).toEqual(housingSize(5, 1));
  });
});

describe('방향을 바꾸면 핸들과 배선 앵커가 함께 따라온다', () => {
  const part = housing(grid(2, 2));

  it.each([
    [0 as const, '왼쪽'],
    [90 as const, '위쪽'],
    [180 as const, '오른쪽'],
    [270 as const, '아래쪽'],
  ])('%s° — 앵커가 그 변 위에 선다', (o) => {
    const c: Connector = { ...place(part), orientation: o };
    const g = connectorLayout(c, part);
    const { w, h } = housingSize(g.cols, g.rows);

    for (const p of c.pins) {
      const off = g.handleOffset(p.index);
      if (o === 0) expect(off.x).toBe(0);
      if (o === 180) expect(off.x).toBe(w);
      if (o === 90) expect(off.y).toBe(0);
      if (o === 270) expect(off.y).toBe(h);
      // 변을 따라간 위치는 언제나 박스 안이다
      const along = o === 0 || o === 180 ? off.y : off.x;
      expect(along).toBeGreaterThanOrEqual(0);
      expect(along).toBeLessThanOrEqual(o === 0 || o === 180 ? h : w);
    }
  });

  it('배선 앵커(pinAnchor)가 화면 핸들과 같은 좌표를 낸다', () => {
    for (const o of [0, 90, 180, 270] as const) {
      const c: Connector = { ...place(part), orientation: o };
      const g = connectorLayout(c, part);
      const org = { x: 0, y: o === 90 ? 0 : 17 };   // housingOrigin — 90° 는 라벨이 아래
      for (const p of c.pins) {
        const off = g.handleOffset(p.index);
        const a = pinAnchor(c, part, p.index, { x: 200, y: 100 });
        expect([a.x, a.y]).toEqual([200 + org.x + off.x, 100 + org.y + off.y]);
      }
    }
  });

  it('180°·270° 는 핀 순서가 뒤집혀 보인다', () => {
    const c = place(part);
    expect(connectorLayout(c, part).orderedPins.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    expect(connectorLayout({ ...c, orientation: 180 }, part).orderedPins.map((p) => p.index))
      .toEqual([4, 3, 2, 1]);
  });
});

describe('망가진 pinLayout 을 조용히 받아들이지 않는다', () => {
  it('offset 이 없는 슬롯이 있어도 터지지 않는다 (예전엔 TypeError 로 캔버스가 죽었다)', () => {
    const broken = [
      { index: 1, label: '1' } as unknown as PinSlot,
      { index: 2, label: '2', offset: { x: 1, y: 0 } },
    ];
    const part = housing(broken, { pinCount: 2 });

    expect(layoutCells(broken)).toHaveLength(1);
    expect(() => connectorLayout(place(part), part)).not.toThrow();
    expect(() => partHousingSize(part)).not.toThrow();
    expect(() => pinAnchor(place(part), part, 1, { x: 0, y: 0 })).not.toThrow();
  });

  it('음수 offset 은 배치에서 빠진다 — 패드가 박스 밖에 찍히지 않는다', () => {
    const layout: PinSlot[] = [
      { index: 1, label: '1', offset: { x: -1, y: 0 } },
      { index: 2, label: '2', offset: { x: 0, y: 0 } },
      { index: 3, label: '3', offset: { x: 1, y: 0 } },
    ];
    const part = housing(layout);
    const c = place(part);
    const g = connectorLayout(c, part);

    expect(layoutCells(layout)!.map((s) => s.index)).toEqual([2, 3]);
    for (const p of c.pins) {
      const cell = g.cellOf(p.index);
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(INSET + cell.x * PITCH + PAD).toBeLessThanOrEqual(g.boxW);
      expect(INSET + cell.y * PITCH + PAD).toBeLessThanOrEqual(g.boxH);
    }
  });

  it('슬롯 좌표가 전부 못 쓰는 값이면 1열 기본 배치로 떨어진다', () => {
    const layout = [
      { index: 1, label: '1', offset: { x: -1, y: -1 } },
      { index: 2, label: '2' } as unknown as PinSlot,
    ];
    expect(layoutCells(layout)).toBeUndefined();
    const part = housing(layout, { pinCount: 2 });
    const g = connectorLayout(place(part), part);
    expect(g.rows).toBe(1);
  });

  it('pinCount 와 pinLayout 이 어긋나면 그릴 수 있는 배치를 따른다', () => {
    // 손으로 고친 JSON: 6핀이라 적혀 있는데 배치는 2칸뿐
    const part = housing(grid(2, 1), { pinCount: 6 });
    const c = place(part);
    expect(c.pins).toHaveLength(2);
  });
});

describe('하우징 정의가 줄었는데 옛 핀이 남은 경우', () => {
  /** 6P(3열2행) 로 놓은 커넥터 + 2P 로 줄어든 정의 */
  const shrunk = () => {
    const before = housing(grid(3, 2));
    const conn = place(before);
    const after = housing(grid(2, 1));
    return { conn, after };
  };

  it('남은 핀도 박스 안에, 살아 있는 핀과 겹치지 않게 그린다', () => {
    const { conn, after } = shrunk();
    const g = connectorLayout(conn, after);

    // 정의는 2열 1행이지만 남은 핀 4개를 담을 줄이 아래에 붙는다
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(3);
    expect({ w: g.boxW, h: g.boxH }).toEqual(housingSize(2, 3));

    const seen = new Set<string>();
    for (const p of conn.pins) {
      const cell = g.cellOf(p.index);
      const key = `${cell.x},${cell.y}`;
      expect(seen.has(key)).toBe(false);           // 겹치지 않는다
      seen.add(key);
      expect(INSET + cell.x * PITCH + PAD).toBeLessThanOrEqual(g.boxW);
      expect(INSET + cell.y * PITCH + PAD).toBeLessThanOrEqual(g.boxH);
    }
    // 정의에 있는 1·2번은 제자리
    expect(g.cellOf(1)).toEqual({ x: 0, y: 0 });
    expect(g.cellOf(2)).toEqual({ x: 1, y: 0 });
  });

  it('gridOf 가 정의 밖 핀을 따로 알려 준다', () => {
    const { conn, after } = shrunk();
    const g = gridOf(conn, after);
    expect([...(g.extra?.keys() ?? [])]).toEqual([3, 4, 5, 6]);
  });

  it('배선 앵커도 같은 기하를 쓴다 (핸들이 박스 변 위에 선다)', () => {
    const { conn, after } = shrunk();
    const g = connectorLayout(conn, after);
    for (const p of conn.pins) {
      const a = pinAnchor(conn, after, p.index, { x: 100, y: 100 });
      expect(a.x).toBe(100); // 0° → 왼쪽 변
      expect(a.y).toBeGreaterThanOrEqual(100);
      expect(a.y).toBeLessThanOrEqual(100 + 17 + g.boxH); // REF_BLOCK_H + 박스 높이 안
    }
  });
});
