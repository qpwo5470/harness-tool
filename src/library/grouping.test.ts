/**
 * 라이브러리 그룹 규칙 — **시드에 넣은 부품이 화면에서 사라지지 않게** 붙잡는다.
 *
 * 실제로 난 사고: JST XH·PH 97종을 `seed.ts` 에 넣고 시드 시험까지 통과했는데
 * 라이브러리 패널에서 검색해도 하나도 나오지 않았다. `LibraryPanel.GROUPS` 는
 * 서로 배타적이지 않고 **각자 목록을 거르는** 구조라, 어느 규칙에도 안 걸린 부품은
 * 렌더되는 자리 자체가 없었기 때문이다.
 *
 * 그래서 두 겹으로 막는다.
 *   1) 화면에는 '그룹 미지정' 칸을 두어 빠뜨린 것이 눈에 띄게 한다(숨기지 않는다)
 *   2) 이 시험이 그 칸이 **비어 있어야 한다**고 요구한다 — 새 시리즈를 넣고 그룹
 *      규칙을 잊으면 여기서 먼저 깨진다
 */
import { describe, it, expect } from 'vitest';
import { SEED_PARTS } from './seed';
import { GROUPS } from './LibraryPanel';

/** 어느 그룹에도 안 걸리는 시드 부품 */
const ungrouped = () => SEED_PARTS.filter((p) => !GROUPS.some((g) => g.match(p)));

describe('라이브러리 그룹 규칙', () => {
  it('모든 시드 부품이 어느 한 그룹에는 걸린다', () => {
    const miss = ungrouped().map((p) => `${p.id} (${p.name})`);
    // 실패하면 이 목록이 그대로 "GROUPS 에 규칙을 더하라" 는 지시가 된다
    expect(miss).toEqual([]);
  });

  it('한 부품이 두 그룹에 겹쳐 들어가지 않는다', () => {
    // 겹치면 같은 부품이 목록에 두 번 나와 발주 수량을 오해하게 만든다.
    const dup = SEED_PARTS
      .map((p) => ({ id: p.id, hit: GROUPS.filter((g) => g.match(p)).map((g) => g.label) }))
      .filter((x) => x.hit.length > 1);
    expect(dup).toEqual([]);
  });

  it('새로 넣은 시리즈가 실제로 그룹에 잡힌다', () => {
    // 이번에 사고가 났던 자리 — 대표 품번 하나씩 짚는다
    const labelOf = (id: string) => GROUPS.find((g) => g.match(SEED_PARTS.find((p) => p.id === id)!))?.label;
    expect(labelOf('lib-jst-xhp-10p')).toBe('JST XH (2.5mm)');
    expect(labelOf('lib-jst-phr-6p')).toBe('JST PH (2.0mm)');
    expect(labelOf('lib-mf3-43025-06p')).toBe('Molex Micro-Fit 3.0 (3.0mm)');
    expect(labelOf('lib-minifit-5557-06p')).toBe('Molex Mini-Fit Jr (4.2mm)');
  });
});
