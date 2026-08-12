/**
 * 파트 탭 — Claude Design 2차 §9.
 *
 * 확인하는 것:
 *  - 집계 범위를 바꾸면 숫자가 실제로 바뀐다(하네스 하나 → 세트 전체 × 세트 수)
 *  - 상태바가 언제나 범위를 밝힌다(범위 없는 숫자를 두지 않는다)
 *  - 발주를 막는 항목을 누르면 그 하네스·대상으로 넘어간다
 *  - 하네스 단위의 총수량은 저장값이 아니라 `perSet × orderQty` 파생값이다
 *  - 발주 문구가 orderText 그대로다
 *  - 세트 구성 행을 펼치면 도면 열기 / 세트당 스테퍼가 나온다
 *  - 발주 대상 | 전체 로 장치(발주 제외) 그룹이 드나든다
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { HarnessDocument, KitDocument, PartLibraryItem } from '../types';
import { orderText } from '../store/kit';
import { PartsPanel } from './PartsPanel';
import type { PartsScope } from './PartsPanel';

// ================================================================
// 픽스처 — 하네스 3종이 든 세트 (A 1개 + B 2개 + C 1개) × 5세트
// ================================================================

const housing6: PartLibraryItem = {
  id: 'h6', category: 'housing', name: 'MDB 6P', mpn: '39-01-2060', pinCount: 6,
};
const housing2: PartLibraryItem = {
  id: 'h2', category: 'housing', name: 'SMH250 2P', pinCount: 2,
};
const term: PartLibraryItem = {
  id: 't1', category: 'terminal', name: '39-00-0207',
};

const BASE = { schemaVersion: 1, createdAt: '2026-08-12T00:00:00Z', updatedAt: '2026-08-12T00:00:00Z' } as const;

/** A — 문제 없는 하네스. 전선 300mm. */
const harnessA: HarnessDocument = {
  ...BASE,
  id: 'hA',
  name: 'MDB 전원·통신',
  drawingNo: 'HRN-01',
  rev: 'B',
  letter: 'A',
  connectors: [
    {
      id: 'c1', kind: 'connector', housingId: 'h6', orientation: 0,
      positions: { logical: { x: 0, y: 0 } },
      pins: [1, 2, 3].map((i) => ({ id: `p${i}`, index: i, terminalId: 't1' })),
    },
    {
      id: 'c2', kind: 'connector', housingId: 'h2', orientation: 0,
      positions: { logical: { x: 200, y: 0 } },
      pins: [1, 2].map((i) => ({ id: `q${i}`, index: i, terminalId: 't1' })),
    },
  ],
  devices: [{ id: 'd1', name: 'Raspberry Pi', terminals: ['5V', 'GND'], positions: { logical: { x: 300, y: 100 } } }],
  wires: [
    {
      id: 'w1',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
      to: { type: 'pin', connectorId: 'c2', pinId: 'q1' },
      color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 120,
    },
    {
      id: 'w2',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p2' },
      to: { type: 'pin', connectorId: 'c2', pinId: 'q2' },
      color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 100,
    },
    {
      id: 'w3',
      from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
      to: { type: 'device', deviceId: 'd1', terminal: '5V' },
      color: { base: 'black', stripe: 'white' }, gauge: { system: 'awg', value: 24 }, lengthMm: 80,
    },
  ],
  usedParts: [housing6, housing2, term],
};

/** B — 길이 미입력 1본(발주를 막는 항목) */
const harnessB: HarnessDocument = {
  ...BASE,
  id: 'hB',
  name: '도어 스위치',
  drawingNo: 'HRN-02',
  letter: 'B',
  connectors: [
    {
      id: 'c3', kind: 'connector', housingId: 'h2', orientation: 0,
      positions: { logical: { x: 0, y: 0 } },
      pins: [{ id: 'b1', index: 1, terminalId: 't1' }],
    },
    {
      id: 'c4', kind: 'connector', housingId: 'h2', orientation: 0,
      positions: { logical: { x: 200, y: 0 } },
      pins: [{ id: 'b2', index: 1, terminalId: 't1' }],
    },
  ],
  devices: [],
  wires: [
    {
      id: 'wb1',
      from: { type: 'pin', connectorId: 'c3', pinId: 'b1' },
      to: { type: 'pin', connectorId: 'c4', pinId: 'b2' },
      color: { base: 'green' }, gauge: { system: 'awg', value: 24 },
    },
  ],
  usedParts: [housing2, term],
};

