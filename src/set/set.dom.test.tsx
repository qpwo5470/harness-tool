/**
 * 세트 개요 — Claude Design 2차 §4.
 *
 * 확인하는 것: 카드 렌더 · 미니 도면이 하네스마다 다른지 · 세트당 스테퍼 ·
 * 총수량이 `perSet × orderQty` 로만 파생되는지 · 발주 전 확인 클릭 ·
 * 하네스 추가/삭제 · 선택 카드 강조.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { HarnessDocument, KitDocument, PartLibraryItem, Pin } from '../types';
import { SetOverview } from './SetOverview';

const TERM = 'term-1';

const housing6: PartLibraryItem = {
  id: 'h6',
  category: 'housing',
  name: 'MDB 6P',
  pinCount: 6,
  pinLayout: [
    { index: 1, offset: { x: 0, y: 0 } },
    { index: 2, offset: { x: 1, y: 0 } },
    { index: 3, offset: { x: 2, y: 0 } },
    { index: 4, offset: { x: 0, y: 1 } },
    { index: 5, offset: { x: 1, y: 1 } },
    { index: 6, offset: { x: 2, y: 1 } },
  ],
};

const housing2: PartLibraryItem = {
  id: 'h2',
  category: 'housing',
  name: 'SMH250 2P',
  pinCount: 2,
  pinLayout: [
    { index: 1, offset: { x: 0, y: 0 } },
    { index: 2, offset: { x: 1, y: 0 } },
  ],
};

const rj45: PartLibraryItem = {
  id: 'h8',
  category: 'housing',
  name: 'RJ45 8P8C',
  pinCount: 8,
  pinLayout: Array.from({ length: 8 }, (_, i) => ({ index: i + 1, offset: { x: i, y: 0 } })),
};

const pins = (prefix: string, n: number, withTerminal: boolean): Pin[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    index: i + 1,
    label: String(i + 1),
    terminalId: withTerminal ? TERM : undefined,
  }));

/** A — 터미널 하나가 비어 있다(발주를 막는 항목) */
function harnessA(): HarnessDocument {
  const p = pins('p', 2, true);
  p[0] = { ...p[0], terminalId: undefined };
  return {
    schemaVersion: 1,
    id: 'hA',
    name: 'MDB 전원·통신',
    letter: 'A',
    drawingNo: 'HRN-2408-01',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    connectors: [
      {
        id: 'c1', kind: 'connector', housingId: 'h6', orientation: 0,
        positions: { logical: { x: 50, y: 150 } }, pins: p,
      },
      {
        id: 'c2', kind: 'connector', housingId: 'h2', orientation: 0,
        positions: { logical: { x: 520, y: 300 } }, pins: pins('q', 2, true),
      },
    ],
    devices: [],
    wires: [
      {
        id: 'w1',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
        to: { type: 'pin', connectorId: 'c2', pinId: 'q1' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 510,
      },
      {
        id: 'w2',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p2' },
        to: { type: 'pin', connectorId: 'c2', pinId: 'q2' },
        color: { base: 'black' }, gauge: { system: 'awg', value: 22 }, lengthMm: 490,
      },
    ],
    usedParts: [housing6, housing2],
  };
}

/** B — 완료 */
function harnessB(): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'hB',
    name: '도어 스위치',
    letter: 'B',
    drawingNo: 'HRN-2408-02',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    connectors: [
      {
        id: 'c3', kind: 'connector', housingId: 'h2', orientation: 0,
        positions: { logical: { x: 30, y: 40 } }, pins: pins('r', 2, true),
      },
    ],
    devices: [
      { id: 'd1', name: '도어 스위치', terminals: ['NO', 'COM'], positions: { logical: { x: 380, y: 220 } } },
    ],
    wires: [
      {
        id: 'w3',
        from: { type: 'pin', connectorId: 'c3', pinId: 'r1' },
        to: { type: 'device', deviceId: 'd1', terminal: 'NO' },
        color: { base: 'yellow' }, gauge: { system: 'awg', value: 20 }, lengthMm: 320,
      },
      {
        id: 'w4',
        from: { type: 'pin', connectorId: 'c3', pinId: 'r2' },
        to: { type: 'device', deviceId: 'd1', terminal: 'COM' },
        color: { base: 'brown' }, gauge: { system: 'awg', value: 20 }, lengthMm: 320,
      },
    ],
    usedParts: [housing2],
  };
}

