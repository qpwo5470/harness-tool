/**
 * Agent D 소유 — 파트리스트 집계 + CSV (문서의 순수 함수, 테스트 대상).
 */
import type { HarnessDocument, Endpoint, KitDocument, PartGender } from '../types';
import { computeNets } from '../store/netlist';
import { perSetOf, totalOf } from '../store/kit';
import { genderDetail } from '../library/gender';
import { lengthResolver, type LengthSource } from '../store/wireLength';

export type PartRow = {
  category: string;
  part: string;
  qty: number;
  detail?: string;
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
 */
function wireLengthDetail(g: WireGroup): string | undefined {
  const notes: string[] = [];
  if (g.counted > 0) {
    notes.push(g.counted < g.qty ? `총 ${g.len}mm (${g.counted}본 기준)` : `총 ${g.len}mm`);
  }
  if (g.cable > 0) notes.push(`케이블 심선 ${g.cable}본`);
  if (g.missing > 0) notes.push(`길이 미입력 ${g.missing}본`);
  return notes.length ? notes.join(' · ') : undefined;
}

/** 하우징 / 와이어 / 케이블을 집계한 파트리스트 */
export function buildPartList(doc: HarnessDocument): PartRow[] {
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
    const { mm, source } = lengthOf(w);
    if (mm == null) cur.missing += 1;
    else if (source === 'cable') cur.cable += 1;   // 케이블에 딸려 오므로 전선으로 사지 않는다
    else {
      cur.len += mm;
      cur.counted += 1;
    }
    wg.set(key, cur);
  }
  for (const [part, g] of wg) {
    rows.push({ category: '와이어', part, qty: g.qty, detail: wireLengthDetail(g) });
  }

  // 터미널(크림프핀): 하우징에 연결된 핀 수만큼 필요 — 발주 시 필수 항목
  const term = new Map<string, number>();
  for (const w of doc.wires) {
    for (const ep of [w.from, w.to]) {
      if (ep.type !== 'pin') continue;
      const c = doc.connectors.find((x) => x.id === ep.connectorId);
      if (!c || c.kind === 'splice') continue; // 스플라이스는 압착단자 불필요
      const housing = doc.usedParts.find((p) => p.id === c.housingId);
      // 핀에 지정된 단자 > 하우징 스펙의 터미널 > 하우징명 기준 일반 표기
      const pin = c.pins.find((p) => p.id === ep.pinId);
      const named =
        doc.usedParts.find((p) => p.id === pin?.terminalId)?.name ??
        housing?.spec?.['터미널'] ??
        (housing ? `${housing.name} 용 터미널` : null);
      if (!named) continue;
      term.set(named, (term.get(named) ?? 0) + 1);
    }
  }
  for (const [part, qty] of term) {
    rows.push({ category: '터미널', part, qty, detail: '압착단자' });
  }

  // 케이블
  for (const cb of doc.cables ?? []) {
    rows.push({
      category: '케이블',
      part: cb.name ?? `${cb.coreCount}C 케이블`,
      qty: 1,
      detail: cb.lengthMm ? `${cb.lengthMm}mm` : undefined,
    });
  }

  return rows;
}

/** 파트리스트 → CSV 문자열 */
export function toCsv(rows: PartRow[]): string {
  const esc = (v: string | number | undefined) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['category', 'part', 'qty', 'detail'];
  const body = rows.map((r) => [r.category, r.part, r.qty, r.detail ?? ''].map(esc).join(','));
  return [head.join(','), ...body].join('\n');
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
  /** 재단 길이(mm). 케이블 심선은 케이블 길이를 따른다. 모르면 빈 문자열 */
  lengthMm: string;
  /** 그 길이가 어디서 왔는지 — 화면·PDF 에서 '케이블 기준'임을 밝히는 데 쓴다 */
  lengthSource: LengthSource;
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

/** 접속표 → CSV */
export function runListToCsv(rows: RunRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // CSV 헤더는 외부(엑셀 매크로 등)에서 참조할 수 있으므로 바꾸지 않는다.
  // 화면 전용인 netCode 는 내보내지 않는다.
  const head = ['wire', 'net', 'from', 'to', 'color', 'gauge', 'length_mm'];
  const body = rows.map((r) =>
    [r.wireId, r.net, r.from, r.to, r.color, r.gauge, r.lengthMm].map(esc).join(','),
  );
  return [head.join(','), ...body].join('\n');
}
