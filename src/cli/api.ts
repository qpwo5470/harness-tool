/**
 * 하네스 CLI · JS API (CLI-스펙.md §JS API).
 *
 * CLI(main.ts)는 이 위의 얇은 껍질이다. 여기 함수들은 앱과 **같은 도메인 함수**를
 * 부른다 — 불러오기·정규화는 store/persistence.parseDocument, 검증은
 * store/validate.validateHarness, PDF 는 export/pdf, CSV 는 export/bundle 의
 * buildExportEntries(웹 내보내기 대화상자와 같은 파일 이름 · 같은 열).
 * React·zustand 는 들이지 않는다.
 */
import type { HarnessDocument, KitDocument, PartLibraryItem, Endpoint } from '../types';
import { parseDocument, emptyDoc, emptyKit } from '../store/persistence';
import { perSetOf, statsOf, totalOf } from '../store/kit';
import { validateHarness, type Issue } from '../store/validate';
import { refLabels } from '../canvas/docToFlow';
import { buildKitBom, buildPartList } from '../export/exporters';
import { planExportFiles, type ExportItems } from '../export/exportPlan';
import { buildExportEntries } from '../export/bundle';
import { harnessPdfBytes, kitPdfBytes } from '../export/pdf';
import { collectDatasheets, withLibraryFacts } from '../export/pdfPages';
import { applyScript as applyDsl, findHarness, type ApplyOptions, type ApplyResult } from './dsl';
import { searchLib as searchParts, shortOf } from './parts';
import { ensureKoreanCanvas, CANVAS_HINT } from './nodeCanvas';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export { DslError, parseScript, tokenize, changesLine } from './dsl';
export { resolvePart, partLine, partLines, PartLookupError } from './parts';
export { autoLayout } from './layout';
export { ensureKoreanCanvas } from './nodeCanvas';
export type { ApplyResult, ApplyOptions };

// ================================================================
// 문서 읽기 · 쓰기
// ================================================================

/** JSON 문자열 → 세트(v1 도 세트로 올린다). 못 읽으면 앱과 같은 이유 문장으로 던진다. */
export function parseDoc(text: string): KitDocument {
  const r = parseDocument(text);
  if (!r.ok) throw new Error(r.reason);
  return r.kit;
}

export function loadDoc(path: string): KitDocument {
  if (!existsSync(path)) throw new Error(`${path}: no such file`);
  return parseDoc(readFileSync(path, 'utf8'));
}

/** 세트가 "하네스 하나 · 수량 1 · 세트 품번 없음" 이면 v1 하네스 파일로 써도 잃는 것이 없다 */
export function isTrivialSet(kit: KitDocument): boolean {
  return kit.harnesses.length === 1
    && !kit.set.pn?.trim()
    && !kit.set.rev?.trim()
    && kit.set.orderQty === 1
    && kit.set.items.every((i) => i.perSet === 1);
}

export type SaveFormat = 'auto' | 'v1' | 'v2';

/**
 * 저장 형식. `auto` 는 원래 파일이 v1(하네스 하나)이고 지금도 잃을 것이 없으면 v1,
 * 아니면 v2(세트). 앱의 'JSON 저장' 은 언제나 v2 를 내고, 불러오기는 둘 다 받는다.
 */
export function docJson(kit: KitDocument, format: 'v1' | 'v2'): string {
  if (format === 'v1') {
    const h: HarnessDocument = { ...kit.harnesses[0] };
    return `${JSON.stringify(h, null, 2)}\n`;
  }
  return `${JSON.stringify(kit, null, 2)}\n`;
}

export function saveDoc(path: string, kit: KitDocument, opts: { format?: SaveFormat } = {}): 'v1' | 'v2' {
  let fmt: 'v1' | 'v2' = opts.format === 'v1' ? 'v1' : 'v2';
  if ((opts.format ?? 'auto') === 'auto') {
    let wasV1 = false;
    try { wasV1 = existsSync(path) && JSON.parse(readFileSync(path, 'utf8'))?.schemaVersion === 1; } catch { /* 깨진 파일은 v2 로 덮는다 */ }
    fmt = wasV1 && isTrivialSet(kit) ? 'v1' : 'v2';
  }
  if (fmt === 'v1' && kit.harnesses.length !== 1) fmt = 'v2';
  writeFileSync(path, docJson(kit, fmt));
  return fmt;
}

/** 새 문서. `kit` 이면 세트(v2), 아니면 하네스 하나(v1 로 저장된다) */
export function newDoc(opts: { name?: string; kit?: boolean; pn?: string } = {}): KitDocument {
  if (opts.kit || opts.pn) {
    const k = emptyKit();
    if (opts.name) { k.name = opts.name; k.set.name = opts.name; }
    if (opts.pn) k.set.pn = opts.pn;
    return k;
  }
  const d = emptyDoc();
  if (opts.name) d.name = opts.name;
  return parseDoc(JSON.stringify(d));
}

