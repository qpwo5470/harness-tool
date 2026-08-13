/**
 * 자동저장 (리드 소유) — localStorage에 문서 스냅샷 유지.
 * 새로고침해도 작업이 날아가지 않게 한다. 백엔드 없는 구성이라 필수.
 *
 * ── 왜 파싱을 여기서 한 번만 하는가
 * 예전에는 불러오기가 `JSON.parse` → `toKit` 을 그대로 탔다. 그래서
 *  - JSON 이 아닌 파일은 SyntaxError 가 Promise 안에서 터져 **아무 안내 없이** 무시됐고,
 *  - `42` · `[]` · 커넥터 배열이 없는 문서는 **오류 없이** 통과해 doc.connectors 가
 *    undefined 인 상태로 앱에 들어갔고(다음 렌더에서 백지),
 *  - schemaVersion 3(미래 버전)은 v1 하네스로 오해해 세트 안에 통째로 말아넣은 뒤
 *    v2 로 다시 저장해 원본을 **조용히 망가뜨렸다**.
 * 파일에서 오든 localStorage 에서 오든 문서는 전부 `parseDocument` 하나를 지난다.
 * 고칠 수 있는 것만 고치고(경고를 남긴다), 못 고치면 이유를 붙여 거절한다.
 */
import type {
  Cable, Connector, Device, HarnessDocument, HarnessSet,
  KitDocument, Pin, Wire,
} from '../types';
import { toKit, letterAt } from './kit';
// 구간 키의 규칙은 만드는 곳에만 있다 — 여기서 형식을 다시 정의하면
// 도출부와 저장부가 서로 다른 키를 쓰게 되고, 입력한 길이가 아무 데도 붙지 않는다.
import { segmentKeyRefs } from '../physical/segments';

const KEY = 'harness-tool:doc:v1';
/**
 * 세트(v2) 저장 키. v1 키와 분리해 둔다 —
 * 구버전 앱이 열려 있어도 v2 문서를 v1 로 오해해 덮어쓰지 않는다.
 */
const KEY_KIT = 'harness-tool:kit:v2';
/**
 * 읽지 못한 자동저장을 옮겨 두는 자리.
 * 못 읽는다고 그 자리에 새 문서를 덮어쓰면 사용자의 작업이 영영 사라진다.
 * 원본을 여기로 피신시킨 뒤에야 새로 저장한다.
 */
const KEY_KIT_BROKEN = 'harness-tool:kit:v2:broken';

/** 이 빌드가 읽을 수 있는 가장 높은 스키마 버전 */
export const MAX_SCHEMA_VERSION = 2;

// ================================================================
// 저장소 문제 알림
//
// persistence 는 UI 를 모른다(Toast 를 import 하면 harnessStore ↔ Toast 로
// 순환이 생긴다). 대신 알림 통로만 열어 두고 App 이 토스트로 연결한다.
// 모듈 초기화(자동저장 읽기)는 App 마운트보다 먼저 일어나므로 밀린 알림을
// 버퍼에 담았다가 핸들러가 붙을 때 흘려보낸다.
// ================================================================

export type StorageProblem =
  /** 저장 공간이 꽉 참 — 이제부터 자동저장이 안 된다 */
  | { kind: 'quota' }
  /** 저장된 자동저장을 읽지 못함 (원본은 백업 키로 피신시켰다) */
  | { kind: 'unreadable'; reason: string };

let onProblem: ((p: StorageProblem) => void) | null = null;
let pending: StorageProblem[] = [];

export function reportStorageProblem(p: StorageProblem) {
  if (onProblem) onProblem(p);
  else pending.push(p);
}

/** App 이 토스트를 붙인다. 등록 즉시 밀린 알림을 흘려보낸다. */
export function setStorageProblemHandler(fn: ((p: StorageProblem) => void) | null) {
  onProblem = fn;
  if (!fn) return;
  const q = pending;
  pending = [];
  for (const p of q) fn(p);
}

