/**
 * 선택 모델 — Claude Design 2차 §11.
 *
 * 호버(임시) · 클릭 고정 · 다중 선택 셋의 경계를 규칙으로 고정한다.
 *   - Shift+클릭 / 박스 드래그 → 다중
 *   - ESC 는 항상 한 단계 (다중 → 단일 → 없음)
 *   - 다중 속성 탭은 공통 속성만, 단일 전용 항목은 감춘다
 *   - 파괴적 동작은 확인 대화상자 없이 실행하고 검은 토스트로 되돌린다
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useHarnessStore } from '../store/harnessStore';
import { useHoverStore } from '../store/hoverStore';
import { useSelectionStore } from '../store/selectionStore';
import { PropertyPanel } from '../panels/PropertyPanel';
import { HarnessCanvas } from './HarnessCanvas';
import { ToastHost, hideToast } from '../ui/Toast';
import type { HarnessDocument, PartLibraryItem } from '../types';

const housing: PartLibraryItem = {
  id: 'h6', category: 'housing', name: '테스트 하우징 6P', mpn: 'TST-6', pinCount: 6,
  pinLayout: [1, 2, 3, 4, 5, 6].map((i) => ({
    index: i, label: String(i), offset: { x: i - 1, y: 0 },
  })),
};
const spliceItem: PartLibraryItem = {
  id: 'hs3', category: 'splice', name: '스플라이스 3 (꼬임)', pinCount: 3,
};

/**
 * 배선 4본.
 *   W1 · W2 는 스플라이스 브리지로 한 네트 (→ "같은 네트 선택" 검증용)
 *   W1 120 / W3 160 / W4 200 → 셋을 고르면 합 480mm
 *   게이지는 W4 만 AWG18 → "여러 값"
 */
function makeDoc(): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'doc-sel',
    name: '선택 모델 문서',
    createdAt: '2026-08-12T03:00:00Z',
    updatedAt: '2026-08-12T03:04:00Z',
    connectors: [
      {
        id: 'c1', kind: 'connector', housingId: 'h6', orientation: 0,
        positions: { logical: { x: 0, y: 0 } },
        pins: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `p${i}`, index: i, label: String(i) })),
      },
      {
        id: 'sp1', kind: 'splice', housingId: 'hs3', orientation: 0,
        positions: { logical: { x: 300, y: 0 } },
        pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i, label: String(i) })),
        bridges: [['s1', 's2', 's3']],
      },
    ],
    devices: [
      { id: 'd1', name: '테스트 장치', terminals: ['5V', 'GND'], positions: { logical: { x: 300, y: 240 } } },
    ],
    wires: [
      {
        id: 'w1',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's1' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 120,
      },
      {
        id: 'w2',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p2' },
        to: { type: 'pin', connectorId: 'sp1', pinId: 's2' },
        color: { base: 'black' }, gauge: { system: 'awg', value: 22 }, lengthMm: 90,
      },
      {
        id: 'w3',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p3' },
        to: { type: 'device', deviceId: 'd1', terminal: '5V' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm: 160,
      },
      {
        id: 'w4',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p4' },
        to: { type: 'device', deviceId: 'd1', terminal: 'GND' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 18 }, lengthMm: 200,
      },
    ],
    cables: [],
    usedParts: [housing, spliceItem],
  };
}

const store = () => useHarnessStore.getState();
const sel = () => useSelectionStore.getState();
const ids = () => sel().ids;

