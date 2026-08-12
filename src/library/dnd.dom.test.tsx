/**
 * 라이브러리 → 캔버스 드래그 배치 (HTML5 DnD).
 *
 * jsdom 에는 실제 드래그가 없다. dataTransfer 를 목으로 만들어
 * dragstart → dragover → drop 을 직접 발생시켜 계약만 검증한다.
 *   - 라이브러리 행이 부품 id 를 실어 보내는가
 *   - 캔버스가 그 좌표에 커넥터/장치를 만드는가
 *   - 단자는 막히는가, 드롭 표시는 켜졌다 꺼지는가
 *   - 기존 클릭 배치가 그대로인가
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';

/**
 * screenToFlowPosition 은 캔버스 DOM 의 실제 크기와 뷰포트 변환에 기댄다.
 * jsdom 은 모든 요소가 0×0 이라 값이 의미를 잃으므로 항등 변환으로 바꾼다.
 * 이렇게 하면 "드롭한 좌표 - 중앙 보정" 계산만 순수하게 검증할 수 있다.
 */
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
    }),
  };
});

import App from '../App';
import { useHarnessStore } from '../store/harnessStore';
import { PART_DND_MIME, DEVICE_DND_ID } from './LibraryPanel';

/** 브라우저 DataTransfer 흉내 — setData/getData/types 만 있으면 충분하다 */
function makeDataTransfer() {
  const bag: Record<string, string> = {};
  return {
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(type: string, value: string) {
      bag[type] = value;
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type: string) {
      return bag[type] ?? '';
    },
    clearData() {},
    setDragImage() {},
  };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
    }));
  }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
    m22 = 1;
    constructor() {}
  };
});

afterEach(() => cleanup());

/**
 * 부품명은 캔버스 노드 라벨에도 나오므로(배치하면 두 곳에서 잡힌다)
 * 라이브러리 패널 안으로 범위를 좁혀 찾는다.
 */
const lib = (container: HTMLElement) =>
  within(container.querySelector('.panel.lib') as HTMLElement);

/**
 * 부품 행의 **버튼**을 돌려준다.
 * 이름은 `<span class="lib-item-name">` 안에 있으므로(긴 이름의 ellipsis 처리),
 * getByText 가 잡는 건 span 이다. disabled 같은 버튼 속성을 보려면 올라가야 한다.
 */
const itemOf = (container: HTMLElement, name: RegExp | string) => {
  const el = lib(container).getByText(name) as HTMLElement;
  return (el.closest('.lib-item') as HTMLElement | null) ?? el;
};

const rowOf = (container: HTMLElement, name: RegExp) =>
  itemOf(container, name).closest('.lib-row') as HTMLElement;

const canvasOf = (container: HTMLElement) =>
  container.querySelector('.hz-canvas-wrap') as HTMLElement;

const connectors = () => useHarnessStore.getState().doc.connectors;
const devices = () => useHarnessStore.getState().doc.devices;

/**
 * jsdom 에는 DragEvent 생성자가 없다. testing-library 는 그럴 때 Event 로 떨어지는데
 * Event 는 clientX/clientY 를 버린다 — 좌표가 이 기능의 핵심이므로 MouseEvent 로
 * 직접 만들어 dataTransfer 만 얹는다. (React 는 nativeEvent 에서 좌표를 읽는다)
 */
function fireDrop(
  target: HTMLElement,
  dataTransfer: ReturnType<typeof makeDataTransfer>,
  x: number,
  y: number,
) {
  const ev = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, ev);
}

/** 라이브러리 행 → 캔버스 좌표로 끌어다 놓기 */
function dragTo(from: HTMLElement, canvas: HTMLElement, x: number, y: number) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(from, { dataTransfer: dt });
  fireEvent.dragOver(canvas, { dataTransfer: dt });
  fireDrop(canvas, dt, x, y);
  return dt;
}

describe('라이브러리 행 드래그 시작', () => {
  it('행이 draggable 이고 dragstart 에 부품 id 를 싣는다', () => {
    const { container } = render(<App />);
    const row = rowOf(container, /MDB VMC/);
    expect(row.getAttribute('draggable')).toBe('true');

    const dt = makeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });

    expect(dt.types).toContain(PART_DND_MIME);
    expect(dt.getData(PART_DND_MIME)).toBe('lib-mdb-vmc');
    // text/plain 폴백도 실려야 일부 브라우저에서 드래그가 시작된다
    expect(dt.getData('text/plain')).toBe('lib-mdb-vmc');
  });

  it('터미널(단자)은 드래그할 수 없다', () => {
    const { container } = render(<App />);
    const row = rowOf(container, /Mini-Fit Jr 크림프핀/);
    expect(row.getAttribute('draggable')).toBe('false');

    // 혹시 이벤트가 발생하더라도 페이로드를 싣지 않는다
    const dt = makeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    expect(dt.types).not.toContain(PART_DND_MIME);
  });
});

