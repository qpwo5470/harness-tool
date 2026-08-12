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
    expect(on.style?.strokeWidth).toBe(3.2);
    expect(off.style?.opacity).toBe(0.16);
  });
});

describe('도면 레퍼런스', () => {
  it('커넥터 J·스플라이스 SP·장치 D 로 번호가 붙는다', async () => {
    const { refLabels } = await import('./docToFlow');
    const refs = refLabels(sampleDoc);
    const vals = [...refs.values()];
    expect(vals.some((v) => /^J\d+$/.test(v))).toBe(true);
    expect(vals.some((v) => /^SP\d+$/.test(v))).toBe(true);
    expect(vals.some((v) => /^D\d+$/.test(v))).toBe(true);
  });

  it('같은 문서를 다시 계산해도 번호가 같다', async () => {
    const { refLabels } = await import('./docToFlow');
    expect([...refLabels(sampleDoc)]).toEqual([...refLabels(sampleDoc)]);
  });
});

describe('레인 배정', () => {
  it('중앙 기준 대칭으로 벌어진다 (도면 중앙에서 크게 벗어나지 않게)', async () => {
    const { assignLanes } = await import('./docToFlow');
    expect(assignLanes(5, 12)).toEqual([0, 12, -12, 24, -24]);
  });

  it('배선이 없으면 빈 배열', async () => {
    const { assignLanes } = await import('./docToFlow');
    expect(assignLanes(0)).toEqual([]);
  });
});

describe('색 약호', () => {
  it('현장 관행 약호로 줄인다', async () => {
    const { colorAbbr } = await import('./docToFlow');
    expect(colorAbbr('red')).toBe('R');
    expect(colorAbbr('black')).toBe('B');
    expect(colorAbbr('blue')).toBe('L');   // 청색은 L (Blue 는 Black 과 혼동)
    expect(colorAbbr('white', 'orange')).toBe('W/O');
  });

  it('모르는 색도 두 글자로 폴백한다', async () => {
    const { colorAbbr } = await import('./docToFlow');
    expect(colorAbbr('teal')).toBe('TE');
  });
});