/** 다중 선택 3본 (W1 · W3 · W4) */
function pickThree() {
  sel().setIds(['w1', 'w3', 'w4']);
}

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  /**
   * 크기를 재자마자 알려주는 관찰자.
   * React Flow 는 노드 크기를 ResizeObserver 로 받아야 비로소 엣지를 그린다.
   * 아무것도 하지 않는 껍데기를 물리면 배선이 영영 그려지지 않는다.
   */
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(
        private cb: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void,
      ) {}
      observe(el: Element) {
        // React Flow 는 어떤 곳은 target 의 offset 을, 어떤 곳은 contentRect 를 읽는다.
        this.cb([{ target: el, contentRect: { width: 1200, height: 800 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
    }));
  }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class { m22 = 1; };

  /**
   * React Flow 는 컨테이너 크기를 재서 0 이면 노드·엣지를 아예 그리지 않는다.
   * jsdom 에는 레이아웃이 없어 언제나 0 이므로, 크기를 읽는 구멍 셋을 막아 준다.
   * (React Flow 공식 테스트 안내와 같은 방식이다)
   */
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { get: () => 1200, configurable: true },
    offsetHeight: { get: () => 800, configurable: true },
  });
  Object.defineProperties(SVGElement.prototype, {
    getBBox: { value: () => ({ x: 0, y: 0, width: 0, height: 0 }), configurable: true },
  });

  useSelectionStore.setState({ ids: [] });
  useHoverStore.setState({ wireId: null, source: null, x: 0, y: 0 });
  useHarnessStore.setState({ doc: makeDoc(), selection: null });
  hideToast();
});

afterEach(() => {
  cleanup();
  hideToast();
});

// ============================================================
// 1. 상태 전이
// ============================================================
describe('§11 상태 전이 — 클릭 · Shift+클릭', () => {
  it('그냥 클릭은 단일, Shift+클릭은 집합에 넣고 뺀다', () => {
    sel().click('w1');
    expect(store().selection).toBe('w1');
    expect(ids()).toEqual([]);            // 단일은 ids 를 쓰지 않는다(불변식)

    sel().click('w3', true);
    expect(ids()).toEqual(['w1', 'w3']);
    expect(store().selection).toBe('w3'); // 마지막으로 집은 것이 대표

    sel().click('w4', true);
    expect(ids()).toEqual(['w1', 'w3', 'w4']);

    // 이미 든 것을 Shift+클릭하면 빠진다
    sel().click('w3', true);
    expect(ids()).toEqual(['w1', 'w4']);

    // 그냥 클릭하면 다중이 접히고 단일로 돌아온다
    sel().click('w2');
    expect(ids()).toEqual([]);
    expect(store().selection).toBe('w2');
  });

  it('바깥(접속표 행 클릭 등)에서 선택이 바뀌면 다중은 접힌다', () => {
    pickThree();
    expect(ids()).toHaveLength(3);
    store().select('w2');                 // 접속표 행 클릭 경로
    expect(ids()).toEqual([]);
    expect(store().selection).toBe('w2');
  });
});

describe('§11 ESC — 항상 한 단계', () => {
  it('다중 → 단일 → 없음 순으로 한 칸씩 푼다', () => {
    pickThree();
    expect(sel().escape()).toBe('multi');
    expect(ids()).toEqual([]);
    expect(store().selection).toBe('w4');  // 마지막으로 집은 하나가 남는다

    expect(sel().escape()).toBe('single');
    expect(store().selection).toBeNull();

    expect(sel().escape()).toBe('none');   // 더 풀 것이 없다
  });
});

