/**
 * PDF 의 **표 · 별면** — 도면 목록(표지) · 구매 품목 · 부록(커넥터 핀 번호) ·
 * 1페이지 부품표 · 비고 블록 · 접속표 색 표기.
 *
 * 기준은 손으로 만든 이스턴웰스 하네스 세트 도면집(build.py)이다. 그 도면집은
 * 이 툴의 시각 언어를 그대로 옮겨 그린 것이라, 거기서 더해진 면·칸을 여기서
 * 다시 툴의 데이터로 만든다. **없는 값은 지어내지 않는다** — 도번이 없으면
 * '—', 세트 품번이 없으면 '—', 데이터시트 캡처가 없는 부품은 부록에 안 나온다.
 *
 * 그리기 원자(표 · 프레임 · 제목블록)는 pdfDraw.ts 의 것을 그대로 쓴다.
 */
import type { HarnessDocument, KitDocument, PartLibraryItem } from '../types';
import { buildPartList } from './exporters';
import { formatLength, unitLabel, type LengthUnit } from './units';
import { colorAbbr, refLabels } from '../canvas/docToFlow';
import { lengthResolver } from '../store/wireLength';
import { perSetOf } from '../store/kit';
import { SEED_PARTS } from '../library/seed';
import { isStandaloneLug } from '../library/taxonomy';
import {
  C, HEAD_H, ROW_H, SHEET_MARGIN, TB, drawFrameAndTitleBlock, drawTable,
  estimateTextWidth, titleBlockExtra,
  type Cell, type Col, type DrawText, type PdfLike, type SheetInfo,
} from './pdfDraw';

type Page = { w: number; h: number };

/** 비고 칸 끝에 **언제나** 붙는 문장 — 색은 어느 규격에도 지정이 없다 */
export const COLOR_NOTE = '전선 색상은 규격 지정 사항이 아님 — 사내 배정.';

const DASH = '—';

/**
 * 종이에 적는 부품 이름 — `shortName`(도면용 짧은 이름, `JST-XH 10P`) 이 있으면 그것,
 * 없으면 라이브러리 이름. 도면집은 짧은 이름을 쓴다. 짧은 이름은 사용자가 정한 값만 쓰고
 * 이름을 잘라 지어내지 않는다.
 */
export function paperName(p: Pick<PartLibraryItem, 'name' | 'shortName'> | undefined, fallback: string): string {
  return p?.shortName?.trim() || p?.name || fallback;
}

export function revText(rev?: string): string {
  return rev?.trim() ? `Rev.${rev.trim()}` : DASH;
}

export function dateText(iso?: string): string {
  return (iso ?? '').slice(0, 10) || DASH;
}

// ============================================================
// 제목블록 — 임의 문구
// ============================================================

/** 제목블록 3행 · 오른쪽 칸 문구 (pdfDraw `info.rows` 와 같은 모양) */
export type TitleRows = {
  title: string;
  no: string;
  line2: string;
  rev: string;
  line3: string;
  date: string;
};

/**
 * 하네스가 아닌 면(도면 목록 · 부록 · 구매 품목)의 프레임 + 제목블록.
 *
 * 글자는 `info.rows` 가 그대로 찍는다. 대역 문서는 함수 서명을 채우는 용도일 뿐이다.
 */
export function drawFrameWithRows(pdf: PdfLike, text: DrawText, page: Page, rows: TitleRows): void {
  const standIn: HarnessDocument = {
    schemaVersion: 1,
    id: '__page',
    name: rows.title,
    createdAt: '',
    updatedAt: rows.date === DASH ? '' : rows.date,
    ...(rows.no !== DASH ? { drawingNo: rows.no } : {}),
    ...(rows.rev !== DASH ? { rev: rows.rev.replace(/^Rev\./, '') } : {}),
    connectors: [], devices: [], wires: [], usedParts: [],
  };
  drawFrameAndTitleBlock(pdf, standIn, text, page, { rows } satisfies SheetInfo);
}

// ============================================================
// 접속표 — NET 코드 · 색 표기
// ============================================================

