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

describe('레인 배정 — 구간 겹침 채색', () => {
  it('레인 인덱스는 중앙 기준 대칭 오프셋으로 바뀐다', async () => {
    const { laneOffset } = await import('./docToFlow');
    expect([0, 1, 2, 3, 4].map((l) => laneOffset(l, 12))).toEqual([0, 12, -12, 24, -24]);
  });

  it('겹치지 않는 구간은 같은 레인을 재사용한다', async () => {
    const { colorLanes } = await import('./docToFlow');
    // [0,10] [50,60] [100,110] — 서로 안 겹침 → 전부 레인 0
    expect(colorLanes([[0, 10], [50, 60], [100, 110]])).toEqual([0, 0, 0]);
  });

  it('완전히 겹치는 구간은 레인이 갈린다', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([[0, 100], [0, 100], [0, 100]])).toEqual([0, 1, 2]);
  });

  it('레인 수는 배선 수가 아니라 최대 동시 겹침 수에서 멈춘다', async () => {
    const { colorLanes } = await import('./docToFlow');
    // 20본이지만 동시에 겹치는 건 최대 2개 → 레인 2개면 충분
    const spans = Array.from({ length: 20 }, (_, i) => [i * 50, i * 50 + 60] as [number, number]);
    const lanes = colorLanes(spans);
    expect(new Set(lanes).size).toBeLessThanOrEqual(2);
  });

  it('입력 순서 그대로 돌려준다 (내부에서 정렬해도)', async () => {
    const { colorLanes } = await import('./docToFlow');
    // x1 역순으로 넣어도 i 번째 결과가 i 번째 입력에 대응해야 한다
    const lanes = colorLanes([[200, 300], [0, 100]]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]).toBe(0); // 안 겹치므로 둘 다 레인 0
    expect(lanes[1]).toBe(0);
  });

  it('x1 > x2 로 뒤집힌 구간도 처리한다', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([[100, 0], [200, 300]])).toEqual([0, 0]);
  });

  it('배선이 없으면 빈 배열', async () => {
    const { colorLanes } = await import('./docToFlow');
    expect(colorLanes([])).toEqual([]);
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