/** 시험용 — 버퍼와 핸들러를 비운다 */
export function resetStorageProblems() {
  onProblem = null;
  pending = [];
}

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

// ================================================================
// 문서 검사·정규화
// ================================================================

/** 불러오기 결과. 실패하면 왜 실패했는지 사용자에게 그대로 보여줄 문장을 낸다. */
export type ParseResult =
  | { ok: true; kit: KitDocument; warnings: string[] }
  | { ok: false; reason: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
/** 수량용 정수 — 유한한 수만 받고 최소 1 로 올린다 */
function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.round(v)) : undefined;
}

let genSeq = 0;
const genId = (p: string) => `${p}-${Date.now().toString(36)}-${genSeq++}`;

/**
 * 배열 자리에 배열이 아닌 값이 온 경우 빈 배열로 되돌린다.
 * 여기서 조용히 넘기면 `doc.connectors.length` 에서 앱이 백지가 된다.
 */
function listOf(v: unknown, label: string, warn: string[]): unknown[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined) warn.push(`${label} 목록이 형식에 맞지 않아 비운 채 불러왔습니다`);
  else warn.push(`${label} 목록이 없어 비운 채 불러왔습니다`);
  return [];
}

function normPin(v: unknown): Pin | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (!id) return null;
  const index = typeof v.index === 'number' && Number.isFinite(v.index) ? v.index : undefined;
  if (index == null) return null;
  return {
    id,
    index,
    ...(str(v.label) != null ? { label: str(v.label)! } : {}),
    ...(str(v.terminalId) != null ? { terminalId: str(v.terminalId)! } : {}),
  };
}

function normConnector(v: unknown, warn: string[]): Connector | null {
  if (!isObj(v) || !str(v.id)) return null;
  const id = str(v.id)!;
  const kind = v.kind === 'splice' || v.kind === 'board-to-wire' ? v.kind : 'connector';
  const pinsRaw = Array.isArray(v.pins) ? v.pins : [];
  if (!Array.isArray(v.pins)) warn.push(`커넥터 ${id} 의 핀 목록이 없어 비운 채 불러왔습니다`);
  const pins = pinsRaw.map(normPin).filter((p): p is Pin => p != null);
  if (pins.length !== pinsRaw.length) {
    warn.push(`커넥터 ${id} 의 핀 ${pinsRaw.length - pins.length}개는 번호가 없어 제외했습니다`);
  }
  const o = v.orientation;
  const orientation = o === 90 || o === 180 || o === 270 ? o : 0;
  const posRaw = isObj(v.positions) ? v.positions : {};
  const vec = (p: unknown) =>
    isObj(p) && typeof p.x === 'number' && typeof p.y === 'number'
      ? { x: p.x, y: p.y }
      : undefined;
  return {
    id,
    kind,
    housingId: str(v.housingId) ?? '',
    pins,
    orientation,
    positions: {
      ...(vec(posRaw.logical) ? { logical: vec(posRaw.logical)! } : {}),
      ...(vec(posRaw.physical) ? { physical: vec(posRaw.physical)! } : {}),
    },
    ...(Array.isArray(v.bridges)
      ? { bridges: (v.bridges as unknown[]).filter(Array.isArray).map((g) => (g as unknown[]).filter((x): x is string => typeof x === 'string')) }
      : {}),
    ...(str(v.note) != null ? { note: str(v.note)! } : {}),
  };
}

function normDevice(v: unknown): Device | null {
  if (!isObj(v) || !str(v.id)) return null;
  const posRaw = isObj(v.positions) ? v.positions : {};
  const vec = (p: unknown) =>
    isObj(p) && typeof p.x === 'number' && typeof p.y === 'number'
      ? { x: p.x, y: p.y }
      : undefined;
  return {
    id: str(v.id)!,
    name: str(v.name) ?? '이름 없는 장치',
    ...(Array.isArray(v.terminals)
      ? { terminals: (v.terminals as unknown[]).filter((t): t is string => typeof t === 'string') }
      : {}),
    positions: {
      ...(vec(posRaw.logical) ? { logical: vec(posRaw.logical)! } : {}),
      ...(vec(posRaw.physical) ? { physical: vec(posRaw.physical)! } : {}),
    },
    ...(str(v.note) != null ? { note: str(v.note)! } : {}),
  };
}

