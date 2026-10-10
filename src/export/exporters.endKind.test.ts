import { describe, it, expect } from 'vitest';
import { buildPartList } from './exporters';
import type { HarnessDocument, PartLibraryItem } from '../types';

const free: PartLibraryItem = { id: 'free', category: 'housing', name: '납처리 전선단 1가닥', endKind: 'free', pinCount: 1 };
const barrel: PartLibraryItem = { id: 'bar', category: 'housing', name: 'DC 배럴잭 암', endKind: 'barrel', pinCount: 2 };

const doc: HarnessDocument = {
  schemaVersion: 1, id: 'd', name: 't', createdAt: '', updatedAt: '',
  connectors: [
    { id: 'w', kind: 'connector', housingId: 'free', orientation: 0, positions: {}, pins: [{ id: 'w1', index: 1 }] },
    { id: 'j', kind: 'connector', housingId: 'bar', orientation: 0, positions: {}, pins: [{ id: 'j1', index: 1 }, { id: 'j2', index: 2 }] },
  ],
  devices: [],
  wires: [{
    id: 'x', from: { type: 'pin', connectorId: 'w', pinId: 'w1' }, to: { type: 'pin', connectorId: 'j', pinId: 'j1' },
    color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 100,
  }],
  usedParts: [free, barrel],
};

describe('D-SUB 솔더컵 / 압착 — 터미널 줄', () => {
  const mk = (spec: Record<string, string>): HarnessDocument => ({
    ...doc,
    connectors: [{ id: 'd', kind: 'connector', housingId: 'ds', orientation: 0, positions: {}, pins: [{ id: 'd1', index: 1 }] },
      doc.connectors[1]],
    wires: [{ ...doc.wires[0], from: { type: 'pin', connectorId: 'd', pinId: 'd1' } }],
    usedParts: [{ id: 'ds', category: 'housing', name: 'D-SUB 9P 암', endKind: 'dsub', pinCount: 9, spec }, barrel],
  });
  it('솔더컵은 압착단자가 없다', () => {
    expect(buildPartList(mk({ 결선방식: '솔더컵 (납땜)' })).some((r) => r.category === '터미널')).toBe(false);
  });
  it('압착형은 컨택트를 배선 끝마다 센다', () => {
    const t = buildPartList(mk({ 결선방식: '압착 (컨택트 별매)', 터미널: 'D-SUB 암 압착 컨택트' })).find((r) => r.category === '터미널');
    expect(t?.part).toBe('D-SUB 암 압착 컨택트');
    expect(t?.qty).toBe(1);
  });
});

describe('납땜 끝단 — 발주 집계', () => {
  it('납처리 전선단은 커넥터로 세지 않는다', () => {
    const rows = buildPartList(doc);
    expect(rows.some((r) => r.part.includes('납처리'))).toBe(false);
  });
  it('배럴잭은 커넥터로 세되, 지어낸 "용 터미널" 줄은 없다', () => {
    const rows = buildPartList(doc);
    expect(rows.find((r) => r.category === '커넥터' && r.part === 'DC 배럴잭 암')?.qty).toBe(1);
    expect(rows.some((r) => r.category === '터미널')).toBe(false);
  });
});
