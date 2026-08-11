import { describe, it, expect, beforeEach } from 'vitest';
import { useHarnessStore } from './harnessStore';
import { sampleDoc } from '../fixtures/sampleDoc';

const S = () => useHarnessStore.getState();

beforeEach(() => S().replaceDoc(sampleDoc));

const conn = (id: string) => ({
  id, kind: 'connector' as const, housingId: 'lib-xh-4p',
  orientation: 0 as const, positions: {}, pins: [{ id: `${id}-p1`, index: 1 }],
});

describe('실행취소 / 다시실행', () => {
  it('불러오기 직후에는 되돌릴 게 없다', () => {
    expect(S().canUndo()).toBe(false);
    expect(S().canRedo()).toBe(false);
  });

  it('커넥터 추가를 되돌린다', () => {
    const before = S().doc.connectors.length;
    S().addConnector(conn('c-new'));
    expect(S().doc.connectors).toHaveLength(before + 1);
    S().undo();
    expect(S().doc.connectors).toHaveLength(before);
  });

  it('삭제를 되돌리면 물려있던 와이어까지 복구된다', () => {
    // con-a 삭제 시 w1(그 커넥터에 물린 와이어)도 함께 사라짐
    S().remove('con-a');
    expect(S().doc.wires.find((w) => w.id === 'w1')).toBeUndefined();
    S().undo();
    expect(S().doc.connectors.find((c) => c.id === 'con-a')).toBeDefined();
    expect(S().doc.wires.find((w) => w.id === 'w1')).toBeDefined();
  });

  it('undo 후 redo 로 되돌아온다', () => {
    S().addConnector(conn('c-x'));
    S().undo();
    expect(S().doc.connectors.find((c) => c.id === 'c-x')).toBeUndefined();
    S().redo();
    expect(S().doc.connectors.find((c) => c.id === 'c-x')).toBeDefined();
  });

  it('undo 후 새 편집을 하면 redo 는 무효화된다', () => {
    S().addConnector(conn('c-1'));
    S().undo();
    expect(S().canRedo()).toBe(true);
    S().addConnector(conn('c-2'));
    expect(S().canRedo()).toBe(false);
  });

  it('여러 단계 연속 되돌리기', () => {
    const base = S().doc.connectors.length;
    S().addConnector(conn('a'));
    S().addConnector(conn('b'));
    S().addConnector(conn('c'));
    expect(S().doc.connectors).toHaveLength(base + 3);
    S().undo(); S().undo(); S().undo();
    expect(S().doc.connectors).toHaveLength(base);
  });

  it('와이어 속성 편집도 되돌려진다', () => {
    const orig = S().doc.wires[0].color.base;
    S().updateWire(S().doc.wires[0].id, { color: { base: 'purple' } });
    expect(S().doc.wires[0].color.base).toBe('purple');
    S().undo();
    expect(S().doc.wires[0].color.base).toBe(orig);
  });

  it('되돌릴 게 없을 때 undo 는 아무 일도 안 한다', () => {
    const before = S().doc;
    S().undo();
    expect(S().doc).toBe(before);
  });
});