function normEndpoint(v: unknown): Wire['from'] | null {
  if (!isObj(v)) return null;
  if (v.type === 'pin') {
    const c = str(v.connectorId);
    const p = str(v.pinId);
    return c && p ? { type: 'pin', connectorId: c, pinId: p } : null;
  }
  if (v.type === 'device') {
    const d = str(v.deviceId);
    if (!d) return null;
    return { type: 'device', deviceId: d, ...(str(v.terminal) != null ? { terminal: str(v.terminal)! } : {}) };
  }
  return null;
}

/**
 * 색·굵기가 없는 배선은 고칠 수 없다.
 * 임의의 기본색을 채우면 **틀린 값을 조용히 받아들이는 것**이라 발주에서 사고가 난다.
 * 대신 그 배선만 빼고, 몇 본을 왜 뺐는지 알린다.
 */
function normWire(v: unknown): Wire | null {
  if (!isObj(v) || !str(v.id)) return null;
  const from = normEndpoint(v.from);
  const to = normEndpoint(v.to);
  if (!from || !to) return null;
  const c = isObj(v.color) ? v.color : null;
  const base = c ? str(c.base) : undefined;
  if (!base) return null;
  const g = isObj(v.gauge) ? v.gauge : null;
  const system = g && (g.system === 'awg' || g.system === 'mm2') ? g.system : null;
  const value = g && typeof g.value === 'number' && Number.isFinite(g.value) ? g.value : null;
  if (!system || value == null) return null;
  return {
    id: str(v.id)!,
    from,
    to,
    color: { base, ...(c && str(c.stripe) != null ? { stripe: str(c.stripe)! } : {}) },
    gauge: { system, value },
    ...(typeof v.lengthMm === 'number' && Number.isFinite(v.lengthMm) ? { lengthMm: v.lengthMm } : {}),
    ...(str(v.cableId) != null ? { cableId: str(v.cableId)! } : {}),
    ...(str(v.label) != null ? { label: str(v.label)! } : {}),
  };
}

function normCable(v: unknown): Cable | null {
  if (!isObj(v) || !str(v.id)) return null;
  const g = isObj(v.gauge) ? v.gauge : null;
  return {
    id: str(v.id)!,
    ...(str(v.name) != null ? { name: str(v.name)! } : {}),
    coreCount: typeof v.coreCount === 'number' && Number.isFinite(v.coreCount) ? v.coreCount : 0,
    ...(g && (g.system === 'awg' || g.system === 'mm2') && typeof g.value === 'number'
      ? { gauge: { system: g.system, value: g.value } }
      : {}),
    ...(str(v.jacketColor) != null ? { jacketColor: str(v.jacketColor)! } : {}),
    ...(typeof v.lengthMm === 'number' && Number.isFinite(v.lengthMm) ? { lengthMm: v.lengthMm } : {}),
  };
}

/**
 * 부품 스냅샷은 **그대로 보존한다**. 이 배열이 문서의 자기완결성을 책임지므로
 * 모르는 필드를 떨어뜨리면 남의 기기에서 도면이 재현되지 않는다.
 * id·name 이 없는 것만 걸러낸다.
 */
function normPart(v: unknown): HarnessDocument['usedParts'][number] | null {
  if (!isObj(v) || !str(v.id) || !str(v.name)) return null;
  return v as unknown as HarnessDocument['usedParts'][number];
}

/**
 * 사람이 입력한 구간 길이.
 *
 * 이 값은 곧 도면의 치수선이 되므로 **고칠 수 있는 것이 없다** — 숫자가 아니거나
 * 0 이하인 값을 0 이나 1 로 때우면 "0mm 로 자르라"는 지시가 되고, 없는 부품을
 * 가리키는 키는 어느 구간에도 붙지 않은 채 파일에만 남아 다음 사람을 헷갈리게 한다.
 * 그래서 못 쓰는 것은 버리고 **몇 건을 왜 버렸는지 알린다**.
 *
 * 키가 가리키는 부품이 문서에 있는지까지 본다: 커넥터를 지운 뒤 그 구간 길이만
 * 남아 있으면 그건 이미 없는 구간의 치수다.
 */
