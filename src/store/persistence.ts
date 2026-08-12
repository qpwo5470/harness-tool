/**
 * 자동저장 (리드 소유) — localStorage에 문서 스냅샷 유지.
 * 새로고침해도 작업이 날아가지 않게 한다. 백엔드 없는 구성이라 필수.
 */
import type { AnyDocument, HarnessDocument, KitDocument } from '../types';
import { toKit } from './kit';

const KEY = 'harness-tool:doc:v1';
/**
 * 세트(v2) 저장 키. v1 키와 분리해 둔다 —
 * 구버전 앱이 열려 있어도 v2 문서를 v1 로 오해해 덮어쓰지 않는다.
 */
const KEY_KIT = 'harness-tool:kit:v2';

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
    const ls = safeStorage();
    ls?.removeItem(KEY);
    ls?.removeItem(KEY_KIT);
  } catch {
    /* noop */
  }
}

// ── 세트(v2) ────────────────────────────────────────────────────────────

/**
 * 저장된 세트를 읽는다.
 * v2 가 없으면 **v1 문서를 찾아 마이그레이션**한다 — 기존 사용자가
 * 새 버전을 열었을 때 작업이 사라지면 안 된다.
 */
export function loadSavedKit(): KitDocument | null {
  try {
    const ls = safeStorage();
    if (!ls) return null;
    const raw = ls.getItem(KEY_KIT);
    if (raw) {
      const kit = JSON.parse(raw) as KitDocument;
      if (kit?.schemaVersion === 2 && Array.isArray(kit.harnesses) && kit.harnesses.length) {
        return kit;
      }
      return null;
    }
    const legacy = loadSaved();
    return legacy ? toKit(legacy) : null;
  } catch {
    return null;
  }
}

export function saveKit(kit: KitDocument) {
  try {
    safeStorage()?.setItem(KEY_KIT, JSON.stringify(kit));
  } catch {
    /* 용량 초과 등은 무시 (자동저장은 best-effort) */
  }
}

/**
 * 불러오기로 들어온 JSON 을 세트로 정규화한다.
 * v1(하네스 하나)·v2(세트) 둘 다 받는다.
 */
export function parseAnyDocument(text: string): KitDocument | null {
  try {
    const parsed = JSON.parse(text) as AnyDocument;
    const v: number = parsed.schemaVersion;
    if (v !== 1 && v !== 2) return null;
    return toKit(parsed);
  } catch {
    return null;
  }
}

/** 빈 새 세트 (하네스 1종) */
export function emptyKit(): KitDocument {
  return toKit(emptyDoc());
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