// ================================================================
// 하네스 고르기 (-h)
// ================================================================

/** `-h` 값: 이름 · letter · 도번 · 인덱스(1부터). 생략하면 전부 */
export function pickHarnesses(kit: KitDocument, sel?: string): HarnessDocument[] {
  if (sel == null || sel === '') return kit.harnesses;
  const h = findHarness(kit, sel);
  if (!h) {
    throw new Error(`harness "${sel}" not found (have: ${kit.harnesses.map((x, i) => `${i + 1}:${x.letter ?? ''} ${x.name}`).join(', ')})`);
  }
  return [h];
}

// ================================================================
// 적용
// ================================================================

export function applyScript(kit: KitDocument, script: string, opts: ApplyOptions = {}): ApplyResult {
  return applyDsl(kit, script, opts);
}

// ================================================================
// 요약 (show)
// ================================================================

export type ConnectorSummary = {
  ref: string; part: string; name: string; pins: number; rot: number;
  unused?: (number | string)[]; sleeve?: boolean; terminals?: string[]; at?: { x: number; y: number };
};
export type WireSummary = {
  from: string; to: string; color: string; gauge: string; lengthMm?: number; label?: string; cable?: string;
};
export type HarnessSummary = {
  index: number; letter: string; name: string; drawingNo?: string; rev?: string; qty: number; total: number;
  purchased?: boolean; note?: string;
  connectors: ConnectorSummary[];
  devices: { ref: string; name: string; terminals?: string[] }[];
  wires: WireSummary[];
  wireCount: number; lengthMm: number; missingLength: number;
  issues: { error: number; warn: number; info: number };
};
export type Summary = {
  kind: 'set' | 'harness';
  set: { pn: string; name: string; rev?: string; orderQty: number; totalHarnesses: number };
  harnesses: HarnessSummary[];
};

const gaugeText = (g: { system: string; value: number }) => (g.system === 'awg' ? `AWG${g.value}` : `${g.value}sq`);

/** 끝점을 DSL 과 같은 꼴로 — `J1.3`, `D1.+24V` */
export function endpointRef(h: HarnessDocument, e: Endpoint, refs = refLabels(h)): string {
  if (e.type === 'device') return `${refs.get(e.deviceId) ?? '?'}${e.terminal ? `.${e.terminal}` : ''}`;
  const c = h.connectors.find((x) => x.id === e.connectorId);
  const p = c?.pins.find((x) => x.id === e.pinId);
  const pin = p ? (p.label && p.label !== String(p.index) ? p.label : String(p.index)) : '?';
  return `${refs.get(e.connectorId) ?? '?'}.${pin}`;
}

function countIssues(issues: Issue[]) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warn: issues.filter((i) => i.level === 'warn').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}

export function summarizeHarness(kit: KitDocument, h: HarnessDocument): HarnessSummary {
  const refs = refLabels(h);
  const st = statsOf(h);
  const partOf = (id: string): PartLibraryItem | undefined => h.usedParts.find((p) => p.id === id);
  return {
    index: kit.harnesses.indexOf(h) + 1,
    letter: h.letter ?? '',
    name: h.name,
    ...(h.drawingNo ? { drawingNo: h.drawingNo } : {}),
    ...(h.rev ? { rev: h.rev } : {}),
    qty: perSetOf(kit.set, h.id),
    total: totalOf(kit.set, h.id),
    ...(h.purchased ? { purchased: true } : {}),
    ...(h.note ? { note: h.note } : {}),
    connectors: h.connectors.map((c) => {
      const part = partOf(c.housingId);
      const terms = [...new Set(c.pins.map((p) => p.terminalId).filter((t): t is string => !!t))]
        .map((t) => partOf(t)?.mpn ?? t);
      return {
        ref: refs.get(c.id) ?? '?',
        part: c.housingId,
        name: part ? shortOf(part) : c.housingId,
        pins: c.pins.length,
        rot: c.orientation,
        ...(c.unused?.length ? { unused: c.unused } : {}),
        ...(c.sleeve ? { sleeve: true } : {}),
        ...(terms.length ? { terminals: terms } : {}),
        ...(c.positions.logical ? { at: c.positions.logical } : {}),
      };
    }),
    devices: h.devices.map((d) => ({ ref: refs.get(d.id) ?? '?', name: d.name, ...(d.terminals ? { terminals: d.terminals } : {}) })),
    wires: h.wires.map((w) => ({
      from: endpointRef(h, w.from, refs),
      to: endpointRef(h, w.to, refs),
      color: w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base,
      gauge: gaugeText(w.gauge),
      ...(w.lengthMm != null ? { lengthMm: w.lengthMm } : {}),
      ...(w.label ? { label: w.label } : {}),
      ...(w.cableId ? { cable: w.cableId } : {}),
    })),
    wireCount: st.wireCount,
    lengthMm: st.wireLengthMm,
    missingLength: st.missingLength,
    issues: countIssues(validateHarness(h)),
  };
}

