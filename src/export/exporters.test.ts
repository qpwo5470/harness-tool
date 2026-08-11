import { describe, it, expect } from 'vitest';
import { buildPartList, toCsv, buildRunList, runListToCsv } from './exporters';
import { sampleDoc } from '../fixtures/sampleDoc';

describe('buildPartList', () => {
  it('커넥터/와이어/케이블을 집계한다', () => {
    const rows = buildPartList(sampleDoc);
    const connQty = rows.filter((r) => r.category === '커넥터').reduce((n, r) => n + r.qty, 0);
    expect(connQty).toBe(3); // 커넥터 3개
    expect(rows.some((r) => r.category === '와이어')).toBe(true);
    expect(rows.some((r) => r.category === '케이블')).toBe(true);
  });
});

describe('toCsv', () => {
  it('헤더 + 행을 만든다', () => {
    const csv = toCsv(buildPartList(sampleDoc));
    expect(csv.split('\n')[0]).toBe('category,part,qty,detail');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });
});

describe('buildRunList', () => {
  it('와이어별 from-to 와 네트 라벨을 만든다', () => {
    const rows = buildRunList(sampleDoc);
    expect(rows).toHaveLength(3);
    const w1 = rows.find((r) => r.wireId === 'w1')!;
    expect(w1.from).toContain('#'); // 커넥터#핀 형식
    expect(w1.color).toBe('red/white');
    expect(w1.gauge).toBe('AWG22');
    expect(w1.net).toContain('Raspberry Pi'); // 스플라이스 통해 한 네트
  });

  it('접속표 CSV 헤더가 맞다', () => {
    const csv = runListToCsv(buildRunList(sampleDoc));
    expect(csv.split('\n')[0]).toBe('wire,net,from,to,color,gauge,length_mm');
  });
});

describe('터미널(크림프핀) 집계', () => {
  it('배선된 핀 수만큼 터미널이 집계된다', () => {
    const rows = buildPartList(sampleDoc);
    const terms = rows.filter((r) => r.category === '터미널');
    expect(terms.length).toBeGreaterThan(0);
  });

  it('스플라이스는 압착단자를 세지 않는다', () => {
    const rows = buildPartList(sampleDoc);
    const terms = rows.filter((r) => r.category === '터미널');
    expect(terms.some((t) => t.part.includes('스플라이스'))).toBe(false);
  });

  it('하우징 스펙의 터미널명(YST025 등)을 쓴다', () => {
    const doc = {
      ...sampleDoc,
      usedParts: [
        ...sampleDoc.usedParts.filter((p) => p.id !== 'lib-xh-4p'),
        {
          id: 'lib-xh-4p', category: 'housing' as const, name: '연호 SMH250-04',
          spec: { 터미널: 'YST025' }, pinCount: 4,
        },
      ],
    };
    const terms = buildPartList(doc).filter((r) => r.category === '터미널');
    expect(terms.some((t) => t.part === 'YST025')).toBe(true);
  });
});

describe('핀별 터미널 지정 반영', () => {
  const termPart = {
    id: 'lib-yh-yst025', category: 'terminal' as const,
    name: '연호 YST025 터미널 (SMH250용)', mpn: 'YST025',
  };

  it('핀에 지정한 terminalId 가 하우징 스펙보다 우선한다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a'
          ? { ...c, pins: c.pins.map((p) => ({ ...p, terminalId: 'lib-yh-yst025' })) }
          : c,
      ),
      usedParts: [
        ...sampleDoc.usedParts.filter((p) => p.id !== 'lib-xh-4p'),
        { id: 'lib-xh-4p', category: 'housing' as const, name: 'JST XH 4P',
          spec: { 터미널: '다른터미널' }, pinCount: 4 },
        termPart,
      ],
    };
    const terms = buildPartList(doc).filter((r) => r.category === '터미널');
    // con-a의 배선된 핀은 지정한 YST025로 집계되어야 함
    expect(terms.some((t) => t.part.includes('YST025'))).toBe(true);
  });

  it('배선되지 않은 핀의 터미널은 세지 않는다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a'
          ? { ...c, pins: c.pins.map((p) => ({ ...p, terminalId: 'lib-yh-yst025' })) }
          : c,
      ),
      usedParts: [...sampleDoc.usedParts, termPart],
    };
    const terms = buildPartList(doc).filter((r) => r.part.includes('YST025'));
    // con-a는 4핀이지만 실제 배선(w1)은 1개 핀만 사용
    const qty = terms.reduce((n, t) => n + t.qty, 0);
    expect(qty).toBe(1);
  });
});
