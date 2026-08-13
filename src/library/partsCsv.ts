/**
 * CSV ↔ PartLibraryItem 변환 (순수 함수).
 *
 * 실무에서 부품표는 엑셀로 온다. 엑셀이 뱉는 CSV 를 그대로 받아 라이브러리에
 * 일괄 등록하는 것이 목표라서, 다음을 직접 처리한다(외부 의존 없음):
 *  - 따옴표 안의 쉼표·줄바꿈, `""` 이스케이프
 *  - 엑셀이 붙이는 BOM, CRLF/CR/LF 혼용
 *  - 열 순서 무관(헤더 이름으로 찾음), 한글·영문 헤더 혼용
 *  - 한 행이 깨져도 그 행만 건너뛰고 경고를 남김(전체를 버리지 않음)
 */
import type { PartCategory, PartLibraryItem, PinSlot } from '../types';
import { newCustomPartId } from './customParts';
import { genderLabel, parseGender } from './gender';

export type CsvParseResult = {
  parts: PartLibraryItem[];
  /** 사람이 읽는 경고 (건너뛴 행, 보정한 값) */
  warnings: string[];
  /**
   * **버린** 행 수 (부품이 하나도 안 나온 행).
   * 경고 수와 다르다 — 경고에는 "분류를 몰라 하우징으로 처리" 처럼 등록은 된
   * 보정도 섞여 있다. 안내 문구에서 둘을 뒤섞으면 "건너뛴 행 3건" 이 거짓말이 된다.
   */
  skipped?: number;
};

/** 신호·색 목록 구분자 — 쉼표는 CSV 자체가 쓰므로 파이프를 쓴다 */
const LIST_SEP = '|';

/** 한 행이 만들 수 있는 핀 수 상한 (오타로 100000 이 들어와도 브라우저가 죽지 않게) */
const MAX_PINS = 512;

// ── 헤더 ─────────────────────────────────────────────────────

type Field =
  | 'name' | 'category' | 'manufacturer' | 'mpn' | 'pitch'
  | 'cols' | 'rows' | 'pins' | 'signals' | 'colors' | 'note' | 'gender';

/**
 * 내보내기용 표준 헤더 (한글).
 *
 * `성별` 은 **맨 뒤에** 붙인다 — 열 순서를 위치로 읽는 기존 부품표(성별 열 없음)를
 * 그대로 받으려면 앞쪽 열 자리가 밀리면 안 된다.
 */
const EXPORT_HEADERS: Array<[Field, string]> = [
  ['name', '이름'],
  ['category', '분류'],
  ['manufacturer', '제조사'],
  ['mpn', 'MPN'],
  ['pitch', '피치'],
  ['cols', '열'],
  ['rows', '행'],
  ['pins', '핀수'],
  ['signals', '신호'],
  ['colors', '색'],
  ['note', '비고'],
  ['gender', '성별'],
];

const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['이름', '부품명', 'name', 'partname'],
  category: ['분류', '종류', 'category', 'type'],
  manufacturer: ['제조사', '메이커', 'manufacturer', 'maker', 'vendor'],
  mpn: ['mpn', '부품번호', '품번', 'partnumber', 'pn'],
  pitch: ['피치', 'pitch'],
  cols: ['열', '열수', 'cols', 'col', 'columns', 'column'],
  rows: ['행', '행수', 'rows', 'row'],
  pins: ['핀수', '핀개수', '핀', 'pins', 'pin', 'pincount'],
  signals: ['신호', '신호명', 'signals', 'signal'],
  colors: ['색', '색상', '규격색', 'colors', 'color'],
  note: ['비고', '메모', 'note', 'notes', 'remark', 'remarks'],
  gender: ['성별', '암수', '결합성별', 'gender', 'sex'],
};

/** 헤더·분류 값 비교용 정규화 — 대소문자·공백·구분기호를 무시 */
function normKey(s: string): string {
  return s.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-.]/g, '');
}

const HEADER_LOOKUP: Record<string, Field> = (() => {
  const m: Record<string, Field> = {};
  for (const f of Object.keys(HEADER_ALIASES) as Field[]) {
    for (const a of HEADER_ALIASES[f]) m[normKey(a)] = f;
  }
  return m;
})();

// ── 분류 ─────────────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, PartCategory> = {
  하우징: 'housing',
  커넥터하우징: 'housing',
  housing: 'housing',
  connectorhousing: 'housing',
  보드투와이어: 'board-to-wire',
  보드투와이어커넥터: 'board-to-wire',
  boardtowire: 'board-to-wire',
  btw: 'board-to-wire',
  스플라이스: 'splice',
  결선: 'splice',
  splice: 'splice',
  터미널: 'terminal',
  단자: 'terminal',
  핀단자: 'terminal',
  terminal: 'terminal',
};

