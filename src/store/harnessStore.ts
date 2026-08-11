/**
 * 스토어 계약 구현 (Wave 0 — 리드 소유, 이후 읽기전용에 준함)
 * types.ts 의 HarnessStore 인터페이스를 Zustand로 구현한다.
 * 모든 에이전트는 이 훅을 통해서만 문서를 읽고 수정한다.
 */
import { create } from 'zustand';
import type {
  HarnessStore,
  HarnessDocument,
  Connector,
  Device,
  Wire,
  Cable,
  PartLibraryItem,
  ViewMode,
  Id,
} from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import { loadSaved, saveDoc } from './persistence';

function touch(doc: HarnessDocument): HarnessDocument {
  return { ...doc, updatedAt: new Date().toISOString() };
}

/**
 * 실행취소 히스토리.
 * 문서(doc)만 스냅샷으로 쌓는다. 문서는 불변 갱신이라 참조 비교로 충분하고,
 * 수십 핀 규모라 메모리 부담도 없다.
 */
const HISTORY_LIMIT = 50;
let past: HarnessDocument[] = [];
let future: HarnessDocument[] = [];

/** 문서를 바꾸기 직전 상태를 히스토리에 push */
function pushHistory(prev: HarnessDocument) {
  past.push(prev);
  if (past.length > HISTORY_LIMIT) past.shift();
  future = []; // 새 편집이 일어나면 redo 스택은 무효
}

/** 히스토리 초기화 (새 문서/불러오기) */
function resetHistory() {
  past = [];
  future = [];
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  doc: loadSaved() || sampleDoc, // loadSaved 내부에서 안전 처리
  selection: null,
  activeView: 'logical' as ViewMode,

  select: (id: Id | null) => set({ selection: id }),
  setView: (view: ViewMode) => set({ activeView: view }),

  addConnector: (c: Connector) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, connectors: [...s.doc.connectors, c] }) };
    }),
  updateConnector: (id, patch) =>
    set((s) => {
      pushHistory(s.doc);
      return {
        doc: touch({
          ...s.doc,
          connectors: s.doc.connectors.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }),
      };
    }),

  addDevice: (d: Device) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, devices: [...s.doc.devices, d] }) };
    }),
  updateDevice: (id, patch) =>
    set((s) => {
      pushHistory(s.doc);
      return {
        doc: touch({
          ...s.doc,
          devices: s.doc.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        }),
      };
    }),

  addWire: (w: Wire) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, wires: [...s.doc.wires, w] }) };
    }),
  updateWire: (id, patch) =>
    set((s) => {
      pushHistory(s.doc);
      return {
        doc: touch({
          ...s.doc,
          wires: s.doc.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        }),
      };
    }),

  addCable: (c: Cable) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, cables: [...(s.doc.cables ?? []), c] }) };
    }),
  updateCable: (id, patch) =>
    set((s) => {
      pushHistory(s.doc);
      return {
        doc: touch({
          ...s.doc,
          cables: (s.doc.cables ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }),
      };
    }),

  addUsedPart: (part: PartLibraryItem) =>
    set((s) => {
      if (s.doc.usedParts.some((p) => p.id === part.id)) return s;
      // usedParts 추가는 보통 addConnector와 짝이라 히스토리를 따로 쌓지 않음
      return { doc: touch({ ...s.doc, usedParts: [...s.doc.usedParts, part] }) };
    }),

  remove: (id: Id) =>
    set((s) => {
      pushHistory(s.doc);
      return {
      selection: s.selection === id ? null : s.selection,
      doc: touch({
        ...s.doc,
        connectors: s.doc.connectors.filter((c) => c.id !== id),
        devices: s.doc.devices.filter((d) => d.id !== id),
        wires: s.doc.wires.filter(
          (w) =>
            w.id !== id &&
            !(w.from.type === 'pin' && w.from.connectorId === id) &&
            !(w.to.type === 'pin' && w.to.connectorId === id) &&
            !(w.from.type === 'device' && w.from.deviceId === id) &&
            !(w.to.type === 'device' && w.to.deviceId === id),
        ),
        cables: (s.doc.cables ?? []).filter((c) => c.id !== id),
      }),
      };
    }),

  replaceDoc: (doc: HarnessDocument) => {
    resetHistory();
    set({ doc, selection: null });
  },

  rename: (name: string) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, name }) };
    }),

  undo: () =>
    set((s) => {
      const prev = past.pop();
      if (!prev) return s;
      future.push(s.doc);
      return { doc: prev, selection: null };
    }),

  redo: () =>
    set((s) => {
      const next = future.pop();
      if (!next) return s;
      past.push(s.doc);
      return { doc: next, selection: null };
    }),

  canUndo: () => past.length > 0,
  canRedo: () => future.length > 0,

  exportJson: () => JSON.stringify(get().doc, null, 2),
  importJson: (json: string) => {
    const doc = JSON.parse(json) as HarnessDocument;
    resetHistory();
    set({ doc, selection: null });
  },
}));

// 자동저장: 문서가 바뀔 때마다 localStorage에 스냅샷 (브라우저에서만)
if (typeof window !== 'undefined') {
  let prev = useHarnessStore.getState().doc;
  useHarnessStore.subscribe((s) => {
    if (s.doc !== prev) {
      prev = s.doc;
      saveDoc(s.doc);
    }
  });
}
