/**
 * 자동저장 (리드 소유) — localStorage에 문서 스냅샷 유지.
 * 새로고침해도 작업이 날아가지 않게 한다. 백엔드 없는 구성이라 필수.
 */
import type { HarnessDocument } from '../types';

const KEY = 'harness-tool:doc:v1';

/**
 * localStorage 안전 접근.
 * file:// 로 열거나(opaque origin), 시크릿 모드/저장소 차단 시
 * 접근 자체가 SecurityError 를 던진다 → 앱이 죽지 않도록 감싼다.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.getItem('__probe__'); // 접근 가능 여부 확인
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSaved(): HarnessDocument | null {
  try {
    const ls = safeStorage();
    if (!ls) return null;
    const raw = ls.getItem(KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as HarnessDocument;
    if (doc?.schemaVersion !== 1) return null; // 스키마 불일치 시 무시
    return doc;
  } catch {
    return null;
  }
}

export function saveDoc(doc: HarnessDocument) {
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* 용량 초과 등은 무시 (자동저장은 best-effort) */
  }
}

export function clearSaved() {
  try {
    safeStorage()?.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** 빈 새 문서 */
export function emptyDoc(): HarnessDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `doc-${Date.now().toString(36)}`,
    name: '새 하네스',
    createdAt: now,
    updatedAt: now,
    connectors: [],
    devices: [],
    wires: [],
    cables: [],
    usedParts: [],
  };
}
