/**
 * 스토어 계약 구현 (Wave 0 — 리드 소유, 이후 읽기전용에 준함)
 * types.ts 의 HarnessStore 인터페이스를 Zustand로 구현한다.
 * 모든 에이전트는 이 훅을 통해서만 문서를 읽고 수정한다.
 */
import { create } from 'zustand';
import type {
  HarnessStore,
  HarnessDocument,
  HarnessSet,
  KitDocument,
  Connector,
  Device,
  Wire,
  Cable,
  PartLibraryItem,
  ViewMode,
  Id,
} from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import { loadSavedKit, saveKit, emptyDoc, parseDocument } from './persistence';
import { toKit, letterAt, withNewHarness, withoutHarness } from './kit';

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

/**
 * 활성 하네스를 세트에 반영한 새 kit.
 *
 * 세트 수정시각은 **뒤로 가지 않는다**. 예전에는 `doc.updatedAt` 을 그대로 썼는데,
 * 방금 연 문서(오래된 하네스)를 활성으로 두고 내보내면 세트 시각이 하네스 시각으로
 * 되감겨 저장됐다 — 파일만 보고 어느 쪽이 최신인지 알 수 없게 된다.
 */
function syncBack(kit: KitDocument, doc: HarnessDocument): KitDocument {
  return {
    ...kit,
    updatedAt: doc.updatedAt > kit.updatedAt ? doc.updatedAt : kit.updatedAt,
    harnesses: kit.harnesses.map((h) => (h.id === doc.id ? doc : h)),
  };
}

/** 새 하네스 id 의 꼬리 — 같은 밀리초에 여러 종이 들어와도 겹치지 않게 한다 */
let harnessSeq = 0;

