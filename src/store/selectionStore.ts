/**
 * 다중 선택 — Claude Design 2차 §11 "선택 모델".
 *
 * 호버(임시) · 선택(고정) · 다중 선택 셋의 경계를 규칙으로 못박는다.
 *
 * ── 왜 별도 스토어인가
 * 단일 선택은 예전부터 `harnessStore.selection` 하나가 들고 있었고,
 * 접속표 행 클릭 · 파트 탭의 "발주 전 확인" · 라이브러리 배치 등 여러 화면이
 * 그 값을 직접 쓴다. 그 계약을 깨지 않으려고 다중 선택은 **덧붙임**으로 얹는다.
 *
 * ── 불변식 (이것만 지키면 기존 화면은 이 스토어를 몰라도 된다)
 *   ids.length === 0  → 선택 없음 또는 단일 선택 (harnessStore.selection 이 진실)
 *   ids.length >= 2   → 다중 선택. 마지막으로 집은 것이 selection 에도 남는다.
 * 즉 ids 에 원소가 1개인 상태는 만들지 않는다. 그래야 "다중인가?"를
 * `ids.length > 1` 한 줄로 판정할 수 있고, 단일 경로가 두 갈래로 갈라지지 않는다.
 *
 * 문서 상태가 아니므로 실행취소 스택 · 자동저장과는 무관하다(hoverStore 와 같은 성격).
 */
import { create } from 'zustand';
import { useHarnessStore } from './harnessStore';

/** ESC 한 번이 되돌린 단계. 아무것도 없었으면 'none'. */
export type EscapeStep = 'multi' | 'single' | 'none';

type SelectionState = {
  /** 다중 선택 id 목록 (2개 이상일 때만 채워진다) */
  ids: string[];
  /** 선택 집합을 통째로 지정한다. 1개면 단일 선택으로, 0개면 해제로 정규화한다. */
  setIds: (ids: string[]) => void;
  /**
   * 캔버스 클릭 한 번.
   * @param additive Shift(또는 ⌘) 를 누른 채인가 — 누르면 집합에 넣고 뺀다.
   */
  click: (id: string, additive?: boolean) => void;
  /** 전부 해제 */
  clear: () => void;
  /**
   * ESC 는 **항상 한 단계만** 푼다: 다중 → 단일 → 없음.
   * 한 번에 다 풀어버리면 "3본 중 하나만 남기고 싶다"가 불가능해진다.
   */
  escape: () => EscapeStep;
};

/** 순서를 유지한 채 중복 제거 */
function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  ids: [],

  setIds: (next) => {
    const list = uniq(next);
    const select = useHarnessStore.getState().select;
    if (list.length > 1) {
      // ids 를 먼저 놓고 selection 을 맞춘다.
      // 순서를 뒤집으면 아래 동기화 구독이 "바깥에서 바뀐 선택"으로 오해해 ids 를 비운다.
      if (!sameList(get().ids, list)) set({ ids: list });
      const cur = useHarnessStore.getState().selection;
      const primary = cur && list.includes(cur) ? cur : list[list.length - 1];
      if (cur !== primary) select(primary);
      return;
    }
    if (get().ids.length) set({ ids: [] });
    select(list[0] ?? null);
  },

  click: (id, additive = false) => {
    if (!additive) {
      get().setIds([id]);
      return;
    }
    const { ids } = get();
    const sel = useHarnessStore.getState().selection;
    const cur = ids.length > 1 ? ids : sel ? [sel] : [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    get().setIds(next);
    // 방금 집은 것이 대표가 된다 — 속성 탭이 단일로 접혔을 때 보여줄 하나.
    // (setIds 는 기존 대표를 되도록 유지하므로 여기서 덮어써야 한다)
    if (next.includes(id)) useHarnessStore.getState().select(id);
  },

  clear: () => get().setIds([]),

  escape: () => {
    const { ids } = get();
    const store = useHarnessStore.getState();
    if (ids.length > 1) {
      // 다중 → 단일. 마지막으로 집은 것(= selection)을 남긴다.
      const keep = store.selection && ids.includes(store.selection)
        ? store.selection
        : ids[ids.length - 1];
      set({ ids: [] });
      store.select(keep);
      return 'multi';
    }
    if (store.selection != null) {
      store.select(null);
      return 'single';
    }
    return 'none';
  },
}));

/** 훅 밖에서 쓰는 조회 — 현재 선택 전체(단일이면 1개) */
export function selectedIds(): string[] {
  const { ids } = useSelectionStore.getState();
  if (ids.length > 1) return ids;
  const sel = useHarnessStore.getState().selection;
  return sel ? [sel] : [];
}

/**
 * 바깥(접속표 행 · 파트 탭 · 라이브러리)에서 selection 을 직접 바꾸면
 * 다중 선택은 의미를 잃는다. 새 선택이 집합 밖이면 다중을 접는다.
 * 삭제·실행취소가 selection 을 null 로 만드는 경우도 여기서 함께 정리된다.
 */
useHarnessStore.subscribe((s, prev) => {
  if (s.selection === prev.selection) return;
  const { ids } = useSelectionStore.getState();
  if (!ids.length) return;
  if (s.selection == null || !ids.includes(s.selection)) {
    useSelectionStore.setState({ ids: [] });
  }
});
