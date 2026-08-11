import { describe, it, expect } from 'vitest';
import { docToEdges } from './docToFlow';
import { sampleDoc } from '../fixtures/sampleDoc';

describe('배선 라벨 표시 규칙', () => {
  it('평소에는 라벨이 없다 (선끼리 겹쳐 잘리는 문제 방지)', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => e.label === undefined)).toBe(true);
  });

  it('클릭한 배선 하나에만 라벨이 나온다 (네트 전체 아님)', () => {
    // w1 클릭 → 스플라이스로 이어진 w1,w2,w3 가 모두 강조되지만
    // 라벨은 w1 에만 떠야 겹치지 않는다
    const hl = new Set(['w1', 'w2', 'w3']);
    const edges = docToEdges(sampleDoc, hl, 'w1');
    expect(edges.find((e) => e.id === 'w1')!.label).toBeTruthy();
    expect(edges.find((e) => e.id === 'w2')!.label).toBeUndefined();
    expect(edges.find((e) => e.id === 'w3')!.label).toBeUndefined();
    // 강조는 셋 다 유지
    expect(edges.filter((e) => e.style?.strokeWidth === 4)).toHaveLength(3);
  });

  it('라벨에 색·게이지·길이가 들어간다', () => {
    const edges = docToEdges(sampleDoc, new Set(['w1']), 'w1');
    const label = String(edges.find((e) => e.id === 'w1')!.label);
    expect(label).toContain('red/white'); // 2톤 색
    expect(label).toContain('AWG22');     // 게이지 대문자
    expect(label).toContain('120mm');     // 길이
  });

  it('라벨 배경이 있어 선 위에서도 읽힌다', () => {
    const e = docToEdges(sampleDoc, new Set(['w1']), 'w1').find((x) => x.id === 'w1')!;
    expect(e.labelShowBg).toBe(true);
    expect(e.labelBgStyle).toBeTruthy();
  });

  it('선택 안 해도 스펙을 data 로 들고 있다 (툴팁용)', () => {
    const edges = docToEdges(sampleDoc);
    const e = edges.find((x) => x.id === 'w1')!;
    expect((e.data as { spec: string }).spec).toContain('AWG22');
  });

  it('선 색은 항상 유지된다 (라벨 없어도 색으로 구분 가능)', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => e.style?.stroke)).toBe(true);
  });
});

describe('선 색 처리', () => {
  it('흰색 와이어는 옅은 회색으로 그려진다 (배경에 안 묻히게)', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('white')).toBe('#d1d5db');
  });

  it('노란색은 진하게 보정된다', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('yellow')).toBe('#eab308');
  });

  it('일반 색은 그대로', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('red')).toBe('red');
    expect(strokeColor('black')).toBe('black');
  });

  it('hex 코드도 허용', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('#ff8800')).toBe('#ff8800');
  });

  it('알 수 없는 값은 회색 (검정으로 오인 방지)', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('없는색')).toBe('#6b7280');
  });
});

describe('배선 레이어', () => {
  it('엣지는 노드 아래층(zIndex 0)에 그려진다', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => e.zIndex === 0)).toBe(true);
  });
});

describe('노드 레이어', () => {
  it('노드는 엣지보다 위층(zIndex 1)이다 — 선이 블록을 가로지르지 않음', async () => {
    const { docToNodes } = await import('./docToFlow');
    const nodes = docToNodes(sampleDoc, 'logical');
    expect(nodes.every((n) => n.zIndex === 1)).toBe(true);
  });
});
