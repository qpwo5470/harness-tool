/**
 * 설계 검증 규칙 테스트.
 *
 * 규칙마다 최소 하나씩 + **정상 문서에서 아무것도 뜨지 않는지**를 같이 본다.
 * 오탐이 한 번 나기 시작하면 사람은 목록 전체를 무시하고, 그때부터 검증은 없는 것과 같다.
 */
import { describe, it, expect } from 'vitest';
import type { HarnessDocument, PartLibraryItem, Wire } from '../types';
import { validateHarness } from './validate';
import { statsOf } from './kit';
import { sampleDoc } from '../fixtures/sampleDoc';
import { rowOfConnectorsDoc } from '../fixtures/rowOfConnectors';
import { buildPhysicalModel } from '../physical/segments';

// ================================================================
// 픽스처 — 문제 없는 하네스 하나
//   J1 JST XH 4P (4핀, 규격 색 없음) ↔ J2 RJ45 (2핀, T568B 규격 색)
//   두 배선 모두 터미널 · 길이 · 규격 색이 맞다.
// ================================================================

const housing4: PartLibraryItem = {
  id: 'h4',
  category: 'housing',
  name: 'JST XH 2.5 4P',
  pinCount: 4,
  pinLayout: [1, 2, 3, 4].map((i) => ({ index: i, label: String(i), offset: { x: i - 1, y: 0 } })),
};

const rj45: PartLibraryItem = {
  id: 'rj',
  category: 'housing',
  name: 'RJ45 8P8C (T568B)',
  pinCount: 2,
  pinLayout: [
    { index: 1, label: '1', offset: { x: 0, y: 0 }, signal: 'TX+', stdColor: 'white/orange' },
    { index: 2, label: '2', offset: { x: 1, y: 0 }, signal: 'TX-', stdColor: 'orange' },
  ],
};

const spliceItem: PartLibraryItem = {
  id: 'sp', category: 'splice', name: '스플라이스 3 (꼬임)', pinCount: 3,
};

const terminal: PartLibraryItem = { id: 't1', category: 'terminal', name: '연호 YST025' };

const CLEAN: HarnessDocument = {
  schemaVersion: 1,
  id: 'doc-clean',
  name: '정상 하네스',
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T00:00:00Z',
  connectors: [
    {
      id: 'c1', kind: 'connector', housingId: 'h4', orientation: 0,
      positions: { logical: { x: 0, y: 0 } },
      pins: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, index: i, label: String(i), terminalId: 't1' })),
    },
    {
      id: 'c2', kind: 'connector', housingId: 'rj', orientation: 0,
      positions: { logical: { x: 300, y: 0 } },
      pins: [1, 2].map((i) => ({ id: `q${i}`, index: i, label: String(i), terminalId: 't1' })),
    },
  ],
  devices: [],
  wires: [
    {
      id: 'w1',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
      to: { type: 'pin', connectorId: 'c2', pinId: 'q1' },
      color: { base: 'white', stripe: 'orange' },
      gauge: { system: 'awg', value: 22 },
      lengthMm: 200,
    },
    {
      id: 'w2',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p2' },
      to: { type: 'pin', connectorId: 'c2', pinId: 'q2' },
      color: { base: 'orange' },
      gauge: { system: 'awg', value: 22 },
      lengthMm: 200,
    },
  ],
  usedParts: [housing4, rj45, spliceItem, terminal],
};

const clean = (): HarnessDocument => structuredClone(CLEAN);

/** 특정 규칙의 이슈만 */
const only = (doc: HarnessDocument, id: string) =>
  validateHarness(doc).filter((i) => i.id === id);

const wire = (w: Partial<Wire> & Pick<Wire, 'id' | 'from' | 'to'>): Wire => ({
  color: { base: 'black' },
  gauge: { system: 'awg', value: 22 },
  lengthMm: 100,
  ...w,
});

// ================================================================
// 오탐 없음
// ================================================================

