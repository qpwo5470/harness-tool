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
  compareInSeries, displayName, searchTagsOf, isStandaloneLug, isCanvasPlaceable,
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

  it('압착 러그는 하우징 컨택트와 다른 계열에 산다', () => {
    /*
     * 컨택트는 하우징과 짝이라 시리즈 안에 살고, 러그는 짝이 볼트/탭이라 축이 다르다.
     * 섞어 두면 "SMH250 단자는 어디" 가 다시 답이 없어진다.
     */
    const lugs = SEED_PARTS.filter((p) => p.id.startsWith('lib-lug-'));
    expect(lugs.length).toBeGreaterThan(20);
    for (const p of lugs) {
      expect(seriesOf(p)?.family, p.id).toBe('lug');
      // 역할 표시는 '압착단자' 그대로다 — 캔버스에 놓느냐는 그것과 다른 축이고
      // `isCanvasPlaceable` 이 따로 판정한다(아래 describe).
      expect(roleOf(p).key, p.id).toBe('terminal');
    }
    // 하우징 컨택트는 반대로 러그 계열에 들어오면 안 된다
    const contact = SEED_PARTS.find((p) => p.id === 'lib-jst-sxh-001t')!;
    expect(seriesOf(contact)?.family).toBe('crimp');
  });

  it('REC · Y 로 검색된다 — 부품 이름에 그 글자가 없어도', () => {
    // 이름은 "파스톤 250 REC (암)" 이라 REC 는 이름에도 있지만, Y 는 "Y형(포크)" 뿐이라
    // 태그가 없으면 "Y" 한 글자로는 안 잡힌다. 실제로 그렇게 부르니 태그로 받는다.
    const rec = SEED_PARTS.find((p) => p.id === 'lib-lug-faston-250-rec')!;
    expect(searchTagsOf(rec)).toContain('REC');
    expect(searchTagsOf(rec)).toContain('파스톤');
    const fork = SEED_PARTS.find((p) => p.id === 'lib-lug-fork-2-4')!;
    expect(searchTagsOf(fork)).toContain('Y');
    expect(searchTagsOf(fork)).toContain('포크');
  });

  it('러그는 제조사 품번을 지어내지 않았다', () => {
    /*
     * 러그는 규격 호칭(`2-4` = 2sq·M4)으로 발주가 통하므로 mpn 에는 호칭만 넣었다.
     * 제조사 카탈로그 번호를 지어내면 그대로 발주서에 실린다 — 비워 두고 그렇게 적었다.
     */
    for (const p of SEED_PARTS.filter((x) => x.id.startsWith('lib-lug-'))) {
      expect(p.manufacturer, p.id).toBeUndefined();
      expect(p.spec?.['제조사품번'], p.id).toBe('미정');
      expect(p.mpn, p.id).toBeTruthy();  // 호칭은 있어야 발주가 된다
    }
  });

  it('페룰은 러그와 호칭 체계가 다르다 — E<단면적><길이>', () => {
    /*
     * 페룰은 속 빈 원통이라 스터드에 붙지 않는다. 그래서 러그 호칭(`2-4` = 2sq·M4)이
     * 성립하지 않고 DIN 46228-4 의 `E0508`(0.5mm²·8mm)을 쓴다.
     * 처음에 러그 호칭으로 적었다가 고친 자리라 시험으로 잡아 둔다.
     */
    const fer = SEED_PARTS.filter((p) => p.id.startsWith('lib-lug-ferrule-'));
    expect(fer.length).toBeGreaterThan(10);
    for (const p of fer) {
      expect(p.mpn, p.id).toMatch(/^E\d{4}$/);        // E0508 꼴
      expect(p.mpn, p.id).not.toMatch(/-/);            // 러그 호칭(1.25-3)이 섞이면 안 된다
      expect(p.spec?.['통길이'], p.id).toBeTruthy();
    }
    // 목깃 색은 규격이 갈려서 단정하지 않는다 — 색으로 굵기를 읽으면 안 된다는 경고가 있어야 한다
    expect(fer[0].spec?.['비고']).toContain('구매처에서 확인');
  });

  it('단자대는 형식마다 필요한 단자를 적어 둔다', () => {
    /*
     * 하네스에서 단자대가 중요한 이유는 극수가 아니라 **결선 방식**이다 —
     * 그게 전선 끝에 러그를 붙일지 페룰을 붙일지를 정한다. 그 대응이 부품에 없으면
     * 단자대를 골라도 전선 끝단은 여전히 미정으로 남는다.
     */
    const tbs = SEED_PARTS.filter((p) => p.id.startsWith('lib-tb-'));
    expect(tbs.length).toBeGreaterThan(20);
    for (const p of tbs) {
      expect(p.spec?.['필요단자'], p.id).toBeTruthy();
      expect(p.spec?.['형식'], p.id).toBeTruthy();
      expect(seriesOf(p)?.family, p.id).toBe('generic');
      expect(roleOf(p).key, p.id).toBe('board');
    }
    // 스터드식은 러그를, 스프링식은 페룰을 가리켜야 한다
    const barrier = SEED_PARTS.find((p) => p.id.startsWith('lib-tb-barrier-'))!;
    expect(barrier.spec!['필요단자']).toMatch(/링|Y형/);
    const spring = SEED_PARTS.find((p) => p.id.endsWith('-spring'))!;
    expect(spring.spec!['필요단자']).toContain('페룰');
  });

  it('파스톤은 암(REC)과 수(TAB)가 짝으로 있다', () => {
    // 한쪽만 있으면 짝을 못 찾아 발주가 반쪽이 된다.
    for (const size of ['110', '187', '250']) {
      const rec = SEED_PARTS.find((p) => p.id === `lib-lug-faston-${size}-rec`);
      const tab = SEED_PARTS.find((p) => p.id === `lib-lug-faston-${size}-tab`);
      expect(rec, size).toBeDefined();
      expect(tab, size).toBeDefined();
      expect(rec!.spec?.['결합']).toContain('TAB');
      expect(tab!.spec?.['결합']).toContain('REC');
    }
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

/**
 * 캔버스에 놓을 수 있느냐 — `category: 'terminal'` 안의 **두 부류를 가르는 선**.
 *
 * 하우징 컨택트는 하우징에 딸린 부속이라 도면 요소가 아니고, 러그는 전선 끝에
 * 압착해 그대로 붙는 종단이라 도면 요소다. 선이 흐려지면 두 방향으로 다 틀린다 —
 * 러그를 못 놓으면 커넥터 없는 하네스를 그릴 수 없고, 컨택트를 놓으면 하우징
 * 없이 떠 있는 핀이 도면에 생기고 발주가 두 벌이 된다.
 */
describe('캔버스에 놓을 수 있는 부품', () => {
  const lugs = SEED_PARTS.filter((p) => p.id.startsWith('lib-lug-'));

  it('압착 러그 전부가 단독 배치 대상이다', () => {
    expect(lugs.length).toBeGreaterThan(20);
    for (const p of lugs) {
      expect(isStandaloneLug(p), p.id).toBe(true);
      expect(isCanvasPlaceable(p), p.id).toBe(true);
    }
  });

  it('하우징 컨택트는 여전히 놓을 수 없다', () => {
    // 하우징 안에 들어가는 부속이다 — 놓을 자리가 도면에 없다.
    for (const id of ['lib-jst-sxh-001t', 'lib-yh-yst025', 'lib-minifit-5556']) {
      const p = SEED_PARTS.find((x) => x.id === id);
      expect(p, id).toBeDefined();
      expect(isStandaloneLug(p!), id).toBe(false);
      expect(isCanvasPlaceable(p!), id).toBe(false);
    }
  });

  it('러그가 아닌 `terminal` 은 하나도 새어 나가지 않는다', () => {
    // 계열이 근거이므로, 시드에 컨택트를 더하면서 실수로 `lib-lug-` id 를 쓰지
    // 않는 한 이 관계는 저절로 유지된다. 그 관계 자체를 못박는다.
    const blocked = SEED_PARTS.filter((p) => p.category === 'terminal' && !isCanvasPlaceable(p));
    expect(blocked.length).toBeGreaterThan(0);
    for (const p of blocked) expect(seriesOf(p)?.family, p.id).not.toBe('lug');
  });

  it('하우징·단자대·스플라이스는 예전 그대로 놓을 수 있다', () => {
    for (const p of SEED_PARTS.filter((x) => x.category !== 'terminal')) {
      expect(isCanvasPlaceable(p), p.id).toBe(true);
    }
  });

  it('러그는 전선 한 본이 들어간다 — 핀이 1개다', () => {
    // `instantiate` 가 `pinCount ?? 2` 라, 비워 두면 핀 두 개짜리 러그가 생긴다.
    for (const p of lugs) expect(p.pinCount, p.id).toBe(1);
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
