/**
 * 케이블 결함 회귀 시험 (감사 A-2 ~ A-5).
 *
 * 케이블은 화면 어디에도 자기 자리가 없는 객체다 — 선택도 삭제도 안 되고,
 * 참조가 끊겨도 아무도 말하지 않았다. 여기서는 **문서와 산출물** 쪽 규칙만 본다
 * (입력 UI 쪽은 panels/property.dom.test.tsx).
 *
 * 각 시험은 "고치기 전에는 이렇게 잘못됐다"를 주석에 남긴다 — 그래야 나중에
 * 이 시험이 왜 이 값을 요구하는지 알 수 있다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Cable, HarnessDocument, Wire } from '../types';
import { useHarnessStore } from './harnessStore';
import { validateHarness } from './validate';
import { lengthResolver } from './wireLength';
import { normalizeDocument } from './persistence';
import { buildPartList } from '../export/exporters';
import { sampleDoc } from '../fixtures/sampleDoc';

const S = () => useHarnessStore.getState();

/** 케이블 하나(2C 300mm)에 심선 2본이 든 최소 문서 */
function cableDoc(over: { cable?: Partial<Cable>; wires?: Partial<Wire>[] } = {}): HarnessDocument {
  const cable: Cable = {
    id: 'cb1', name: '2C 전원', coreCount: 2, lengthMm: 300, ...over.cable,
  };
  const wire = (i: number): Wire => ({
    id: `w${i}`,
    from: { type: 'pin', connectorId: 'con-a', pinId: `a${i}` },
    to: { type: 'device', deviceId: 'dev-pi', terminal: '5V' },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
    cableId: cable.id,
    ...over.wires?.[i - 1],
  });
  return {
    ...structuredClone(sampleDoc),
    id: 'doc-cable',
    cables: [cable],
    wires: [wire(1), wire(2)],
  };
}

const ids = (doc: HarnessDocument, rule: string) =>
  validateHarness(doc).filter((i) => i.id === rule);

beforeEach(() => S().replaceDoc(cableDoc()));

// ================================================================
// A-2 케이블 삭제
// ================================================================
describe('A-2 케이블을 지울 수 있다', () => {
  /**
   * 고치기 전: `selection` 은 커넥터·장치·배선만 될 수 있어 케이블은 고를 수도
   * 지울 수도 없었다. 심선을 전부 '단선'으로 빼도 케이블은 남아 자재표가
   * qty 1 로 계속 발주했다.
   */
  it('remove(케이블 id) 로 지워지고, 심선은 단선으로 남는다', () => {
    S().remove('cb1');
    expect(S().doc.cables).toEqual([]);
    // 배선 자체는 도면에 그려진 것이라 같이 지우지 않는다
    expect(S().doc.wires).toHaveLength(2);
    // 소속만 끊는다 — 남겨 두면 없는 케이블을 가리키는 참조가 된다(A-3)
    expect(S().doc.wires.every((w) => w.cableId === undefined)).toBe(true);
  });

  it('삭제는 실행취소 한 단계다', () => {
    S().remove('cb1');
    S().undo();
    expect(S().doc.cables).toHaveLength(1);
    expect(S().doc.wires.every((w) => w.cableId === 'cb1')).toBe(true);
  });

  /** 심선 0본 케이블은 자재표에 1개로 잡혀 발주된다 — 검증이 짚어야 한다 */
  it('심선이 하나도 없는 케이블을 검증이 짚는다', () => {
    const doc = cableDoc();
    doc.wires = doc.wires.map((w) => ({ ...w, cableId: undefined }));
    const found = ids(doc, 'cable-empty');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].targetId).toBe('cb1');
  });
});

