/**
 * 케이블을 **1급 선택 대상**으로 올린 뒤의 동작.
 *
 * 고치기 전: `selection` 은 커넥터·장치·배선만 될 수 있었다. 그래서
 *   · 도면에서 케이블을 가리킬 수 있는 그림 자체가 없었고
 *   · 심선이 0본이 되면 그 케이블은 **UI 에서 손댈 수 없었다** — 검증이
 *     `cable-empty` 로 알려 줘도 그 항목을 눌러 갈 곳이 없었다(막다른 길).
 * 그 두 가지를 여기서 잰다. 선택 모델(§11)의 불변식도 함께 붙잡는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useHarnessStore } from '../store/harnessStore';
import { useSelectionStore } from '../store/selectionStore';
import { useHoverStore } from '../store/hoverStore';
import { validateHarness } from '../store/validate';
import { buildPartList } from '../export/exporters';
import { PropertyPanel } from '../panels/PropertyPanel';
import { HarnessCanvas } from './HarnessCanvas';
import { planJackets } from './wirePlan';
import { cableDoc } from '../fixtures/cableDoc';
import type { HarnessDocument } from '../types';

const store = () => useHarnessStore.getState();
const sel = () => useSelectionStore.getState();

/** React Flow 는 jsdom 에 레이아웃이 없어 크기를 0 으로 읽는다 — 구멍을 막는다
    (selection.dom.test.tsx 와 같은 준비. 그쪽 주석 참고) */
beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(
        private cb: (e: { target: Element; contentRect: { width: number; height: number } }[]) => void,
      ) {}
      observe(el: Element) {
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
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { get: () => 1200, configurable: true },
    offsetHeight: { get: () => 800, configurable: true },
  });
  Object.defineProperties(SVGElement.prototype, {
    getBBox: { value: () => ({ x: 0, y: 0, width: 0, height: 0 }), configurable: true },
  });

  useSelectionStore.setState({ ids: [] });
  useHoverStore.setState({ wireId: null, source: null, x: 0, y: 0 });
  useHarnessStore.setState({ doc: cableDoc({ jacketColor: 'black' }), selection: null });
});

afterEach(() => cleanup());