export function summarize(kit: KitDocument, sel?: string): Summary {
  const hs = pickHarnesses(kit, sel);
  return {
    kind: kit.harnesses.length > 1 || !isTrivialSet(kit) ? 'set' : 'harness',
    set: {
      pn: kit.set.pn,
      name: kit.set.name,
      ...(kit.set.rev ? { rev: kit.set.rev } : {}),
      orderQty: kit.set.orderQty,
      totalHarnesses: kit.set.items.reduce((n, i) => n + i.perSet, 0) * kit.set.orderQty,
    },
    harnesses: hs.map((h) => summarizeHarness(kit, h)),
  };
}

const issuesText = (i: { error: number; warn: number; info: number }) => `${i.error}E ${i.warn}W ${i.info}I`;

function harnessHead(s: HarnessSummary): string {
  return [
    s.letter || String(s.index), s.drawingNo ?? '-', s.name, `rev ${s.rev ?? '-'}`, `qty ${s.qty}`,
    `conn ${s.connectors.length}`, `wire ${s.wireCount}`, `len ${s.lengthMm}mm${s.missingLength ? ` (+${s.missingLength} no len)` : ''}`,
    issuesText(s.issues), ...(s.purchased ? ['purchased'] : []),
  ].join('  ');
}

/** 하네스 표 (짧은 텍스트). 세트 문서에서 -h 가 없으면 하네스 목록만. */
export function summaryText(sum: Summary, detail: boolean): string {
  const out: string[] = [];
  if (sum.kind === 'set') {
    const s = sum.set;
    out.push(`set ${s.pn || '-'}  ${s.name}  rev ${s.rev ?? '-'}  order ${s.orderQty}  harnesses ${s.totalHarnesses}`);
  }
  for (const h of sum.harnesses) {
    out.push(harnessHead(h));
    if (!detail) continue;
    if (h.note) out.push(`  note ${h.note}`);
    for (const c of h.connectors) {
      out.push(`  ${c.ref} ${c.name} [${c.part}] ${c.pins}p rot${c.rot}`
        + `${c.unused ? ` unused=${c.unused.join(',')}` : ''}${c.sleeve ? ' sleeve' : ''}`
        + `${c.terminals ? ` term=${c.terminals.join(',')}` : ''}`);
    }
    for (const d of h.devices) out.push(`  ${d.ref} "${d.name}"${d.terminals ? ` terminals=${d.terminals.join(',')}` : ''}`);
    for (const w of h.wires) {
      out.push(`  ${w.from} ${w.to} ${w.color} ${w.gauge} ${w.lengthMm != null ? `${w.lengthMm}mm` : 'len?'}${w.label ? ` "${w.label}"` : ''}`);
    }
  }
  return out.join('\n');
}

// ================================================================
// 검증 (check)
// ================================================================

export type CheckRow = {
  harness: string; name: string; level: 'error' | 'warn' | 'info'; code: string; where: string; title: string; detail: string;
};

export function validateDoc(kit: KitDocument, sel?: string): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const h of pickHarnesses(kit, sel)) {
    for (const i of validateHarness(h)) {
      rows.push({ harness: h.letter ?? '', name: h.name, level: i.level, code: i.id, where: i.where, title: i.title, detail: i.detail });
    }
  }
  return rows;
}

export function checkText(rows: CheckRow[], multi: boolean): string {
  return rows.map((r) => `${r.level[0].toUpperCase()} ${r.code}${multi ? ` ${r.harness}` : ''} ${r.where}: ${r.title}`).join('\n');
}

// ================================================================
// PDF
// ================================================================

