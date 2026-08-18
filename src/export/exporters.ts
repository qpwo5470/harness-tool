/**
 * Agent D 소유 — 파트리스트 집계 + CSV (문서의 순수 함수, 테스트 대상).
 */
import type { HarnessDocument, Endpoint, KitDocument, PartGender } from '../types';
import { computeNets } from '../store/netlist';
import { perSetOf, totalOf } from '../store/kit';
import { genderDetail } from '../library/gender';
import { lengthResolver, type LengthSource } from '../store/wireLength';
import {
  assertMarginPct, formatLength, unitLabel, unitSuffix, withMargin, type LengthUnit,
} from './units';

export type PartRow = {
  category: string;
  part: string;
  qty: number;
  detail?: string;
  /**
   * 이 행이 발주하는 **도면 길이 합(mm)** — 와이어·케이블 행에만 있다.
   *
   * `detail` 은 사람이 읽는 문장이라 여유율·단위를 여기서 다시 계산할 수 없다.
   * 발주 길이를 기계적으로 뽑으려면 숫자가 따로 있어야 한다. 여유율을 곱하기
   * **전** 값이라는 점이 중요하다 — 도면값과 발주값을 나란히 적을 근거다.
   */
  drawingLengthMm?: number;
  /**
   * 이 행이 가리키는 **문서 안의 그것 하나** — 파트 탭에서 행을 눌러 고를 수 있게 한다.
   *
   * 케이블 행에만 있다. 그리고 그건 **집계 방식의 차이**지 인심이 아니다:
   *  · 하우징 행 `MDB 6P ×3` 은 커넥터 세 **개**를 이름으로 묶은 것이다. 어느 하나를
   *    고를 수 없다 — 셋 다 그 행에 들어 있다.
   *  · 터미널 행은 한술 더 떠 **핀 수**를 센다(부품 인스턴스가 아예 없다).
   *  · 와이어 행은 게이지+색으로 묶은 길이 합이다.
   *  · 케이블만 `doc.cables` 를 1행 1개로 그대로 옮긴다(qty 는 언제나 1) —
   *    그래서 행과 문서의 개체가 1:1 이고 id 를 실을 수 있다.
   * CSV 에는 나가지 않는다(발주처가 쓸 값이 아니다 — toCsv 는 이 필드를 보지 않는다).
   */
  targetId?: string;
};

/** 와이어 한 그룹(게이지+색)의 길이 집계 상태 */
type WireGroup = {
  /** 그룹의 전체 본수 */
  qty: number;
  /** 전선으로 **발주할** 길이 합(mm) — 배선에 직접 입력된 것만 */
  len: number;
  /** len 이 몇 본치인지 */
  counted: number;
  /** 케이블 길이를 따르는 심선 수 — 케이블 행으로 이미 발주된다 */
  cable: number;
  /** 길이를 알 수 없는 배선 수 */
  missing: number;
};

/**
 * 와이어 행의 비고 문구.
 *
 * ## 왜 "(N본 기준)" 을 붙이는가
 * 예전에는 `w.lengthMm ?? 0` 으로 미입력분을 조용히 0 으로 더했다. 3본 중 1본에
 * 길이가 없으면 `총 300mm · 3본` 이라 찍혔고, 그 300 은 2본치였다. 발주서에서
 * 이 한 줄이 그대로 수량이 되므로, 합계가 몇 본치인지 행에 드러낸다.
 *
 * ## 왜 케이블 심선은 합계에서 빼는가
 * 케이블 심선은 케이블에 딸려 오는 것이라 **전선으로 따로 사지 않는다**
 * (같은 파트리스트의 '케이블' 행에 이미 길이가 잡혀 있다). 길이를 모르는 것과는
 * 다른 사정이므로 0 으로 뭉개지 않고 본수를 따로 밝힌다.
 *
 * ## 무엇을 사는지는 **소속**이 정한다 (길이 출처가 아니다)
 * 예전에는 길이가 케이블에서 왔을 때만 심선으로 쳤다. 그래서 속성 패널에서
 * 심선에 길이를 한 번 치면 그 가닥이 전선 행으로도 발주되고 케이블 행도 남아
 * **같은 두 가닥을 전선으로도 케이블로도** 샀다(전선 720mm + 케이블 300mm).
 * 심선을 짧게 자르는 것은 재단 지시이지 구매 지시가 아니다 — 재단 길이는
 * 접속표·물리 뷰가 그대로 쓰고, 여기서는 소속만 본다.
 */