// ============================================================
describe('캔버스 — 자켓이 그려진다', () => {
  it('심선이 나란히 가는 구간마다 자켓 윤곽이 하나씩 선다', () => {
    const { container } = render(<HarnessCanvas />);
    const runs = planJackets(store().doc, 'logical').reduce((n, j) => n + j.runs.length, 0);
    expect(runs).toBeGreaterThan(0);
    expect(container.querySelectorAll('.hz-jacket')).toHaveLength(runs);
    // 어느 케이블인지 이름표로 읽힌다 — 윤곽만으로는 알 수 없다
    expect(container.querySelector('.hz-jacket-label')?.textContent).toBe('3C 제어');
  });

  it('대조군 — 케이블이 없는 문서에서는 자켓이 한 개도 그려지지 않는다', () => {
    const doc = store().doc;
    const bare: HarnessDocument = {
      ...doc,
      cables: [],
      wires: doc.wires.map(({ cableId: _drop, ...rest }) => rest),
    };
    useHarnessStore.setState({ doc: bare });
    const { container } = render(<HarnessCanvas />);
    // 고치기 전 도면이 정확히 이 모습이었다: 배선은 다 있는데 케이블의 흔적이 없다
    expect(container.querySelectorAll('.hz-jacket')).toHaveLength(0);
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(doc.wires.length);
  });

  it('자켓색 미지정은 점선으로 그린다 — 색을 지어내지 않는다', () => {
    useHarnessStore.setState({ doc: cableDoc() });      // cb-p 자켓색 없음
    const { container } = render(<HarnessCanvas />);
    const dashed = [...container.querySelectorAll('.hz-jacket')]
      .filter((el) => el.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBeGreaterThan(0);
    // 자켓색이 있는 cb-y(gray)는 실선이다 — 둘이 한 도면에서 구분된다
    const solid = [...container.querySelectorAll('.hz-jacket')]
      .filter((el) => !el.getAttribute('stroke-dasharray'));
    expect(solid.length).toBeGreaterThan(0);
  });
});

// ============================================================
describe('자켓을 클릭하면 케이블이 선택된다', () => {
  it('클릭 → selection 이 케이블 id 이고, 선택 불변식(ids 0개)이 지켜진다', () => {
    const { container } = render(<HarnessCanvas />);
    const hit = container.querySelector('g[data-cable="cb-p"] .hz-jacket-hit');
    expect(hit).toBeTruthy();

    fireEvent.click(hit!);
    expect(store().selection).toBe('cb-p');
    // §11 불변식: ids 는 0개이거나 2개 이상이다 — 1개짜리를 만들지 않는다
    expect(sel().ids).toEqual([]);
  });

  it('선택하면 속성 패널에 케이블 카드가 열린다', () => {
    const { container } = render(<HarnessCanvas />);
    fireEvent.click(container.querySelector('g[data-cable="cb-p"] .hz-jacket-hit')!);
    cleanup();

    render(<PropertyPanel />);
    expect(screen.getByText('CABLE')).toBeTruthy();
    expect(screen.getByText('3C 제어')).toBeTruthy();
    expect(screen.getByLabelText('케이블 길이')).toBeTruthy();
    expect(screen.getByLabelText('케이블 게이지 값')).toBeTruthy();
    // 푸터 삭제 버튼도 종류에 맞게 바뀐다. 같은 이름의 버튼은 화면에 하나뿐이다.
    const del = screen.getAllByText('케이블 삭제');
    expect(del).toHaveLength(1);
    expect(del[0].className).toContain('pp-danger');
  });

  it('ESC 는 여기서도 한 단계만 푼다 (단일 → 없음)', () => {
    const { container } = render(<HarnessCanvas />);
    fireEvent.click(container.querySelector('g[data-cable="cb-p"] .hz-jacket-hit')!);
    expect(store().selection).toBe('cb-p');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store().selection).toBeNull();
    expect(sel().ids).toEqual([]);
  });
});

// ============================================================
describe('심선 0본 케이블도 닿을 수 있다', () => {
  /** 심선이 하나도 없는 케이블 하나만 든 문서 */
  function ghostDoc(): HarnessDocument {
    const doc = cableDoc();
    return {
      ...doc,
      cables: [{ id: 'cb-ghost', name: '유령 케이블', coreCount: 4, lengthMm: 300 }],
      wires: doc.wires.map(({ cableId: _drop, ...rest }) => rest),
    };
  }

  it('대조군 — 배선을 통해서는 어디로도 닿을 수 없다 (고치기 전 막다른 길)', () => {
    const doc = ghostDoc();
    // 옛 통로는 "심선을 골라야 케이블 카드가 열린다" 하나뿐이었다.
    expect(doc.wires.some((w) => w.cableId === 'cb-ghost')).toBe(false);
    // 그런데도 자재표는 이 케이블을 1개로 발주한다 — 지울 길이 없으면 그대로 나간다
    expect(
      buildPartList(doc).some((r) => r.category === '케이블' && r.part === '유령 케이블'),
    ).toBe(true);
  });

  it('검증 항목이 케이블 자신을 가리키고, 그것을 고르면 카드가 열린다', () => {
    const doc = ghostDoc();
    useHarnessStore.setState({ doc, selection: null });

    // 검증 탭의 행 클릭 = onGoTo(targetId) → select(targetId) (App.tsx)
    const empty = validateHarness(doc).find((i) => i.id === 'cable-empty');
    expect(empty?.targetId).toBe('cb-ghost');
    store().select(empty!.targetId!);

    render(<PropertyPanel />);
    expect(screen.getByText('CABLE')).toBeTruthy();
    expect(screen.getByText(/심선이 하나도 없습니다/)).toBeTruthy();

    // 그 자리에서 지울 수 있다 — 막다른 길이 사라졌다
    fireEvent.click(screen.getByText('케이블 삭제'));
    expect(store().doc.cables).toEqual([]);
  });
});