/** `N1` → `N01` (종이에서만 — 열을 맞춰 읽게 한다. CSV 는 그대로) */
export function padNet(code: string): string {
  return code.replace(/^([A-Za-z]+)(\d)$/, (_, a: string, d: string) => `${a}0${d}`);
}

const KO: Record<string, string> = {
  red: '빨강', black: '검정', white: '흰색', green: '초록', blue: '파랑',
  yellow: '노랑', orange: '주황', brown: '갈색', purple: '보라', violet: '보라',
  gray: '회색', grey: '회색', pink: '분홍',
};
/** 줄무늬 표기(`흰/주황`)에서는 두 글자 이름을 줄인다 */
const KO_SHORT: Record<string, string> = { ...KO, white: '흰' };

/**
 * 색 칸 글자 — `R 빨강`, `W/O 흰/주황`.
 * 모르는 색 이름(hex 등)은 **원문 그대로** 둔다 — 한글 이름을 지어내지 않는다.
 */
export function colorLabel(base: string, stripe?: string): string {
  const abbr = colorAbbr(base, stripe);
  const b = base.trim().toLowerCase();
  if (!stripe) return `${abbr} ${KO[b] ?? base.trim()}`;
  const s = stripe.trim().toLowerCase();
  return `${abbr} ${KO_SHORT[b] ?? base.trim()}/${KO_SHORT[s] ?? stripe.trim()}`;
}

// ============================================================
// 1페이지 부품표
// ============================================================

/**
 * 종이용 부품표 행 — 도면집 형식(`J1 부품명 | 1 | MPN`, `전선 AWG22 | 10 | 1600mm / 본`).
 *
 * ## CSV 파트리스트와 무엇이 다른가
 * 파트리스트(buildPartList)는 **발주** 단위로 묶는다(같은 하우징은 한 줄, 전선은
 * 게이지·색별 총길이). 종이는 **조립** 단위다 — 조립자는 도면의 J1·J2 와 표를
 * 맞대어 보고, 전선은 몇 mm 로 몇 본 자르는지가 필요하다. 그래서:
 *  · 커넥터는 도면 레퍼런스별 한 줄(`grouped` 면 같은 부품끼리 `J1·J2` 로 묶는다)
 *  · 전선은 게이지 + **본당 길이**별(케이블 심선은 케이블 줄이 대신한다)
 *  · 단자 · 슬리브 · 케이블 줄은 파트리스트와 **같은 집계**를 쓴다 — 도면집이
 *    뺀 압착단자도 남긴다(발주에서 빠지면 현장에 안 온다).
 * 러그 노드는 커넥터 줄에 이미 섰으므로 단자 줄에서 그만큼 뺀다(이중 계상 방지).
 */
