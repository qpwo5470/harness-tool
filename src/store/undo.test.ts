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

  /**
   * 구간 길이는 표 안에서 타이핑으로 들어온다. 한 번 확정할 때 한 단계만 쌓여야
   * 실행취소가 쓸모 있다 — 글자마다 쌓이면 되돌리려다 다른 편집까지 밀려난다.
   */
  it('구간 길이 확정은 한 단계만 쌓이고, 지우면 다시 유도값으로 돌아간다', () => {
    const key = 'con:con-a|con:con-b';
    S().setSegmentLength?.(key, 300);
    expect(S().doc.segmentLengths).toEqual({ [key]: 300 });

    S().setSegmentLength?.(key, 420);
    S().undo();
    expect(S().doc.segmentLengths).toEqual({ [key]: 300 });
    S().undo();
    expect(S().doc.segmentLengths).toBeUndefined();
  });

  it('바뀌는 것이 없으면 히스토리를 쌓지 않는다', () => {
    const key = 'con:con-a|con:con-b';
    S().setSegmentLength?.(key, null);          // 지울 것이 없다
    expect(S().canUndo()).toBe(false);
    S().setSegmentLength?.(key, 300);
    const after = S().doc;
    S().setSegmentLength?.(key, 300);           // 같은 값 재확정
    expect(S().doc).toBe(after);
  });

  it('되돌릴 게 없을 때 undo 는 아무 일도 안 한다', () => {
    const before = S().doc;
    S().undo();
    expect(S().doc).toBe(before);
  });
});
