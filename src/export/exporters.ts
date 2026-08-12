/**
 * Agent D 소유 — 파트리스트 집계 + CSV (문서의 순수 함수, 테스트 대상).
 */
import type { HarnessDocument, Endpoint, PartGender } from '../types';
import { computeNets } from '../store/netlist';
import { genderDetail } from '../library/gender';

export type PartRow = {
  category: string;
  part: string;
  qty: number;
  detail?: string;
};

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
  const wg = new Map<string, { qty: number; len: number }>();
  for (const w of doc.wires) {
    const color = w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base;
    const key = `${w.gauge.system.toUpperCase()}${w.gauge.value} · ${color}`;
    const cur = wg.get(key) ?? { qty: 0, len: 0 };
    cur.qty += 1;
    cur.len += w.lengthMm ?? 0;
    wg.set(key, cur);
  }
  for (const [part, { qty, len }] of wg) {
    rows.push({ category: '와이어', part, qty, detail: len ? `총 ${len}mm` : undefined });
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
  lengthMm: string;
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

  return doc.wires.map((w) => ({
    wireId: w.id,
    net: netOfWire.get(w.id) ?? '',
    netCode: codeOfWire.get(w.id) ?? '',
    from: describeEndpoint(doc, w.from),
    to: describeEndpoint(doc, w.to),
    color: w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base,
    gauge: `${w.gauge.system.toUpperCase()}${w.gauge.value}`,
    lengthMm: w.lengthMm != null ? String(w.lengthMm) : '',
  }));
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