function wireLengthDetail(g: WireGroup, unit: LengthUnit): string | undefined {
  const notes: string[] = [];
  if (g.counted > 0) {
    // 단위를 반드시 붙인다 — 숫자만 있으면 800mm 와 31.496in 을 구분할 수 없다
    const len = `${formatLength(g.len, unit)}${unitLabel(unit)}`;
    notes.push(g.counted < g.qty ? `총 ${len} (${g.counted}본 기준)` : `총 ${len}`);
  }
  if (g.cable > 0) notes.push(`케이블 심선 ${g.cable}본`);
  if (g.missing > 0) notes.push(`길이 미입력 ${g.missing}본`);
  return notes.length ? notes.join(' · ') : undefined;
}

/**
 * 이 끝점에 압착되는 단자 이름.
 * 우선순위: 핀에 지정된 단자 > 하우징 스펙의 터미널 > 하우징명 기준 일반 표기.
 * 파트리스트 집계와 접속표의 '단자' 열이 **같은 함수**를 쓴다 — 발주에 잡힌
 * 단자와 현장이 보는 접속표의 단자가 갈라지면 안 된다.
 */
function terminalNameAt(doc: HarnessDocument, ep: Endpoint): string | null {
  if (ep.type !== 'pin') return null;
  const c = doc.connectors.find((x) => x.id === ep.connectorId);
  if (!c || c.kind === 'splice') return null; // 스플라이스는 압착단자 불필요
  const housing = doc.usedParts.find((p) => p.id === c.housingId);
  const pin = c.pins.find((p) => p.id === ep.pinId);
  return (
    doc.usedParts.find((p) => p.id === pin?.terminalId)?.name ??
    housing?.spec?.['터미널'] ??
    (housing ? `${housing.name} 용 터미널` : null)
  );
}

/**
 * 이 끝점의 표준 신호명 (하우징 pinLayout 의 `signal`).
 * MDB 의 "34V", RJ45 T568B 의 "TX+" 처럼 **규격이 정한 이름**이다. 네트 라벨
 * (`net` 열)은 이 도면에서 무엇에 이어졌는지를 말하고, 이 열은 커넥터 규격이
 * 그 자리에 무엇을 요구하는지를 말한다 — 서로 다른 사실이라 열도 따로 둔다.
 */
function signalAt(doc: HarnessDocument, ep: Endpoint): string | null {
  if (ep.type !== 'pin') return null;
  const c = doc.connectors.find((x) => x.id === ep.connectorId);
  const pin = c?.pins.find((p) => p.id === ep.pinId);
  if (!pin) return null;
  const housing = doc.usedParts.find((p) => p.id === c?.housingId);
  return housing?.pinLayout?.find((s) => s.index === pin.index)?.signal ?? null;
}

export type PartListOptions = {
  /** 길이 문구를 적을 단위. 기본 mm — 화면·도면이 쓰는 값 그대로다. */
  unit?: LengthUnit;
};