describe('validateHarness — 정상 문서', () => {
  it('문제 없는 문서에서는 아무것도 지적하지 않는다', () => {
    expect(validateHarness(clean())).toEqual([]);
  });

  it('배선되지 않은 여분 핀(#3 #4)은 지적하지 않는다 — 안 쓰는 핀은 잘못이 아니다', () => {
    const doc = clean();
    // #3 #4 는 터미널을 지워도 배선이 없으므로 발주에 영향이 없다
    doc.connectors[0].pins[2].terminalId = undefined;
    doc.connectors[0].pins[3].terminalId = undefined;
    expect(validateHarness(doc)).toEqual([]);
  });

  it('기존 샘플 문서에서 새 규칙이 엉뚱한 것을 잡지 않는다', () => {
    const ids = new Set(validateHarness(sampleDoc).map((i) => i.id));
    // 샘플은 터미널·길이만 비어 있는 문서다 (스플라이스 3가닥 · 중복 · 자기연결 없음)
    expect(ids).toEqual(new Set(['terminal-missing', 'length-missing']));
  });

  it('배선 200본 규모에서도 오탐 없이 끝난다', () => {
    const doc = clean();
    doc.connectors = [
      {
        id: 'big', kind: 'connector', housingId: 'big-h', orientation: 0,
        positions: { logical: { x: 0, y: 0 } },
        pins: Array.from({ length: 400 }, (_, i) => ({
          id: `bp${i + 1}`, index: i + 1, label: String(i + 1), terminalId: 't1',
        })),
      },
    ];
    doc.usedParts = [
      { id: 'big-h', category: 'housing', name: '대형 하우징 400P', pinCount: 400 },
      terminal,
    ];
    doc.wires = Array.from({ length: 200 }, (_, i) => wire({
      id: `bw${i}`,
      from: { type: 'pin', connectorId: 'big', pinId: `bp${i * 2 + 1}` },
      to: { type: 'pin', connectorId: 'big', pinId: `bp${i * 2 + 2}` },
    }));
    // 전부 같은 커넥터 안이라 자기연결 200건만 나와야 한다 (그 외 오탐 없음)
    const ids = new Set(validateHarness(doc).map((i) => i.id));
    expect(ids).toEqual(new Set(['self-loop']));
  });
});

// ================================================================
// 규칙별
// ================================================================

describe('1. 핀 수 초과', () => {
  it('하우징 핀 범위를 넘는 자리에 배선하면 error', () => {
    const doc = clean();
    doc.connectors[0].pins[0].index = 9;         // 4핀 하우징의 9번 자리
    const [issue] = only(doc, 'pin-overflow');
    expect(issue.level).toBe('error');
    expect(issue.targetId).toBe('c1');
    expect(issue.where).toContain('J1');
    expect(issue.detail).toContain('4핀');
  });

  it('배선되지 않은 핀이면 범위를 넘어도 지적하지 않는다', () => {
    const doc = clean();
    doc.connectors[0].pins[3].index = 9;         // #4 는 배선이 없다
    expect(only(doc, 'pin-overflow')).toHaveLength(0);
  });
});

describe('2. 한 핀에 여러 배선', () => {
  it('한 핀에 두 가닥이 물리면 warn 이고 몇 가닥인지 밝힌다', () => {
    const doc = clean();
    doc.wires.push(wire({
      id: 'w3',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
      to: { type: 'pin', connectorId: 'c2', pinId: 'q1' },  // q1 은 w1 이 이미 쓴다
      color: { base: 'white', stripe: 'orange' },
    }));
    const found = only(doc, 'pin-multi-wire');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('2가닥');
    expect(found[0].targetId).toBe('c2');
  });

  it('스플라이스는 여러 가닥이 모이는 자리라 지적하지 않는다', () => {
    const doc = clean();
    doc.connectors.push({
      id: 'sp1', kind: 'splice', housingId: 'sp', orientation: 0,
      positions: { logical: { x: 150, y: 100 } },
      pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i })),
      bridges: [['s1', 's2', 's3']],
    });
    doc.wires.push(
      wire({
        id: 'w3',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's1' },
      }),
      wire({
        id: 'w4',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p4' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's1' },  // 같은 스플라이스 핀
      }),
      wire({
        id: 'w5',
        from: { type: 'pin', connectorId: 'sp1', pinId: 's2' },
        to: { type: 'device', deviceId: 'd1', terminal: '5V' },
      }),
    );
    doc.devices.push({ id: 'd1', name: 'Raspberry Pi', terminals: ['5V'], positions: {} });
    expect(only(doc, 'pin-multi-wire')).toHaveLength(0);
  });
});

