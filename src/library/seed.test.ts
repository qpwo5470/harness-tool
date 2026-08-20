import { describe, it, expect } from 'vitest';
import { SEED_PARTS, instantiate, suggestedColor } from './seed';
import { GENDERS } from './gender';

const byId = (id: string) => SEED_PARTS.find((p) => p.id === id)!;

describe('MDB 시드', () => {
  it('VMC/주변기기 모두 Molex Mini-Fit Jr 6핀', () => {
    const vmc = byId('lib-mdb-vmc');
    const per = byId('lib-mdb-periph');
    expect(vmc.pinCount).toBe(6);
    expect(per.pinCount).toBe(6);
    expect(vmc.mpn).toBe('39-01-2060');   // 5557 시리즈 플러그
    expect(per.mpn).toBe('39-30-1060');   // 5569 시리즈 소켓
  });

  it('6핀 신호 배치가 전원 2쌍 + 통신 2선', () => {
    const sigs = byId('lib-mdb-vmc').pinLayout!.map((s) => s.signal);
    expect(sigs).toContain('Master Receive');
    expect(sigs).toContain('Master Transmit');
    expect(sigs.filter((s) => s?.includes('34V'))).toHaveLength(2);
    expect(sigs.filter((s) => s?.includes('GND'))).toHaveLength(2);
  });

  it('2열 3핀 배치 (Mini-Fit Jr 6way)', () => {
    const layout = byId('lib-mdb-vmc').pinLayout!;
    expect(new Set(layout.map((s) => s.offset.y)).size).toBe(2);
    expect(new Set(layout.map((s) => s.offset.x)).size).toBe(3);
  });
});

describe('RJ45 시드', () => {
  it('T568B 색상 순서가 표준과 일치', () => {
    const colors = byId('lib-rj45-t568b').pinLayout!.map((s) => s.stdColor);
    expect(colors).toEqual([
      'white/orange', 'orange', 'white/green', 'blue',
      'white/blue', 'green', 'white/brown', 'brown',
    ]);
  });

  it('T568A는 주황/녹색 쌍만 교체됨', () => {
    const a = byId('lib-rj45-t568a').pinLayout!.map((s) => s.stdColor);
    const b = byId('lib-rj45-t568b').pinLayout!.map((s) => s.stdColor);
    expect(a[0]).toBe('white/green');
    expect(b[0]).toBe('white/orange');
    // 4,5,7,8번(파랑/갈색)은 동일
    expect([a[3], a[4], a[6], a[7]]).toEqual([b[3], b[4], b[6], b[7]]);
  });
});

describe('USB 시드', () => {
  it('버전별 핀 수가 규격과 일치', () => {
    expect(byId('lib-usb-a-20').pinCount).toBe(4);   // USB 2.0
    expect(byId('lib-usb-b-20').pinCount).toBe(4);
    expect(byId('lib-usb-mini-b').pinCount).toBe(5); // ID핀 추가
    expect(byId('lib-usb-micro-b').pinCount).toBe(5);
    expect(byId('lib-usb-a-30').pinCount).toBe(9);   // SuperSpeed
    expect(byId('lib-usb-b-30').pinCount).toBe(9);
    expect(byId('lib-usb-c').pinCount).toBe(24);     // Type-C
  });

  it('Type-C는 A열/B열 대칭 24핀', () => {
    const layout = byId('lib-usb-c').pinLayout!;
    expect(layout).toHaveLength(24);
    expect(layout.filter((s) => s.label?.startsWith('A'))).toHaveLength(12);
    expect(layout.filter((s) => s.label?.startsWith('B'))).toHaveLength(12);
    expect(layout.find((s) => s.label === 'A5')?.signal).toBe('CC1');
    expect(layout.find((s) => s.label === 'B5')?.signal).toBe('CC2');
  });

  it('Micro-B 4번은 ID핀', () => {
    expect(byId('lib-usb-micro-b').pinLayout![3].signal).toBe('ID');
  });
});

describe('instantiate', () => {
  it('스플라이스는 모든 핀이 내부 브리지된다', () => {
    const c = instantiate(byId('lib-splice-3'), { x: 0, y: 0 });
    expect(c.kind).toBe('splice');
    expect(c.bridges![0]).toHaveLength(3);
  });

  it('보드투와이어는 kind가 board-to-wire', () => {
    expect(instantiate(byId('lib-rj45-jack'), { x: 0, y: 0 }).kind).toBe('board-to-wire');
  });

  it('MDB 인스턴스는 6핀이 생성된다', () => {
    expect(instantiate(byId('lib-mdb-vmc'), { x: 0, y: 0 }).pins).toHaveLength(6);
  });
});