/** 하우징 / 와이어 / 케이블을 집계한 파트리스트 */
export function buildPartList(doc: HarnessDocument, opts: PartListOptions = {}): PartRow[] {
  const unit = opts.unit ?? 'mm';
  const rows: PartRow[] = [];

  // 하우징/커넥터
  // 암수(gender)를 detail 에 실어 보낸다 — 발주에서 이게 틀리면 현장에서 못 쓴다.
  const hc = new Map<string, { qty: number; gender?: PartGender }>();
  for (const c of doc.connectors) {
    const item = doc.usedParts.find((p) => p.id === c.housingId);
    const name = item?.name ?? c.housingId;
    const cur = hc.get(name) ?? { qty: 0, gender: item?.gender };
    cur.qty += 1;
    hc.set(name, cur);
  }
  for (const [part, { qty, gender }] of hc) {
    rows.push({ category: '커넥터', part, qty, detail: genderDetail(gender) });
  }

  // 와이어: 게이지+색 기준 그룹, 총 길이 합산
  const lengthOf = lengthResolver(doc);
  const wg = new Map<string, WireGroup>();
  for (const w of doc.wires) {
    const color = w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base;
    const key = `${w.gauge.system.toUpperCase()}${w.gauge.value} · ${color}`;
    const cur = wg.get(key) ?? { qty: 0, len: 0, counted: 0, cable: 0, missing: 0 };
    cur.qty += 1;
    const { mm, cable } = lengthOf(w);
    // 실재하는 케이블에 속하면 그 케이블 행이 이미 발주한다 — 길이를 직접 넣었어도.
    // (없는 케이블을 가리키는 배선은 딸려 올 곳이 없으므로 전선으로 친다.)
    if (cable) cur.cable += 1;
    else if (mm == null) cur.missing += 1;
    else {
      cur.len += mm;
      cur.counted += 1;
    }
    wg.set(key, cur);
  }
  for (const [part, g] of wg) {
    rows.push({
      category: '와이어',
      part,
      qty: g.qty,
      detail: wireLengthDetail(g, unit),
      // 합계가 0본치면(전부 케이블 심선·미입력) 발주할 전선 길이가 없다 —
      // 0 을 적으면 "0mm 를 사라"는 지시가 된다.
      drawingLengthMm: g.counted > 0 ? g.len : undefined,
    });
  }

  // 터미널(크림프핀): 하우징에 연결된 핀 수만큼 필요 — 발주 시 필수 항목
  const term = new Map<string, number>();
  for (const w of doc.wires) {
    for (const ep of [w.from, w.to]) {
      const named = terminalNameAt(doc, ep);
      if (!named) continue;
      term.set(named, (term.get(named) ?? 0) + 1);
    }
  }
  for (const [part, qty] of term) {
    rows.push({ category: '터미널', part, qty, detail: '압착단자' });
  }

  // 케이블
  //
  // 자켓색·게이지는 **여기서 처음이자 유일하게 산출물에 나온다.** 속성 패널에는
  // 입력칸이 있는데 캔버스·물리 뷰·PDF·CSV 어디에도 나오지 않아, 검은 자켓을
  // 골라 둔 사람이 받는 발주서에는 그 사실이 한 글자도 없었다. 케이블은 자켓색과
  // 규격이 곧 품목이라(같은 4C 라도 자켓이 다르면 다른 물건이다) 비고에 싣는다.
  // 게이지는 아직 입력 UI 가 없지만, 파일에 들어 있는 값이 보이지 않는 것이
  // 더 나쁘므로 있으면 적는다.
  for (const cb of doc.cables ?? []) {
    const spec = [
      `${cb.coreCount}C`,
      cb.jacketColor,
      cb.gauge ? `${cb.gauge.system.toUpperCase()}${cb.gauge.value}` : undefined,
      cb.lengthMm ? `${formatLength(cb.lengthMm, unit)}${unitLabel(unit)}` : undefined,
    ].filter(Boolean);
    rows.push({
      category: '케이블',
      part: cb.name ?? `${cb.coreCount}C 케이블`,
      qty: 1,
      detail: spec.join(' · '),
      drawingLengthMm: cb.lengthMm,
      // 이 행은 케이블 **하나**다 — 파트 탭이 이 id 로 도면의 케이블을 고른다
      targetId: cb.id,
    });
  }

  return rows;
}

const csvEsc = (v: string | number | undefined): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export type PartCsvOptions = {
  /** 길이 열의 단위. 기본 mm */
  unit?: LengthUnit;
  /**
   * 전선 여유율(%). **주면 발주 길이 열이 생긴다.**
   * 주지 않으면 옛 4열 그대로다 — 화면(파트 탭)에서 쓰는 CSV 는 도면 그대로여야
   * 하므로 기본값이 "여유율 없음" 이어야 한다.
   */
  marginPct?: number;
};

