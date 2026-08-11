/**
 * 핀맵 에디터로 만든 커스텀 부품이 실제 배선까지 이어지는지 종단 검증.
 */
import { describe, it, expect } from 'vitest';
import { instantiate, suggestedColor } from './seed';
import { computeNets } from '../store/netlist';
import { buildRunList, buildPartList } from '../export/exporters';
import type { PartLibraryItem, HarnessDocument, Wire } from '../types';

/** 핀맵 에디터가 만들어낼 법한 커스텀 부품 */
const customPart: PartLibraryItem = {
  id: 'custom-abc',
  category: 'housing',
  name: '내 전용 4P',
  manufacturer: '사내',
  mpn: 'MY-4P',
  spec: { 피치: '2.5mm' },
  pinCount: 4,
  pinLayout: [
    { index: 1, label: '1', offset: { x: 0, y: 0 }, signal: '+24V', stdColor: 'red' },
    { index: 2, label: '2', offset: { x: 1, y: 0 }, signal: 'GND', stdColor: 'black' },
    { index: 3, label: '3', offset: { x: 0, y: 1 }, signal: 'TX', stdColor: 'yellow' },
    { index: 4, label: '4', offset: { x: 1, y: 1 }, signal: 'RX', stdColor: 'blue' },
  ],
};

describe('커스텀 부품 종단 흐름', () => {
  it('인스턴스가 핀맵대로 생성된다', () => {
    const c = instantiate(customPart, { x: 0, y: 0 });
    expect(c.pins).toHaveLength(4);
    expect(c.housingId).toBe('custom-abc');
    expect(c.pins.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('핀별 규격색이 결선 시 제안된다', () => {
    expect(suggestedColor(customPart, 1)).toBe('red');
    expect(suggestedColor(customPart, 4)).toBe('blue');
  });

  it('2행 배치가 보존된다 (물리 뷰용)', () => {
    const ys = new Set(customPart.pinLayout!.map((s) => s.offset.y));
    expect(ys.size).toBe(2);
  });

  it('커스텀 부품으로 만든 문서가 넷리스트·접속표·파트리스트까지 통과', () => {
    const c = instantiate(customPart, { x: 0, y: 0 });
    const wire: Wire = {
      id: 'w1',
      from: { type: 'pin', connectorId: c.id, pinId: c.pins[0].id },
      to: { type: 'device', deviceId: 'dev-1', terminal: 'VIN' },
      color: { base: 'red' },
      gauge: { system: 'awg', value: 20 },
      lengthMm: 150,
    };
    const doc: HarnessDocument = {
      schemaVersion: 1, id: 'd', name: '커스텀 테스트',
      createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z',
      connectors: [c],
      devices: [{ id: 'dev-1', name: '컨트롤러', terminals: ['VIN'], positions: {} }],
      wires: [wire],
      usedParts: [customPart], // 문서에 스냅샷으로 동봉됨
    };

    // 넷리스트
    const nets = computeNets(doc);
    expect(nets).toHaveLength(1);

    // 접속표: 커스텀 부품 이름이 from 표기에 나와야 함
    const runs = buildRunList(doc);
    expect(runs[0].from).toContain('내 전용 4P');
    expect(runs[0].to).toBe('컨트롤러.VIN');

    // 파트리스트: 커스텀 부품이 집계됨
    const parts = buildPartList(doc);
    expect(parts.some((p) => p.part === '내 전용 4P')).toBe(true);
  });
});