describe('suggestedColor', () => {
  it('RJ45 1번핀은 white/orange 를 제안', () => {
    expect(suggestedColor(byId('lib-rj45-t568b'), 1)).toBe('white/orange');
  });
  it('MDB 1번핀(+34V)은 red', () => {
    expect(suggestedColor(byId('lib-mdb-vmc'), 1)).toBe('red');
  });
  it('규격 색이 없으면 undefined', () => {
    expect(suggestedColor(byId('lib-xh-4p'), 1)).toBeUndefined();
  });
});

describe('연호전자 시리즈', () => {
  it('SMH250/SMH200/YH396 하우징이 핀수별로 생성된다', () => {
    const smh250 = SEED_PARTS.filter((p) => p.id.startsWith('lib-yh-smh250'));
    const smh200 = SEED_PARTS.filter((p) => p.id.startsWith('lib-yh-smh200'));
    const yh396 = SEED_PARTS.filter((p) => p.id.startsWith('lib-yh-yh396'));
    expect(smh250.length).toBe(7);  // 2,3,4,5,6,8,10P
    expect(smh200.length).toBe(7);
    expect(yh396.length).toBe(6);   // 2,3,4,6,8,10P
  });

  it('피치가 시리즈별로 맞다', () => {
    expect(byId('lib-yh-smh250-4p').spec!.피치).toBe('2.5mm');
    expect(byId('lib-yh-smh200-4p').spec!.피치).toBe('2.0mm');
    expect(byId('lib-yh-yh396-4p').spec!.피치).toBe('3.96mm');
  });

  it('하우징마다 전용 터미널이 명시된다', () => {
    expect(byId('lib-yh-smh250-4p').spec!.터미널).toBe('YST025');
    expect(byId('lib-yh-smh200-4p').spec!.터미널).toBe('YST200');
    expect(byId('lib-yh-yh396-4p').spec!.터미널).toBe('YT396');
  });

  it('MPN이 실제 발주 코드 형식(SMH250-04)이다', () => {
    expect(byId('lib-yh-smh250-4p').mpn).toBe('SMH250-04');
    expect(byId('lib-yh-smh200-10p').mpn).toBe('SMH200-10');
  });

  it('웨이퍼는 보드투와이어이고 스트레이트/앵글이 구분된다', () => {
    const smw = byId('lib-yh-smw250-4p');
    const smaw = byId('lib-yh-smaw250-4p');
    expect(smw.category).toBe('board-to-wire');
    expect(smw.spec!.실장).toBe('스트레이트');
    expect(smaw.spec!.실장).toBe('앵글');
    expect(smw.spec!.결합).toContain('SMH250');
  });

  it('터미널 3종이 등록되어 있다', () => {
    const terms = SEED_PARTS.filter((p) => /^lib-yh-(yst|yt)/.test(p.id));
    expect(terms.map((t) => t.mpn).sort()).toEqual(['YST025', 'YST200', 'YT396']);
    expect(terms.every((t) => t.category === 'terminal')).toBe(true);
  });

  it('연호 하우징도 인스턴스 생성이 된다', () => {
    const c = instantiate(byId('lib-yh-smh250-6p'), { x: 0, y: 0 });
    expect(c.pins).toHaveLength(6);
    expect(c.kind).toBe('connector');
  });
});