const CATEGORY_LABEL: Record<PartCategory, string> = {
  housing: '하우징',
  terminal: '터미널',
  splice: '스플라이스',
  'board-to-wire': '보드투와이어',
};

// ── CSV 저수준 파서 ───────────────────────────────────────────

/**
 * RFC4180 풍 CSV 를 레코드 배열로 쪼갠다.
 * 따옴표 안의 쉼표·줄바꿈을 지키고, `""` 는 따옴표 한 개로 푼다.
 * 따옴표 안 줄바꿈은 `\n` 으로 정규화한다.
 *
 * `problems` 를 주면 **구조가 깨진 곳**을 담아 준다. 지금은 따옴표가 닫히지 않은
 * 경우 하나다: 그 뒤 파일 전체가 값 하나로 빨려 들어가 나머지 행이 통째로
 * 사라지는데, 예전에는 아무 말 없이 부품 한 종만 등록되고 끝났다.
 */
export function parseCsvRecords(text: string, problems?: string[]): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      if (ch === '\r') {
        field += '\n';
        i += src[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      records.push(row); row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i += 1;
  }

  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }
  if (inQuotes) {
    // 마지막 레코드 = 따옴표가 삼킨 덩어리. 몇 줄이 통째로 묶였는지 알려 준다.
    const swallowed = field.split('\n').length - 1;
    problems?.push(
      `따옴표(")가 닫히지 않아 마지막 ${swallowed + 1}줄이 한 칸으로 묶였습니다 — 따옴표 짝을 확인하세요`,
    );
  }
  return records;
}

function isBlankRecord(rec: string[]): boolean {
  return rec.every((c) => c.trim() === '');
}

// ── 파싱 ─────────────────────────────────────────────────────

