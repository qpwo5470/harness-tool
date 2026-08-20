/**
 * 분류 체계 — **시드에 넣은 부품이 화면에서 사라지지 않게** 붙잡는다.
 *
 * 실제로 난 사고: JST XH·PH 97종을 `seed.ts` 에 넣고 시드 시험까지 통과했는데
 * 라이브러리 패널에서 검색해도 하나도 나오지 않았다. 목록은 시리즈별로 각자
 * 거르는 구조라, 어느 규칙에도 안 걸린 부품은 렌더되는 자리 자체가 없었기 때문이다.
 *
 * 그래서 두 겹으로 막는다.
 *   1) 화면에는 '분류 미지정' 칸을 두어 빠뜨린 것이 눈에 띄게 한다(숨기지 않는다)
 *   2) 이 시험이 그 칸이 **비어 있어야 한다**고 요구한다
 *
 * 여기에 더해 분류가 **체계로 남아 있는지**도 지킨다 — 축이 하나뿐인지, 계열마다
 * 시리즈가 제자리인지. 예전 그룹 목록은 용도(MDB)·제조사(연호)·형태(범용 하우징)가
 * 한 줄에 섞여 있었고, 그래서 "SMH250 단자는 어느 칸이냐" 에 답이 없었다.
 */
import { describe, it, expect } from 'vitest';
import { SEED_PARTS } from './seed';
import {
  FAMILIES, SERIES, SERIES_ORDERED, seriesOf, seriesLabel, roleOf,
  compareInSeries, displayName, searchTagsOf,
} from './taxonomy';

describe('분류 — 빠짐·겹침', () => {
  it('모든 시드 부품이 어느 한 시리즈에는 걸린다', () => {
    const miss = SEED_PARTS.filter((p) => !seriesOf(p)).map((p) => `${p.id} (${p.name})`);
    // 실패하면 이 목록이 그대로 "SERIES 에 규칙을 더하라" 는 지시가 된다
    expect(miss).toEqual([]);
  });

  it('한 부품이 두 시리즈에 겹쳐 들어가지 않는다', () => {
    // 겹치면 같은 부품이 목록에 두 번 나와 발주 수량을 오해하게 만든다.
    const dup = SEED_PARTS
      .map((p) => ({ id: p.id, hit: SERIES.filter((s) => s.match(p.id)).map((s) => s.key) }))
      .filter((x) => x.hit.length > 1);
    expect(dup).toEqual([]);
  });

  it('빈 시리즈가 없다 — 규칙만 남고 부품이 사라진 칸을 잡는다', () => {
    const empty = SERIES.filter((s) => !SEED_PARTS.some((p) => s.match(p.id))).map((s) => s.key);
    expect(empty).toEqual([]);
  });
});