/**
 * 파트리스트 → CSV 문자열.
 *
 * ## 여유율을 적용했으면 반드시 밝힌다
 * `marginPct` 를 주면 길이 열이 **셋으로 갈라진다**:
 *   `drawing_length_*` (도면 길이) · `order_margin_pct` (적용한 여유율) ·
 *   `order_length_*` (발주 길이 = 도면 × (1 + pct/100))
 *
 * 머리말 주석(`# 여유율 5%`) 대신 **열**로 적는 이유: CSV 는 엑셀에서 정렬·필터
 * 되고 다른 표에 붙여 넣어진다. 그때 맨 위 한 줄은 떨어져 나가고 숫자만 남는다.
 * 행마다 여유율이 붙어 있으면 어느 행을 떼어 가도 그 숫자가 도면값인지
 * 발주값인지 알 수 있다. 여유율 0% 일 때도 열을 지우지 않는다 — "여유를 안 넣은
 * 발주서" 임을 문서가 스스로 말해야 한다.
 */
export function toCsv(rows: PartRow[], opts?: PartCsvOptions): string {
  const unit = opts?.unit ?? 'mm';
  const u = unitSuffix(unit);
  const head = ['category', 'part', 'qty', 'detail'];
  if (!opts || opts.marginPct == null) {
    const body = rows.map((r) =>
      [r.category, r.part, r.qty, r.detail ?? ''].map(csvEsc).join(','));
    return [head.join(','), ...body].join('\n');
  }

  const pct = assertMarginPct(opts.marginPct);
  const wide = [...head, `drawing_length_${u}`, 'order_margin_pct', `order_length_${u}`];
  const body = rows.map((r) => {
    const mm = r.drawingLengthMm;
    // 길이가 없는 행(커넥터·터미널)은 여유율과 무관하다 — 빈 칸으로 둔다.
    // 0 을 적으면 "길이 0 짜리 부품" 으로 읽힌다.
    const lens = mm == null
      ? ['', '', '']
      : [formatLength(mm, unit), String(pct), formatLength(withMargin(mm, pct), unit)];
    return [r.category, r.part, r.qty, r.detail ?? '', ...lens].map(csvEsc).join(',');
  });
  return [wide.join(','), ...body].join('\n');
}

// ============================================================
// 접속표 (From-To List) — 현장에서 하네스 제작 시 보는 표
// ============================================================

export type RunRow = {
  wireId: string;
  /** 사람이 읽는 네트 이름 (CSV·검색용) */
  net: string;
  /** 짧은 네트 코드 N1, N2 … (접속표 NET 열용) */
  netCode: string;
  from: string;
  to: string;
  color: string;
  gauge: string;
  /**
   * 재단 길이(mm). 케이블 심선은 케이블 길이를 따른다. 모르면 빈 문자열.
   * **여유율을 곱하지 않은 도면 길이다** — 접속표는 현장이 자르는 표라
   * 도면과 한 글자도 달라지면 안 된다(README §6).
   */
  lengthMm: string;
  /** 그 길이가 어디서 왔는지 — 화면·PDF 에서 '케이블 기준'임을 밝히는 데 쓴다 */
  lengthSource: LengthSource;
  /** 커넥터 규격이 이 자리에 정한 표준 신호명 (MDB "34V" 등). 없으면 빈 문자열 */
  signal: string;
  /** 양 끝에 압착되는 단자 이름 (같으면 하나로). 없으면 빈 문자열 */
  terminal: string;
  /** 비고 — 배선 라벨 · 길이 출처처럼 표에 남겨야 할 단서 */
  note: string;
};

/** 끝점을 사람이 읽는 문자열로 ("JST XH 4P#1", "Raspberry Pi.5V") */
export function describeEndpoint(doc: HarnessDocument, e: Endpoint): string {
  if (e.type === 'device') {
    const d = doc.devices.find((x) => x.id === e.deviceId);
    return `${d?.name ?? e.deviceId}${e.terminal ? `.${e.terminal}` : ''}`;
  }
  const c = doc.connectors.find((x) => x.id === e.connectorId);
  const pin = c?.pins.find((p) => p.id === e.pinId);
  const housing = doc.usedParts.find((p) => p.id === c?.housingId)?.name ?? c?.kind ?? e.connectorId;
  return `${housing}#${pin?.label ?? pin?.index ?? '?'}`;
}