describe('3. 터미널 미지정', () => {
  it('배선된 핀에 터미널이 없으면 error 이고 statsOf 와 개수가 같다', () => {
    const doc = clean();
    doc.connectors[0].pins[0].terminalId = undefined;
    doc.connectors[0].pins[1].terminalId = undefined;
    const [issue] = only(doc, 'terminal-missing');
    expect(issue.level).toBe('error');
    expect(issue.title).toContain('2핀');
    expect(issue.targetId).toBe('c1');
    expect(statsOf(doc).missingTerminal).toBe(2);
  });

  it('스플라이스는 압착 단자가 없으므로 제외한다', () => {
    const doc = clean();
    doc.connectors.push({
      id: 'sp1', kind: 'splice', housingId: 'sp', orientation: 0,
      positions: { logical: { x: 150, y: 100 } },
      pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i })),   // terminalId 없음
      bridges: [['s1', 's2', 's3']],
    });
    doc.wires.push(
      wire({
        id: 'w3',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's1' },
      }),
      wire({
        id: 'w4',
        from: { type: 'pin', connectorId: 'sp1', pinId: 's2' },
        to: { type: 'pin', connectorId: 'c2', pinId: 'q2' },
      }),
      wire({
        id: 'w5',
        from: { type: 'pin', connectorId: 'sp1', pinId: 's3' },
        to: { type: 'pin', connectorId: 'c1', pinId: 'p4' },
      }),
    );
    expect(only(doc, 'terminal-missing')).toHaveLength(0);
  });
});

describe('4. 길이 미입력', () => {
  it('길이가 없으면 error', () => {
    const doc = clean();
    doc.wires[0].lengthMm = undefined;
    const [issue] = only(doc, 'length-missing');
    expect(issue.level).toBe('error');
    expect(issue.targetId).toBe('w1');
    expect(issue.where).toContain('W1');
  });

  /**
   * 케이블 길이를 따르는 심선은 "미입력"이 아니라 **다른 곳에 입력된 것**이다.
   * 그래서 `statsOf().missingLength`(= 길이를 알 수 없는 배선 수)에는 세지 않고,
   * 여기서 비교할 것은 error 등급 건수다. 예전에는 두 곳이 각자 길이를 판정해
   * 물리 뷰는 "길이 미입력 2본", 검증은 "info 1 + error 1" 로 갈렸다.
   */
  it('케이블 길이를 따르는 심선은 info 로 낮추고 statsOf 는 미입력으로 세지 않는다', () => {
    const doc = clean();
    doc.wires[0].lengthMm = undefined;
    doc.wires[0].cableId = 'cb1';
    doc.wires[1].lengthMm = undefined;
    doc.cables = [{ id: 'cb1', name: '2C 전원 케이블', coreCount: 2, lengthMm: 300 }];
    const found = only(doc, 'length-missing');
    const st = statsOf(doc);
    expect(found).toHaveLength(2);
    expect(found.filter((i) => i.level === 'info')).toHaveLength(1);
    expect(found.filter((i) => i.level === 'error')).toHaveLength(st.missingLength);
    expect(st.missingLength).toBe(1);
    expect(st.cableLength).toBe(1);
    // 합계에도 케이블 길이가 반영된다 — 자재표·물리 뷰와 같은 함수를 쓴다
    expect(st.wireLengthMm).toBe(300 + (doc.wires[2]?.lengthMm ?? 0));
  });

  it('케이블에도 길이가 없으면 그 심선은 error 로 남는다', () => {
    const doc = clean();
    doc.wires[0].lengthMm = undefined;
    doc.wires[0].cableId = 'cb1';
    doc.cables = [{ id: 'cb1', name: '2C 전원 케이블', coreCount: 2 }];
    const found = only(doc, 'length-missing');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    expect(found[0].title).toContain('케이블에도 길이가 없다');
    expect(statsOf(doc).missingLength).toBe(1);
  });
});

describe('5. 떠 있는 커넥터 / 장치', () => {
  it('배선이 하나도 없는 커넥터는 warn (파트리스트에는 잡힌다)', () => {
    const doc = clean();
    doc.connectors.push({
      id: 'c3', kind: 'connector', housingId: 'h4', orientation: 0,
      positions: { logical: { x: 0, y: 200 } },
      pins: [{ id: 'z1', index: 1, terminalId: 't1' }],
    });
    const found = only(doc, 'floating');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].targetId).toBe('c3');
  });

  it('배선이 없는 장치는 발주 대상이 아니라 info', () => {
    const doc = clean();
    doc.devices.push({ id: 'd1', name: 'Raspberry Pi', positions: { logical: { x: 0, y: 300 } } });
    const found = only(doc, 'floating');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('info');
    expect(found[0].targetId).toBe('d1');
  });
});

