/**
 * 도번 일괄 부여 — 계획(planDrawingNumbers) · 적용(applyDrawingNumbers) · 스토어(assignDrawingNumbers).
 *
 * 지키는 것: 빈 칸에만 넣는다 · 이미 있는 도번은 덮지 않는다 · 겹치는 번호를 만들지 않는다 ·
 * 세트 품번이 없으면 아무것도 지어내지 않는다 · Rev 는 따로 고를 때만 · 실행취소 한 번에 전부.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { HarnessDocument, KitDocument } from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import { applyDrawingNumbers, planDrawingNumbers, toKit, withNewHarness } from './kit';
import { assignDrawingNumbers, useHarnessStore } from './harnessStore';

const h = (id: string, extra: Partial<HarnessDocument> = {}): HarnessDocument => ({
  ...sampleDoc, id, name: `하네스 ${id}`, ...extra,
});

function kitOf(hs: HarnessDocument[], pn = 'EW', rev?: string): KitDocument {
  let k = toKit(hs[0]);
  for (const x of hs.slice(1)) k = withNewHarness(k, x);
  return { ...k, set: { ...k.set, pn, ...(rev ? { rev } : {}) } };
}

describe('planDrawingNumbers', () => {
  it('세트 품번-01, -02 … 를 하네스 순서대로, 빈 하네스에만', () => {
    const kit = kitOf([h('a'), h('b', { drawingNo: 'EW-02' }), h('c')]);
    const plan = planDrawingNumbers(kit);
    expect(plan.map((a) => [a.letter, a.drawingNo])).toEqual([['A', 'EW-01'], ['C', 'EW-03']]);
  });

  it('공백뿐인 도번은 빈 것으로 본다', () => {
    const plan = planDrawingNumbers(kitOf([h('a', { drawingNo: '  ' })]));
    expect(plan[0].drawingNo).toBe('EW-01');
  });

  it('자리 번호를 다른 하네스가 이미 쓰면 겹치지 않는 다음 번호를 준다', () => {
    // A 가 손으로 EW-02 를 쓰고 있다 → B 의 자리 번호 EW-02 는 겹친다
    const kit = kitOf([h('a', { drawingNo: 'EW-02' }), h('b'), h('c')]);
    const plan = planDrawingNumbers(kit);
    expect(plan.map((a) => a.drawingNo)).toEqual(['EW-04', 'EW-03']);
    expect(new Set(plan.map((a) => a.drawingNo)).size).toBe(plan.length);
  });

  it('세트 품번이 비어 있으면 아무것도 계획하지 않는다', () => {
    expect(planDrawingNumbers(kitOf([h('a')], '  '))).toEqual([]);
  });

  it('하네스가 100종을 넘으면 세 자리로', () => {
    const many = Array.from({ length: 100 }, (_, i) => h(`x${i}`));
    expect(planDrawingNumbers(kitOf(many))[0].drawingNo).toBe('EW-001');
  });

  it('Rev 는 applySetRev 일 때만, Rev 가 빈 하네스에만', () => {
    const kit = kitOf([h('a'), h('b', { rev: 'C', drawingNo: 'EW-02' })], 'EW', 'A');
    expect(planDrawingNumbers(kit).some((a) => a.rev != null)).toBe(false);
    const plan = planDrawingNumbers(kit, { applySetRev: true });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ harnessId: 'a', drawingNo: 'EW-01', rev: 'A' });
  });
});

describe('applyDrawingNumbers', () => {
  it('계획에 없는 하네스는 그대로(같은 참조), 이미 채워진 칸은 덮지 않는다', () => {
    const kit = kitOf([h('a'), h('b', { drawingNo: 'MINE' })]);
    const plan = [
      { harnessId: 'a', letter: 'A', name: 'a', drawingNo: 'EW-01' },
      // 계획 뒤에 누가 채웠다고 가정 — 덮으면 안 된다
      { harnessId: 'b', letter: 'B', name: 'b', drawingNo: 'EW-02' },
    ];
    const next = applyDrawingNumbers(kit, plan, '2030-01-01T00:00:00Z');
    expect(next.harnesses[0].drawingNo).toBe('EW-01');
    expect(next.harnesses[1].drawingNo).toBe('MINE');
    expect(applyDrawingNumbers(kit, [])).toBe(kit);
  });
});

describe('assignDrawingNumbers (스토어)', () => {
  const S = () => useHarnessStore.getState();
  beforeEach(() => {
    S().replaceKit(kitOf([h('a'), h('b', { drawingNo: 'KEEP' }), h('c')], 'EW', 'B'));
  });

  it('세트 전체와 활성 하네스에 함께 들어가고, 실행취소 한 번에 전부 돌아간다', () => {
    expect(S().activeHarnessId).toBe('a');
    const n = assignDrawingNumbers(planDrawingNumbers(S().kit));
    expect(n).toBe(2);
    expect(S().doc.drawingNo).toBe('EW-01');
    expect(S().kit.harnesses.map((x) => x.drawingNo)).toEqual(['EW-01', 'KEEP', 'EW-03']);
    expect(S().kit.harnesses.every((x) => x.rev == null)).toBe(true);

    S().undo();
    expect(S().doc.drawingNo).toBeUndefined();
    expect(S().kit.harnesses.map((x) => x.drawingNo)).toEqual([undefined, 'KEEP', undefined]);
    S().redo();
    expect(S().kit.harnesses.map((x) => x.drawingNo)).toEqual(['EW-01', 'KEEP', 'EW-03']);
  });

  it('Rev 를 고르면 빈 Rev 에 세트 Rev 를 적는다', () => {
    assignDrawingNumbers(planDrawingNumbers(S().kit, { applySetRev: true }));
    expect(S().kit.harnesses.map((x) => x.rev)).toEqual(['B', 'B', 'B']);
    expect(S().doc.rev).toBe('B');
  });

  it('바뀌는 것이 없으면 히스토리를 쌓지 않는다', () => {
    expect(assignDrawingNumbers([])).toBe(0);
    expect(S().canUndo()).toBe(false);
  });

  it('활성 하네스를 편집 중이던 내용도 잃지 않는다', () => {
    S().rename('바뀐 이름');
    assignDrawingNumbers(planDrawingNumbers(S().kit));
    expect(S().doc.name).toBe('바뀐 이름');
    expect(S().kit.harnesses[0].name).toBe('바뀐 이름');
    expect(S().kit.harnesses[0].drawingNo).toBe('EW-01');
  });
});
