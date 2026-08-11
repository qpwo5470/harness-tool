import { describe, it, expect } from 'vitest';
import { computeNets } from './netlist';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { HarnessDocument } from '../types';

describe('computeNets', () => {
  it('스플라이스를 통해 갈라진 가닥이 하나의 네트로 묶인다', () => {
    // 샘플: con-a#1 → sp-1(s1), sp-1(s2) → b2w#1, sp-1(s3) → Pi.5V
    // 스플라이스 bridges로 s1/s2/s3가 이어지므로 전부 한 네트여야 함
    const nets = computeNets(sampleDoc);
    expect(nets).toHaveLength(1);
    const net = nets[0];
    expect(net.wireIds.sort()).toEqual(['w1', 'w2', 'w3']);
    // 장치 단자가 대표 라벨로 선택됨
    expect(net.label).toContain('Raspberry Pi');
  });

  it('브리지가 없으면 별개 네트로 남는다', () => {
    const doc: HarnessDocument = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'sp-1' ? { ...c, bridges: undefined } : c,
      ),
    };
    const nets = computeNets(doc);
    expect(nets.length).toBeGreaterThan(1);
  });

  it('한 핀에 여러 와이어가 물리면 같은 네트로 합쳐진다', () => {
    const doc: HarnessDocument = {
      ...sampleDoc,
      wires: [
        ...sampleDoc.wires,
        {
          id: 'w4',
          from: { type: 'pin', connectorId: 'con-a', pinId: 'a1' }, // w1과 같은 핀
          to: { type: 'pin', connectorId: 'con-b2w', pinId: 'p2' },
          color: { base: 'blue' },
          gauge: { system: 'awg', value: 22 },
        },
      ],
    };
    const nets = computeNets(doc);
    expect(nets).toHaveLength(1);
    expect(nets[0].wireIds).toContain('w4');
  });
});