export function paperPartRows(doc: HarnessDocument, unit: LengthUnit, grouped = false): Cell[][] {
  const refs = refLabels(doc);
  const partOf = (id?: string): PartLibraryItem | undefined =>
    id ? doc.usedParts.find((p) => p.id === id) : undefined;
  const rows: Cell[][] = [];

  // ── 커넥터 (도면 레퍼런스) ───────────────────────────────────────────────
  const lugNodes = new Map<string, number>();
  if (grouped) {
    const byPart = new Map<string, string[]>();
    for (const c of doc.connectors) {
      const list = byPart.get(c.housingId) ?? [];
      list.push(refs.get(c.id) ?? '?');
      byPart.set(c.housingId, list);
    }
    for (const [hid, list] of byPart) {
      const p = partOf(hid);
      rows.push([`${list.join('·')} ${paperName(p, hid)}`, String(list.length), p?.mpn || DASH]);
    }
  } else {
    for (const c of doc.connectors) {
      const p = partOf(c.housingId);
      rows.push([`${refs.get(c.id) ?? '?'} ${paperName(p, c.housingId)}`, '1', p?.mpn || p?.spec?.['처리'] || DASH]);
    }
  }
  for (const c of doc.connectors) {
    const p = partOf(c.housingId);
    if (p && isStandaloneLug(p)) lugNodes.set(p.name, (lugNodes.get(p.name) ?? 0) + 1);
  }

  // ── 전선 — 게이지 + 본당 길이 ────────────────────────────────────────────
  const lengthOf = lengthResolver(doc);
  const wires = new Map<string, { label: string; mm: number | null; qty: number }>();
  for (const w of doc.wires) {
    const { mm, cable } = lengthOf(w);
    if (cable) continue; // 케이블 심선 — 아래 케이블 줄이 발주한다
    const g = `${w.gauge.system.toUpperCase()}${w.gauge.value}`;
    const key = `${g}|${mm ?? '?'}`;
    const cur = wires.get(key) ?? { label: g, mm, qty: 0 };
    cur.qty += 1;
    wires.set(key, cur);
  }
  for (const g of wires.values()) {
    rows.push([
      `전선 ${g.label}`,
      String(g.qty),
      g.mm != null ? `${formatLength(g.mm, unit)}${unitLabel(unit)} / 본` : '길이 미상',
    ]);
  }

  // ── 단자 · 슬리브 · 케이블 — 파트리스트와 같은 집계 ─────────────────────
  const list = buildPartList(doc, { unit });
  for (const r of list) {
    if (r.category !== '터미널') continue;
    const qty = r.qty - (lugNodes.get(r.part) ?? 0);
    if (qty <= 0) continue;
    const part = doc.usedParts.find((p) => p.name === r.part);
    rows.push([paperName(part, r.part), String(qty), part?.mpn || r.detail || DASH]);
  }
  const sleeves = new Map<string, string[]>();
  for (const c of doc.connectors) {
    if (!c.sleeve) continue;
    const sid = partOf(c.housingId)?.sleevePartId;
    const name = partOf(sid)?.name ?? sid ?? '절연 슬리브 (품목 미지정)';
    const l = sleeves.get(name) ?? [];
    l.push(refs.get(c.id) ?? '?');
    sleeves.set(name, l);
  }
  for (const [name, l] of sleeves) rows.push([name, String(l.length), `${l.join('·')}측 압착부`]);
  for (const r of list) {
    if (r.category === '케이블') rows.push([r.part, String(r.qty), r.detail || DASH]);
  }
  return rows;
}

export const PART_COLS_PAPER: Col[] = [
  { title: '품목', w: 0.52 },
  { title: '수량', w: 0.14, align: 'right' },
  { title: '비고', w: 0.34 },
];

// ============================================================
// 비고 블록
// ============================================================

/** 문서 비고 + 색상 문구 */
export function noteText(doc: HarnessDocument): string {
  return [doc.note?.trim(), COLOR_NOTE].filter(Boolean).join(' ');
}

