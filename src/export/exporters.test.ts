import { describe, it, expect } from 'vitest';
import type { HarnessDocument } from '../types';
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

  /**
   * 발주하는 것은 **전선 길이**지 구간 길이가 아니다. 구간은 여러 전선이 함께
   * 지나는 다발이라, 사람이 넣은 구간 길이를 자재에 더하면 같은 전선을 구간
   * 수만큼 다시 세게 된다. 접속표도 마찬가지다 — 현장에서 자르는 것은 전선이다.
   * (구간 길이는 작업 지시용 치수이고, 물리 뷰에만 산다.)
   */
  it('입력한 구간 길이는 파트리스트·접속표를 건드리지 않는다 — 이중 계상 금지', () => {
    const parts = buildPartList(sampleDoc);
    const runs = buildRunList(sampleDoc);
    const withSeg: HarnessDocument = {
      ...sampleDoc,
      segmentLengths: { 'con:con-a|con:sp-1': 5000, 'con:sp-1|dev:dev-1': 4000 },
    };
    expect(buildPartList(withSeg)).toEqual(parts);
    expect(buildRunList(withSeg)).toEqual(runs);
  });
});

// ============================================================
// 와이어 총 길이 — 미입력분을 조용히 0 으로 더하지 않는다
// ============================================================

/** 같은 규격·색 와이어 n 본짜리 문서. `lengths[i] === undefined` 면 미입력 */
function wireDoc(lengths: (number | undefined)[], cables?: HarnessDocument['cables']) {
  return {
    ...sampleDoc,
    cables,
    wires: lengths.map((len, i) => ({
      id: `w${i + 1}`,
      from: { type: 'pin' as const, connectorId: 'con-a', pinId: `a${i + 1}` },
      to: { type: 'pin' as const, connectorId: 'sp-1', pinId: 's1' },
      color: { base: 'red' },
      gauge: { system: 'awg' as const, value: 22 },
      lengthMm: len,
      cableId: cables ? 'cb1' : undefined,
    })),
  };
}

const wireRow = (doc: HarnessDocument) =>
  buildPartList(doc).find((r) => r.category === '와이어')!;

describe('와이어 총 길이', () => {
  it('전부 입력돼 있으면 합만 적는다', () => {
    expect(wireRow(wireDoc([100, 200])).detail).toBe('총 300mm');
  });

  /**
   * 회귀(감사 ④): 예전에는 `w.lengthMm ?? 0` 으로 미입력분을 0 으로 더해
   * `총 300mm · 3본` 이라 찍혔다 — 그 300 은 2본치다. 발주서에서는 이 한 줄이
   * 그대로 수량이 되므로 합계가 몇 본치인지 행에 드러나야 한다.
   */
  it('미입력이 섞이면 몇 본치 합인지와 미입력 본수를 밝힌다', () => {
    const row = wireRow(wireDoc([100, 200, undefined]));
    expect(row.qty).toBe(3);
    expect(row.detail).toBe('총 300mm (2본 기준) · 길이 미입력 1본');
  });

  it('전부 미입력이면 합을 만들지 않는다', () => {
    expect(wireRow(wireDoc([undefined, undefined])).detail).toBe('길이 미입력 2본');
  });

  /**
   * 케이블 심선은 케이블에 딸려 오므로 **전선으로 따로 사지 않는다**
   * (같은 파트리스트의 '케이블' 행에 길이가 이미 잡힌다). 길이를 모르는 것과는
   * 사정이 다르므로 0 으로 뭉개지 않고 본수를 따로 밝힌다.
   */
  it('케이블 심선은 전선 합계에 넣지 않고 본수만 밝힌다', () => {
    const doc = wireDoc([undefined, undefined], [
      { id: 'cb1', name: '2C 전원 케이블', coreCount: 2, lengthMm: 500 },
    ]);
    expect(wireRow(doc).detail).toBe('케이블 심선 2본');
    // 케이블 행에는 그대로 500mm 가 잡힌다 — 이중 계상이 아니다
    expect(buildPartList(doc).find((r) => r.category === '케이블')!.detail).toBe('500mm');
  });
});

describe('접속표 길이', () => {
  it('케이블 심선의 재단 길이는 케이블에서 온다 — 빈 칸으로 두지 않는다', () => {
    // sampleDoc: w2 · w3 는 cbl-1(300mm) 소속이고 개별 길이가 없다
    const rows = buildRunList(sampleDoc);
    const w2 = rows.find((r) => r.wireId === 'w2')!;
    expect(w2.lengthMm).toBe('300');
    expect(w2.lengthSource).toBe('cable');
    expect(rows.find((r) => r.wireId === 'w1')!.lengthSource).toBe('wire');
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

describe('파트리스트 — 결합 성별', () => {
  /** 하우징에 성별을 붙인 문서 */
  const withGender = () => ({
    ...sampleDoc,
    usedParts: sampleDoc.usedParts.map((p) =>
      p.id === 'lib-xh-4p'
        ? { ...p, gender: 'receptacle' as const }
        : p.id === 'lib-b2w-2p'
          ? { ...p, gender: 'header' as const }
          : { ...p, gender: 'neutral' as const },
    ),
  });

  it('커넥터 행에 암수가 실린다 — 발주에서 이게 틀리면 안 된다', () => {
    const rows = buildPartList(withGender()).filter((r) => r.category === '커넥터');
    expect(rows.find((r) => r.part === 'JST XH 2.5 4P')!.detail).toBe('암(리셉터클)');
    expect(rows.find((r) => r.part === 'Board-to-Wire 2P')!.detail).toBe('보드(헤더 · 보드 실장)');
  });

  it('성별 없음(스플라이스)·미지정은 detail 을 만들지 않는다', () => {
    const rows = buildPartList(withGender()).filter((r) => r.category === '커넥터');
    expect(rows.find((r) => r.part === '단순 결선(꼬임)')!.detail).toBeUndefined();

    // 원본 픽스처는 성별이 없다 → 전부 미지정
    const plain = buildPartList(sampleDoc).filter((r) => r.category === '커넥터');
    expect(plain.every((r) => r.detail === undefined)).toBe(true);
  });

  it('CSV 로 내보내도 암수가 detail 열에 남는다', () => {
    const csv = toCsv(buildPartList(withGender()));
    expect(csv).toContain('커넥터,JST XH 2.5 4P,1,암(리셉터클)');
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