// ============================================================
// 2. 다중 선택 속성 탭
// ============================================================
describe('§11 다중 선택 속성 탭', () => {
  it('MULTI 배지 · 본수 · 선택 칩 · 해제 ESC 가 상단에 선다', () => {
    pickThree();
    render(<PropertyPanel />);
    expect(screen.getByText('MULTI')).toBeTruthy();
    expect(screen.getByText('배선 3본 선택')).toBeTruthy();
    expect(screen.getByText('해제 ESC')).toBeTruthy();
    // 무엇을 골랐는지 번호로 되짚어 준다
    expect(['W1', 'W3', 'W4'].map((c) => screen.getByText(c).className)).toEqual(
      ['pp-wchip num', 'pp-wchip num', 'pp-wchip num'],
    );
  });

  it('값이 같으면 그대로 편집하고, 다르면 "여러 값"으로 두며 길이는 합계를 함께 보인다', () => {
    pickThree();
    render(<PropertyPanel />);

    // 색은 셋 다 red → 동일. 게이지·길이는 제각각 → 여러 값
    expect(screen.getAllByText('3본 동일').length).toBeGreaterThan(0);
    expect(screen.getAllByText('여러 값').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('기본색 적(red)').getAttribute('aria-pressed')).toBe('true');

    const len = screen.getByLabelText('길이 일괄') as HTMLInputElement;
    expect(len.value).toBe('');                       // 모르는 값을 덮어쓰지 않게 비워 둔다
    expect(len.className).toContain('mixed');         // 점선 테두리 + 이탤릭
    expect(screen.getByText('합 480mm')).toBeTruthy(); // 120 + 160 + 200
  });

  it('단일 선택 전용 항목(케이블 소속 · FROM/TO)은 감춘다', () => {
    pickThree();
    const { container } = render(<PropertyPanel />);
    expect(screen.queryByText('케이블 소속')).toBeNull();
    expect(container.querySelector('.pp-card-sub')).toBeNull();
    cleanup();

    // 단일로 내려오면 다시 보인다
    sel().setIds(['w1']);
    const single = render(<PropertyPanel />);
    expect(screen.getByText('케이블 소속')).toBeTruthy();
    expect(single.container.querySelector('.pp-card-sub')).toBeTruthy();
  });

  it('칩을 고르면 3본 전체에 들어가고 검은 토스트가 뜬다', () => {
    pickThree();
    render(<><PropertyPanel /><ToastHost /></>);

    fireEvent.click(screen.getByLabelText('기본색 흑(black)'));
    const byId = new Map(store().doc.wires.map((w) => [w.id, w]));
    expect(['w1', 'w3', 'w4'].map((id) => byId.get(id)!.color.base)).toEqual(
      ['black', 'black', 'black'],
    );
    // 건드리지 않은 배선은 그대로
    expect(byId.get('w2')!.color.base).toBe('black');
    expect(screen.getByText('배선 3본을 일괄 지정했습니다')).toBeTruthy();
  });

  it('길이는 Enter 로 한 번만 반영한다 (타이핑마다 실행취소가 쌓이지 않게)', () => {
    pickThree();
    render(<PropertyPanel />);
    const len = screen.getByLabelText('길이 일괄');

    fireEvent.change(len, { target: { value: '3' } });
    fireEvent.change(len, { target: { value: '30' } });
    expect(store().doc.wires.find((w) => w.id === 'w1')!.lengthMm).toBe(120); // 아직 그대로

    fireEvent.keyDown(len, { key: 'Enter' });
    const byId = new Map(store().doc.wires.map((w) => [w.id, w]));
    expect(['w1', 'w3', 'w4'].map((id) => byId.get(id)!.lengthMm)).toEqual([30, 30, 30]);
  });

  it('"같은 네트 선택"이 스플라이스 너머까지 한 네트를 통째로 고른다', () => {
    sel().setIds(['w1', 'w3']);
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText('같은 네트 선택'));
    // W1 의 네트는 스플라이스 브리지로 W2 까지 이어진다
    expect([...ids()].sort()).toEqual(['w1', 'w2', 'w3']);
  });
});