// ================================================================
// A-3 고아 cableId
// ================================================================
describe('A-3 없는 케이블을 가리키는 배선', () => {
  const orphan = (): HarnessDocument => {
    const doc = cableDoc();
    doc.cables = [];                 // 케이블만 사라진 파일 (손으로 고친 JSON 등)
    return doc;
  };

  /**
   * 고치기 전: 재단 길이가 300mm 에서 조용히 '미상'이 되고, 검증은
   * "길이 미입력" 이라고만 말했다 — 케이블 참조가 깨졌다는 사실은 어디에도 없었다.
   */
  it('검증이 참조가 깨진 사실을 짚는다 (길이까지 없으면 error)', () => {
    const found = ids(orphan(), 'cable-missing');
    expect(found).toHaveLength(2);
    expect(found.every((i) => i.level === 'error')).toBe(true);
    expect(found[0].title).toContain('cb1');
  });

  it('배선에 제 길이가 있으면 만들 수는 있다 — warn', () => {
    const doc = orphan();
    doc.wires = doc.wires.map((w) => ({ ...w, lengthMm: 360 }));
    expect(ids(doc, 'cable-missing').every((i) => i.level === 'warn')).toBe(true);
  });

  /**
   * 불러오기는 **고치지 않고 알린다**. cableId 를 지우면 그 심선이 원래 어느
   * 케이블이었는지도 사라져 되살릴 근거가 없어진다 — 어느 쪽이 맞는지는 사람만 안다.
   */
  it('불러오기가 소속을 지우지 않고 경고만 남긴다', () => {
    const r = normalizeDocument(orphan());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.harnesses[0].wires.every((w) => w.cableId === 'cb1')).toBe(true);
    expect(r.warnings.some((w) => w.includes('없는 케이블'))).toBe(true);
  });
});

