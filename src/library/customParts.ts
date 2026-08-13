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
import { parsePartsCsv, type CsvParseResult } from './partsCsv';

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

/**
 * 문서에 딸려 온 사용자 정의 부품을 내 라이브러리에 합친다.
 *
 * 부품은 두 곳에 산다(문서의 usedParts · 이 저장소). 남이 만든 문서를 열면
 * 도면은 usedParts 스냅샷으로 정확히 재현되지만, 라이브러리에는 그 부품이 없어
 * **같은 커넥터를 하나 더 놓을 수가 없었다**. 문서를 여는 김에 내 목록에도 넣는다.
 *
 * 이미 같은 id 가 있으면 덮어쓰지 않는다 — 내가 고쳐 둔 핀맵을 남의 파일이
 * 말없이 되돌리면 안 된다. 반환값은 새로 들어온 부품만.
 */
export function mergeDocumentParts(parts: PartLibraryItem[]): PartLibraryItem[] {
  const mine = loadCustomParts();
  const have = new Set(mine.map((p) => p.id));
  const added: PartLibraryItem[] = [];
  for (const p of parts) {
    if (!isCustomPart(p.id) || have.has(p.id)) continue;
    have.add(p.id);   // 한 문서에 같은 부품이 여러 번 실려 있어도 한 번만 넣는다
    added.push(p);
  }
  if (!added.length) return [];
  saveCustomParts([...mine, ...added]);
  return added;
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

/**
 * 확장자·내용으로 JSON/CSV 를 판별해 파싱한다.
 *
 * 실무 부품표는 엑셀(→CSV)로 오고, 툴이 내보낸 백업은 JSON 이다.
 * `가져오기` 는 둘 다 같은 버튼으로 받으므로 여기서 갈라준다.
 * JSON 은 기존 `parseCustomParts` 경로를 그대로 쓴다(경고 없음).
 */
export function parsePartsFile(text: string, filename?: string): CsvParseResult {
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'csv' || ext === 'txt') {
    return parsePartsCsv(text);
  }
  if (ext === 'json') {
    return { parts: parseCustomParts(text), warnings: [] };
  }
  // 확장자를 모르면 내용으로 판별한다 — JSON 은 { 나 [ 로 시작한다
  const head = (text ?? '').replace(/^\uFEFF/, '').trimStart()[0];
  if (head === '{' || head === '[') {
    return { parts: parseCustomParts(text), warnings: [] };
  }
  return parsePartsCsv(text);
}

export type { CsvParseResult };