/** C — 터미널 미지정 2핀(발주를 막는 항목). 전선 200mm. */
const harnessC: HarnessDocument = {
  ...BASE,
  id: 'hC',
  name: 'LAN 연장',
  drawingNo: 'HRN-03',
  letter: 'C',
  connectors: [
    {
      id: 'c5', kind: 'connector', housingId: 'h6', orientation: 0,
      positions: { logical: { x: 0, y: 0 } },
      pins: [{ id: 'e1', index: 1 }],
    },
    {
      id: 'c6', kind: 'connector', housingId: 'h6', orientation: 0,
      positions: { logical: { x: 200, y: 0 } },
      pins: [{ id: 'e2', index: 1 }],
    },
  ],
  devices: [],
  wires: [
    {
      id: 'wc1',
      from: { type: 'pin', connectorId: 'c5', pinId: 'e1' },
      to: { type: 'pin', connectorId: 'c6', pinId: 'e2' },
      color: { base: 'blue' }, gauge: { system: 'awg', value: 22 }, lengthMm: 200,
    },
  ],
  usedParts: [housing6],
};

function makeKit(): KitDocument {
  return {
    schemaVersion: 2,
    id: 'kit-1',
    name: '자판기 1대분 하네스 세트',
    createdAt: BASE.createdAt,
    updatedAt: BASE.updatedAt,
    harnesses: [harnessA, harnessB, harnessC],
    set: {
      id: 'set-1',
      pn: 'KIT-2408',
      name: '자판기 1대분 하네스 세트',
      rev: 'B',
      items: [
        { harnessId: 'hA', perSet: 1 },
        { harnessId: 'hB', perSet: 2 },
        { harnessId: 'hC', perSet: 1 },
      ],
      orderQty: 5,
    },
  };
}

type Handlers = {
  onChangeScope: ReturnType<typeof vi.fn>;
  onGoToBlocker: ReturnType<typeof vi.fn>;
  onChangeOrderQty: ReturnType<typeof vi.fn>;
  onChangePerSet: ReturnType<typeof vi.fn>;
  onOpenHarness: ReturnType<typeof vi.fn>;
};

function setup(scope: PartsScope = { kind: 'harness', harnessId: 'hA' }) {
  const kit = makeKit();
  const h: Handlers = {
    onChangeScope: vi.fn(),
    onGoToBlocker: vi.fn(),
    onChangeOrderQty: vi.fn(),
    onChangePerSet: vi.fn(),
    onOpenHarness: vi.fn(),
  };
  const view = render(
    <PartsPanel kit={kit} activeHarnessId="hA" scope={scope} {...h} />,
  );
  const rerenderWith = (s: PartsScope) =>
    view.rerender(<PartsPanel kit={kit} activeHarnessId="hA" scope={s} {...h} />);
  return { kit, h, rerenderWith };
}

/** 행(.pt-row) 안의 수량 텍스트 */
function qtyOf(name: string): string {
  const row = screen.getByText(name).closest('.pt-row') as HTMLElement;
  return within(row).getByText((_t, el) => el?.className === 'pt-qty num').textContent ?? '';
}

afterEach(cleanup);

describe('파트 탭 — 파트 단위', () => {
  it('집계 범위를 세트로 바꾸면 수량이 세트당 × 주문 세트 수만큼 늘어난다', () => {
    const { rerenderWith } = setup({ kind: 'harness', harnessId: 'hA' });

    // 하네스 A 1개 기준 — MDB 6P 는 1개
    expect(qtyOf('MDB 6P')).toBe('1');

    // 세트 전체 — A(1개 × 1개/세트 × 5세트) + C(2개 × 1개/세트 × 5세트) = 15
    rerenderWith({ kind: 'set' });
    expect(qtyOf('MDB 6P')).toBe('15');
  });

  it('상태바가 범위를 밝힌다 — 어떤 숫자도 범위 없이 두지 않는다', () => {
    const { rerenderWith } = setup({ kind: 'harness', harnessId: 'hA' });

    const bar = screen.getByRole('status');
    expect(bar.textContent).toContain('하네스 A');
    expect(bar.textContent).toContain('전선 300mm');
    expect(bar.textContent).toContain('1개 기준');

    rerenderWith({ kind: 'set' });
    const bar2 = screen.getByRole('status');
    expect(bar2.textContent).toContain('세트 전체 (A+B+C)');
    expect(bar2.textContent).toContain('전선 2,500mm');   // (300×5) + (200×5)
    expect(bar2.textContent).toContain('5세트 기준');
  });

  it('집계 범위 셀렉트를 바꾸면 onChangeScope 가 불린다', () => {
    const { h } = setup({ kind: 'harness', harnessId: 'hA' });
    fireEvent.change(screen.getByLabelText('집계 범위'), { target: { value: 'set' } });
    expect(h.onChangeScope).toHaveBeenCalledWith({ kind: 'set' });

    fireEvent.change(screen.getByLabelText('집계 범위'), { target: { value: 'h:hC' } });
    expect(h.onChangeScope).toHaveBeenLastCalledWith({ kind: 'harness', harnessId: 'hC' });
  });

  it('발주를 막는 항목이 맨 위에 서고, 누르면 그 하네스·대상으로 넘어간다', () => {
    const { h } = setup({ kind: 'set' });

    // C 는 터미널 미지정 2핀, B 는 길이 미입력 1본
    expect(screen.getByText('터미널 미지정 2핀')).toBeTruthy();
    fireEvent.click(screen.getByText('길이 미입력 1본'));
    expect(h.onGoToBlocker).toHaveBeenCalledWith('hB', 'wb1');
  });

  it('발주 대상 | 전체 로 장치(발주 제외) 그룹이 드나든다', () => {
    setup({ kind: 'harness', harnessId: 'hA' });

    expect(screen.queryByText('Raspberry Pi')).toBeNull();
    fireEvent.click(screen.getByText('전체'));
    expect(screen.getByText('장치 · 발주 제외')).toBeTruthy();
    expect(screen.getByText('Raspberry Pi')).toBeTruthy();
    // 집계 규칙이 그룹 헤더에 적혀 있다
    expect(screen.getByText('배선된 핀 수 기준')).toBeTruthy();
    expect(screen.getByText('색 · 게이지별 길이 합')).toBeTruthy();
  });
});