// ================================================================
// 결합 성별 (gender)
// ================================================================
describe('결합 성별', () => {
  it('값이 있으면 반드시 네 값 중 하나다', () => {
    for (const p of SEED_PARTS) {
      if (p.gender !== undefined) expect(GENDERS).toContain(p.gender);
    }
  });

  it('연호 3종 세트가 암 · 보드 · 수로 갈린다', () => {
    expect(byId('lib-yh-smh250-4p').gender).toBe('receptacle'); // 하우징(암)
    expect(byId('lib-yh-smw250-4p').gender).toBe('header');     // 웨이퍼(보드)
    expect(byId('lib-yh-smaw250-4p').gender).toBe('header');
    expect(byId('lib-yh-smp250-4p').gender).toBe('plug');       // 전선측 플러그(수)
  });

  it('스플라이스 · 와이어투와이어 · 터미널블럭 · 크림프 터미널은 성별이 없다', () => {
    for (const id of [
      'lib-splice-3', 'lib-splice-4',
      'lib-w2w-2p', 'lib-w2w-4p', 'lib-w2w-6p',
      'lib-terminal-block-2p',
      'lib-minifit-terminal', 'lib-yh-yst025', 'lib-yh-yst200', 'lib-yh-yt396', 'lib-yh-smt025',
    ]) {
      expect(byId(id).gender).toBe('neutral');
    }
    // 터미널은 한 개도 빠짐없이 neutral 이어야 한다
    for (const t of SEED_PARTS.filter((p) => p.category === 'terminal')) {
      expect(t.gender).toBe('neutral');
    }
  });

  it('RJ45 는 플러그(수), 보드 실장 잭·리셉터클은 보드다', () => {
    expect(byId('lib-rj45-t568b').gender).toBe('plug');
    expect(byId('lib-rj45-t568a').gender).toBe('plug');
    expect(byId('lib-rj45-jack').gender).toBe('header');
    expect(byId('lib-usb-c-b2w').gender).toBe('header');
    expect(byId('lib-usb-a-20').gender).toBe('plug');
  });

  it('시리즈가 특정되지 않은 부품은 비워 둔다 — 지어내지 않는다', () => {
    // Mini-Fit 은 5557(암)/5559(수)가 같은 4.2mm 라 이름만으로 못 정한다
    expect(byId('lib-minifit-4p').gender).toBeUndefined();
    expect(byId('lib-molex-2x5').gender).toBeUndefined();
  });
});

// ================================================================
// Molex SPOX 2.50mm — 데이터시트 값 그대로 (35155.pdf / 35312.pdf)
// ================================================================
describe('Molex 35155 (SPOX 2.50mm 하우징)', () => {
  const p = () => byId('lib-spox-35155-3p');

  it('데이터시트 스펙이 그대로 들어 있다', () => {
    expect(p().manufacturer).toBe('Molex');
    expect(p().mpn).toBe('35155-0300');
    expect(p().gender).toBe('receptacle');           // Component Type: Receptacle
    expect(p().spec!.시리즈).toBe('35155');
    expect(p().spec!.설명).toBe('2.50mm Pitch Wire-to-Board Housing, Positive Lock, Natural');
    expect(p().spec!.종류).toBe('Receptacle');
    expect(p().spec!.피치).toBe('2.50mm');
    expect(p().spec!.열).toContain('1');             // Number of Rows: 1
    expect(p().spec!.용도).toBe('Wire-to-Wire');
    expect(p().spec!.결합).toContain('35184');
    expect(p().spec!.결합).toContain('35312');
    expect(p().spec!.터미널).toContain('5103');
    expect(p().spec!.온도).toBe('-40°C ~ +105°C');
    expect(p().spec!.상태).toBe('Not Recommended For New Design');
    expect(p().spec!.비고).toContain('Not Recommended For New Design');
  });

  it('검증된 3 · 4 · 5핀만 있고 품번 규칙은 비고에만 적는다', () => {
    const all = SEED_PARTS.filter((x) => x.id.startsWith('lib-spox-35155'));
    expect(all.map((x) => x.pinCount)).toEqual([3, 4, 5]);
    expect(all.map((x) => x.mpn)).toEqual(['35155-0300', '35155-0400', '35155-0500']);
    // 규칙으로 만들어낸 미검증 품번이 섞이면 안 된다
    expect(all.every((x) => x.pinLayout!.length === x.pinCount)).toBe(true);
    expect(p().spec!.비고).toContain('35155-0N00');
  });
});

describe('Molex 35312 (2.50mm 수직 헤더)', () => {
  const p = () => byId('lib-spox-35312-5p');

  it('데이터시트 스펙이 그대로 들어 있다', () => {
    expect(p().manufacturer).toBe('Molex');
    expect(p().mpn).toBe('35312-0560');
    expect(p().category).toBe('board-to-wire');
    expect(p().gender).toBe('header');               // Component Type: PCB Header
    expect(p().spec!.시리즈).toBe('35312');
    expect(p().spec!.설명).toBe('2.50mm Pitch Header, Vertical, Shrouded, with Positive Lock');
    expect(p().spec!.종류).toBe('PCB Header');
    expect(p().spec!.피치).toBe('2.50mm');
    expect(p().spec!.열).toContain('1');
    expect(p().spec!.용도).toBe('Wire-to-Board');
    expect(p().spec!.결합).toBe('35155');
    expect(p().spec!.정격).toBe('3.0A / 250V');
    expect(p().spec!.재질).toContain('Nylon 66');
    expect(p().spec!.실장).toContain('Through Hole');
    expect(p().spec!.실장).toContain('1.60mm');
    expect(p().spec!.온도).toBe('-40°C ~ +105°C');
    expect(p().spec!.상태).toBe('Not Recommended For New Design');
  });

  it('검증된 5핀 하나만 있다', () => {
    const all = SEED_PARTS.filter((x) => x.id.startsWith('lib-spox-35312'));
    expect(all).toHaveLength(1);
    expect(all[0].pinCount).toBe(5);
    expect(p().spec!.비고).toContain('35312-0N60');
  });
});

