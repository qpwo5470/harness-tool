/**
 * 캔버스 ↔ 접속표 동기 강조용 임시 UI 상태.
 *
 * 문서 상태가 아니므로 harnessStore(동결 계약 · 실행취소 · 자동저장)에 넣지 않는다.
 * 여기 값이 바뀌어도 문서는 더러워지지 않고 undo 스택도 쌓이지 않는다.
 *
 * source 를 구분하는 이유:
 * 표에서 hover 할 때는 상세 카드를 띄우지 않는다. 커서가 캔버스 밖이라
 * 카드를 놓을 자리가 없고, 놓으면 표를 가린다.
 *
 * 고정 선택과의 관계(§11 선택 모델):
 * 호버는 **임시** 상태다. 클릭으로 선택이 고정되면 값은 우측 속성 탭에 상주하므로
 * 카드는 뜨지 않는다. 그 판정은 selection/selectionStore 를 함께 봐야 하므로
 * 여기 상태로 두지 않고 HarnessCanvas 에서 파생시킨다(중복 상태를 만들지 않는다).
 */
import { create } from 'zustand';

export type HoverSource = 'canvas' | 'table';

type HoverState = {
  /** 강조 중인 와이어 id */
  wireId: string | null;
  source: HoverSource | null;
  /** 캔버스 기준 커서 좌표 (상세 카드 위치) */
  x: number;
  y: number;
  setHover: (wireId: string | null, source?: HoverSource) => void;
  setCursor: (x: number, y: number) => void;
};

export const useHoverStore = create<HoverState>((set) => ({
  wireId: null,
  source: null,
  x: 0,
  y: 0,
  setHover: (wireId, source = 'canvas') =>
    set(wireId ? { wireId, source } : { wireId: null, source: null }),
  setCursor: (x, y) => set({ x, y }),
}));
