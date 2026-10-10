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