const initialKit = loadSavedKit() ?? toKit(sampleDoc);

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  doc: initialKit.harnesses[0],
  kit: initialKit,
  activeHarnessId: initialKit.harnesses[0].id,
  selection: null,
  activeView: 'logical' as ViewMode,

  select: (id: Id | null) => set({ selection: id }),
  setView: (view: ViewMode) => set({ activeView: view }),

  // ── 세트 ──────────────────────────────────────────────────────────
  setActiveHarness: (id: Id) =>
    set((s) => {
      if (id === s.activeHarnessId) return s;
      // 지금 편집하던 내용을 세트에 먼저 반영하고 넘어간다
      const kit = syncBack(s.kit, s.doc);
      const next = kit.harnesses.find((h) => h.id === id);
      if (!next) return s;
      resetHistory(); // 하네스가 바뀌면 실행취소 스택은 의미가 없다
      return { kit, doc: next, activeHarnessId: id, selection: null };
    }),

  updateSet: (patch: Partial<HarnessSet>) =>
    set((s) => ({ kit: { ...s.kit, set: { ...s.kit.set, ...patch } } })),

  setPerSet: (harnessId: Id, perSet: number) =>
    set((s) => ({
      kit: {
        ...s.kit,
        set: {
          ...s.kit.set,
          items: s.kit.set.items.map((i) =>
            i.harnessId === harnessId ? { ...i, perSet: Math.max(1, perSet) } : i,
          ),
        },
      },
    })),

  addHarness: (mode, docIn) =>
    set((s) => {
      const now = new Date().toISOString();
      const base = docIn
        ?? (mode === 'duplicate'
          ? { ...s.doc, name: `${s.doc.name} 복사본`, drawingNo: undefined }
          : emptyDoc());
      const h: HarnessDocument = {
        ...base,
        // 한 파일에서 여러 종을 연달아 추가하면 같은 밀리초에 들어온다 —
        // 시각만으로 id 를 만들면 서로 같은 id 가 되어 배선이 엉뚱한 하네스를 가리킨다
        id: `hrn-${Date.now().toString(36)}-${harnessSeq++}`,
        createdAt: now,
        updatedAt: now,
      };
      const kit = withNewHarness(syncBack(s.kit, s.doc), h);
      resetHistory();
      return { kit, doc: kit.harnesses[kit.harnesses.length - 1], activeHarnessId: h.id, selection: null };
    }),

  removeHarness: (id: Id) =>
    set((s) => {
      if (s.kit.harnesses.length <= 1) return s;   // 마지막 하나는 지울 수 없다
      const kit = withoutHarness(syncBack(s.kit, s.doc), id);
      const doc = kit.harnesses.find((h) => h.id === s.activeHarnessId) ?? kit.harnesses[0];
      resetHistory();
      return { kit, doc, activeHarnessId: doc.id, selection: null };
    }),

  replaceKit: (kit: KitDocument) => {
    resetHistory();
    const doc = kit.harnesses[0];
    set({ kit, doc, activeHarnessId: doc.id, selection: null });
  },

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

  /**
   * 이미 문서에 든 부품의 정의를 갱신한다 (핀맵 에디터 저장 경로).
   * 없는 부품이면 추가한다. 도면이 눈에 띄게 바뀌는 동작이라 실행취소 한 단계를 쌓는다.
   */
  syncUsedPart: (part: PartLibraryItem) =>
    set((s) => {
      const i = s.doc.usedParts.findIndex((p) => p.id === part.id);
      if (i >= 0 && JSON.stringify(s.doc.usedParts[i]) === JSON.stringify(part)) return s;
      pushHistory(s.doc);
      const usedParts = i >= 0
        ? s.doc.usedParts.map((p) => (p.id === part.id ? part : p))
        : [...s.doc.usedParts, part];
      return { doc: touch({ ...s.doc, usedParts }) };
    }),

  /**
   * 구간 길이 입력 · 삭제.
   *
   * 구간은 저장되지 않고 배선에서 유도되므로(physical/segments.ts), 값은 구간
   * **키**(양 끝 정점 id)로 붙는다. 키를 만드는 함수는 segments.ts 한 곳뿐이다.
   *
   * - 값이 없거나 0 이하면 **키를 지운다**. 0 을 남기면 도면에 0mm 치수가 오른다.
   * - 마지막 키가 사라지면 필드 자체를 지운다 — 빈 객체를 남기면 이 기능을 쓴 적
   *   없는 문서와 저장 파일이 달라져 형상관리에서 없는 변경이 보인다.
   * - 바뀌는 것이 없으면 히스토리도 쌓지 않는다(같은 값 재확정·없는 값 삭제).
   */
  setSegmentLength: (key: string, mm: number | null) =>
    set((s) => {
      const cur = s.doc.segmentLengths ?? {};
      const has = Object.prototype.hasOwnProperty.call(cur, key);
      if (mm == null || !Number.isFinite(mm) || mm <= 0) {
        if (!has) return s;
        pushHistory(s.doc);
        const next = { ...cur };
        delete next[key];
        const doc = { ...s.doc };
        if (Object.keys(next).length) doc.segmentLengths = next;
        else delete doc.segmentLengths;
        return { doc: touch(doc) };
      }
      if (cur[key] === mm) return s;
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, segmentLengths: { ...cur, [key]: mm } }) };
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

  /**
   * 문서 교체(불러오기 · 새 문서).
   *
   * 세트에 없는 문서를 doc 자리에만 꽂으면 **그 문서는 어디에도 저장되지 않는다**:
   * 내보내기(`exportJson`)는 kit 을 내보내고 자동저장도 kit 이 바뀔 때만 도는데,
   * `syncBack` 은 id 가 세트에 있는 하네스만 갈아끼우기 때문이다. 실제로 '새 문서'
   * 뒤에 작업한 내용은 JSON 저장에서 통째로 빠지고 새로고침에서도 사라졌다.
   * 세트에 없는 문서면 그 문서를 담은 새 세트를 만든다 — 새 문서 = 새 세트.
   */
  replaceDoc: (doc: HarnessDocument) =>
    set((s) => {
      resetHistory();
      if (s.kit.harnesses.some((h) => h.id === doc.id)) {
        return { doc, kit: syncBack(s.kit, doc), activeHarnessId: doc.id, selection: null };
      }
      const kit = toKit(doc);
      return { doc: kit.harnesses[0], kit, activeHarnessId: kit.harnesses[0].id, selection: null };
    }),

  rename: (name: string) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, name }) };
    }),

  setDocMeta: (patch) =>
    set((s) => {
      pushHistory(s.doc);
      return { doc: touch({ ...s.doc, ...patch }) };
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

  // 내보내기는 세트 전체를 낸다 — 하네스 하나만 내면 세트 구성이 사라진다
  exportJson: () => JSON.stringify(syncBack(get().kit, get().doc), null, 2),
  /**
   * v1(하네스 하나)·v2(세트) 둘 다 받는다.
   *
   * 검사는 `parseDocument` 하나가 한다. 예전처럼 `JSON.parse` 결과를 그대로
   * `toKit` 에 넘기면 미래 버전 문서·부분만 있는 문서·숫자 하나짜리 파일까지
   * 오류 없이 통과해 앱이 이상한 상태로 들어갔다.
   * 못 읽는 파일은 **이유를 담아 던진다** — 부르는 쪽이 사용자에게 알려야 한다.
   */
  importJson: (json: string) => {
    const r = parseDocument(json);
    if (!r.ok) throw new Error(r.reason);
    resetHistory();
    const doc = r.kit.harnesses[0];
    set({ kit: r.kit, doc, activeHarnessId: doc.id, selection: null });
  },
}));

/**
 * 활성 하네스(doc) 변경을 세트(kit)에 되돌려 쓴다.
 *
 * 기존 액션들은 전부 doc 만 건드리도록 그대로 뒀다. 여기서 한 번에 동기화하므로
 * 캔버스·속성·핀맵 등 하네스 하나만 다루는 코드는 세트 도입 전과 똑같이 동작한다.
 */
useHarnessStore.subscribe((s, prevState) => {
  if (s.doc === prevState.doc) return;
  if (s.kit.harnesses.some((h) => h.id === s.doc.id && h !== s.doc)) {
    useHarnessStore.setState({ kit: syncBack(s.kit, s.doc) });
  }
});

// 자동저장: 세트가 바뀔 때마다 localStorage에 스냅샷 (브라우저에서만)
if (typeof window !== 'undefined') {
  let prev = useHarnessStore.getState().kit;
  useHarnessStore.subscribe((s) => {
    if (s.kit !== prev) {
      prev = s.kit;
      saveKit(s.kit);
    }
  });
}

/** 세트 문자 재부여가 필요한 곳에서 쓰는 재노출 */
export { letterAt };