function normSegmentLengths(
  v: unknown,
  known: Set<string>,
  at: (label: string) => string,
  warn: string[],
): Record<string, number> {
  if (v === undefined) return {};
  if (!isObj(v)) {
    warn.push(at('구간 길이가 형식에 맞지 않아 비운 채 불러왔습니다'));
    return {};
  }
  const out: Record<string, number> = {};
  let badValue = 0;
  let badKey = 0;
  for (const [key, raw] of Object.entries(v)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      badValue += 1;
      continue;
    }
    const refs = segmentKeyRefs(key);
    if (!refs || refs.some((id) => !known.has(id))) {
      badKey += 1;
      continue;
    }
    out[key] = raw;
  }
  if (badValue > 0) warn.push(at(`구간 길이 ${badValue}건은 숫자가 아니거나 0 이하라 제외했습니다`));
  if (badKey > 0) warn.push(at(`구간 길이 ${badKey}건은 문서에 없는 부품을 가리켜 제외했습니다`));
  return out;
}

function normHarness(v: unknown, i: number, warn: string[]): HarnessDocument | null {
  if (!isObj(v)) return null;
  const where = str(v.name) ?? `${i + 1}번 하네스`;
  const at = (label: string) => `${where}: ${label}`;
  const now = new Date().toISOString();

  const id = str(v.id) || genId('hrn');
  if (!str(v.id)) warn.push(at('문서 id 가 없어 새로 붙였습니다'));

  const cs = listOf(v.connectors, at('커넥터'), warn).map((c) => normConnector(c, warn));
  const connectors = cs.filter((c): c is Connector => c != null);
  if (connectors.length !== cs.length) warn.push(at(`커넥터 ${cs.length - connectors.length}개는 id 가 없어 제외했습니다`));

  const ds = listOf(v.devices, at('장치'), warn).map(normDevice);
  const devices = ds.filter((d): d is Device => d != null);
  if (devices.length !== ds.length) warn.push(at(`장치 ${ds.length - devices.length}개는 id 가 없어 제외했습니다`));

  const ws = listOf(v.wires, at('배선'), warn).map(normWire);
  const wires = ws.filter((w): w is Wire => w != null);
  if (wires.length !== ws.length) {
    warn.push(at(`배선 ${ws.length - wires.length}본은 끝점·색·굵기가 없어 제외했습니다`));
  }

  const ps = listOf(v.usedParts, at('부품 스냅샷'), warn).map(normPart);
  const usedParts = ps.filter((p): p is HarnessDocument['usedParts'][number] => p != null);
  if (usedParts.length !== ps.length) warn.push(at(`부품 ${ps.length - usedParts.length}종은 id·이름이 없어 제외했습니다`));

  // cables 는 원래 선택 필드다 — 없다고 경고하지 않는다.
  const cables = Array.isArray(v.cables)
    ? (v.cables as unknown[]).map(normCable).filter((c): c is Cable => c != null)
    : [];

  // 구간 길이도 선택 필드다. 키가 가리킬 수 있는 것은 살아남은 커넥터·장치뿐이다.
  const segmentLengths = normSegmentLengths(
    v.segmentLengths,
    new Set([...connectors.map((c) => c.id), ...devices.map((d) => d.id)]),
    at,
    warn,
  );

  return {
    schemaVersion: 1,
    id,
    name: str(v.name) ?? '이름 없는 하네스',
    createdAt: str(v.createdAt) ?? now,
    updatedAt: str(v.updatedAt) ?? now,
    ...(str(v.drawingNo) != null ? { drawingNo: str(v.drawingNo)! } : {}),
    ...(str(v.rev) != null ? { rev: str(v.rev)! } : {}),
    ...(str(v.letter) != null ? { letter: str(v.letter)! } : {}),
    connectors,
    devices,
    wires,
    cables,
    // 쓴 적 없는 문서에 빈 객체를 붙이지 않는다 — 없던 필드가 생기면 저장 파일이
    // 달라져 형상관리에서 없는 변경이 보이고, 옛 문서와 왕복 결과도 어긋난다.
    ...(Object.keys(segmentLengths).length ? { segmentLengths } : {}),
    usedParts,
  };
}