/** 데이터시트 캡처(부록) — 번들에 심긴 것, 없으면 저장소의 public/datasheets */
export function datasheetImages(): Record<string, string> {
  if (typeof __HARNESS_DATASHEETS__ !== 'undefined' && __HARNESS_DATASHEETS__) return __HARNESS_DATASHEETS__;
  const dirs: string[] = [];
  if (process.env.HARNESS_DATASHEETS) dirs.push(process.env.HARNESS_DATASHEETS);
  try { dirs.push(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'datasheets')); } catch { /* */ }
  dirs.push(join(process.cwd(), 'public', 'datasheets'));
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const out: Record<string, string> = {};
    for (const f of readdirSync(d)) {
      if (!/\.(png|jpe?g)$/i.test(f)) continue;
      const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
      out[`datasheets/${f}`] = `data:${mime};base64,${toBase64(readFileSync(join(d, f)))}`;
    }
    return out;
  }
  return {};
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export type PdfOpts = {
  harness?: string;
  layout?: 'onepage' | 'sheets';
  paper?: 'A3' | 'A4';
  /** 부록 이미지 — 기본은 datasheetImages() */
  images?: Record<string, string>;
  /** 한글 캔버스가 없을 때 등 경고 한 줄 */
  onWarn?: (msg: string) => void;
};

/**
 * PDF 바이트. `-h` 로 하나를 고르면 그 하네스 도면, 아니면 세트 전체(도면 목록 + 하네스별 면 + 부록).
 * 하네스 하나짜리 단일 문서는 하네스 도면으로 낸다(앱의 '하네스' 범위와 같다).
 */
export function pdfBytes(kit: KitDocument, opts: PdfOpts = {}): Uint8Array {
  const ko = ensureKoreanCanvas();
  if (!ko.ok) opts.onWarn?.(CANVAS_HINT);
  const images = opts.images ?? datasheetImages();
  const layout = opts.layout ?? 'onepage';
  const one = opts.harness ? pickHarnesses(kit, opts.harness)[0] : isTrivialSet(kit) ? kit.harnesses[0] : undefined;
  if (one) {
    return harnessPdfBytes(one, { layout, paper: opts.paper, perSet: perSetOf(kit.set, one.id), images });
  }
  return kitPdfBytes(kit, { layout, paper: opts.paper, images });
}

/** 부록에 들어갈 캡처 목록(확인용) */
export function datasheetsOf(kit: KitDocument): string[] {
  return collectDatasheets(kit.harnesses.map(withLibraryFacts)).map((e) => e.ds.src);
}

// ================================================================
// CSV · BOM
// ================================================================

export type CsvFile = { name: string; text: string };

/** 접속표·파트리스트 CSV (+ 세트면 하네스 BOM) — 웹 내보내기와 같은 함수·같은 파일 이름 */
export async function csvFiles(kit: KitDocument, opts: { harness?: string } = {}): Promise<CsvFile[]> {
  const scope = opts.harness
    ? { kind: 'harness' as const, harnessId: pickHarnesses(kit, opts.harness)[0].id }
    : { kind: 'set' as const };
  const items: ExportItems = { pdf: false, runsCsv: true, partsCsv: true, bomCsv: !opts.harness && !isTrivialSet(kit), json: false };
  const files = planExportFiles(kit, scope, items);
  const entries = await buildExportEntries(kit, { files, paper: 'A4' }, { yieldToUi: async () => {} });
  const dec = new TextDecoder();
  return entries.map((e) => ({ name: e.name, text: dec.decode(e.data) }));
}

export type BomLine = { harness: string; category: string; part: string; qty: number; detail?: string };

export function bomRows(kit: KitDocument, sel?: string): BomLine[] {
  const out: BomLine[] = [];
  for (const h of pickHarnesses(kit, sel)) {
    for (const r of buildPartList(h)) {
      out.push({ harness: h.letter ?? '', category: r.category, part: r.part, qty: r.qty, ...(r.detail ? { detail: r.detail } : {}) });
    }
  }
  return out;
}

/** 부품표 텍스트 — 하네스마다 머리 한 줄 + 품목 한 줄씩. 세트 전체면 세트 구성 줄을 먼저 */
export function bomText(kit: KitDocument, sel?: string): string {
  const out: string[] = [];
  if (!sel && !isTrivialSet(kit)) {
    for (const r of buildKitBom(kit)) {
      out.push(`${r.letter} ${r.drawingNo || '-'} ${r.name}  ${r.perSet}/set × ${r.orderQty} = ${r.totalQty}`);
    }
  }
  for (const h of pickHarnesses(kit, sel)) {
    out.push(`[${h.letter ?? ''}] ${h.drawingNo ?? '-'} ${h.name}`);
    for (const r of buildPartList(h)) {
      out.push(`  ${r.qty}  ${r.category}  ${r.part}${r.detail ? `  (${r.detail})` : ''}`);
    }
  }
  return out.join('\n');
}

// ================================================================
// 라이브러리
// ================================================================

export function searchLib(query = '', kit?: KitDocument): PartLibraryItem[] {
  const extra = kit ? kit.harnesses.flatMap((h) => h.usedParts) : [];
  return searchParts(query, extra);
}
