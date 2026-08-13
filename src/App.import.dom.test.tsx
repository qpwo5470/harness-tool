/**
 * 'JSON 불러오기' 회귀 시험.
 *
 * 예전 경로는 `f.text().then(importJson)` 이었다. 실패가 Promise 안에서 사라져
 * 쓰레기 파일을 골라도 **화면에 아무 일도 일어나지 않았고**, 사용자는 파일을
 * 잘못 골랐는지 앱이 멈췄는지 알 수 없었다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from './App';
import { useHarnessStore } from './store/harnessStore';
import { hideToast } from './ui/Toast';
import { loadCustomParts } from './library/customParts';
import type { KitDocument, PartLibraryItem } from './types';

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
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
  hideToast();
});
afterEach(() => { cleanup(); hideToast(); });

/** 상단바의 숨은 파일 입력 */
function fileInput(): HTMLInputElement {
  const el = document.querySelector('input[type="file"][accept="application/json"]');
  if (!el) throw new Error('파일 입력이 없다');
  return el as HTMLInputElement;
}

function drop(text: string, name = 'doc.json') {
  fireEvent.change(fileInput(), {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  });
}

const kitJson = (name: string) => JSON.stringify({
  schemaVersion: 2, id: 'kit-x', name,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  harnesses: [{
    schemaVersion: 1, id: 'h-x', name, letter: 'A',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    connectors: [], devices: [], wires: [], cables: [], usedParts: [],
  }],
  set: { id: 's-x', pn: 'PN-1', name, items: [{ harnessId: 'h-x', perSet: 2 }], orderQty: 3 },
} satisfies KitDocument);

describe('JSON 불러오기 — 실패를 알린다', () => {
  it('JSON 이 아닌 파일을 고르면 이유를 띄우고 문서를 바꾸지 않는다', async () => {
    render(<App />);
    const before = useHarnessStore.getState().kit;
    drop('name,category\nXH 4P,housing', 'parts.csv');
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeTruthy();
    expect(screen.getByText(/JSON 파일이 아닙니다/)).toBeTruthy();
    expect(useHarnessStore.getState().kit).toBe(before);
  });

  it('빈 파일도 조용히 넘어가지 않는다', async () => {
    render(<App />);
    drop('');
    expect(await screen.findByText(/파일이 비어 있습니다/)).toBeTruthy();
  });

  it('더 새 버전으로 저장된 문서는 거부하고 버전을 밝힌다', async () => {
    render(<App />);
    const before = useHarnessStore.getState().kit;
    drop(kitJson('미래').replace('"schemaVersion":2', '"schemaVersion":5'));
    expect(await screen.findByText(/v5/)).toBeTruthy();
    expect(useHarnessStore.getState().kit).toBe(before);
  });

  it('정상 파일은 불러오고 무엇이 들어왔는지 알린다', async () => {
    render(<App />);
    drop(kitJson('불러온 세트'));
    await waitFor(() => {
      expect(useHarnessStore.getState().kit.harnesses[0].name).toBe('불러온 세트');
    });
    expect(await screen.findByText(/1종을 불러왔습니다/)).toBeTruthy();
    expect(useHarnessStore.getState().kit.set.orderQty).toBe(3);
  });

  /**
   * 회귀: 세트 개요의 '이 세트에 하네스 추가 → JSON 가져오기' 가 세트를 통째로
   * 갈아치웠다. 하네스 두 종을 만들어 둔 사용자가 세 번째를 가져오면 앞의 둘이
   * 아무 경고 없이 사라졌다.
   */
  it('세트 개요의 JSON 가져오기는 기존 하네스를 지우지 않고 추가한다', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /세트 개요/ }));
    const before = useHarnessStore.getState().kit.harnesses.map((h) => h.id);
    fireEvent.click(screen.getByText('JSON 가져오기'));
    drop(kitJson('추가된 하네스'));

    await waitFor(() => {
      expect(useHarnessStore.getState().kit.harnesses).toHaveLength(before.length + 1);
    });
    const after = useHarnessStore.getState().kit.harnesses;
    // 원래 있던 것이 그대로 남아 있어야 한다
    expect(after.map((h) => h.id).slice(0, before.length)).toEqual(before);
    expect(after[after.length - 1].name).toBe('추가된 하네스');
    // 세트 구성에도 줄이 하나 늘어난다 — 안 늘면 발주 수량에서 조용히 빠진다
    expect(useHarnessStore.getState().kit.set.items).toHaveLength(before.length + 1);
    expect(await screen.findByText(/세트에 추가했습니다/)).toBeTruthy();
  });

  /**
   * 커스텀 부품은 문서(usedParts)와 내 저장소 두 곳에 산다.
   * 남이 만든 문서를 열면 도면은 스냅샷으로 재현되지만 라이브러리에는 없어서
   * **같은 커넥터를 하나 더 놓을 수가 없었다**.
   */
  it('문서에 딸려 온 커스텀 부품이 라이브러리에도 들어온다', async () => {
    render(<App />);
    const part: PartLibraryItem = {
      id: 'custom-남의부품', category: 'housing', name: '남이 만든 6P', pinCount: 6,
    };
    const doc = JSON.parse(kitJson('부품 딸린 세트')) as KitDocument & { harnesses: Record<string, unknown>[] };
    doc.harnesses[0].usedParts = [part];
    drop(JSON.stringify(doc));

    expect(await screen.findByText('남이 만든 6P')).toBeTruthy();
    expect(loadCustomParts().map((p) => p.id)).toContain('custom-남의부품');
  });

  it('고쳐서 불러온 부분이 있으면 그것도 알린다', async () => {
    render(<App />);
    // 커넥터 목록이 통째로 빠진 문서 — 예전에는 오류 없이 통과해 화면이 백지가 됐다
    drop(JSON.stringify({
      schemaVersion: 1, id: 'half', name: '반쪽',
      createdAt: '', updatedAt: '', wires: [], devices: [],
    }));
    expect(await screen.findByText(/커넥터 목록이 없어/)).toBeTruthy();
    await waitFor(() => {
      expect(useHarnessStore.getState().doc.connectors).toEqual([]);
    });
  });
});