describe('캔버스 드롭 배치', () => {
  it('놓은 자리에 커넥터가 생기고 선택된다', () => {
    const { container } = render(<App />);
    const before = connectors().length;

    dragTo(rowOf(container, /MDB VMC/), canvasOf(container), 400, 300);

    const after = connectors();
    expect(after.length).toBe(before + 1);

    const added = after[after.length - 1];
    expect(added.housingId).toBe('lib-mdb-vmc');
    expect(useHarnessStore.getState().selection).toBe(added.id);

    // 무작위 좌표가 아니라 드롭 지점 근처(중앙 보정만큼 좌상단으로 당김)
    const pos = added.positions.logical!;
    expect(pos.x).toBeGreaterThan(300);
    expect(pos.x).toBeLessThanOrEqual(400);
    expect(pos.y).toBeGreaterThan(200);
    expect(pos.y).toBeLessThanOrEqual(300);
  });

  it('드롭 좌표가 그대로 반영된다 — 커서를 옮긴 만큼 부품도 옮겨진다', () => {
    const { container } = render(<App />);
    const canvas = canvasOf(container);

    dragTo(rowOf(container, /MDB VMC/), canvas, 400, 300);
    const a = connectors()[connectors().length - 1].positions.logical!;

    dragTo(rowOf(container, /MDB VMC/), canvas, 600, 450);
    const b = connectors()[connectors().length - 1].positions.logical!;

    expect(b.x - a.x).toBe(200);
    expect(b.y - a.y).toBe(150);
  });

  it('부품이 usedParts 에도 들어간다 (클릭 배치와 같은 순서)', () => {
    const { container } = render(<App />);
    dragTo(rowOf(container, /RJ45 8P8C \(T568B\)/), canvasOf(container), 250, 250);

    const doc = useHarnessStore.getState().doc;
    expect(doc.usedParts.some((p) => p.id === 'lib-rj45-t568b')).toBe(true);
    expect(doc.connectors[doc.connectors.length - 1].housingId).toBe('lib-rj45-t568b');
  });

  it('장치 블록도 같은 방식으로 드래그 배치된다', () => {
    const { container } = render(<App />);
    const before = devices().length;

    const block = itemOf(container, '+ 장치 블록');
    expect(block.getAttribute('draggable')).toBe('true');

    const dt = makeDataTransfer();
    fireEvent.dragStart(block, { dataTransfer: dt });
    expect(dt.getData(PART_DND_MIME)).toBe(DEVICE_DND_ID);

    fireEvent.dragOver(canvasOf(container), { dataTransfer: dt });
    fireDrop(canvasOf(container), dt, 520, 380);

    const after = devices();
    expect(after.length).toBe(before + 1);
    const d = after[after.length - 1];
    expect(d.positions.logical!.x).toBeGreaterThan(400);
    expect(d.positions.logical!.y).toBeGreaterThan(300);
    expect(useHarnessStore.getState().selection).toBe(d.id);
  });

  it('우리 드래그가 아니면 캔버스는 무시한다', () => {
    const { container } = render(<App />);
    const canvas = canvasOf(container);
    const before = connectors().length;

    const foreign = makeDataTransfer();
    foreign.setData('text/plain', 'lib-mdb-vmc'); // 커스텀 MIME 없음
    fireEvent.dragOver(canvas, { dataTransfer: foreign });
    expect(canvas.className).not.toContain('hz-dropping');

    fireDrop(canvas, foreign, 400, 300);
    expect(connectors().length).toBe(before);
  });
});

describe('드롭 가능 표시', () => {
  it('부품을 끌고 들어오면 켜지고 나가면 꺼진다', () => {
    const { container } = render(<App />);
    const canvas = canvasOf(container);

    const dt = makeDataTransfer();
    fireEvent.dragStart(rowOf(container, /MDB VMC/), { dataTransfer: dt });

    fireEvent.dragOver(canvas, { dataTransfer: dt });
    expect(canvas.className).toContain('hz-dropping');
    expect(dt.dropEffect).toBe('copy');

    fireEvent.dragLeave(canvas, { dataTransfer: dt });
    expect(canvas.className).not.toContain('hz-dropping');
  });

  it('드롭이 끝나면 표시가 남지 않는다', () => {
    const { container } = render(<App />);
    const canvas = canvasOf(container);

    dragTo(rowOf(container, /MDB VMC/), canvas, 400, 300);
    expect(canvas.className).not.toContain('hz-dropping');
  });
});

describe('클릭 배치는 그대로', () => {
  it('클릭해도 커넥터가 추가된다 (드래그가 어려운 환경용)', () => {
    const { container } = render(<App />);
    const before = connectors().length;
    fireEvent.click(itemOf(container, /MDB VMC/));
    expect(connectors().length).toBe(before + 1);
  });

  it('단자는 클릭으로도 배치되지 않는다', () => {
    const { container } = render(<App />);
    const before = connectors().length;
    const btn = itemOf(container, /Mini-Fit Jr 크림프핀/) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(connectors().length).toBe(before);
  });
});
