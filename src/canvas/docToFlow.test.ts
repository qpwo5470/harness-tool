import { describe, it, expect } from 'vitest';
import { docToFlow, docToEdges, highlightedWires } from './docToFlow';
import { sampleDoc } from '../fixtures/sampleDoc';

describe('docToFlow', () => {
  it('노드 = 커넥터+장치, 엣지 = 와이어', () => {
    const { nodes, edges } = docToFlow(sampleDoc, 'logical');
    expect(nodes).toHaveLength(4); // 커넥터 3 + 장치 1
    expect(edges).toHaveLength(3); // 와이어 3
  });
});

describe('highlightedWires', () => {
  it('와이어 선택 시 같은 네트 전체가 하이라이트된다', () => {
    const hl = highlightedWires(sampleDoc, 'w1');
    expect([...hl].sort()).toEqual(['w1', 'w2', 'w3']); // 스플라이스 너머까지
  });

  it('커넥터 선택 시 그 커넥터가 물린 네트가 하이라이트된다', () => {
    const hl = highlightedWires(sampleDoc, 'con-a');
    expect(hl.has('w1')).toBe(true);
  });

  it('선택 없으면 빈 집합', () => {
    expect(highlightedWires(sampleDoc, null).size).toBe(0);
  });
});

describe('docToEdges 하이라이트 스타일', () => {
  it('하이라이트된 엣지는 굵고, 나머지는 흐려진다', () => {
    const edges = docToEdges(sampleDoc, new Set(['w1']));
    const on = edges.find((e) => e.id === 'w1')!;
    const off = edges.find((e) => e.id === 'w2')!;
    expect(on.style?.strokeWidth).toBe(4);
    expect(off.style?.opacity).toBe(0.25);
  });
});
