import { describe, it, expect } from 'vitest';
import { docToNodes } from './docToFlow';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { ConnectorNodeData } from './nodes';

describe('방향 변경이 노드 데이터에 반영되는가', () => {
  it('orientation 을 바꾸면 노드 data 에 새 값이 들어간다', () => {
    const rotated = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a' ? { ...c, orientation: 90 as const } : c,
      ),
    };
    const nodes = docToNodes(rotated, 'physical');
    const n = nodes.find((x) => x.id === 'con-a')!;
    expect((n.data as unknown as ConnectorNodeData).connector.orientation).toBe(90);
  });

  it('노드 객체가 새 참조로 만들어진다 (React Flow 리렌더 조건)', () => {
    const a = docToNodes(sampleDoc, 'physical').find((n) => n.id === 'con-a')!;
    const rotated = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a' ? { ...c, orientation: 180 as const } : c,
      ),
    };
    const b = docToNodes(rotated, 'physical').find((n) => n.id === 'con-a')!;
    expect(a.data).not.toBe(b.data); // 참조가 달라야 리렌더됨
  });
});