/** 와이어별 접속표 생성 (네트 라벨 포함) */
export function buildRunList(doc: HarnessDocument): RunRow[] {
  const nets = computeNets(doc);
  const netOfWire = new Map<string, string>();
  const codeOfWire = new Map<string, string>();
  for (const n of nets) {
    for (const wid of n.wireIds) {
      netOfWire.set(wid, n.label);
      codeOfWire.set(wid, n.code);
    }
  }

  // 접속표는 현장에서 전선을 자를 때 보는 표다. 케이블 심선의 재단 길이는
  // 케이블에 적혀 있으므로 여기에도 그 값이 나와야 한다 — 빈 칸으로 두면
  // 작업자가 길이를 모른 채 자르게 된다.
  const lengthOf = lengthResolver(doc);

  return doc.wires.map((w) => {
    const len = lengthOf(w);
    // 양 끝 단자가 같으면 한 번만 적는다 — "TST-T / TST-T" 는 읽는 사람에게
    // 두 종류인 것처럼 보인다.
    const terms = [...new Set([w.from, w.to].map((e) => terminalNameAt(doc, e)).filter(Boolean))];
    const signals = [...new Set([w.from, w.to].map((e) => signalAt(doc, e)).filter(Boolean))];
    return {
      wireId: w.id,
      net: netOfWire.get(w.id) ?? '',
      netCode: codeOfWire.get(w.id) ?? '',
      from: describeEndpoint(doc, w.from),
      to: describeEndpoint(doc, w.to),
      color: w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base,
      gauge: `${w.gauge.system.toUpperCase()}${w.gauge.value}`,
      lengthMm: len.mm != null ? String(len.mm) : '',
      lengthSource: len.source,
      signal: signals.join(' / '),
      terminal: terms.join(' / '),
      // 길이 출처는 비고로 남긴다 — 길이 열의 숫자만으로는 그 값이 이 심선에
      // 직접 지정된 것인지 케이블에서 온 것인지 알 수 없다(PDF 도 같은 이유로
      // "(케이블)" 을 덧붙인다).
      note: [w.label, len.source === 'cable' ? '케이블 기준' : ''].filter(Boolean).join(' · '),
    };
  });
}

// ============================================================
// 하네스 BOM — 세트 구성표 (종별 수량)
// ============================================================

export type KitBomRow = {
  letter: string;
  drawingNo: string;
  name: string;
  /** 세트 하나에 몇 개 */
  perSet: number;
  /** 주문 세트 수 */
  orderQty: number;
  /**
   * 총수량. **저장하지 않고 언제나 perSet × orderQty 로 파생한다**
   * (store/kit.ts 의 원칙 그대로) — 화면 숫자와 발주 숫자가 갈라지면 안 된다.
   */
  totalQty: number;
};

/**
 * 세트 구성 BOM.
 *
 * 대화상자는 예전부터 '하네스 BOM CSV' 를 고를 수 있었지만 저장하는 쪽에 이
 * 산출물이 아예 없어 **체크해도 아무 파일도 나오지 않았다**. 미리보기에 있는
 * 것은 반드시 나와야 한다.
 */
export function buildKitBom(kit: KitDocument): KitBomRow[] {
  return kit.harnesses.map((h, i) => ({
    letter: h.letter ?? String.fromCharCode(65 + i),
    drawingNo: h.drawingNo ?? '',
    name: h.name,
    perSet: perSetOf(kit.set, h.id),
    orderQty: kit.set.orderQty,
    totalQty: totalOf(kit.set, h.id),
  }));
}

/** 세트 BOM → CSV */
export function kitBomToCsv(rows: KitBomRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['letter', 'drawing_no', 'name', 'per_set', 'order_qty', 'total_qty'];
  const body = rows.map((r) =>
    [r.letter, r.drawingNo, r.name, r.perSet, r.orderQty, r.totalQty].map(esc).join(','),
  );
  return [head.join(','), ...body].join('\n');
}

