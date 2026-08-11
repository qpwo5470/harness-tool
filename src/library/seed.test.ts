import { describe, it, expect } from 'vitest';
import { SEED_PARTS, instantiate, suggestedColor } from './seed';

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