describe('파트 탭 — 하네스 단위', () => {
  function toHarnessUnit() {
    fireEvent.click(screen.getByText('하네스 단위'));
  }

  it('총수량은 저장값이 아니라 perSet × orderQty 로 파생된다', () => {
    const { h } = setup();
    toHarnessUnit();

    // B: 세트당 2개 × 5세트 = 10개
    const rowB = screen.getByText('도어 스위치').closest('.pt-item') as HTMLElement;
    expect(within(rowB).getByText('10개')).toBeTruthy();
    expect(within(rowB).getByText('세트당 ×2')).toBeTruthy();

    // 세트 전체 하네스 = (1+2+1) × 5 = 20
    expect(screen.getByText('20').textContent).toBe('20');

    fireEvent.click(screen.getByLabelText('주문 세트 수 증가'));
    expect(h.onChangeOrderQty).toHaveBeenCalledWith(6);
  });

  it('발주 문구는 orderText 그대로이고 복사 버튼이 붙는다', () => {
    const { kit } = setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    toHarnessUnit();

    const block = document.querySelector('.pt-ordertext') as HTMLElement;
    expect(block.textContent).toBe(orderText(kit));
    expect(block.textContent).toContain('자판기 1대분 하네스 세트 (KIT-2408) — 5세트');
    expect(block.textContent).toContain('B. HRN-02 도어 스위치  세트당 2개 → 10개');
    expect(block.textContent).toContain('합계 하네스 20개');

    fireEvent.click(screen.getByText('발주 문구 복사'));
    expect(writeText).toHaveBeenCalledWith(orderText(kit));
  });

  it('세트 구성 행을 펼치면 상세와 도면 열기 · 세트당 스테퍼가 나온다', () => {
    const { h } = setup();
    toHarnessUnit();

    expect(screen.queryByText('도면 열기')).toBeNull();
    fireEvent.click(screen.getByText('MDB 전원·통신'));

    expect(screen.getByText('끝단')).toBeTruthy();
    expect(screen.getByText(/300mm — 전선 길이 합/)).toBeTruthy();

    fireEvent.click(screen.getByText('도면 열기'));
    expect(h.onOpenHarness).toHaveBeenCalledWith('hA');

    fireEvent.click(screen.getByLabelText('하네스 A 세트당 수량 증가'));
    expect(h.onChangePerSet).toHaveBeenCalledWith('hA', 2);
  });

  it('제작 사양서에 작업 지시와 첨부 목록이 들어간다', () => {
    setup();
    toHarnessUnit();
    fireEvent.click(screen.getByText('MDB 전원·통신'));
    fireEvent.click(screen.getByText('제작 사양서'));

    expect(screen.getByText('작업 지시')).toBeTruthy();
    expect(screen.getByText(/압착 규격 — 39-00-0207/)).toBeTruthy();
    expect(screen.getByText('도통 · 오결선 검사 전수')).toBeTruthy();
    expect(screen.getByText('양 끝단 열수축 라벨 — 도번 · Rev 표기')).toBeTruthy();
    expect(screen.getByText('도면 PDF (논리 · 물리 2매)')).toBeTruthy();
  });
});