// ================================================================
// Molex Micro-Fit 3.0 — 판매도면 430250000-SD 에서 확인한 값만
// ================================================================

describe('Molex Micro-Fit 3.0 (43025 · 43020 · 43030/43031)', () => {
  const rcpt = (n: number) => byId(`lib-mf3-43025-${String(n).padStart(2, '0')}p`);
  const plug = (n: number) => byId(`lib-mf3-43020-${String(n).padStart(2, '0')}p`);

  it('도면이 밝힌 회로 구성 12종이 리셉터클·플러그 양쪽에 있다', () => {
    // 판매도면 표: 02·04·06·08·10·12·14·16·18·20·22·24
    const want = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
    for (const series of ['43025', '43020']) {
      const all = SEED_PARTS.filter((x) => x.id.startsWith(`lib-mf3-${series}-`));
      expect(all.map((x) => x.pinCount)).toEqual(want);
    }
  });

  it('품번은 네 자리 0 채움이다 — 43025-0600 이지 43025-600 이 아니다', () => {
    expect(rcpt(6).mpn).toBe('43025-0600');
    expect(rcpt(24).mpn).toBe('43025-2400');
    expect(plug(2).mpn).toBe('43020-0200');
    // 규칙을 벗어난 품번이 하나라도 섞이면 발주가 틀어진다.
    // 터미널(43030/43031)은 끝자리가 도금·포장을 물어 시리즈 번호만 적으므로 뺀다.
    const housings = SEED_PARTS.filter(
      (x) => x.id.startsWith('lib-mf3-430') && x.category === 'housing',
    );
    expect(housings).toHaveLength(24);
    expect(housings.every((x) => /^430(25|20)-\d{2}00$/.test(x.mpn!))).toBe(true);
    // 터미널은 반대로 **하이픈 뒤가 없어야** 한다 — 확인하지 못한 끝자리를 지어내지 않았다는 뜻
    expect(byId('lib-mf3-43030').mpn).toBe('43030');
    expect(byId('lib-mf3-43031').mpn).toBe('43031');
  });

  it('격자는 2행 × (회로수/2)열 — 도면 치수 B 로 검산한 값', () => {
    // B = (열수 − 1) × 3.00mm : 6회로 B=6.00 → 3열, 24회로 B=33.00 → 12열
    const colsOf = (p: ReturnType<typeof rcpt>) =>
      new Set(p.pinLayout!.map((s) => s.offset!.x)).size;
    const rowsOf = (p: ReturnType<typeof rcpt>) =>
      new Set(p.pinLayout!.map((s) => s.offset!.y)).size;

    expect([colsOf(rcpt(6)), rowsOf(rcpt(6))]).toEqual([3, 2]);
    expect([colsOf(rcpt(24)), rowsOf(rcpt(24))]).toEqual([12, 2]);
    expect([colsOf(plug(10)), rowsOf(plug(10))]).toEqual([5, 2]);
  });

  it('핀 수와 pinLayout 길이가 맞고, 두 핀이 같은 자리에 오지 않는다', () => {
    const all = SEED_PARTS.filter((x) => x.id.startsWith('lib-mf3-430'));
    for (const p of all) {
      if (p.category === 'terminal') continue;
      expect(p.pinLayout!.length).toBe(p.pinCount);
      const seen = new Set(p.pinLayout!.map((s) => `${s.offset!.x},${s.offset!.y}`));
      expect(seen.size).toBe(p.pinCount);
    }
  });

  it('암수가 하우징과 뒤집혀 있다는 사실을 그대로 담는다', () => {
    // 리셉터클 하우징(43025)에 암 터미널(43030), 플러그 하우징(43020)에 수 터미널(43031).
    // 이 뒤집힘이 실제로 잘못 발주되는 자리라 시험으로 못박는다.
    expect(rcpt(6).gender).toBe('receptacle');
    expect(plug(6).gender).toBe('plug');
    expect(rcpt(6).spec!.터미널).toContain('43030');
    expect(plug(6).spec!.터미널).toContain('43031');
    expect(byId('lib-mf3-43030').category).toBe('terminal');
    expect(byId('lib-mf3-43031').category).toBe('terminal');
  });

  it('짝·피치·전선범위가 도면대로 적혀 있다', () => {
    expect(rcpt(8).spec!.피치).toContain('3.00mm');
    expect(rcpt(8).spec!.결합).toContain('43020');   // 도면 주5: 43020, 43045 와 결합
    expect(plug(8).spec!.결합).toContain('43025');
    expect(rcpt(8).spec!.적용전선).toContain('18');
    expect(rcpt(8).spec!.적용전선).toContain('30');
  });

  it('2·4 회로만 풀탭 없음을 적고, 나머지에는 적지 않는다', () => {
    // 도면 주8은 "없는 쪽"만 밝힌다. 나머지에 "있음"이라 쓰면 도면이 말하지 않은 것을 말하는 셈이다.
    expect(rcpt(2).spec!.풀탭).toContain('없');
    expect(rcpt(4).spec!.풀탭).toContain('없');
    expect(rcpt(6).spec!.풀탭).toBeUndefined();
    expect(rcpt(24).spec!.풀탭).toBeUndefined();
  });

  it('확인하지 못한 핀 번호 배열을 아는 척하지 않는다', () => {
    // 2열 중 어느 행이 1..n/2 인지는 도면 그림 안에 있어 확인하지 못했다.
    // 그 사실이 부품 비고에 남아 있어야 사용자가 크림프 전에 확인한다.
    for (const p of [rcpt(6), rcpt(24), plug(10)]) {
      expect(p.spec!.비고).toContain('확인');
      expect(p.spec!.비고).toContain('핀맵 에디터');
    }
    expect(rcpt(6).spec!.회로1표시).toContain('리브');
  });

  it('43045(PCB 헤더)는 넣지 않았다 — 품번 규칙을 확인하지 못해서다', () => {
    // 43045 는 끝 두 자리가 회로 수가 아니라 실장 방향·페그·도금을 문다.
    // 43025 도면만 보고 43045-XX00 을 지어내면 없는 품번이 발주서에 실린다.
    expect(SEED_PARTS.filter((x) => (x.mpn ?? '').startsWith('43045'))).toHaveLength(0);
  });
});

