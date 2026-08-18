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

// ================================================================
// B-1 세트 편집
// ================================================================
describe('B-1 세트 편집도 시간순으로 되돌아간다', () => {
  const perSetOf = () => S().kit.set.items.find((i) => i.harnessId === S().doc.id)?.perSet;

  /**
   * 회귀(감사 B-1): `updateSet`·`setPerSet` 이 히스토리 밖에 있어서
   * "커넥터 추가 → 세트당 수량 7 → ⌘Z" 가 **수량은 7 그대로 둔 채 커넥터를 지웠다.**
   * 사용자가 마지막에 한 동작은 수량 변경인데 그 앞의 도면 편집이 사라진 것이다.
   */
  it('마지막에 한 세트 편집이 먼저 되돌아간다', () => {
    const base = S().doc.connectors.length;
    S().addConnector(conn('c-set'));
    S().setPerSet(S().doc.id, 7);
    expect(perSetOf()).toBe(7);

    S().undo();
    expect(perSetOf()).toBe(1);                       // 수량이 먼저 돌아온다
    expect(S().doc.connectors).toHaveLength(base + 1); // 커넥터는 그대로 남는다

    S().undo();
    expect(S().doc.connectors).toHaveLength(base);     // 그다음이 도면 편집이다
  });

  it('세트 편집도 다시실행된다', () => {
    S().setPerSet(S().doc.id, 5);
    S().undo();
    expect(perSetOf()).toBe(1);
    S().redo();
    expect(perSetOf()).toBe(5);
  });

  it('주문 수·품번 변경도 되돌아간다', () => {
    S().updateSet({ orderQty: 12 });
    expect(S().kit.set.orderQty).toBe(12);
    S().undo();
    expect(S().kit.set.orderQty).toBe(1);
  });

  /**
   * 세트 품번·이름은 **글자마다** updateSet 이 돈다. 한 글자에 한 단계씩 쌓으면
   * 도면 히스토리가 통째로 밀려나므로, 연달아 들어온 세트 편집은 한 덩어리다.
   */
  it('연속된 세트 편집은 한 덩어리로 묶인다', () => {
    const base = S().doc.connectors.length;
    S().addConnector(conn('c-burst'));
    for (const pn of ['K', 'KI', 'KIT', 'KIT-']) S().updateSet({ pn });
    S().undo();
    expect(S().kit.set.pn).toBe('');                   // 타이핑 묶음 전체가 돌아간다
    expect(S().doc.connectors).toHaveLength(base + 1);
    S().undo();
    expect(S().doc.connectors).toHaveLength(base);
  });

  it('바뀌는 것이 없으면 히스토리를 쌓지 않는다', () => {
    // 세트(kit)는 문서 교체와 무관하게 살아 있으므로 지금 값을 그대로 다시 넣는다
    S().updateSet({ orderQty: S().kit.set.orderQty });
    S().setPerSet(S().doc.id, perSetOf()!);
    expect(S().canUndo()).toBe(false);
  });
});

// ================================================================
// B-2 부품 스냅샷
// ================================================================
describe('B-2 부품 스냅샷도 함께 되돌아간다', () => {
  const part = { id: 'lib-tmp', category: 'housing' as const, name: '임시 부품', pinCount: 2 };

  /**
   * 회귀(감사 B-2): 라이브러리 드롭이 `addUsedPart` → `addConnector` 순서였는데
   * 앞엣것이 스냅샷을 쌓지 않아, 뒤엣것이 찍는 스냅샷에 부품이 **이미 들어 있었다.**
   * 그래서 ⌘Z 뒤 커넥터는 사라지는데 usedParts 는 남고 더 되돌려도 안 사라졌다.
   * 지금은 히스토리를 쌓는 액션을 먼저 부른다(LibraryPanel·HarnessCanvas 주석).
   */
  it('커넥터를 먼저 넣으면 ⌘Z 한 번이 부품까지 되돌린다', () => {
    const before = S().doc.usedParts.length;
    S().addConnector({ ...conn('c-part'), housingId: part.id });
    S().addUsedPart(part);
    expect(S().doc.usedParts).toHaveLength(before + 1);

    S().undo();
    expect(S().doc.connectors.find((c) => c.id === 'c-part')).toBeUndefined();
    expect(S().doc.usedParts).toHaveLength(before);     // 고치기 전: before + 1 로 남았다
  });
});

// ================================================================
// B-3 스택 상한
// ================================================================
describe('B-3 스택 상한', () => {
  /**
   * 회귀(감사 B-3): 상한이 50 이라 60회 편집 뒤 무한 undo 를 해도 커넥터 10개가
   * 영영 남았고, 잘렸다는 표시도 없었다. 스냅샷은 구조를 공유하므로 상한을
   * 200 으로 올려도 한 도면치 메모리를 크게 넘지 않는다.
   */
  it('60회 편집을 전부 되돌릴 수 있다', () => {
    const base = S().doc.connectors.length;
    for (let i = 0; i < 60; i += 1) S().addConnector(conn(`c-${i}`));
    expect(S().doc.connectors).toHaveLength(base + 60);
    while (S().canUndo()) S().undo();
    expect(S().doc.connectors).toHaveLength(base);
  });
});
