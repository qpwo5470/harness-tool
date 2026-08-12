import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useHarnessStore } from './store/harnessStore';
import { useSelectionStore } from './store/selectionStore';

/**
 * 콘솔 점검 창구 — `window.hz`.
 *
 * 화면만 보고 "선택이 됐나?"를 판정하려다 크게 헤맸다. 픽셀은 호버 강조와
 * 고정 선택을 구분해 주지 않아서, 멀쩡한 코드를 세 번 고쳤다.
 * 상태를 직접 물어볼 창구가 있으면 그 낭비가 사라진다.
 *
 * 읽기 전용 조회만 노출한다(스토어 자체를 내걸면 콘솔에서 문서를 망가뜨릴 수 있다).
 */
declare global {
  interface Window {
    hz: { selection: () => { primary: string | null; ids: string[] } };
  }
}
window.hz = {
  selection: () => ({
    primary: useHarnessStore.getState().selection,
    ids: useSelectionStore.getState().ids,
  }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
