/**
 * 형상 기호가 읽는 격자 — 화면에서 확인하기 어려운 부분만 여기서 잡는다.
 *
 * 기호가 틀린 격자를 그리면 2×12 짜리와 1×24 짜리가 같은 그림이 된다. 24핀
 * 커넥터를 두 종류 다 쓰는 시리즈(Micro-Fit·Mini-Fit)에서 이건 실제로 헷갈린다.
 */
import { describe, it, expect } from 'vitest';
import { symbolGrid } from './PartSymbol';
import { SEED_PARTS } from './seed';

describe('형상 기호 격자', () => {
  it('핀맵이 있으면 그 좌표에서 열·행을 읽는다', () => {
    expect(symbolGrid(6, [
      { index: 1, offset: { x: 0, y: 0 } },
      { index: 2, offset: { x: 1, y: 0 } },
      { index: 3, offset: { x: 2, y: 0 } },
      { index: 4, offset: { x: 0, y: 1 } },
      { index: 5, offset: { x: 1, y: 1 } },
      { index: 6, offset: { x: 2, y: 1 } },
    ])).toEqual({ cols: 3, rows: 2 });
  });

  it('핀맵이 없으면 핀 수만큼 한 줄', () => {
    expect(symbolGrid(4)).toEqual({ cols: 4, rows: 1 });
  });

  it('핀 수도 핀맵도 없으면 1칸 — 0으로 나누지 않는다', () => {
    expect(symbolGrid()).toEqual({ cols: 1, rows: 1 });
    expect(symbolGrid(0)).toEqual({ cols: 1, rows: 1 });
  });

  it('2열 24핀과 1열 24핀이 서로 다른 격자로 나온다', () => {
    const dual = SEED_PARTS.find((p) => p.id === 'lib-minifit-5557-24p');
    expect(dual).toBeDefined();
    const g = symbolGrid(dual!.pinCount, dual!.pinLayout);
    expect(g.rows).toBeGreaterThan(1);
    expect(g).not.toEqual(symbolGrid(24));
  });

  it('모든 시드 부품이 유한한 격자를 낸다 — 그리다 터지는 항목이 없다', () => {
    for (const p of SEED_PARTS) {
      const g = symbolGrid(p.pinCount, p.pinLayout);
      expect(Number.isFinite(g.cols) && g.cols >= 1, p.id).toBe(true);
      expect(Number.isFinite(g.rows) && g.rows >= 1, p.id).toBe(true);
      // 격자가 핀 수보다 작으면 안 된다 (핀이 그림 밖으로 나간다는 뜻)
      expect(g.cols * g.rows, p.id).toBeGreaterThanOrEqual(p.pinCount ?? 1);
    }
  });
});