export function parsePartsCsv(text: string): CsvParseResult {
  const warnings: string[] = [];
  const parts: PartLibraryItem[] = [];
  let skipped = 0;

  const records = parseCsvRecords(text ?? '', warnings);
  const headerAt = records.findIndex((r) => !isBlankRecord(r));
  if (headerAt < 0) {
    warnings.push('내용이 없는 CSV 입니다.');
    return { parts, warnings, skipped };
  }

  // 헤더 → 열 번호 (같은 헤더가 여러 번이면 처음 것을 쓴다)
  const col: Partial<Record<Field, number>> = {};
  records[headerAt].forEach((h, idx) => {
    const f = HEADER_LOOKUP[normKey(h)];
    if (f && col[f] === undefined) col[f] = idx;
  });

  if (col.name === undefined) {
    warnings.push('이름(name) 열을 찾지 못했습니다. 첫 줄이 헤더인지 확인하세요.');
    return { parts, warnings, skipped };
  }

  const headerWidth = records[headerAt].length;
  /** 같은 MPN 이 먼저 나온 행 번호 — 발주 코드가 겹치면 알려야 한다 */
  const mpnSeen = new Map<string, number>();

  for (let i = headerAt + 1; i < records.length; i++) {
    const rec = records[i];
    const lineNo = i + 1; // 사람이 세는 행 번호 (헤더 = 1행)
    if (isBlankRecord(rec)) continue;

    const get = (f: Field): string => {
      const idx = col[f];
      return idx === undefined ? '' : (rec[idx] ?? '').trim();
    };

    const name = get('name');
    if (!name) {
      warnings.push(`${lineNo}행: 이름이 비어 건너뜀`);
      skipped += 1;
      continue;
    }

    // 헤더보다 칸이 많고 그 칸에 값이 있으면 열이 밀렸다는 뜻이다 — 읽은 값이 엉뚱할 수 있다.
    if (rec.length > headerWidth && rec.slice(headerWidth).some((c) => c.trim() !== '')) {
      warnings.push(
        `${lineNo}행: 열이 헤더(${headerWidth}칸)보다 많아 ${rec.length - headerWidth}칸을 버림 — 쉼표가 하나 더 있는지 보세요`,
      );
    }

    // 분류
    let category: PartCategory = 'housing';
    const rawCat = get('category');
    if (rawCat) {
      const mapped = CATEGORY_ALIASES[normKey(rawCat)];
      if (mapped) category = mapped;
      else warnings.push(`${lineNo}행: 분류 '${rawCat}' 를 몰라 하우징으로 처리`);
    }

    // 숫자 열
    const num = (f: Field, label: string): number | null => {
      const raw = get(f);
      if (!raw) return null;
      const n = Number(raw.replace(/[,\s]/g, ''));
      // 숫자로 아예 안 읽히는 것과, 읽히지만 쓸 수 없는 값(0·음수·소수)은 사유가 다르다
      if (!Number.isFinite(n)) {
        warnings.push(`${lineNo}행: ${label} 값 '${raw}' 를 숫자로 읽지 못해 무시`);
        return null;
      }
      if (!Number.isInteger(n) || n <= 0) {
        warnings.push(`${lineNo}행: ${label} 값 '${raw}' 가 1 이상의 정수가 아니라 무시`);
        return null;
      }
      return n;
    };
    let cols = num('cols', '열');
    let rows = num('rows', '행');
    const pins = num('pins', '핀수');

    const signals = splitList(get('signals'));
    const colors = splitList(get('colors'));

    // 핀 격자 결정 — 열·행이 있으면 열×행이 우선
    let total: number;
    if (cols !== null && rows !== null) {
      total = cols * rows;
      if (pins !== null && pins !== total) {
        warnings.push(`${lineNo}행: 핀수 ${pins} 와 열×행 ${total} 이 달라 열×행을 따름`);
      }
    } else if (cols !== null && pins !== null) {
      /*
       * 열만 적힌 부품표가 흔하다 (`열 2 · 핀수 6` = 2열 3행).
       * 예전에는 행을 1 로 못 박고 total = 열 로 잡아 **핀 4개를 버렸다**.
       * 핀수는 사람이 적은 실제 핀 수이므로 그쪽을 살리고 행을 역산한다.
       */
      total = pins;
      rows = Math.ceil(pins / cols);
      if (pins % cols !== 0) {
        warnings.push(`${lineNo}행: 핀수 ${pins} 가 열 ${cols} 로 딱 나뉘지 않아 마지막 줄이 덜 찬다`);
      }
    } else if (cols !== null) {
      rows = 1;
      total = cols;
    } else if (rows !== null && pins !== null) {
      total = pins;
      cols = Math.ceil(pins / rows);
      if (pins % rows !== 0) {
        warnings.push(`${lineNo}행: 핀수 ${pins} 가 행 ${rows} 로 딱 나뉘지 않아 마지막 줄이 덜 찬다`);
      }
    } else if (pins !== null) {
      cols = pins;
      rows = 1;
      total = pins;
    } else {
      // 열·행·핀수가 모두 없으면 신호(또는 색) 개수로 핀 수를 추정한다
      total = Math.max(signals.length, colors.length);
      cols = total;
      rows = total > 0 ? 1 : 0;
    }

    if (total > MAX_PINS) {
      warnings.push(`${lineNo}행: 핀 수 ${total} 가 너무 많아 ${MAX_PINS} 로 줄임`);
      total = MAX_PINS;
      cols = MAX_PINS;
      rows = 1;
    }

    const spec: Record<string, string> = {};
    const pitch = get('pitch');
    const note = get('note');
    if (pitch) spec['피치'] = pitch;
    if (note) spec['비고'] = note;

    const manufacturer = get('manufacturer');
    const mpn = get('mpn');

    // 같은 MPN 이 두 번 — 발주 코드가 겹치면 둘 중 무엇을 사야 하는지 알 수 없다.
    // 버리지는 않는다(둘 다 진짜일 수 있다). 대신 어느 행과 겹치는지 알려 준다.
    if (mpn) {
      const first = mpnSeen.get(normKey(mpn));
      if (first !== undefined) {
        warnings.push(`${lineNo}행: MPN '${mpn}' 이 ${first}행과 겹칩니다 — 두 부품으로 등록`);
      } else {
        mpnSeen.set(normKey(mpn), lineNo);
      }
    }

    // 성별 — 한글(암/수/보드/—)·영문(receptacle/plug/header/neutral) 둘 다 받는다.
    // 빈 칸은 "미지정", `—` 은 "성별 없음(neutral)" 으로 서로 다르게 본다.
    const rawGender = get('gender');
    const gender = parseGender(rawGender);
    if (rawGender && !gender) {
      warnings.push(`${lineNo}행: 성별 '${rawGender}' 를 몰라 비움`);
    }

    const part: PartLibraryItem = {
      id: newCustomPartId(),
      category,
      name,
      manufacturer: manufacturer || undefined,
      mpn: mpn || undefined,
      spec: Object.keys(spec).length ? spec : undefined,
    };
    if (gender) part.gender = gender;

    if (category === 'terminal') {
      // 터미널은 크림프 단자라 핀 배열이 없다
      if (total > 0 || signals.length || colors.length) {
        warnings.push(`${lineNo}행: 터미널이라 핀 배열은 만들지 않음`);
      }
    } else if (total > 0) {
      if (signals.length && signals.length !== total) {
        warnings.push(`${lineNo}행: 신호 ${signals.length}개가 핀 ${total}개와 달라 있는 만큼만 채움`);
      }
      if (colors.length && colors.length !== total) {
        warnings.push(`${lineNo}행: 색 ${colors.length}개가 핀 ${total}개와 달라 있는 만큼만 채움`);
      }
      part.pinCount = total;
      part.pinLayout = buildLayout(total, cols || total, signals, colors);
    } else if (signals.length || colors.length) {
      warnings.push(`${lineNo}행: 핀 수를 알 수 없어 신호·색을 버림`);
    } else {
      /*
       * 핀 수를 알 수 없는 하우징 — 열도 행도 핀수도 없다(열이 모자란 행에서 잘 생긴다).
       * 그대로 두면 캔버스에 놓는 순간 기본 2핀 커넥터가 되어, 부품표에 없던 숫자가
       * 도면에 조용히 생긴다. 등록은 하되 무엇이 비었는지는 반드시 말해야 한다.
       */
      warnings.push(`${lineNo}행: 핀 수(열·행·핀수)가 없어 핀 배치 없이 등록 — 캔버스에 놓기 전에 채우세요`);
    }

    parts.push(part);
  }

  return { parts, warnings, skipped };
}