/** C — 길이 미입력 1본 */
function harnessC(): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'hC',
    name: 'LAN 연장',
    letter: 'C',
    drawingNo: 'HRN-2408-03',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    connectors: [
      {
        id: 'c4', kind: 'connector', housingId: 'h8', orientation: 0,
        positions: { logical: { x: 20, y: 60 } }, pins: pins('s', 8, true),
      },
      {
        id: 'c5', kind: 'connector', housingId: 'h8', orientation: 0,
        positions: { logical: { x: 600, y: 60 } }, pins: pins('t', 8, true),
      },
    ],
    devices: [],
    wires: [
      {
        id: 'w5',
        from: { type: 'pin', connectorId: 'c4', pinId: 's1' },
        to: { type: 'pin', connectorId: 'c5', pinId: 't1' },
        color: { base: 'green' }, gauge: { system: 'awg', value: 24 }, lengthMm: 700,
      },
      {
        id: 'w6',
        from: { type: 'pin', connectorId: 'c4', pinId: 's2' },
        to: { type: 'pin', connectorId: 'c5', pinId: 't2' },
        color: { base: 'white' }, gauge: { system: 'awg', value: 24 },
      },
    ],
    usedParts: [rj45],
  };
}

function makeKit(): KitDocument {
  return {
    schemaVersion: 2,
    id: 'kit-1',
    name: '자판기 1대분 하네스 세트',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    harnesses: [harnessA(), harnessB(), harnessC()],
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

const spies = () => ({
  onSelectHarness: vi.fn(),
  onChangePerSet: vi.fn(),
  onChangeOrderQty: vi.fn(),
  onChangeSet: vi.fn(),
  onAddHarness: vi.fn(),
  onRemoveHarness: vi.fn(),
  onGoToBlocker: vi.fn(),
  onCopyOrderText: vi.fn(),
  onExportSetPdf: vi.fn(),
});

function show(kit: KitDocument = makeKit(), activeHarnessId = 'hA') {
  const cb = spies();
  const view = render(<SetOverview kit={kit} activeHarnessId={activeHarnessId} {...cb} />);
  return { ...view, cb };
}

afterEach(() => cleanup());

describe('하네스 카드', () => {
  it('하네스 종수만큼 카드가 뜨고 레터·품번·스펙 3줄이 들어간다', () => {
    const { container } = show();
    expect(container.querySelectorAll('.so-card').length).toBe(3);

    expect(screen.getByLabelText('하네스 A MDB 전원·통신')).toBeTruthy();
    expect(screen.getByLabelText('하네스 B 도어 스위치')).toBeTruthy();
    expect(screen.getByLabelText('하네스 C LAN 연장')).toBeTruthy();

    const cardA = screen.getByLabelText('하네스 A MDB 전원·통신');
    expect(within(cardA).getByText('HRN-2408-01')).toBeTruthy();
    expect(within(cardA).getByText('MDB 6P ↔ SMH250 2P')).toBeTruthy();
    // 전선 = 본수 · 길이 합, 전장 = 최장 배선
    expect(within(cardA).getByText('2본 · 1,000mm')).toBeTruthy();
    expect(within(cardA).getByText('510mm')).toBeTruthy();

    /**
     * 길이를 모르는 배선이 섞이면 합계가 몇 본치인지 밝힌다.
     * 실제 발주 문서(이스턴웰스)로 확인한 결함 — 길이 미정 하네스 카드가
     * "3본 · 0mm" 로 나왔다. statsOf 는 모르는 배선을 0 으로 더하지 않는데
     * 카드가 그 사실을 감춰 0mm 를 실측값처럼 보이게 했다.
     */
    const strip = (h: HarnessDocument, keep: number): HarnessDocument => ({
      ...h,
      wires: h.wires.map((w, i) => (i < keep ? w : { ...w, lengthMm: undefined })),
    });

    // 전부 미입력 → 0mm 가 아니라 "길이 미입력"
    cleanup();
    const none = makeKit();
    show({ ...none, harnesses: [strip(none.harnesses[0], 0), ...none.harnesses.slice(1)] });
    expect(
      within(screen.getByLabelText('하네스 A MDB 전원·통신')).getByText('2본 · 길이 미입력'),
    ).toBeTruthy();

    // 일부만 아는 경우 → 몇 본치 합계인지 밝힌다
    cleanup();
    const some = makeKit();
    show({ ...some, harnesses: [strip(some.harnesses[0], 1), ...some.harnesses.slice(1)] });
    expect(
      within(screen.getByLabelText('하네스 A MDB 전원·통신')).getByText(/1본 기준/),
    ).toBeTruthy();

    // 미완성 배지 / 완료 배지
    expect(within(cardA).getByText('터미널 미지정 1핀')).toBeTruthy();
    expect(within(screen.getByLabelText('하네스 B 도어 스위치')).getByText('완료')).toBeTruthy();
    expect(within(screen.getByLabelText('하네스 C LAN 연장')).getByText('길이 미입력 1본')).toBeTruthy();
  });

  it('썸네일 미니 도면은 하네스마다 다른 형상으로 그려진다', () => {
    const { container } = show();
    const svgs = Array.from(container.querySelectorAll('.so-thumb-svg'));
    expect(svgs.length).toBe(3);

    // 하우징 사각 + 핀 패드 9px + 직교 배선이 실제로 있어야 한다
    for (const svg of svgs) {
      expect(svg.querySelectorAll('rect.so-box').length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('rect.so-pad').length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
      expect(svg.querySelector('rect.so-pad')?.getAttribute('width')).toBe('9');
    }
    const shapes = svgs.map((s) => s.innerHTML);
    expect(new Set(shapes).size).toBe(3);
  });

  it('선택된 하네스 카드만 강조된다', () => {
    const { rerender } = show(makeKit(), 'hB');
    expect(screen.getByLabelText('하네스 A MDB 전원·통신').className).not.toContain('on');
    expect(screen.getByLabelText('하네스 B 도어 스위치').className).toContain('on');
    expect(screen.getByLabelText('하네스 B 도어 스위치').getAttribute('aria-current')).toBe('true');

    rerender(<SetOverview kit={makeKit()} activeHarnessId="hC" {...spies()} />);
    expect(screen.getByLabelText('하네스 B 도어 스위치').className).not.toContain('on');
    expect(screen.getByLabelText('하네스 C LAN 연장').className).toContain('on');
  });

  it('카드를 클릭하면 그 하네스로 이동한다', () => {
    const { cb } = show();
    fireEvent.click(screen.getByLabelText('하네스 C LAN 연장'));
    expect(cb.onSelectHarness).toHaveBeenCalledWith('hC');
  });
});

describe('세트당 수량 스테퍼', () => {
  it('카드 푸터의 ± 로 세트당 수량만 바꾼다 (총수량은 입력하지 않는다)', () => {
    const { cb } = show();
    fireEvent.click(screen.getByLabelText('하네스 B 세트당 수량 늘리기'));
    expect(cb.onChangePerSet).toHaveBeenCalledWith('hB', 3);

    fireEvent.click(screen.getByLabelText('하네스 B 세트당 수량 줄이기'));
    expect(cb.onChangePerSet).toHaveBeenCalledWith('hB', 1);

    // 1 아래로는 내려가지 않는다
    fireEvent.click(screen.getByLabelText('하네스 A 세트당 수량 줄이기'));
    expect(cb.onChangePerSet).toHaveBeenLastCalledWith('hA', 1);

    // 스테퍼를 눌러도 카드 선택으로 새지 않는다
    expect(cb.onSelectHarness).not.toHaveBeenCalled();
  });
});

describe('총수량 파생', () => {
  it('세트 구성의 총수량은 언제나 perSet × orderQty 다', () => {
    const { container } = show();
    expect(within(screen.getByLabelText('세트 구성 A')).getByText('5개')).toBeTruthy();
    expect(within(screen.getByLabelText('세트 구성 B')).getByText('10개')).toBeTruthy();  // 2 × 5
    expect(within(screen.getByLabelText('세트 구성 C')).getByText('5개')).toBeTruthy();
    // 합계 하네스 = (1+2+1) × 5
    expect(container.querySelector('.so-set-total')?.textContent).toBe('하네스 20개');
    expect(screen.getByText(/이 문서의 하네스/).textContent?.replace(/\s+/g, ' '))
      .toBe('이 문서의 하네스 3종 · 세트당 4개');
  });

  it('주문 세트 수를 바꾸면 콜백만 나가고 총수량은 저장되지 않는다', () => {
    const kit = makeKit();
    const { cb, container } = show(kit);
    fireEvent.click(screen.getByLabelText('주문 세트 수 늘리기'));
    expect(cb.onChangeOrderQty).toHaveBeenCalledWith(6);

    // 주문 수가 6이 된 문서로 다시 그리면 총수량이 따라온다 (4 × 6)
    const next: KitDocument = { ...kit, set: { ...kit.set, orderQty: 6 } };
    cleanup();
    const again = render(<SetOverview kit={next} activeHarnessId="hA" {...spies()} />);
    expect(again.container.querySelector('.so-set-total')?.textContent).toBe('하네스 24개');
    expect(container.isConnected).toBe(false);
  });
});

describe('발주 전 확인', () => {
  it('막힌 항목을 클릭하면 그 하네스·대상으로 이동한다', () => {
    const { cb } = show();
    fireEvent.click(screen.getByText('터미널 미지정 1핀', { selector: '.so-blocker-text' }));
    expect(cb.onGoToBlocker).toHaveBeenCalledWith('hA', 'c1');

    fireEvent.click(screen.getByText('길이 미입력 1본', { selector: '.so-blocker-text' }));
    expect(cb.onGoToBlocker).toHaveBeenLastCalledWith('hC', 'w6');
  });

  it('막는 항목이 없으면 그렇다고 적는다', () => {
    const kit = makeKit();
    kit.harnesses = [harnessB()];
    kit.set.items = [{ harnessId: 'hB', perSet: 2 }];
    show(kit, 'hB');
    expect(screen.getByText('발주를 막는 항목이 없습니다')).toBeTruthy();
  });
});

describe('하네스 추가 · 삭제', () => {
  it('점선 카드의 세 버튼이 각 모드로 추가를 요청한다', () => {
    const { cb } = show();
    fireEvent.click(screen.getByText('빈 하네스 만들기'));
    fireEvent.click(screen.getByText('기존 하네스 복제'));
    fireEvent.click(screen.getByText('JSON 가져오기'));
    expect(cb.onAddHarness.mock.calls.map((c) => c[0])).toEqual(['blank', 'duplicate', 'import']);
  });

  it('⋯ 메뉴에서 하네스를 삭제한다 — 마지막 하나는 지울 수 없다', () => {
    const { cb } = show();
    fireEvent.click(screen.getByLabelText('하네스 B 메뉴'));
    fireEvent.click(screen.getByText('하네스 삭제'));
    expect(cb.onRemoveHarness).toHaveBeenCalledWith('hB');
    expect(cb.onSelectHarness).not.toHaveBeenCalled();

    cleanup();
    const one = makeKit();
    one.harnesses = [harnessA()];
    one.set.items = [{ harnessId: 'hA', perSet: 1 }];
    const solo = show(one);
    fireEvent.click(screen.getByLabelText('하네스 A 메뉴'));
    const del = screen.getByText('하네스 삭제') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(del);
    expect(solo.cb.onRemoveHarness).not.toHaveBeenCalled();
  });
});

describe('세트 패널', () => {
  it('세트 품번·이름을 편집하고 하단 버튼으로 PDF·발주 문구를 낸다', () => {
    const { cb } = show();
    expect((screen.getByLabelText('세트 품번') as HTMLInputElement).value).toBe('KIT-2408');
    fireEvent.change(screen.getByLabelText('세트 품번'), { target: { value: 'KIT-2409' } });
    expect(cb.onChangeSet).toHaveBeenCalledWith({ pn: 'KIT-2409' });

    fireEvent.change(screen.getByLabelText('세트 이름'), { target: { value: '자판기 2대분' } });
    expect(cb.onChangeSet).toHaveBeenLastCalledWith({ name: '자판기 2대분' });

    fireEvent.click(screen.getByText('세트 PDF 묶음'));
    expect(cb.onExportSetPdf).toHaveBeenCalled();
    fireEvent.click(screen.getByText('발주 문구 복사'));
    expect(cb.onCopyOrderText).toHaveBeenCalled();
  });

  it('접속표 탭은 세트 화면에서 비활성이다', () => {
    show();
    expect((screen.getByText('접속표') as HTMLButtonElement).disabled).toBe(true);
  });
});