describe('6. 스플라이스 결선 부족', () => {
  const withSplice = (strands: number): HarnessDocument => {
    const doc = clean();
    doc.connectors.push({
      id: 'sp1', kind: 'splice', housingId: 'sp', orientation: 0,
      positions: { logical: { x: 150, y: 100 } },
      pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i })),
      bridges: [['s1', 's2', 's3']],
    });
    for (let i = 0; i < strands; i++) {
      doc.wires.push(wire({
        id: `sw${i}`,
        from: { type: 'pin', connectorId: 'c1', pinId: `p${i + 1}` },
        to: { type: 'pin', connectorId: 'sp1', pinId: `s${i + 1}` },
      }));
    }
    return doc;
  };

  it('한 가닥만 물린 스플라이스는 warn', () => {
    const found = only(withSplice(1), 'splice-underused');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('1가닥');
  });

  it('두 가닥이면 갈래가 없는 단순 연장이라 info', () => {
    const found = only(withSplice(2), 'splice-underused');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('info');
  });

  it('세 가닥부터는 지적하지 않는다', () => {
    expect(only(withSplice(3), 'splice-underused')).toHaveLength(0);
  });
});

describe('7. 규격 색 불일치', () => {
  it('하우징 규격 색과 다른 색을 쓰면 warn 이고 규격 색을 알려준다', () => {
    const doc = clean();
    doc.wires[0].color = { base: 'blue' };       // RJ45 #1 규격은 white/orange
    const found = only(doc, 'std-color-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('white/orange');
    expect(found[0].detail).toContain('TX+');
    expect(found[0].targetId).toBe('w1');
  });

  it('대소문자·공백만 다른 색은 같은 색으로 본다', () => {
    const doc = clean();
    doc.wires[0].color = { base: 'White', stripe: 'Orange ' };
    expect(only(doc, 'std-color-mismatch')).toHaveLength(0);
  });

  it('규격 색이 없는 하우징은 어떤 색이든 지적하지 않는다', () => {
    const doc = clean();
    doc.wires[1].color = { base: 'pink' };
    doc.connectors[1].pins[1].index = 2;
    // c1(JST XH)은 stdColor 가 없다 — c2 쪽 규격만 걸린다
    expect(only(doc, 'std-color-mismatch').every((i) => i.where.includes('J2'))).toBe(true);
  });
});

describe('8. 자기 자신에 연결', () => {
  it('같은 커넥터의 핀끼리 이으면 warn', () => {
    const doc = clean();
    doc.wires.push(wire({
      id: 'w3',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
      to: { type: 'pin', connectorId: 'c1', pinId: 'p4' },
    }));
    const found = only(doc, 'self-loop');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].targetId).toBe('w3');
  });

  it('스플라이스 안에서의 연결은 정상이므로 제외한다', () => {
    const doc = clean();
    doc.connectors.push({
      id: 'sp1', kind: 'splice', housingId: 'sp', orientation: 0,
      positions: { logical: { x: 150, y: 100 } },
      pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i })),
      bridges: [['s1', 's2', 's3']],
    });
    doc.wires.push(
      wire({
        id: 'w3',
        from: { type: 'pin', connectorId: 'sp1', pinId: 's1' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's2' },
      }),
      wire({
        id: 'w4',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's3' },
      }),
      wire({
        id: 'w5',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p4' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's2' },
      }),
    );
    expect(only(doc, 'self-loop')).toHaveLength(0);
  });
});

describe('9. 중복 배선', () => {
  it('같은 두 끝점을 잇는 배선이 둘이면 error', () => {
    const doc = clean();
    doc.wires.push(wire({
      id: 'w3',
      from: { type: 'pin', connectorId: 'c2', pinId: 'q1' },   // 방향만 뒤집힌 같은 구간
      to: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
      color: { base: 'white', stripe: 'orange' },
    }));
    const found = only(doc, 'duplicate-wire');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    expect(found[0].title).toContain('2본');
    expect(found[0].targetId).toBe('w3');       // 나중에 그린 쪽을 선택시킨다
  });
});

