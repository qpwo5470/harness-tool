/**
 * 토스트 — Claude Design 2차 §11 "실행취소".
 *
 * 원칙: **확인 대화상자를 두지 않는다.**
 * 3본을 지우기 전에 "정말 지울까요?"를 묻는 대신 그냥 지우고,
 * 되돌릴 방법을 6초간 눈에 보이게 둔다. 도면 작업은 되돌리기가 값싸고
 * 대화상자는 매번 손을 멈추게 하기 때문이다.
 *
 * 검은 배경은 화면에서 이 요소 하나뿐이다(--text). "지금 무언가 사라졌다"를
 * 도면 위에서 확실히 구분시키기 위한 예외이며, 그 외 UI 색 규칙은 그대로다.
 *
 * ── 왜 undo 를 여러 번 부르는가
 * harnessStore 는 액션 하나당 스냅샷 하나를 쌓는다. 3본 삭제는 remove() 3회 =
 * 실행취소 3단계다. 사용자가 보기엔 한 동작이었으므로 토스트의 "실행취소"는
 * 그 횟수만큼 undo() 를 불러 **한 번에** 되돌린다(undoSteps).
 */
import { useEffect, useState } from 'react';
import { useHarnessStore } from '../store/harnessStore';
import './toast.css';

export type ToastItem = {
  id: number;
  message: string;
  /** 있으면 "실행취소 ⌘Z" 버튼이 붙는다 */
  undo?: () => void;
  /**
   * 실행취소가 아닌 행동 하나 (선택). 라벨을 직접 준다.
   *
   * 되돌리기가 아닌 일(예: 밀려난 저장본 내려받기)을 "실행취소 ⌘Z" 버튼에
   * 실으면 라벨이 거짓말이 되고, ⌘Z 로도 그 일이 일어난다. 그래서 통로를
   * 따로 두고 **키는 걸지 않는다** — 취소가 아니므로 키로 부를 일이 없다.
   */
  action?: { label: string; run: () => void };
  /** 표시 시간(ms) */
  ms: number;
};

let seq = 0;
let current: ToastItem | null = null;
const listeners = new Set<(t: ToastItem | null) => void>();

function emit() {
  for (const l of listeners) l(current);
}

/**
 * 파괴적 동작(삭제 · 일괄 지정) 뒤에만 부른다.
 * 되돌릴 수 없는 동작이면 undo 를 넘기지 않는다 — 버튼이 빠진다.
 */
export function showToast(
  message: string,
  undo?: () => void,
  ms = 6000,
  action?: ToastItem['action'],
): number {
  current = { id: ++seq, message, undo, ms, ...(action ? { action } : {}) };
  emit();
  return current.id;
}

export function hideToast() {
  if (!current) return;
  current = null;
  emit();
}

/** 테스트·디버깅용 조회 */
export function currentToast(): ToastItem | null {
  return current;
}

/**
 * 실행취소 n 단계를 한 동작으로 묶는다.
 * 다중 삭제·일괄 지정은 스토어에 n 단계가 쌓이므로 그대로는 ⌘Z 를 n 번 눌러야 한다.
 */
export function undoSteps(n: number): () => void {
  return () => {
    const { undo } = useHarnessStore.getState();
    for (let i = 0; i < n; i += 1) undo();
  };
}

/**
 * 전역 토스트 컨테이너. **App 최상단에 한 번만** 마운트한다.
 * 마운트되지 않아도 showToast() 는 조용히 무시될 뿐 터지지 않는다.
 */
export function ToastHost() {
  const [toast, setToast] = useState<ToastItem | null>(current);

  useEffect(() => {
    listeners.add(setToast);
    setToast(current);
    return () => {
      listeners.delete(setToast);
    };
  }, []);

  // 6초 뒤 자동 소멸. 그 사이 새 토스트가 오면 id 가 달라져 타이머가 새로 걸린다.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => {
      if (current?.id === toast.id) hideToast();
    }, toast.ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  /**
   * 토스트가 떠 있는 동안의 ⌘Z 는 이 토스트의 실행취소로 가로챈다.
   * 캡처 단계에서 잡고 전파를 끊어야 앱의 전역 ⌘Z(1단계 undo)와 겹치지 않는다.
   * 라벨이 "⌘Z"라고 적혀 있는데 한 단계만 돌아가면 거짓말이 된다.
   */
  useEffect(() => {
    if (!toast?.undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      e.stopPropagation();
      toast.undo?.();
      hideToast();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="tz-host" role="status" aria-live="polite">
      <div className="tz">
        <span className="tz-msg">{toast.message}</span>
        {toast.undo && (
          <button
            type="button"
            className="tz-undo"
            onClick={() => {
              toast.undo?.();
              hideToast();
            }}
          >
            실행취소 <b className="num">⌘Z</b>
          </button>
        )}
        {toast.action && (
          <button
            type="button"
            className="tz-undo"
            onClick={() => {
              toast.action?.run();
              hideToast();
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button type="button" className="tz-close" aria-label="알림 닫기" onClick={hideToast}>
          ×
        </button>
      </div>
    </div>
  );
}