/**
 * 접속표 CSV 로 낼 수 있는 열 — **대화상자의 칩 목록도 이 배열에서 나온다.**
 *
 * 예전에는 대화상자가 자기 문자열 배열(`CSV_COLS`)을 들고 있었고 CSV 쪽은 고정
 * 7열을 찍었다. 고를 수는 있는데 결과가 안 바뀌는 스위치였다. 목록을 여기 한
 * 곳에 두면 "칩에는 있는데 CSV 가 모르는 열" 이 구조적으로 생길 수 없다.
 *
 * ## 순서가 왜 이 순서인가
 * 앞 일곱 열의 기본 선택이 옛 고정 헤더
 * `wire,net,from,to,color,gauge,length_mm` 와 **글자 하나까지 같도록** 맞췄다.
 * 이 헤더는 받는 쪽 엑셀 매크로가 참조하는 발표된 인터페이스라, 아무것도
 * 건드리지 않은 사람의 파일이 조용히 바뀌면 안 된다.
 */
export type RunCsvColumn = {
  /** 대화상자에 보이는 이름 (= 사람이 고르는 이름) */
  label: string;
  /** CSV 헤더 이름. 길이 열만 단위에 따라 `length_mm` / `length_in` 로 갈린다 */
  head: (unit: LengthUnit) => string;
  value: (r: RunRow, unit: LengthUnit) => string;
};

export const RUN_CSV_COLUMNS: RunCsvColumn[] = [
  { label: '와이어', head: () => 'wire', value: (r) => r.wireId },
  { label: '네트', head: () => 'net', value: (r) => r.net },
  { label: 'FROM', head: () => 'from', value: (r) => r.from },
  { label: 'TO', head: () => 'to', value: (r) => r.to },
  { label: '신호', head: () => 'signal', value: (r) => r.signal },
  { label: '색', head: () => 'color', value: (r) => r.color },
  { label: '게이지', head: () => 'gauge', value: (r) => r.gauge },
  {
    label: '길이',
    head: (u) => `length_${unitSuffix(u)}`,
    // 접속표는 **도면 길이 그대로**다. 단위만 바꿔 적고 여유율은 곱하지 않는다.
    value: (r, u) => (r.lengthMm ? formatLength(Number(r.lengthMm), u) : ''),
  },
  { label: '단자', head: () => 'terminal', value: (r) => r.terminal },
  { label: '비고', head: () => 'note', value: (r) => r.note },
];

/** 접속표 기본 열 — 신호·단자·비고는 비워 둔다(대개 안 쓴다) */
export const RUN_CSV_DEFAULT_COLS = ['와이어', '네트', 'FROM', 'TO', '색', '게이지', '길이'];

export type RunCsvOptions = {
  /** 고른 열 이름들 (고른 순서 그대로). 주지 않으면 기본 7열 */
  cols?: string[];
  unit?: LengthUnit;
};

/** 접속표 → CSV */
export function runListToCsv(rows: RunRow[], opts: RunCsvOptions = {}): string {
  const unit = opts.unit ?? 'mm';
  const labels = opts.cols ?? RUN_CSV_DEFAULT_COLS;
  // 빈 CSV 를 조용히 내보내지 않는다. 머리글만 있는 파일이 발주처로 가면
  // "배선이 없는 하네스" 로 읽힌다 — 고를 열이 없다는 사실은 사람이 알아야 한다.
  if (labels.length === 0) {
    throw new Error('접속표 CSV 에 넣을 열을 하나도 고르지 않았습니다');
  }
  const cols = labels.map((l) => {
    const c = RUN_CSV_COLUMNS.find((x) => x.label === l);
    if (!c) throw new Error(`접속표 CSV 에 없는 열입니다 — ${l}`);
    return c;
  });
  // 화면 전용인 netCode 는 내보내지 않는다.
  const head = cols.map((c) => c.head(unit));
  const body = rows.map((r) => cols.map((c) => csvEsc(c.value(r, unit))).join(','));
  return [head.join(','), ...body].join('\n');
}