function splitList(raw: string): string[] {
  if (!raw) return [];
  return raw.split(LIST_SEP).map((s) => s.trim());
}

/** 행 우선(row-major) 격자 생성. index 는 1부터, label 은 숫자. */
function buildLayout(total: number, cols: number, signals: string[], colors: string[]): PinSlot[] {
  const width = Math.max(1, cols);
  const out: PinSlot[] = [];
  for (let i = 0; i < total; i++) {
    out.push({
      index: i + 1,
      label: String(i + 1),
      offset: { x: i % width, y: Math.floor(i / width) },
      signal: signals[i] || undefined,
      stdColor: colors[i] || undefined,
    });
  }
  return out;
}

// ── 내보내기 ─────────────────────────────────────────────────

/**
 * 부품 목록 → CSV. `parsePartsCsv` 로 되읽으면 (id 제외) 같은 부품이 나온다.
 * 쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 `"` 는 `""` 로 이스케이프한다.
 */
export function partsToCsv(parts: PartLibraryItem[]): string {
  const lines: string[] = [EXPORT_HEADERS.map(([, h]) => csvCell(h)).join(',')];

  for (const p of parts ?? []) {
    const layout =
      p.category === 'terminal'
        ? []
        : [...(p.pinLayout ?? [])].sort((a, b) => a.index - b.index);

    let cols = '';
    let rows = '';
    let pins = '';
    if (layout.length) {
      const w = Math.max(...layout.map((s) => (s.offset?.x ?? 0) + 1));
      const h = Math.max(...layout.map((s) => (s.offset?.y ?? 0) + 1));
      /*
       * 격자가 꽉 차지 않으면(마지막 줄이 덜 찬 5핀 2열 배치 등) 행을 비우고
       * 열·핀수만 내보낸다 — 되읽을 때 행을 역산하므로 같은 배치가 돌아온다.
       * 예전처럼 1행으로 펴 버리면 2열 3행 부품이 6열 1행으로 바뀌어 돌아왔다.
       */
      cols = String(w);
      rows = w * h === layout.length ? String(h) : '';
      pins = String(layout.length);
    } else if (p.category !== 'terminal' && p.pinCount) {
      cols = String(p.pinCount);
      rows = '1';
      pins = String(p.pinCount);
    }

    const signals = layout.map((s) => s.signal ?? '');
    const colors = layout.map((s) => s.stdColor ?? '');

    const cells: Record<Field, string> = {
      name: p.name ?? '',
      category: CATEGORY_LABEL[p.category] ?? p.category ?? '',
      manufacturer: p.manufacturer ?? '',
      mpn: p.mpn ?? '',
      pitch: p.spec?.['피치'] ?? '',
      cols,
      rows,
      pins,
      signals: signals.some(Boolean) ? signals.join(LIST_SEP) : '',
      colors: colors.some(Boolean) ? colors.join(LIST_SEP) : '',
      note: p.spec?.['비고'] ?? '',
      // 내보낼 때는 언제나 한글 — 엑셀에서 사람이 읽는 표다
      gender: genderLabel(p.gender),
    };

    lines.push(EXPORT_HEADERS.map(([f]) => csvCell(cells[f])).join(','));
  }

  return lines.join('\n');
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