describe('10. 게이지 불일치', () => {
  it('한 네트에 굵기가 섞이면 warn 이고 가장 얇은 쪽을 짚는다', () => {
    const doc = clean();
    doc.wires.push(wire({
      id: 'w3',
      from: { type: 'pin', connectorId: 'c2', pinId: 'q1' },   // w1 과 같은 네트
      to: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
      gauge: { system: 'awg', value: 26 },
      color: { base: 'white', stripe: 'orange' },
    }));
    const found = only(doc, 'gauge-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('AWG22');
    expect(found[0].detail).toContain('AWG26');   // 얇은 쪽
  });

  it('단위가 섞이면 어림 환산하지 않고 통일하라고 말한다', () => {
    const doc = clean();
    doc.wires.push(wire({
      id: 'w3',
      from: { type: 'pin', connectorId: 'c2', pinId: 'q1' },
      to: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
      gauge: { system: 'mm2', value: 0.5 },
      color: { base: 'white', stripe: 'orange' },
    }));
    const [issue] = only(doc, 'gauge-mismatch');
    expect(issue.detail).toContain('단위');
  });

  it('같은 굵기면 지적하지 않는다', () => {
    expect(only(clean(), 'gauge-mismatch')).toHaveLength(0);
  });
});

describe('11. 하우징 스냅샷 없음', () => {
  it('usedParts 에 하우징이 없으면 error', () => {
    const doc = clean();
    doc.usedParts = doc.usedParts.filter((p) => p.id !== 'h4');
    const found = only(doc, 'housing-missing');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    expect(found[0].targetId).toBe('c1');
    expect(found[0].detail).toContain('재현');
  });

  it('하우징을 모르면 핀 범위는 판정하지 않는다 (근거 없는 경고를 만들지 않는다)', () => {
    const doc = clean();
    doc.usedParts = doc.usedParts.filter((p) => p.id !== 'h4');
    doc.connectors[0].pins[0].index = 99;
    expect(only(doc, 'pin-overflow')).toHaveLength(0);
  });
});

// ================================================================
// 15·16. 사람이 입력한 구간 길이
//
// 구간은 배선에서 유도되고, 그 길이는 대부분 유도할 근거가 없어 사람이 넣는다.
// 근거가 **있는데도** 다른 값이 들어와 있으면 둘 중 하나는 틀렸다 —
// 조용히 덮지 않고 알린다. 자동으로 고치지 않는다.
// ================================================================

describe('15. 구간 길이 불일치', () => {
  /** CLEAN 은 c1 ↔ c2 직결 200mm 두 본 = 구간 하나 (유도값 200) */
  const soleKey = () => buildPhysicalModel(clean()).segments[0].key;

  it('입력값이 배선에서 나온 값과 다르면 warn 이고 두 숫자를 다 보여 준다', () => {
    const doc = clean();
    doc.segmentLengths = { [soleKey()]: 260 };
    const found = only(doc, 'segment-length-conflict');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('260mm');
    expect(found[0].title).toContain('200mm');
    expect(found[0].where).toContain('S1');
    // 클릭하면 근거가 된 배선으로 데려간다
    expect(found[0].targetId).toBe('w1');
    expect(found[0].detail).toContain('W1');
  });

  it('같은 값이면 지적하지 않는다', () => {
    const doc = clean();
    doc.segmentLengths = { [soleKey()]: 200 };
    expect(validateHarness(doc)).toEqual([]);
  });

  it('유도할 근거가 없는 구간은 지적하지 않는다 — 그러라고 넣는 값이다', () => {
    const doc = clean();
    // 배선마다 길이를 달리하면 유도값이 없어진다(mixed)
    doc.wires[1].lengthMm = 300;
    doc.segmentLengths = { [soleKey()]: 1000 };
    expect(only(doc, 'segment-length-conflict')).toHaveLength(0);
  });

  it('입력값이 없는 문서는 구간 산출을 돌리지 않고 조용하다', () => {
    expect(only(clean(), 'segment-length-conflict')).toHaveLength(0);
    expect(only({ ...clean(), segmentLengths: {} }, 'segment-length-conflict')).toHaveLength(0);
  });
});

describe('16. 쓰이지 않는 구간 길이', () => {
  it('구간이 사라져 어디에도 붙지 않는 값이 있으면 info 로 알린다', () => {
    const doc = clean();
    // 배선을 다 지우면 구간도 사라진다 — 넣어 둔 길이는 파일에만 남는다
    doc.segmentLengths = { 'con:c1|con:c2': 200, 'con:c1|con:c9': 300 };
    doc.wires = [];
    const found = only(doc, 'segment-length-orphan');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('info');
    expect(found[0].title).toContain('2건');
  });

  it('멀쩡히 쓰이는 값에는 아무 말도 하지 않는다', () => {
    const doc = clean();
    doc.segmentLengths = { [buildPhysicalModel(clean()).segments[0].key]: 200 };
    expect(only(doc, 'segment-length-orphan')).toHaveLength(0);
  });
});

// ================================================================
// 17. 배선이 부품을 지난다
// ================================================================

describe('배선이 부품을 지난다', () => {
  /**
   * 커넥터를 다른 커넥터의 패드 **바로 앞**에 겹쳐 놓는다.
   *
   * 왜 이렇게 만드나: 라우터는 주행 구간과 스텁 길이를 밀어 상자를 비켜 가지만
   * **스텁이 나가는 방향 자체**는 못 바꾼다(패드에서 핸들 방향으로 곧게 나가야
   * 어느 핀에서 나온 선인지 읽힌다 — route.ts 머리말). 그 자리를 다른 부품이
   * 덮고 있으면 어떤 회피로도 못 피한다. 그때 조용히 그리기만 하지 않고
   * 알리는지를 보는 자리다.
   *
   * c1(o=0)의 핸들은 왼쪽 변(x=0)에 있고 스텁은 왼쪽으로 나간다. c3 을 그 왼쪽에
   * 겹쳐 두면 스텁이 c3 의 상자 속을 지난다.
   */
  const overlapped = (): HarnessDocument => {
    const doc = clean();
    doc.connectors.push({
      id: 'c3', kind: 'connector', housingId: 'h4', orientation: 180,
      positions: { logical: { x: -20, y: 20 } },
      pins: [1, 2, 3, 4].map((i) => ({ id: `r${i}`, index: i, label: String(i), terminalId: 't1' })),
    });
    return doc;
  };

  it('피할 수 없게 겹쳐 놓으면 어느 부품을 지나는지 짚어 준다', () => {
    const found = only(overlapped(), 'wire-crosses-part');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('J3');       // 도면 레퍼런스로 짚는다
    expect(found[0].targetId).toBeDefined();
  });

  it('정상 문서에서는 아무 말도 하지 않는다 (제 끝 노드는 세지 않는다)', () => {
    expect(only(clean(), 'wire-crosses-part')).toHaveLength(0);
  });

  /**
   * 대조군의 반대편 — 라우터가 **비켜 갈 수 있는** 배치에서는 뜨면 안 된다.
   * 한 줄로 늘어선 커넥터 사이를 지나는 배선이 그 배치다(canvas/thirdNode.test.ts).
   * 여기서 뜨기 시작하면 오탐이라 사람이 목록 전체를 무시하게 된다.
   */
  it('한 줄로 늘어선 커넥터 배치에서는 뜨지 않는다', () => {
    expect(only(rowOfConnectorsDoc(), 'wire-crosses-part')).toHaveLength(0);
  });
});

// ================================================================
// 목록 자체
// ================================================================

describe('이슈 목록', () => {
  it('error → warn → info 순으로 정렬된다', () => {
    const doc = clean();
    doc.wires[0].lengthMm = undefined;                       // error
    doc.wires[1].color = { base: 'blue' };                   // warn (규격 색)
    doc.devices.push({ id: 'd1', name: '참고 장치', positions: {} }); // info
    const levels = validateHarness(doc).map((i) => i.level);
    expect(levels).toEqual([...levels].sort(
      (a, b) => ['error', 'warn', 'info'].indexOf(a) - ['error', 'warn', 'info'].indexOf(b),
    ));
    expect(new Set(levels)).toEqual(new Set(['error', 'warn', 'info']));
  });

  it('모든 이슈가 위치와 이유를 갖는다 — "규칙 위반"만 적힌 이슈는 없다', () => {
    const doc = clean();
    doc.wires[0].lengthMm = undefined;
    doc.connectors[0].pins[1].terminalId = undefined;
    doc.devices.push({ id: 'd1', name: '참고 장치', positions: {} });
    for (const i of validateHarness(doc)) {
      expect(i.where.length).toBeGreaterThan(0);
      expect(i.detail.length).toBeGreaterThan(15);
      expect(i.title.length).toBeGreaterThan(0);
    }
  });
});