describe('분류 — 체계', () => {
  it('시리즈의 계열은 모두 FAMILIES 에 있는 값이다', () => {
    const known = new Set(FAMILIES.map((f) => f.key));
    expect(SERIES.filter((s) => !known.has(s.family))).toEqual([]);
  });

  it('시리즈 키가 유일하다', () => {
    const keys = SERIES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('압착 커넥터 계열은 제조사와 피치가 반드시 있다', () => {
    // 이 계열의 정체성이 "제조사 · 시리즈 · 피치" 세 조각이다. 하나라도 비면
    // 머리글의 자리가 어긋나 목록을 훑는 눈이 걸린다.
    const bad = SERIES.filter((s) => s.family === 'crimp' && (!s.maker || s.pitchMm == null));
    expect(bad.map((s) => s.key)).toEqual([]);
  });

  it('머리글은 계열 → 제조사 → 피치 순으로 정렬된다', () => {
    const crimp = SERIES_ORDERED.filter((s) => s.family === 'crimp');
    expect(crimp.map(seriesLabel)).toEqual([
      'JST · PH · 2.00mm',
      'JST · XH · 2.50mm',
      'Molex · SPOX · 2.50mm',
      'Molex · Micro-Fit 3.0 · 3.00mm',
      'Molex · Mini-Fit Jr. · 4.20mm',
      '연호전자 · SMH200 · SMW200 · 2.00mm',
      '연호전자 · SMH250 · SMP250 · 2.50mm',
      '연호전자 · YH396 · 3.96mm',
    ]);
  });

  it('한 시리즈 안에 하우징·헤더·단자가 함께 산다', () => {
    /*
     * 이게 이 분류의 핵심 규칙이다. 하네스는 양 끝이 있어야 그려지고 압착단자까지
     * 골라야 발주가 되므로, 역할로 칸을 쪼개면 한 벌을 세 군데서 주워 모아야 한다.
     * (예전 '연호 터미널' 그룹이 정확히 그 문제였다)
     */
    const rolesIn = (key: string) =>
      new Set(SEED_PARTS.filter((p) => seriesOf(p)?.key === key).map((p) => roleOf(p).key));
    for (const key of ['jst-xh', 'jst-ph', 'yeonho-250', 'molex-minifit']) {
      expect(rolesIn(key), key).toEqual(new Set(['wire', 'board', 'terminal']));
    }
  });

  it('보드 실장 헤더는 category 가 housing 이라도 보드측으로 읽는다', () => {
    /*
     * `lib-mdb-periph`(Molex 39-30-1060) 이 그런 항목이다 — 시드 주석에 판매도면
     * 55690002-SD 를 근거로 "Right Angle Header, 보드 실장" 이라 적혀 있고
     * `gender: 'header'` 도 그렇게 박혀 있는데, `category` 만 `'housing'` 이다.
     * 목록에서 이게 전선측으로 보이면 짝을 거꾸로 발주한다.
     */
    const periph = SEED_PARTS.find((p) => p.id === 'lib-mdb-periph')!;
    expect(periph.category).toBe('housing');   // 문서 모델은 그대로 둔다
    expect(periph.gender).toBe('header');
    expect(roleOf(periph).key).toBe('board');  // 표시는 보드측
  });

  it('MDB 부품은 따로 살지 않고 Mini-Fit Jr 안에 있다', () => {
    // 실물이 Mini-Fit Jr(39-01-2060 = 5557-06R) 이므로 용도로 칸을 또 파지 않는다.
    // 대신 태그로 검색된다 — 그 두 가지가 함께 성립해야 한다.
    const vmc = SEED_PARTS.find((p) => p.id === 'lib-mdb-vmc')!;
    expect(seriesOf(vmc)?.key).toBe('molex-minifit');
    expect(searchTagsOf(vmc)).toContain('MDB');
    expect(searchTagsOf(vmc)).toContain('자판기');
  });

  it('예전 그룹에 있던 대표 품번이 새 분류에서도 제자리다', () => {
    const at = (id: string) => seriesOf(SEED_PARTS.find((p) => p.id === id)!)?.key;
    expect(at('lib-jst-xhp-10p')).toBe('jst-xh');
    expect(at('lib-jst-phr-6p')).toBe('jst-ph');
    expect(at('lib-mf3-43025-06p')).toBe('molex-microfit');
    expect(at('lib-minifit-5557-06p')).toBe('molex-minifit');
    expect(at('lib-spox-35155-3p')).toBe('molex-spox');
    // 예전에는 '연호 터미널' 이라는 별도 칸에 있어서 짝을 찾기 어려웠던 것들
    expect(at('lib-yh-yst025')).toBe('yeonho-250');
    expect(at('lib-yh-yst200')).toBe('yeonho-200');
    expect(at('lib-yh-yt396')).toBe('yeonho-396');
    expect(at('lib-yh-smw250-2p')).toBe('yeonho-250');
    // 품번 없는 초기 항목은 구 항목 칸으로
    expect(at('lib-xh-4p')).toBe('legacy');
    expect(at('lib-minifit-4p')).toBe('legacy');
    expect(at('lib-molex-2x5')).toBe('legacy');
  });
});

describe('시리즈 안 정렬', () => {
  it('역할 → 핀 수 순이다', () => {
    const xh = SEED_PARTS.filter((p) => seriesOf(p)?.key === 'jst-xh').sort(compareInSeries);
    const roles = xh.map((p) => roleOf(p).key);
    // 전선측이 먼저, 단자가 마지막
    expect(roles[0]).toBe('wire');
    expect(roles[roles.length - 1]).toBe('terminal');
    // 같은 역할 안에서는 핀 수가 오름차순 (24회로가 2회로 위에 오면 눈이 되짚는다)
    const wirePins = xh.filter((p) => roleOf(p).key === 'wire').map((p) => p.pinCount ?? 0);
    expect(wirePins).toEqual([...wirePins].sort((a, b) => a - b));
  });
});

describe('표시 이름', () => {
  it('머리글이 이미 말한 제조사만 뗀다', () => {
    const p = SEED_PARTS.find((x) => x.id === 'lib-minifit-5557-06p')!;
    expect(p.name).toContain('Molex'); // 원본은 그대로 — 발주서에 나가는 값이다
    expect(displayName(p)).toBe('39-01-2060 Mini-Fit Jr 5557 리셉터클 (6회로)');
  });

  it('연호는 시드 표기가 "연호 " 라 그것도 받는다', () => {
    const p = SEED_PARTS.find((x) => x.id === 'lib-yh-smh250-2p')!;
    expect(displayName(p)).toBe('SMH250-02 (2P)');
  });

  it('시리즈 이름까지 떼지는 않는다 — XHP-4 와 PHR-4 가 같아 보이면 안 된다', () => {
    const xh = SEED_PARTS.find((x) => x.id === 'lib-jst-xhp-4p')!;
    const ph = SEED_PARTS.find((x) => x.id === 'lib-jst-phr-4p')!;
    expect(displayName(xh)).not.toBe(displayName(ph));
  });

  it('빈 이름을 만들지 않는다', () => {
    expect(SEED_PARTS.filter((p) => !displayName(p).trim())).toEqual([]);
  });
});