/** 어림 폭으로 줄바꿈 — 공백에서 끊고, 한 단어가 폭을 넘으면 글자 단위로 끊는다 */
export function wrapText(s: string, width: number, size: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (estimateTextWidth(t, size) <= width) { line = t; continue; }
      if (line) out.push(line);
      line = '';
      let chunk = '';
      for (const ch of word) {
        if (estimateTextWidth(chunk + ch, size) > width && chunk) { out.push(chunk); chunk = ''; }
        chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/**
 * 비고 블록 간격. 도면집은 표 끝 → `비고` 를 28pt 띄웠지만, 1페이지 부품 칸은
 * 제목블록 위 109pt 뿐이라 그 간격이면 부품 5줄 + 비고 1줄이 안 들어간다
 * (EW-05 실측: 단자 줄 하나 때문에 이어지는 면이 생겼다). 줄 간격을 좁혀 담는다.
 */
export const NOTE = { size: 8.5, gap: 16, labelToFirst: 12, lineH: 11 };

/** 비고 블록 높이 (표 끝 → 마지막 줄 베이스라인) */
export function noteHeight(lines: number): number {
  return NOTE.gap + NOTE.labelToFirst + NOTE.lineH * Math.max(0, lines - 1);
}

/** 표 끝(y) 아래에 `비고` + 줄들 */
export function drawNote(text: DrawText, x: number, tableEnd: number, lines: string[]): void {
  const ny = tableEnd + NOTE.gap;
  text('비고', x, ny, { size: 9, bold: true, color: C.text3 });
  lines.forEach((ln, i) => {
    text(ln, x, ny + NOTE.labelToFirst + i * NOTE.lineH, { size: NOTE.size, color: C.muted });
  });
}

// ============================================================
// 표지 — 도면 목록
// ============================================================

/**
 * 끝단 구성 — `A측 끝단 ↔ B측 끝단`.
 * 논리 뷰의 x 로 왼쪽/오른쪽을 가른다(도면이 그렇게 놓여 있다). 한쪽에 여러
 * 부품이 있으면 `·` 로 잇는다. 장치 블록은 그 이름으로 적는다.
 */
export function endsText(doc: HarnessDocument): string {
  const items: { name: string; x: number }[] = [
    ...doc.connectors.map((c, i) => ({
      name: paperName(doc.usedParts.find((p) => p.id === c.housingId), c.housingId),
      x: c.positions.logical?.x ?? i * 160,
    })),
    ...doc.devices.map((d, i) => ({ name: d.name, x: d.positions.logical?.x ?? (doc.connectors.length + i) * 160 })),
  ];
  if (!items.length) return DASH;
  const uniq = (l: { name: string }[]) => [...new Set(l.map((v) => v.name))].join(' · ');
  if (items.length === 1) return items[0].name;
  const xs = items.map((v) => v.x);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  let left = items.filter((v) => v.x <= mid);
  let right = items.filter((v) => v.x > mid);
  if (!right.length) {
    // 전부 같은 x — 입력 순서로 반씩
    const half = Math.ceil(items.length / 2);
    left = items.slice(0, half);
    right = items.slice(half);
  }
  return `${uniq(left)} ↔ ${uniq(right)}`;
}

/**
 * 길이 칸 — 값 하나면 그대로(`1600`), 여럿이면 범위(`200~1800`). 하나도 모르면 '미상'.
 *
 * 일부만 아는 하네스는 아는 값 뒤에 `(일부 미상)` 을 붙인다. 예전에는 아는 값만으로
 * 범위를 적어, 길이를 안 넣은 배선이 있는데도 표지가 완결된 길이처럼 읽혔다.
 * (도면집 ref-01 은 하네스마다 한 길이만 적는다 — 길이를 다 넣은 하네스는 그렇게 나온다.)
 */
export function lengthCell(doc: HarnessDocument, unit: LengthUnit): string {
  const lengthOf = lengthResolver(doc);
  const all = doc.wires.map((w) => lengthOf(w).mm);
  const uniq = [...new Set(all.filter((v): v is number => v != null))].sort((a, b) => a - b);
  if (!uniq.length) return '미상';
  const f = (mm: number) => formatLength(mm, unit);
  const known = uniq.length === 1 ? f(uniq[0]) : `${f(uniq[0])}~${f(uniq[uniq.length - 1])}`;
  return all.some((v) => v == null) ? `${known} (일부 미상)` : known;
}

export const COVER_COLS = (unit: LengthUnit): Col[] => [
  { title: '도번', w: 0.10 },
  { title: '품명', w: 0.22 },
  { title: '끝단 구성', w: 0.40 },
  { title: `길이(${unitLabel(unit)})`, w: 0.14, align: 'right' },
  { title: '수량(EA)', w: 0.14, align: 'right' },
];

export function coverRows(kit: KitDocument, unit: LengthUnit): Cell[][] {
  return kit.harnesses.map((h) => [
    h.drawingNo?.trim() || DASH,
    h.purchased ? `${h.name || '이름 없는 하네스'} (구매품)` : (h.name || '이름 없는 하네스'),
    // 짧은 이름(shortName)은 라이브러리에만 있을 수 있다 — 하네스 면과 같은 보충을 거친다
    endsText(withLibraryFacts(h)),
    lengthCell(h, unit),
    String(perSetOf(kit.set, h.id)),
  ]);
}

export function coverTitleRows(kit: KitDocument): TitleRows {
  const made = kit.harnesses.filter((h) => !h.purchased).length;
  const bought = kit.harnesses.length - made;
  return {
    title: '도면 목록',
    no: kit.set.pn?.trim() || DASH,
    line2: '1세트 기준',
    rev: revText(kit.set.rev),
    line3: `제작 ${made}종 · 구매 ${bought}종`,
    date: dateText(kit.updatedAt),
  };
}

/** 표지 한 면에 들어가는 목록 행 수 (제목블록 위에서 멈춘다) */
export function coverRowsPerPage(page: Page): number {
  const tbTop = page.h - SHEET_MARGIN - TB.rowH * TB.rows - 8;
  return Math.max(1, Math.floor((tbTop - (SHEET_MARGIN + 84 + HEAD_H)) / ROW_H));
}

/** 표지 한 면 — 세트 이름 · 부제 · 도면 목록 표 */
export function drawCoverPage(
  pdf: PdfLike, text: DrawText, page: Page, kit: KitDocument, unit: LengthUnit,
  rows: Cell[][], total: number, pi: number, pn: number,
): void {
  drawFrameWithRows(pdf, text, page, coverTitleRows(kit));
  const fx = SHEET_MARGIN;
  const fw = page.w - SHEET_MARGIN * 2;
  text(kit.set.name || kit.name || '이름 없는 세트', fx + 12, SHEET_MARGIN + 34, { size: 20, bold: true, color: C.text });
  text('수량은 모두 세트당 기준', fx + 12, SHEET_MARGIN + 54, { size: 10, color: C.muted });
  drawTable(pdf, text, {
    x: fx + 12, y: SHEET_MARGIN + 84, w: fw - 24,
    title: pn > 1 ? `도면 목록 (${pi + 1}/${pn})` : '도면 목록',
    note: `${total}종`,
    cols: COVER_COLS(unit), rows, empty: '세트에 하네스가 없다.',
  });
}

// ============================================================
// 구매 품목
// ============================================================

/** 완제품 구매 품목 면 — 결선도를 그리지 않는다 */
export function drawPurchasedPage(
  pdf: PdfLike, text: DrawText, page: Page, doc: HarnessDocument, unit: LengthUnit, perSet?: number,
): void {
  drawFrameWithRows(pdf, text, page, {
    title: doc.name || '이름 없는 하네스',
    no: doc.drawingNo?.trim() || DASH,
    line2: '구매품 · 제작 대상 아님',
    rev: revText(doc.rev),
    line3: titleBlockExtra(doc, perSet),
    date: dateText(doc.updatedAt),
  });
  const fx = SHEET_MARGIN;
  const fw = page.w - SHEET_MARGIN * 2;
  text(doc.name || '이름 없는 하네스', fx + 12, SHEET_MARGIN + 34, { size: 20, bold: true, color: C.text });
  text(doc.note?.trim() || '완제품 구매. 제작 대상 아님.', fx + 12, SHEET_MARGIN + 54, {
    size: 10, color: C.muted, maxWidth: fw - 24,
  });
  const len = lengthCell(doc, unit);
  const end = drawTable(pdf, text, {
    x: fx + 12, y: SHEET_MARGIN + 84, w: fw - 24,
    title: '구매 품목', note: '1품목',
    cols: [
      { title: '품목', w: 0.44 },
      { title: '규격', w: 0.18 },
      { title: '수량(EA)', w: 0.14, align: 'right' },
      { title: '비고', w: 0.24 },
    ],
    rows: [[
      doc.name || '이름 없는 하네스',
      len === '미상'
        ? '길이 미상'
        : len.replace(/^(.*?)( \(일부 미상\))?$/, (_, v: string, tail?: string) => `${v}${unitLabel(unit)}${tail ?? ''}`),
      perSet != null ? String(perSet) : DASH,
      endsText(doc),
    ]],
  });
  text('※ 완제품 구매 품목이므로 결선도 생략.', fx + 12, end + 30, { size: 9, color: C.muted });
}

// ============================================================
// 부록 — 커넥터 핀 번호 (제조사 원본 도면 캡처)
// ============================================================

export type DatasheetEntry = {
  part: PartLibraryItem;
  ds: NonNullable<PartLibraryItem['datasheet']>;
};

const SEED_BY_ID = new Map(SEED_PARTS.map((p) => [p.id, p] as const));

/**
 * 문서 스냅샷에 **비어 있는** 라이브러리 사실(layout · view · datasheet · shortName)을 채운다.
 *
 * 스냅샷(usedParts)은 그 부품을 쓴 시점의 정의라, 그 뒤에 라이브러리에 적힌
 * 실물 배열·원본 도면이 없다(EW-에보카 세트가 그렇다). **같은 id · 같은 MPN**
 * 일 때만, 그리고 스냅샷이 그 칸을 **아예 비워 둔** 때만 채운다 — 스냅샷에 적힌
 * 값은 절대 덮지 않는다. layout 과 view 는 한 쌍으로만 옮긴다(뷰 없는 배열은
 * 거울상일 수 있다).
 */
export function withLibraryFacts(doc: HarnessDocument): HarnessDocument {
  let changed = false;
  const usedParts = doc.usedParts.map((p) => {
    const s = SEED_BY_ID.get(p.id);
    if (!s || (s.mpn ?? '') !== (p.mpn ?? '')) return p;
    const add: Partial<PartLibraryItem> = {};
    if (p.layout == null && p.view == null && s.layout && s.view) {
      add.layout = s.layout;
      add.view = s.view;
    }
    // 요약은 원문과 같은 뷰일 때만 — 다른 원문에 엉뚱한 요약이 붙지 않게
    const view = add.view ?? p.view;
    if (!p.viewBrief && s.viewBrief && view === s.view) add.viewBrief = s.viewBrief;
    if (!p.datasheet && s.datasheet) add.datasheet = s.datasheet;
    // 도면용 짧은 이름 — 같은 id·MPN 이므로 같은 부품이다. 스냅샷 값은 덮지 않는다
    if (!p.shortName?.trim() && s.shortName?.trim()) add.shortName = s.shortName;
    if (!Object.keys(add).length) return p;
    changed = true;
    return { ...p, ...add };
  });
  return changed ? { ...doc, usedParts } : doc;
}

/** 도면에 실제로 놓인 부품의 데이터시트 — 원본 도면(src) 단위로 한 번씩 */
export function collectDatasheets(docs: HarnessDocument[]): DatasheetEntry[] {
  const out: DatasheetEntry[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (d.purchased) continue;
    for (const c of d.connectors) {
      const part = d.usedParts.find((p) => p.id === c.housingId);
      const ds = part?.datasheet;
      if (!part || !ds?.src || seen.has(ds.src)) continue;
      seen.add(ds.src);
      out.push({ part, ds });
    }
  }
  return out;
}

/** Vite base 를 붙인 URL (`./datasheets/xh.png`) */
export function datasheetUrl(src: string): string {
  if (/^(https?:|data:|\/)/.test(src)) return src;
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = env?.BASE_URL ?? './';
  return `${base.endsWith('/') ? base : `${base}/`}${src}`;
}

/**
 * 브라우저에서 캡처 이미지를 읽어 data URL 로 — `{ [src]: dataURL }`.
 * 못 읽은 것은 **빼고** 돌려준다(부록에서 그 부품만 빠진다). 실패로 PDF 전체를
 * 막지 않는다 — 캡처는 참고 자료이고 도면 본문은 그것 없이도 완결이다.
 */
export async function loadDatasheetImages(entries: DatasheetEntry[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return out;
  await Promise.all(entries.map(async ({ ds }) => {
    try {
      const res = await fetch(datasheetUrl(ds.src));
      if (!res.ok) return;
      const blob = await res.blob();
      out[ds.src] = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    } catch {
      /* 이 캡처만 빠진다 */
    }
  }));
  return out;
}

const DS_COL_W = 380;
const DS_BOX_H = 382;

function imageFormat(data: string): string {
  const m = /^data:image\/(png|jpe?g|webp)/i.exec(data);
  if (!m) return 'PNG';
  return m[1].toLowerCase().startsWith('jp') ? 'JPEG' : m[1].toUpperCase();
}

/** 부록 면 하나의 제목블록 문구 */
export function appendixTitleRows(
  entries: DatasheetEntry[], letter: string, rev: string, date: string,
): TitleRows {
  const mfrs = [...new Set(entries.map((e) => e.part.manufacturer?.trim()).filter((v): v is string => !!v))];
  return {
    title: `부록 ${letter} · 커넥터 핀 번호`,
    no: DASH,
    line2: '제조사 원본 도면 캡처',
    rev,
    line3: `${mfrs.length ? `${mfrs.join(' · ')} · ` : ''}${entries.length}종`,
    date,
  };
}

/** 부록 경고 줄 — 모든 캡처의 출처가 "뷰 기준 표기 없음" 일 때만 그 사실을 말한다 */
export function appendixWarning(all: DatasheetEntry[]): string {
  const noView = all.length > 0 && all.every((e) => /뷰 기준 표기 없음/.test(e.ds.source));
  return noView
    ? '※ 아래 원본 도면 모두 뷰 기준(결합면/후면) 표기가 없음. 조립 전 실물의 1번 식별 리브·각인과 대조할 것.'
    : '※ 조립 전 실물의 1번 식별 리브·각인과 대조할 것.';
}

/** 부록 한 면 — 캡처 두 장까지 */
export function drawAppendixPage(
  pdf: PdfLike, text: DrawText, page: Page, entries: DatasheetEntry[],
  images: Record<string, string>, rows: TitleRows, warning: string,
): void {
  drawFrameWithRows(pdf, text, page, rows);
  const fx = SHEET_MARGIN;
  const fw = page.w - SHEET_MARGIN * 2;
  text(warning, fx + 12, SHEET_MARGIN + 34, { size: 9, bold: true, color: C.danger, maxWidth: fw - 24 });
  const gap = Math.max(12, fw - 24 - DS_COL_W * 2);
  entries.forEach((e, i) => {
    const x = fx + 12 + i * (DS_COL_W + gap);
    const y = SHEET_MARGIN + 66;
    // 이름에 이미 MPN 이 들어 있으면(`JST XHP-10 …`) 두 번 적지 않는다
    const head = [e.part.manufacturer, e.part.mpn].filter(Boolean).join(' ');
    const title = !head || (e.part.mpn && e.part.name.includes(e.part.mpn))
      ? e.part.name
      : `${head} · ${e.part.name}`;
    text(title, x, y - 8, {
      size: 11, bold: true, color: C.text, maxWidth: DS_COL_W,
    });
    const data = images[e.ds.src];
    let w = DS_COL_W;
    let h = DS_BOX_H;
    const props = (pdf as unknown as {
      getImageProperties?(d: string): { width: number; height: number };
    }).getImageProperties?.(data);
    if (props && props.width > 0 && props.height > 0) {
      const sc = Math.min(DS_COL_W / props.width, DS_BOX_H / props.height);
      w = props.width * sc;
      h = props.height * sc;
    }
    const ix = x + (DS_COL_W - w) / 2;
    pdf.addImage(data, imageFormat(data), ix, y, w, h);
    pdf.setLineDashPattern([], 0);
    pdf.setDrawColor(C.lineMid);
    pdf.setLineWidth(0.8);
    pdf.rect(ix, y, w, h, 'S');
    let cy = y + h + 14;
    const caps = [e.ds.source, ...(e.ds.note ? e.ds.note.split('\n') : [])];
    for (const cap of caps) {
      for (const ln of wrapText(cap, DS_COL_W, 8.5)) {
        text(ln, x, cy, { size: 8.5, color: C.muted });
        cy += 11;
      }
    }
  });
}