// ================================================================
// A-4 코어 수
// ================================================================
describe('A-4 코어 수와 심선 수', () => {
  /** 고치기 전: 1코어에 심선 2본, coreCount -3 까지 전부 통과했다 */
  it('심선이 코어 수보다 많으면 error', () => {
    const doc = cableDoc({ cable: { coreCount: 1 } });
    const found = ids(doc, 'cable-core-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('error');
    expect(found[0].title).toContain('심선 2본');
  });

  it('코어 수가 더 많으면 예비심 — 정상일 수 있으므로 info', () => {
    const doc = cableDoc({ cable: { coreCount: 8 } });
    const found = ids(doc, 'cable-core-spare');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('info');
  });

  it('딱 맞으면 아무 말도 하지 않는다', () => {
    expect(ids(cableDoc(), 'cable-core-mismatch')).toHaveLength(0);
    expect(ids(cableDoc(), 'cable-core-spare')).toHaveLength(0);
  });

  /**
   * 음수 코어는 존재하지 않는다. 임의로 1 이나 심선 수로 채우지 않고
   * 0(코어 수 미상)으로 되돌린 뒤 알린다 — 모르는 사실을 지어내지 않는다.
   */
  it('불러오기가 음수 코어 수를 미상으로 되돌리고 알린다', () => {
    const doc = cableDoc({ cable: { coreCount: -3 } });
    const r = normalizeDocument(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.harnesses[0].cables?.[0].coreCount).toBe(0);
    expect(r.warnings.some((w) => w.includes('음수'))).toBe(true);
  });
});

// ================================================================
// A-8 케이블 규격 게이지
//
// 입력 UI 가 없던 시절에는 값이 있어도 아무도 손대지 못해 어긋날 일이 없었다.
// 이제 넣을 수 있게 됐으니, 심선과 어긋나는 경우를 정해 둬야 한다.
// ================================================================
describe('A-8 케이블 게이지와 심선 게이지', () => {
  it('같은 단위인데 값이 다르면 warn 이고 케이블을 짚는다', () => {
    // 심선 AWG22 · 케이블 규격 AWG20 → 들어오는 물건과 접속표가 갈린다
    const doc = cableDoc({ cable: { gauge: { system: 'awg', value: 20 } } });
    const found = ids(doc, 'cable-gauge-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].title).toContain('AWG20');
    expect(found[0].title).toContain('AWG22');
    // 고칠 칸(케이블 게이지)이 케이블 카드에 있으므로 케이블로 데려간다
    expect(found[0].targetId).toBe('cb1');
  });

  it('값이 같으면 아무 말도 하지 않는다', () => {
    const doc = cableDoc({ cable: { gauge: { system: 'awg', value: 22 } } });
    expect(ids(doc, 'cable-gauge-mismatch')).toHaveLength(0);
  });

  it('게이지를 안 적은 케이블은 판정 대상이 아니다 — 선택 필드다', () => {
    expect(ids(cableDoc(), 'cable-gauge-mismatch')).toHaveLength(0);
  });

  /**
   * 단위가 섞이면 **판정하지 않는다**. 규칙 10(`thinnest`)과 같은 태도다 —
   * AWG22 를 0.34 로 볼지 0.3 으로 볼지는 제조사마다 다르고, 여기서 어림 환산을
   * 하면 경고가 거짓말을 한다. 그래서 샘플 문서(케이블 0.5sq · 심선 AWG22)도 조용하다.
   */
  it('단위가 다르면 어림 환산하지 않고 조용하다', () => {
    const doc = cableDoc({ cable: { gauge: { system: 'mm2', value: 0.5 } } });
    expect(ids(doc, 'cable-gauge-mismatch')).toHaveLength(0);
    expect(ids(sampleDoc, 'cable-gauge-mismatch')).toHaveLength(0);
  });

  it('자재표에는 케이블 게이지가 그대로 실린다 — 입력이 산출물까지 간다', () => {
    const doc = cableDoc({ cable: { gauge: { system: 'mm2', value: 0.75 } } });
    const row = buildPartList(doc).find((r) => r.category === '케이블')!;
    expect(row.detail).toContain('MM20.75');
  });
});

// ================================================================
// A-5 이중 계상
// ================================================================
describe('A-5 심선 개별 길이', () => {
  /**
   * 재단 길이는 심선에 적힌 값이 이긴다(그래야 한쪽만 짧게 자를 수 있다).
   * 다만 **소속은 그대로 케이블**이라, 발주 판단은 갈리지 않는다.
   */
  it('길이 출처는 배선이지만 소속 케이블은 계속 따라다닌다', () => {
    const doc = cableDoc({ wires: [{ lengthMm: 360 }] });
    const len = lengthResolver(doc)(doc.wires[0]);
    expect(len.mm).toBe(360);
    expect(len.source).toBe('wire');
    expect(len.cable?.id).toBe('cb1');   // 고치기 전에는 undefined 였다 → 이중 계상
  });
});

// ================================================================
// A-1 길이 입력 — 값이 들어오면 발주를 막던 error 가 사라진다
// ================================================================
describe('A-1 케이블 길이', () => {
  it('케이블에 길이가 있으면 심선은 error 가 아니라 info 다', () => {
    const withLen = ids(cableDoc(), 'length-missing');
    expect(withLen.every((i) => i.level === 'info')).toBe(true);

    // 길이가 없던 시절(= 입력할 칸이 없던 시절)에는 심선마다 error 였다
    const noLen = ids(cableDoc({ cable: { lengthMm: undefined } }), 'length-missing');
    expect(noLen).toHaveLength(2);
    expect(noLen.every((i) => i.level === 'error')).toBe(true);
  });

  /**
   * 심선마다 길이가 있어도 **자켓을 몇 mm 사야 하는지**는 모른다 —
   * 그대로 두면 자재표의 케이블 행이 수량 없이 나간다.
   */
  it('심선에 길이가 다 있어도 케이블 길이가 비면 짚는다', () => {
    const doc = cableDoc({
      cable: { lengthMm: undefined },
      wires: [{ lengthMm: 360 }, { lengthMm: 360 }],
    });
    expect(ids(doc, 'cable-length-missing')).toHaveLength(1);
    // 규칙 4 가 이미 말하는 경우에는 같은 말을 두 번 하지 않는다
    expect(ids(cableDoc({ cable: { lengthMm: undefined } }), 'cable-length-missing')).toHaveLength(0);
  });
});