/** 세트 구성 — 하네스 목록과 어긋난 줄은 버리고 빠진 줄은 채운다 */
function normSet(v: unknown, harnesses: HarnessDocument[], kitName: string, warn: string[]): HarnessSet {
  const raw = isObj(v) ? v : null;
  if (!raw) warn.push('세트 구성 정보가 없어 하네스마다 세트당 1개로 채웠습니다');

  const known = new Set(harnesses.map((h) => h.id));
  const items: HarnessSet['items'] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const it of Array.isArray(raw?.items) ? (raw!.items as unknown[]) : []) {
    if (!isObj(it)) { dropped += 1; continue; }
    const hid = str(it.harnessId);
    // 없는 하네스를 가리키는 줄은 수량만 부풀린다 — 버리고 알린다
    if (!hid || !known.has(hid) || seen.has(hid)) { dropped += 1; continue; }
    seen.add(hid);
    items.push({ harnessId: hid, perSet: count(it.perSet) ?? 1 });
  }
  if (dropped > 0) warn.push(`세트 구성 ${dropped}줄이 없는 하네스를 가리켜 제외했습니다`);
  const missing = harnesses.filter((h) => !seen.has(h.id));
  if (missing.length > 0 && raw) {
    warn.push(`세트 구성에 빠진 하네스 ${missing.length}종을 세트당 1개로 채웠습니다`);
  }
  for (const h of missing) items.push({ harnessId: h.id, perSet: 1 });

  const orderQty = count(raw?.orderQty);
  if (raw && orderQty == null) warn.push('주문 세트 수가 올바르지 않아 1 로 되돌렸습니다');

  return {
    id: str(raw?.id) || genId('set'),
    pn: str(raw?.pn) ?? '',
    name: str(raw?.name) || kitName,
    ...(str(raw?.rev) != null ? { rev: str(raw?.rev)! } : {}),
    items,
    orderQty: orderQty ?? 1,
  };
}

/**
 * 임의의 값 → 세트. 실패하면 사용자에게 보일 이유를 낸다.
 * 파일에서 오든 localStorage 에서 오든 이 함수 하나만 지난다.
 */
export function normalizeDocument(parsed: unknown): ParseResult {
  if (!isObj(parsed)) {
    return { ok: false, reason: '하네스 문서 형식이 아닙니다 (JSON 객체가 아님)' };
  }
  const v = parsed.schemaVersion;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { ok: false, reason: '하네스 문서 형식이 아닙니다 (schemaVersion 없음)' };
  }
  if (v > MAX_SCHEMA_VERSION) {
    // 미래 버전을 v1 하네스로 오해해 세트에 말아넣고 v2 로 덮어쓰면 원본이 사라진다
    return {
      ok: false,
      reason: `더 새 버전(v${v})으로 저장된 문서입니다 — 툴을 최신으로 올린 뒤 열어 주세요`,
    };
  }
  if (v < 1) return { ok: false, reason: `알 수 없는 문서 버전입니다 (v${v})` };

  const warnings: string[] = [];

  if (v === 1) {
    const h = normHarness(parsed, 0, warnings);
    if (!h) return { ok: false, reason: '하네스 문서를 읽을 수 없습니다' };
    return { ok: true, kit: toKit(h), warnings };
  }

  // v2 (세트)
  if (!Array.isArray(parsed.harnesses) || parsed.harnesses.length === 0) {
    return { ok: false, reason: '세트 파일에 하네스가 하나도 없습니다' };
  }
  const hs = (parsed.harnesses as unknown[])
    .map((h, i) => normHarness(h, i, warnings))
    .filter((h): h is HarnessDocument => h != null);
  if (hs.length === 0) return { ok: false, reason: '세트 파일의 하네스를 하나도 읽을 수 없습니다' };
  if (hs.length !== (parsed.harnesses as unknown[]).length) {
    warnings.push(`하네스 ${(parsed.harnesses as unknown[]).length - hs.length}종을 읽지 못해 제외했습니다`);
  }
  // 문자(A·B·C)가 비면 도면·발주 문구에서 '?' 로 새기 때문에 순서대로 채운다
  const harnesses = hs.map((h, i) => (h.letter ? h : { ...h, letter: letterAt(i) }));

  const now = new Date().toISOString();
  const name = str(parsed.name) || '하네스 세트';
  return {
    ok: true,
    warnings,
    kit: {
      schemaVersion: 2,
      id: str(parsed.id) || genId('kit'),
      name,
      createdAt: str(parsed.createdAt) ?? now,
      updatedAt: str(parsed.updatedAt) ?? now,
      harnesses,
      set: normSet(parsed.set, harnesses, name, warnings),
    },
  };
}

