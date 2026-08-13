/**
 * 부품 정의 변경 → 도면 반영 회귀 시험.
 *
 * 재현 결함: 핀맵 에디터에서 **이미 쓰고 있는** 부품을 고쳐 저장해도 도면은
 * 하나도 바뀌지 않았다(`addUsedPart` 가 같은 id 를 무시한다). 이름을 바꿔도
 * 도면 이름표는 옛 이름, 6P→2P 로 줄여도 도면은 6P 그대로였고 안내도 없었다.
 */
import { describe, it, expect } from 'vitest';
import { planPartSync, partSyncMessage } from './partSync';
import type { HarnessDocument, PartLibraryItem, PinSlot, Wire } from '../types';

function grid(cols: number, rows: number): PinSlot[] {
  return Array.from({ length: cols * rows }, (_, i) => ({
    index: i + 1,
    label: String(i + 1),
    offset: { x: i % cols, y: Math.floor(i / cols) },
  }));
}

const part6: PartLibraryItem = {
  id: 'custom-6p', category: 'housing', name: '내 6P', pinCount: 6, pinLayout: grid(3, 2),
};

/** 6핀 커넥터 하나 + (원하면) 6번 핀에 배선 한 본 */
function doc(part: PartLibraryItem, wired: number[] = []): HarnessDocument {
  const pins = Array.from({ length: 6 }, (_, i) => ({ id: `pin${i + 1}`, index: i + 1 }));
  const wires: Wire[] = wired.map((n) => ({
    id: `w${n}`,
    from: { type: 'pin', connectorId: 'c1', pinId: `pin${n}` },
    to: { type: 'device', deviceId: 'd1', terminal: 'T1' },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 20 },
  }));
  return {
    schemaVersion: 1, id: 'doc1', name: '시험',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    connectors: [{ id: 'c1', kind: 'connector', housingId: part.id, orientation: 0, positions: {}, pins }],
    devices: [{ id: 'd1', name: '장치', terminals: ['T1'], positions: {} }],
    wires,
    usedParts: [part],
  };
}

describe('planPartSync', () => {
  it('이름만 바꿔도 문서 스냅샷을 갱신한다 (핀은 그대로)', () => {
    const plan = planPartSync(doc(part6), { ...part6, name: '이름 바뀜' });
    expect(plan.usedPartChanged).toBe(true);
    expect(plan.connectors).toHaveLength(0);
    expect(plan.steps).toBe(1);
    expect(partSyncMessage({ ...part6, name: '이름 바뀜' }, plan))
      .toBe("'이름 바뀜' 정의를 도면에 반영했습니다");
  });

  it('바뀐 게 없으면 아무것도 하지 않는다 (토스트도 없다)', () => {
    const plan = planPartSync(doc(part6), { ...part6 });
    expect(plan.steps).toBe(0);
    expect(partSyncMessage(part6, plan)).toBeNull();
  });

  it('핀 수를 줄이면 배선 없는 핀은 정리한다', () => {
    const small = { ...part6, pinCount: 2, pinLayout: grid(2, 1) };
    const plan = planPartSync(doc(part6), small);

    expect(plan.connectors).toHaveLength(1);
    expect(plan.connectors[0].pins.map((p) => p.index)).toEqual([1, 2]);
    expect(plan.connectors[0].droppedPins.map((p) => p.index)).toEqual([3, 4, 5, 6]);
    expect(plan.strandedWires).toBe(0);
  });

  it('배선이 물린 핀은 말없이 지우지 않고 남긴 뒤 알린다', () => {
    const small = { ...part6, pinCount: 2, pinLayout: grid(2, 1) };
    const plan = planPartSync(doc(part6, [6]), small);

    const patch = plan.connectors[0];
    expect(patch.pins.map((p) => p.index)).toEqual([1, 2, 6]);   // 6번은 배선이 있어 남는다
    expect(patch.strandedPins.map((p) => p.index)).toEqual([6]);
    expect(patch.droppedPins.map((p) => p.index)).toEqual([3, 4, 5]);
    expect(plan.strandedWires).toBe(1);

    const msg = partSyncMessage(small, plan)!;
    expect(msg).toContain('빈 핀 3개 정리');
    expect(msg).toContain('배선 1본이 없어진 핀에 남음');
  });

  it('핀 수를 늘리면 늘어난 자리를 새 핀으로 채운다', () => {
    const big = { ...part6, pinCount: 8, pinLayout: grid(4, 2) };
    const plan = planPartSync(doc(part6), big);

    const patch = plan.connectors[0];
    expect(patch.pins.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(patch.addedPins.map((p) => p.index)).toEqual([7, 8]);
    // 새 핀 id 는 기존 핀과 겹치지 않는다
    expect(new Set(patch.pins.map((p) => p.id)).size).toBe(8);
    expect(partSyncMessage(big, plan)).toContain('핀 2개 추가');
  });

  it('정의를 따르던 표기는 새 표기를 따라가고, 손으로 고친 표기는 지킨다', () => {
    const d = doc(part6);
    d.connectors[0].pins[0] = { id: 'pin1', index: 1, label: '1' };      // 정의 그대로
    d.connectors[0].pins[1] = { id: 'pin2', index: 2, label: '전원' };   // 사용자가 고침

    const relabelled: PartLibraryItem = {
      ...part6,
      pinLayout: grid(3, 2).map((s) => ({ ...s, label: `A${s.index}` })),
    };
    const patch = planPartSync(d, relabelled).connectors[0];
    expect(patch.pins.find((p) => p.index === 1)!.label).toBe('A1');
    expect(patch.pins.find((p) => p.index === 2)!.label).toBe('전원');
    // 표기가 비어 있던 핀은 그대로 둔다 — 계약상 비면 라이브러리 표기를 따른다
    expect(patch.pins.find((p) => p.index === 3)!.label).toBeUndefined();
  });

  it('다른 하우징을 쓰는 커넥터는 건드리지 않는다', () => {
    const d = doc(part6);
    d.connectors.push({
      id: 'c2', kind: 'connector', housingId: 'lib-xh-4p', orientation: 0, positions: {},
      pins: [{ id: 'q1', index: 1 }],
    });
    const plan = planPartSync(d, { ...part6, pinCount: 2, pinLayout: grid(2, 1) });
    expect(plan.connectors.map((c) => c.connectorId)).toEqual(['c1']);
  });

  it('실행취소 단계 수 = 스토어 호출 횟수', () => {
    const plan = planPartSync(doc(part6), { ...part6, pinCount: 2, pinLayout: grid(2, 1) });
    expect(plan.steps).toBe(1 + plan.connectors.length);
  });
});
