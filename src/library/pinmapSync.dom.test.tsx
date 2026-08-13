/**
 * 핀맵 에디터 → 도면 종단 회귀 시험.
 *
 * 재현 결함(전부 실행으로 확인한 것):
 *  1) 이미 도면에 놓인 커스텀 부품을 고쳐 저장해도 문서 스냅샷(usedParts)이 그대로였다.
 *     `addUsedPart` 가 계약상 같은 id 를 무시하기 때문. 이름을 바꿔도 도면 이름표는 옛 이름.
 *  2) 핀 수를 줄여도 커넥터의 옛 핀이 그대로 남고, 사용자에게 아무 표시가 없었다.
 *  3) 캔버스 하우징 심볼이 정의한 열×행대로 그려지는지 확인한 시험이 없었다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { LibraryPanel } from './LibraryPanel';
import { PinMapEditor } from './PinMapEditor';
import { ConnectorNode } from '../canvas/nodes';
import { instantiate } from './seed';
import { saveCustomParts } from './customParts';
import { useHarnessStore } from '../store/harnessStore';
import { currentToast, hideToast } from '../ui/Toast';
import { INSET, PITCH } from '../canvas/geometry';
import type { HarnessDocument, PartLibraryItem, PinSlot, Wire } from '../types';

beforeEach(() => {
  const bag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class { m22 = 1; };
  hideToast();
});
afterEach(() => cleanup());

function grid(cols: number, rows: number): PinSlot[] {
  return Array.from({ length: cols * rows }, (_, i) => ({
    index: i + 1, label: String(i + 1), offset: { x: i % cols, y: Math.floor(i / cols) },
  }));
}

const part6: PartLibraryItem = {
  id: 'custom-6p', category: 'housing', name: '내 6P', pinCount: 6, pinLayout: grid(3, 2),
};

/** 6핀 커넥터 한 개 + 6번 핀에 배선 한 본 */
function docWith(part: PartLibraryItem, wired: number[] = []): HarnessDocument {
  const pins = Array.from({ length: 6 }, (_, i) => ({ id: `pin${i + 1}`, index: i + 1 }));
  const wires: Wire[] = wired.map((n) => ({
    id: `w${n}`,
    from: { type: 'pin', connectorId: 'c1', pinId: `pin${n}` },
    to: { type: 'device', deviceId: 'd1', terminal: 'T1' },
    color: { base: 'red' }, gauge: { system: 'awg', value: 20 },
  }));
  return {
    schemaVersion: 1, id: 'doc-sync', name: '시험',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    connectors: [{ id: 'c1', kind: 'connector', housingId: part.id, orientation: 0, positions: {}, pins }],
    devices: [{ id: 'd1', name: '장치', terminals: ['T1'], positions: {} }],
    wires,
    usedParts: [part],
  };
}

/** 라이브러리 패널을 띄우고 '내 6P' 편집 창을 연다 */
function openEditor(part: PartLibraryItem, wired: number[] = []) {
  saveCustomParts([part]);
  useHarnessStore.getState().replaceDoc(docWith(part, wired));
  render(<LibraryPanel />);
  fireEvent.click(screen.getByTitle('편집'));
}

const doc = () => useHarnessStore.getState().doc;

describe('핀맵 편집이 도면에 반영된다', () => {
  it('이름을 바꾸면 문서 스냅샷의 이름도 바뀐다', () => {
    openEditor(part6);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '이름 바뀜' } });
    fireEvent.click(screen.getByText('저장'));

    expect(doc().usedParts.find((p) => p.id === 'custom-6p')!.name).toBe('이름 바뀜');
    expect(currentToast()?.message).toContain('이름 바뀜');
  });

  it('핀 수를 6 → 2 로 줄이면 정의도 커넥터도 함께 줄고, 그 사실을 알린다', () => {
    openEditor(part6);
    fireEvent.click(screen.getByLabelText('열 줄이기'));   // 3열 → 2열
    fireEvent.click(screen.getByLabelText('행 줄이기'));   // 2행 → 1행
    expect(screen.getByText('2핀')).toBeTruthy();
    fireEvent.click(screen.getByText('저장'));

    const used = doc().usedParts.find((p) => p.id === 'custom-6p')!;
    expect(used.pinCount).toBe(2);
    expect(used.pinLayout).toHaveLength(2);
    // 배선이 없으므로 옛 핀은 정리된다
    expect(doc().connectors[0].pins.map((p) => p.index)).toEqual([1, 2]);

    const msg = currentToast()!.message;
    expect(msg).toContain('빈 핀 4개 정리');
    expect(currentToast()!.undo).toBeTypeOf('function');
  });

  it('배선이 물린 핀은 말없이 지우지 않고 남긴 뒤 알린다', () => {
    openEditor(part6, [6]);                                 // 6번 핀에 배선 한 본
    fireEvent.click(screen.getByLabelText('열 줄이기'));
    fireEvent.click(screen.getByLabelText('행 줄이기'));
    fireEvent.click(screen.getByText('저장'));

    expect(doc().wires).toHaveLength(1);                    // 배선을 지우지 않는다
    expect(doc().connectors[0].pins.map((p) => p.index)).toEqual([1, 2, 6]);
    expect(currentToast()!.message).toContain('배선 1본이 없어진 핀에 남음');
  });

  it('토스트의 실행취소가 편집 전 도면으로 되돌린다', () => {
    openEditor(part6);
    fireEvent.click(screen.getByLabelText('열 줄이기'));
    fireEvent.click(screen.getByLabelText('행 줄이기'));
    fireEvent.click(screen.getByText('저장'));
    expect(doc().connectors[0].pins).toHaveLength(2);

    currentToast()!.undo!();
    expect(doc().usedParts.find((p) => p.id === 'custom-6p')!.pinCount).toBe(6);
    expect(doc().connectors[0].pins).toHaveLength(6);
  });

  it('핀 수를 늘리면 커넥터에 핀이 생긴다', () => {
    openEditor(part6);
    fireEvent.click(screen.getByLabelText('열 늘리기'));    // 3열 → 4열 (4×2 = 8핀)
    expect(screen.getByText('8핀')).toBeTruthy();
    fireEvent.click(screen.getByText('저장'));

    expect(doc().connectors[0].pins.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(currentToast()!.message).toContain('핀 2개 추가');
  });
});