// ================================================================
// 연호 SMP250 — 데이터시트 값 그대로 (SMP250-NN.pdf)
// ================================================================
describe('연호 SMP250 (2.50mm 전선측 플러그)', () => {
  const p = () => byId('lib-yh-smp250-4p');

  it('핀수 02~13 열두 종이 등록된다', () => {
    const all = SEED_PARTS.filter((x) => x.id.startsWith('lib-yh-smp250'));
    expect(all).toHaveLength(12);
    expect(all.map((x) => x.pinCount)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(all.map((x) => x.mpn)).toEqual([
      'SMP250-02', 'SMP250-03', 'SMP250-04', 'SMP250-05', 'SMP250-06', 'SMP250-07',
      'SMP250-08', 'SMP250-09', 'SMP250-10', 'SMP250-11', 'SMP250-12', 'SMP250-13',
    ]);
  });

  it('데이터시트 스펙이 그대로 들어 있다', () => {
    expect(p().manufacturer).toBe('Yeonho Electronics (연호전자)');
    expect(p().gender).toBe('plug');
    expect(p().spec!.종류).toBe('Wire to Wire Connector — Plug');
    expect(p().spec!.피치).toBe('2.50mm');
    expect(p().spec!.열).toBe('1열');
    expect(p().spec!.재질).toBe('Nylon 66, UL94V-0');
    expect(p().spec!.정격).toBe('AC/DC 250V · AC/DC 3A');
    expect(p().spec!.온도).toBe('-25℃ ~ +85℃');
    expect(p().spec!.접촉저항).toBe('30mΩ MAX');
    expect(p().spec!.적용전선).toBe('AWG #22 ~ #28');
    expect(p().spec!.결합).toContain('SMH250');
  });

  it('터미널이 SMH250 의 YST025 가 아니라 SMT025 다', () => {
    expect(p().spec!.터미널).toBe('SMT025');
    expect(byId('lib-yh-smh250-4p').spec!.터미널).toBe('YST025');

    const smt = byId('lib-yh-smt025');
    expect(smt.category).toBe('terminal');
    expect(smt.gender).toBe('neutral');
    expect(smt.mpn).toBe('SMT025');
    expect(smt.spec!.적용).toBe('SMP250 (2.5mm)');
    expect(smt.spec!.비고).toContain('AWG22~28');
  });

  it('플러그도 캔버스 인스턴스가 만들어진다', () => {
    const c = instantiate(p(), { x: 0, y: 0 });
    expect(c.kind).toBe('connector');
    expect(c.pins).toHaveLength(4);
  });
});
