/**
 * Agent B 소유 — 사용자 정의 부품 저장소.
 *
 * 두 곳에 산다:
 *  1) 문서의 usedParts  → JSON 저장 시 함께 딸려감(자기완결, 남에게 보내도 도면 재현됨)
 *  2) 이 저장소(localStorage) → 여러 문서에서 재사용할 "내 부품 목록"
 *
 * 시드 부품(SEED_PARTS)은 코드에 있고, 여기 있는 건 사용자가 만든 것.
 */
import type { PartLibraryItem } from '../types';

const KEY = 'harness-tool:customParts:v1';

/** localStorage 안전 접근 (file:// · 시크릿 모드에서 SecurityError 방지) */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.getItem('__probe__');
    return localStorage;
  } catch {
    return null;
  }
}

export function loadCustomParts(): PartLibraryItem[] {
  try {
    const ls = safeStorage();
    if (!ls) return [];
    const raw = ls.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PartLibraryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomParts(parts: PartLibraryItem[]) {
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(parts));
  } catch {
    /* 용량 초과 등은 무시 */
  }
}

/** 추가 또는 같은 id 갱신 */
export function upsertCustomPart(part: PartLibraryItem): PartLibraryItem[] {
  const parts = loadCustomParts();
  const i = parts.findIndex((p) => p.id === part.id);
  if (i >= 0) parts[i] = part;
  else parts.push(part);
  saveCustomParts(parts);
  return parts;
}

export function deleteCustomPart(id: string): PartLibraryItem[] {
  const parts = loadCustomParts().filter((p) => p.id !== id);
  saveCustomParts(parts);
  return parts;
}

/** 커스텀 부품 id 접두사 (시드와 구분) */
export const CUSTOM_PREFIX = 'custom-';

export function isCustomPart(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

let seq = 0;
export function newCustomPartId(): string {
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}-${seq++}`;
}

/** 커스텀 부품 목록 → JSON 문자열 (내보내기) */
export function exportCustomParts(parts: PartLibraryItem[]): string {
  return JSON.stringify({ kind: 'harness-custom-parts', version: 1, parts }, null, 2);
}

/** JSON 문자열 → 커스텀 부품 목록 (가져오기). 형식이 아니면 빈 배열 */
export function parseCustomParts(json: string): PartLibraryItem[] {
  try {
    const data = JSON.parse(json);
    // 내보내기 형식
    if (data?.kind === 'harness-custom-parts' && Array.isArray(data.parts)) {
      return data.parts as PartLibraryItem[];
    }
    // 부품 배열만 있는 경우도 허용
    if (Array.isArray(data)) return data as PartLibraryItem[];
    return [];
  } catch {
    return [];
  }
}