describe('핀맵에서 정의한 형상이 캔버스 하우징 심볼로 그대로 나온다', () => {
  /** 핀맵 에디터로 부품을 만들고, 그 정의로 그린 노드의 패드 좌표를 읽는다 */
  function definePartAndRender(steps: () => void) {
    const onSave = vi.fn();
    render(<PinMapEditor onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '정의 시험' } });
    steps();
    fireEvent.click(screen.getByText('저장'));
    cleanup();

    const part = onSave.mock.calls[0][0] as PartLibraryItem;
    const conn = instantiate(part, { x: 0, y: 0 });
    const { container } = render(
      <ReactFlowProvider>
        <ConnectorNode
          id="c1" type="connector" dragging={false} zIndex={1}
          selectable selected={false} draggable deletable isConnectable
          positionAbsoluteX={0} positionAbsoluteY={0}
          data={{ connector: conn, housing: part, view: 'logical' } as never}
        />
      </ReactFlowProvider>,
    );
    const pads = [...container.querySelectorAll('.hz-pad')] as HTMLElement[];
    const box = container.querySelector('.hz-housing') as HTMLElement;
    return { part, pads, box };
  }

  it('2열 3행으로 정의하면 패드가 2열 3행 자리에 찍힌다', () => {
    const { part, pads, box } = definePartAndRender(() => {
      fireEvent.click(screen.getByLabelText('열 줄이기'));   // 4 → 3
      fireEvent.click(screen.getByLabelText('열 줄이기'));   // 3 → 2
      fireEvent.click(screen.getByLabelText('행 늘리기'));   // 1 → 2
      fireEvent.click(screen.getByLabelText('행 늘리기'));   // 2 → 3
    });

    expect(part.pinCount).toBe(6);
    expect(pads).toHaveLength(6);
    expect(box.style.width).toBe('68px');    // 2열
    expect(box.style.height).toBe('98px');   // 3행
    const at = pads.map((p) => [p.style.left, p.style.top].join(','));
    expect(at).toEqual([
      `${INSET}px,${INSET}px`,
      `${INSET + PITCH}px,${INSET}px`,
      `${INSET}px,${INSET + PITCH}px`,
      `${INSET + PITCH}px,${INSET + PITCH}px`,
      `${INSET}px,${INSET + PITCH * 2}px`,
      `${INSET + PITCH}px,${INSET + PITCH * 2}px`,
    ]);
  });

  it('1핀으로 정의하면 한 칸짜리 심볼이 된다', () => {
    const { part, pads, box } = definePartAndRender(() => {
      for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText('열 줄이기'));
    });
    expect(part.pinCount).toBe(1);
    expect(pads).toHaveLength(1);
    expect(box.style.width).toBe('38px');
    expect(box.style.height).toBe('38px');
  });

  it('24핀(12열 2행)도 열 수만큼 넓어진다', () => {
    const { part, pads, box } = definePartAndRender(() => {
      for (let i = 0; i < 8; i++) fireEvent.click(screen.getByLabelText('열 늘리기'));  // 4 → 12
      fireEvent.click(screen.getByLabelText('행 늘리기'));                              // 1 → 2
    });
    expect(part.pinCount).toBe(24);
    expect(pads).toHaveLength(24);
    expect(box.style.width).toBe('368px');   // 12 × 30 + 12 − 4
    expect(box.style.height).toBe('68px');
  });

  it('한글·긴 신호명을 넣어도 패드 수와 자리는 그대로다', () => {
    const { part, pads } = definePartAndRender(() => {
      fireEvent.click(screen.getByLabelText(/^핀 1 · 1열 1행/));
      fireEvent.change(screen.getByLabelText('신호명'), {
        target: { value: '무정전 +34V 전원 (마스터측)' },
      });
      fireEvent.change(screen.getByLabelText('핀 표기'), { target: { value: 'A1-전원' } });
    });

    expect(pads).toHaveLength(4);
    expect(part.pinLayout![0].signal).toBe('무정전 +34V 전원 (마스터측)');
    // 표기가 길어도 패드는 격자 자리를 지킨다 (넘치는 글자는 CSS 가 자른다)
    expect(pads[0].style.left).toBe(`${INSET}px`);
    expect(pads[1].style.left).toBe(`${INSET + PITCH}px`);
    expect(pads[0].textContent).toBe('A1-전원');
  });
});