// ============================================================
// 3. 파괴적 동작 — 확인 대화상자 대신 토스트
// ============================================================
describe('§11 실행취소 — 확인 대화상자를 두지 않는다', () => {
  it('"3본 삭제"는 바로 지우고, 토스트의 실행취소가 한 번에 되돌린다', () => {
    pickThree();
    render(<><PropertyPanel /><ToastHost /></>);

    fireEvent.click(screen.getByText('3본 삭제'));
    expect(store().doc.wires.map((w) => w.id)).toEqual(['w2']);
    expect(ids()).toEqual([]);

    // 검은 토스트 — 문구 + 실행취소
    expect(screen.getByText('배선 3본을 삭제했습니다')).toBeTruthy();
    const undo = screen.getByText(/실행취소/);
    fireEvent.click(undo);

    // 3단계가 한 번에 되돌아온다 (remove 3회 = 스택 3단계)
    expect(store().doc.wires.map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(screen.queryByText('배선 3본을 삭제했습니다')).toBeNull();
  });
});

// ============================================================
// 4. 캔버스
// ============================================================
describe('§11 캔버스 — 호버는 임시, 선택은 고정', () => {
  it('호버 중에는 상세 카드가 뜨고, 선택이 고정되면 뜨지 않는다', () => {
    useHoverStore.setState({ wireId: 'w1', source: 'canvas' });
    const hoverOnly = render(<HarnessCanvas />);
    expect(hoverOnly.container.querySelector('.hz-card')).toBeTruthy();
    cleanup();

    // 같은 배선을 클릭해 고정하면 값은 우측 속성 탭에 있으므로 카드는 사라진다
    useHoverStore.setState({ wireId: 'w1', source: 'canvas' });
    sel().setIds(['w1']);
    const pinned = render(<HarnessCanvas />);
    expect(pinned.container.querySelector('.hz-card')).toBeNull();
  });

  /**
   * 수정키 클릭이 배선까지 도달하는가 — 회귀 시험.
   *
   * 왜 이 시험이 있나: React Flow 는 selectionKeyCode · multiSelectionKeyCode ·
   * zoomActivationKeyCode 중 하나라도 눌리면 pane 을 활성 모드로 올려
   * **그 클릭을 가져간다**. 그래서 ⌘+클릭이 배선에 닿지 못하고 선택이 통째로 풀렸다.
   * 세 키를 모두 떼어내고 판정을 OrthogonalEdge 의 히트 선으로 옮겨 고쳤다.
   * 다시 React Flow 에 수정키를 물리면 이 시험이 먼저 깨진다.
   */
  it('배선 히트 선 클릭 — 그냥 클릭은 단일, ⌘·Shift 를 누르면 집합에 더한다', () => {
    const { container } = render(<HarnessCanvas />);
    const hits = container.querySelectorAll('.hz-edge-hit');
    expect(hits.length).toBe(4);           // 배선 4본 모두 집을 수 있어야 한다

    const hitOf = (wireId: string) => {
      const g = container.querySelector(`.react-flow__edge[data-id="${wireId}"]`);
      const hit = g?.querySelector('.hz-edge-hit');
      if (!hit) throw new Error(`${wireId} 히트 선을 찾지 못했다`);
      return hit;
    };

    fireEvent.click(hitOf('w1'));
    expect(store().selection).toBe('w1');
    expect(ids()).toEqual([]);

    fireEvent.click(hitOf('w3'), { metaKey: true });
    expect(ids()).toEqual(['w1', 'w3']);

    fireEvent.click(hitOf('w4'), { shiftKey: true });
    expect(ids()).toEqual(['w1', 'w3', 'w4']);

    // 이미 든 것을 다시 집으면 빠진다
    fireEvent.click(hitOf('w3'), { metaKey: true });
    expect(ids()).toEqual(['w1', 'w4']);

    // 수정키 없이 집으면 다중이 접힌다
    fireEvent.click(hitOf('w2'));
    expect(ids()).toEqual([]);
    expect(store().selection).toBe('w2');
  });

  /**
   * 호버도 히트 선이 직접 받는다 — 회귀 시험.
   *
   * React Flow 의 onEdgeMouseLeave 에 맡겼더니 선을 벗어나도 해제가 오지 않아
   * 상세 카드가 커서를 따라다녔다(실제 화면에서 확인). 들어오고 나가는 판정을
   * 히트 선 자신이 하도록 옮겼다.
   */
  it('배선 히트 선을 벗어나면 강조가 풀린다', () => {
    const { container } = render(<HarnessCanvas />);
    const hitOf = () => {
      const el = container.querySelector('.react-flow__edge[data-id="w1"] .hz-edge-hit');
      if (!el) throw new Error('w1 히트 선을 찾지 못했다');
      return el;
    };

    fireEvent.mouseOver(hitOf());
    expect(useHoverStore.getState().wireId).toBe('w1');
    expect(container.querySelector('.hz-card')).toBeTruthy();

    // 강조가 켜지면 엣지가 다시 그려진다. 그때 DOM 노드가 갈릴 수 있으므로
    // 나가는 이벤트는 **다시 찾은** 노드에 쏜다.
    fireEvent.mouseOut(hitOf());
    expect(useHoverStore.getState().wireId).toBeNull();
    expect(container.querySelector('.hz-card')).toBeNull();
  });

  it('다중 선택이면 도면 위에 본수 배지가 서고, ESC 로 단일까지 한 단계 내려간다', () => {
    pickThree();
    const { container } = render(<HarnessCanvas />);
    expect(container.querySelector('.hz-multi-badge')?.textContent).toContain('3');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ids()).toEqual([]);
    expect(store().selection).toBe('w4');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store().selection).toBeNull();
  });
});
