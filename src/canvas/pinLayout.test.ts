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
  connectorLayout, drawGrid, gridOf, housingSize, layoutCells, partHousingSize, pinAnchor,
} from './geometry';
import { instantiate } from '../library/seed';
import type { Connector, Orientation, PartLibraryItem, PinSlot } from '../types';

/** cols×rows 행 우선 배치 (핀맵 에디터가 만드는 모양) */
function grid(cols: number, rows: number, total = cols * rows): PinSlot[] {
  return Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    label: String(i + 1),
    offset: { x: i % cols, y: Math.floor(i / cols) },
  }));
}

const DIRS: Orientation[] = [0, 90, 180, 270];

const housing = (pinLayout: PinSlot[], over: Partial<PartLibraryItem> = {}): PartLibraryItem => ({
  id: 'custom-h', category: 'housing', name: '시험 하우징',
  pinCount: pinLayout.length, pinLayout, ...over,
});

const place = (part: PartLibraryItem): Connector => instantiate(part, { x: 0, y: 0 });

describe('핀맵 정의가 하우징 심볼로 그대로 나온다', () => {
  /**
   * `instantiate` 는 커넥터를 0°(배선이 왼쪽으로) 로 만든다. 나가는 변이 **세로**라
   * 긴 축을 그 변에 붙여 세워 그린다(geometry.drawGrid) — 그래서 정의가 가로로 긴
   * 격자(5×1, 3×2)면 그리는 격자는 전치돼 세로로 길어진다.
   *
   * 예전 이 시험은 `[g.cols, g.rows] === [정의 열, 정의 행]` 을 못박고 있었는데,
   * 그건 "그리는 격자 = 정의 격자" 라는 낡은 전제였다. 그 전제 때문에 1행 N핀
   * 커넥터의 핸들 N 개가 38px 변에 뭉갰다. 정의는 `defCols/defRows` 로 따로 잰다.
   */
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
    // 0° 이므로 긴 축이 세로로 선다
    const drawn = drawGrid(cols, rows, 0);

    expect(c.pins).toHaveLength(cols * rows);
    expect([g.defCols, g.defRows]).toEqual([cols, rows]);            // 정의는 그대로
    expect([g.cols, g.rows]).toEqual([drawn.cols, drawn.rows]);      // 그림만 세운다
    expect(g.cols).toBeLessThanOrEqual(g.rows);                      // 0° → 세로가 길다
    expect({ w: g.boxW, h: g.boxH }).toEqual(housingSize(drawn.cols, drawn.rows));
    // 1번 핀은 언제나 좌상단 — 등록 마크가 "1번 핀 위치"를 가리키기 때문
    expect(g.cellOf(1)).toEqual({ x: 0, y: 0 });
    expect(g.defCellOf(1)).toEqual({ x: 0, y: 0 });
    expect(g.defCellOf(cols * rows)).toEqual({ x: cols - 1, y: rows - 1 });
    expect(g.cellOf(cols * rows)).toEqual({ x: drawn.cols - 1, y: drawn.rows - 1 });
    // 모든 패드가 박스 안에 들어간다
    for (const p of c.pins) {
      const cell = g.cellOf(p.index);
      expect(INSET + cell.x * PITCH + PAD).toBeLessThanOrEqual(g.boxW);
      expect(INSET + cell.y * PITCH + PAD).toBeLessThanOrEqual(g.boxH);
    }
  });

  it('홀수 핀이 2열에 들어가면 마지막 줄이 덜 찬 채로 그려진다 (5핀 2열 3행)', () => {
    // 정의 2열 3행 · 0° — 이미 세로가 길어 전치하지 않는다(그림이 예전과 같다)
    const part = housing(grid(2, 3, 5));
    const g = connectorLayout(place(part), part);
    expect([g.cols, g.rows]).toEqual([2, 3]);
    expect(g.transposed).toBe(false);
    expect(g.cellOf(5)).toEqual({ x: 0, y: 2 });
  });

  it('pinLayout 이 없으면 핀 수만큼 1열로 편다', () => {
    const part: PartLibraryItem = {
      id: 'custom-nolayout', category: 'housing', name: '배치 없음', pinCount: 5,
    };
    const c = place(part);
    const g = connectorLayout(c, part);
    expect(c.pins).toHaveLength(5);
    expect([g.defCols, g.defRows]).toEqual([5, 1]);
    // 0°(왼쪽으로 나감) 이므로 5핀이 세로 한 줄로 선다.
    // 드롭 보정(partHousingSize)도 같은 크기를 내야 커서가 부품 가운데에 온다.
    expect([g.cols, g.rows]).toEqual([1, 5]);
    expect(partHousingSize(part)).toEqual(housingSize(1, 5));
    expect(partHousingSize(part, 90)).toEqual(housingSize(5, 1));
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

/* ============================================================
   격자를 방향에 맞춰 세운다 — 실제 밀도 도면에서 잡은 결함
   ------------------------------------------------------------
   20본(10P·8P·6P + 스플라이스) 도면을 그려 보고 찾았다.
   1행 N핀 커넥터를 좌우(0°/180°)로 두면 예전 구현은 핸들 N 개를 하우징의 **짧은
   변**(1행 = 38px)에 균등 분배했다: 10P 는 3.8px, 20P 는 1.9px 간격. 화면에서
   배선 10본이 한 점에서 나오는 것처럼 붙어 어느 핀인지 구분할 수 없었다.
   레인 분리를 아무리 잘 해도 시작점이 뭉개져 있으면 소용이 없다.
   ============================================================ */
describe('배선이 나가는 변에 핀이 줄지어 선다', () => {
  /** 핀 번호 → 하우징 박스 좌상단 기준 핸들 좌표 */
  const handles = (part: PartLibraryItem, o: Orientation) => {
    const c: Connector = { ...place(part), orientation: o };
    const g = connectorLayout(c, part);
    return { g, list: c.pins.map((p) => ({ index: p.index, at: g.handleOffset(p.index) })) };
  };

  /** 나가는 변을 따라간 좌표만 뽑아 오름차순으로 */
  const alongSorted = (part: PartLibraryItem, o: Orientation) => {
    const { g, list } = handles(part, o);
    const v = list.map(({ at }) => (o === 0 || o === 180 ? at.y : at.x));
    return { g, v: [...v].sort((a, b) => a - b) };
  };

  const gaps = (v: number[]) => v.slice(1).map((x, i) => x - v[i]);

  it.each(DIRS)(
    '1행 10P — %s° 에서 핸들 간격이 전부 PITCH(30px) 다 (예전 0°/180° 는 3.8px)',
    (o) => {
      const part = housing(grid(10, 1));
      const { g, v } = alongSorted(part, o);

      expect(v).toHaveLength(10);
      // 첫 핸들은 첫 패드 가운데(INSET + PAD/2 = 19px), 그다음부터 정확히 30px 씩
      expect(v[0]).toBeCloseTo(INSET + PAD / 2, 9);
      for (const d of gaps(v)) expect(d).toBeCloseTo(PITCH, 9);

      // 나가는 변의 길이가 핀 수에 비례한다 = 뭉갤 자리가 없다
      const edge = o === 0 || o === 180 ? g.boxH : g.boxW;
      expect(edge).toBe(housingSize(10, 1).w);   // 10칸 변 = 308px
      expect(o === 0 || o === 180 ? g.boxW : g.boxH).toBe(housingSize(1, 1).w); // 반대 변 = 38px
    },
  );

  it('1행 20P 도 마찬가지다 (밀도를 두 배로 올려도 식이 버틴다)', () => {
    for (const o of DIRS) {
      const { v } = alongSorted(housing(grid(20, 1)), o);
      expect(v).toHaveLength(20);
      for (const d of gaps(v)) expect(d, `${o}°`).toBeCloseTo(PITCH, 9);
    }
  });

  it.each(DIRS)('2×5 격자 — %s° 에서 행·열이 바뀌어도 자리 수는 5, 깊이는 2', (o) => {
    // 정의: 2열 5행(2×5 몰렉스). 세운 뒤에도 "긴 축 5" 가 나가는 변에 붙는다.
    const part = housing(grid(2, 5));
    const { g, v } = alongSorted(part, o);
    const edgeVertical = o === 0 || o === 180;

    expect([g.defCols, g.defRows]).toEqual([2, 5]);
    expect(edgeVertical ? g.rows : g.cols).toBe(5);   // 변을 따라 5자리
    expect(edgeVertical ? g.cols : g.rows).toBe(2);   // 안쪽으로 2줄

    // 한 자리에 2핀이 겹치므로 간격은 (PAD 안 반칸, 다음 칸) 이 번갈아 나온다.
    // 두 핀이 **같은 자리**에 오지 않는다는 것이 요점이다.
    expect(new Set(v.map((x) => Math.round(x * 100))).size).toBe(10);
    expect(Math.min(...gaps(v))).toBeGreaterThan(0);
    // 같은 rank 끼리는 정확히 PITCH — 자리 자체는 30px 격자를 지킨다
    const rank0 = v.filter((_, i) => i % 2 === 0);
    for (const d of gaps(rank0)) expect(d).toBeCloseTo(PITCH, 9);
  });

  it.each(DIRS)('5×2 격자도 같은 그림이 된다 — %s° (정의를 어느 축으로 적었든)', (o) => {
    const a = connectorLayout({ ...place(housing(grid(2, 5))), orientation: o }, housing(grid(2, 5)));
    const b = connectorLayout({ ...place(housing(grid(5, 2))), orientation: o }, housing(grid(5, 2)));
    expect([a.cols, a.rows]).toEqual([b.cols, b.rows]);
    expect({ w: a.boxW, h: a.boxH }).toEqual({ w: b.boxW, h: b.boxH });
  });

  it('회전해도 핀 index → 핸들 좌표가 1:1 이다 (두 핀이 한 자리에 겹치지 않는다)', () => {
    const parts: [string, PartLibraryItem][] = [
      ['1행 10P', housing(grid(10, 1))],
      ['1열 10P', housing(grid(1, 10))],
      ['2×5', housing(grid(2, 5))],
      ['5×2', housing(grid(5, 2))],
      ['3×3', housing(grid(3, 3))],
      ['홀수 7P 1행', housing(grid(7, 1))],
    ];
    for (const [name, part] of parts) {
      for (const o of DIRS) {
        const { g, list } = handles(part, o);
        const keys = list.map(({ at }) => `${at.x.toFixed(4)},${at.y.toFixed(4)}`);
        expect(new Set(keys).size, `${name} ${o}°`).toBe(list.length);

        // 패드도 겹치지 않는다 (그리는 격자에서도 1:1)
        const cells = list.map(({ index }) => {
          const c = g.cellOf(index);
          return `${c.x},${c.y}`;
        });
        expect(new Set(cells).size, `${name} ${o}° 패드`).toBe(list.length);

        // 핸들은 언제나 나가는 변 위에 있고 박스를 벗어나지 않는다
        for (const { at } of list) {
          if (o === 0) expect(at.x).toBe(0);
          if (o === 180) expect(at.x).toBe(g.boxW);
          if (o === 90) expect(at.y).toBe(0);
          if (o === 270) expect(at.y).toBe(g.boxH);
          const a = o === 0 || o === 180 ? at.y : at.x;
          expect(a).toBeGreaterThan(0);
          expect(a).toBeLessThan(o === 0 || o === 180 ? g.boxH : g.boxW);
        }
      }
    }
  });

  it('정의 격자(저장 데이터)는 방향을 바꿔도 그대로다', () => {
    // types/index.ts 동결 계약 — offset 은 부품 정의 기준이다. 회전은 그릴 때만.
    const part = housing(grid(10, 1));
    const before = JSON.stringify(part.pinLayout);
    for (const o of DIRS) {
      const g = connectorLayout({ ...place(part), orientation: o }, part);
      expect(g.defCellOf(1)).toEqual({ x: 0, y: 0 });
      expect(g.defCellOf(10)).toEqual({ x: 9, y: 0 });
    }
    expect(JSON.stringify(part.pinLayout)).toBe(before);
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
    // 정의(회전 전)가 1행이라는 뜻이다. 그리는 격자는 0°(왼쪽으로 나감)라
    // 세로로 세워지므로 rows 가 2다 — 폴백이 먹었는지는 defRows 로 재야 한다.
    expect(g.defRows).toBe(1);
    expect([g.cols, g.rows]).toEqual([1, 2]);
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