/** JSON 문자열 → 세트. 문법 오류도 사용자 문장으로 바꾼다. */
export function parseDocument(text: string): ParseResult {
  if (!text || !text.trim()) return { ok: false, reason: '파일이 비어 있습니다' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON 파일이 아닙니다' };
  }
  return normalizeDocument(parsed);
}

// ── v1 자동저장(구버전 키) ──────────────────────────────────────────────

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
 *
 * 읽지 못하면 원본을 백업 키로 옮기고 알린다. 예전에는 조용히 null 을 돌려
 * 샘플 문서로 시작했고, 사용자가 한 번만 손대면 그 위에 덮어써져 작업이 없어졌다.
 */
export function loadSavedKit(): KitDocument | null {
  try {
    const ls = safeStorage();
    if (!ls) return null;
    const raw = ls.getItem(KEY_KIT);
    if (raw) {
      const r = parseDocument(raw);
      if (r.ok) return r.kit;
      try {
        ls.setItem(KEY_KIT_BROKEN, raw);
        ls.removeItem(KEY_KIT);
      } catch {
        /* 백업조차 못 하면 원본을 그대로 둔다 */
      }
      reportStorageProblem({ kind: 'unreadable', reason: r.reason });
      return null;
    }
    // 구버전 키도 같은 검사를 지난다 — 예전 자동저장이 반쪽이어도 앱이 백지가 되면 안 된다
    const legacyRaw = ls.getItem(KEY);
    if (!legacyRaw) return null;
    const legacy = parseDocument(legacyRaw);
    return legacy.ok ? legacy.kit : null;
  } catch {
    return null;
  }
}

/** 저장 성공 여부. 실패하면 조용히 넘기지 않고 한 번 알린다. */
let quotaNotified = false;

export function saveKit(kit: KitDocument): boolean {
  const ls = safeStorage();
  if (!ls) return false;      // 저장소 자체가 없는 환경(file://)은 이미 알려진 상태다
  try {
    ls.setItem(KEY_KIT, JSON.stringify(kit));
    quotaNotified = false;
    return true;
  } catch {
    // 용량 초과면 **이 시점부터 자동저장이 멈춘다**. 조용히 두면 사용자는
    // 저장되고 있다고 믿은 채 작업하다 새로고침에서 전부 잃는다.
    if (!quotaNotified) {
      quotaNotified = true;
      reportStorageProblem({ kind: 'quota' });
    }
    return false;
  }
}

/**
 * 불러오기로 들어온 JSON 을 세트로 정규화한다.
 * v1(하네스 하나)·v2(세트) 둘 다 받는다. 실패하면 null.
 * 이유가 필요하면 `parseDocument` 를 쓴다.
 */
export function parseAnyDocument(text: string): KitDocument | null {
  const r = parseDocument(text);
  return r.ok ? r.kit : null;
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
