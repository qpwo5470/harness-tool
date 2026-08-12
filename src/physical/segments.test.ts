/**
 * 구간 산출 테스트 — Claude Design 2차 §3.
 *
 * 확인하는 것:
 *  - 분기 없는 단순 하네스 → 구간 하나
 *  - 같은 경로를 공유하는 배선이 한 다발로 묶이는지
 *  - 스플라이스 분기(채움) vs 단순 분기(빈)
 *  - 길이 미입력 시 지어내지 않고 null 로 두는지
 *  - 외경이 √본수 × 심선 외경 추정식과 일치하는지
 *  - 같은 문서면 항상 같은 결과(결정론)
 */
import { describe, it, expect } from 'vitest';
import type {
  Connector, Device, Endpoint, HarnessDocument, PartLibraryItem, Wire,
} from '../types';
import {
  buildPhysicalModel, bundleDiameterMm, materialRows, wireDiameterMm,
} from './segments';

// ---------------- 픽스처 헬퍼 ----------------

const housing = (id: string, name: string, pins: number, mpn?: string): PartLibraryItem => ({
  id, category: 'housing', name, mpn, pinCount: pins,
});

const spliceItem: PartLibraryItem = { id: 'lib-sp', category: 'splice', name: '꼬임 결선', pinCount: 3 };

const conn = (id: string, housingId: string, n: number): Connector => ({
  id,
  kind: 'connector',
  housingId,
  orientation: 0,
  positions: {},
  pins: Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i + 1}`, index: i + 1 })),
});

const splice = (id: string, n: number, bridged = true): Connector => ({
  ...conn(id, 'lib-sp', n),
  kind: 'splice',
  bridges: bridged ? [Array.from({ length: n }, (_, i) => `${id}-p${i + 1}`)] : undefined,
});

const device = (id: string, name: string, terminals: string[]): Device => ({
  id, name, terminals, positions: {},
});

const pin = (c: string, i: number): Endpoint => ({ type: 'pin', connectorId: c, pinId: `${c}-p${i}` });
const dev = (d: string, t?: string): Endpoint => ({ type: 'device', deviceId: d, terminal: t });

const w = (id: string, from: Endpoint, to: Endpoint, lengthMm?: number): Wire => ({
  id, from, to, color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm,
});

const makeDoc = (
  usedParts: PartLibraryItem[],
  connectors: Connector[],
  devices: Device[],
  wires: Wire[],
): HarnessDocument => ({
  schemaVersion: 1,
  id: 'doc',
  name: '테스트 하네스',
  createdAt: '2026-08-12T00:00:00Z',
  updatedAt: '2026-08-12T00:00:00Z',
  connectors,
  devices,
  wires,
  usedParts,
});

/** 커넥터 두 개를 n 본으로 직결한 가장 단순한 하네스 */
function simpleDoc(n: number, lengths = true): HarnessDocument {
  return makeDoc(
    [housing('h6', 'MDB 6P', 6, 'Molex 39-01-2060'), housing('h4', 'SMH250 4P', 4)],
    [conn('c1', 'h6', 6), conn('c2', 'h4', 4)],
    [],
    Array.from({ length: n }, (_, i) =>
      w(`w${i + 1}`, pin('c1', i + 1), pin('c2', (i % 4) + 1), lengths ? 100 + i * 10 : undefined),
    ),
  );
}

/**
 * Claude Design §3 샘플과 같은 골격:
 * J1(6P) · SP1(스플라이스) · J2(4P) · J3(8P) · D1(장치)
 */
function branchedDoc(): HarnessDocument {
  return makeDoc(
    [
      housing('h6', 'MDB 6P', 6, 'Molex 39-01-2060'),
      spliceItem,
      housing('h4', 'SMH250 4P', 4, 'YEONHO SMH250-04'),
      housing('h8', 'RJ45 8P8C', 8, 'ANSI/TIA-568B'),
    ],
    [conn('J1', 'h6', 6), splice('SP1', 3), conn('J2', 'h4', 4), conn('J3', 'h8', 8)],
    [device('D1', 'Raspberry Pi 5', ['5V', 'GND', 'GPIO18'])],
    [
      w('w1', pin('J1', 1), pin('SP1', 1), 120),
      w('w2', pin('SP1', 2), pin('J2', 1), 180),
      w('w3', pin('SP1', 3), dev('D1', '5V'), 260),
      w('w4', pin('J1', 2), pin('J2', 2), 300),
      w('w5', pin('J1', 3), pin('J3', 1), 340),
      w('w6', pin('J1', 4), pin('J3', 2), 340),
      w('w7', pin('J1', 5), pin('J2', 3), 300),
      w('w8', pin('J1', 6), dev('D1', 'GND'), 380),
      w('w9', pin('J2', 4), pin('J3', 3), 210),
    ],
  );
}

// ---------------- 테스트 ----------------

describe('구간 산출 (분기 없음)', () => {
  it('두 커넥터를 잇는 하네스는 구간 하나 · 본수 = 전체 배선 수', () => {
    const m = buildPhysicalModel(simpleDoc(6));
    expect(m.segments).toHaveLength(1);
    const [s] = m.segments;
    expect(s.code).toBe('S1');
    expect(s.fromRef).toBe('J1');
    expect(s.toRef).toBe('J2');
    expect(s.count).toBe(6);
    expect(s.wireIds).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    // 갈라질 곳이 없으므로 분기점을 만들지 않는다
    expect(m.nodes.filter((n) => n.kind === 'branch')).toHaveLength(0);
  });

  it('대표 길이는 그 구간 배선 길이의 최댓값 · 합계는 전 배선의 합', () => {
    const m = buildPhysicalModel(simpleDoc(3)); // 100 / 110 / 120
    expect(m.segments[0].lengthMm).toBe(120);
    expect(m.totalWireMm).toBe(330);
    expect(m.missingLength).toBe(0);
    expect(m.longest).toMatchObject({ code: 'W3', lengthMm: 120, fromRef: 'J1', toRef: 'J2' });
  });
});

describe('같은 경로 공유 판정', () => {
  it('한 커넥터에서 두 방향으로 갈리면 하우징 바깥에 분기점이 생기고 앞구간이 한 다발이 된다', () => {
    const doc = makeDoc(
      [housing('h6', 'MDB 6P', 6), housing('h4', 'SMH250 4P', 4), housing('h8', 'RJ45 8P8C', 8)],
      [conn('J1', 'h6', 6), conn('J2', 'h4', 4), conn('J3', 'h8', 8)],
      [],
      [
        w('w1', pin('J1', 1), pin('J2', 1), 200),
        w('w2', pin('J1', 2), pin('J2', 2), 200),
        w('w3', pin('J1', 3), pin('J3', 1), 260),
      ],
    );
    const m = buildPhysicalModel(doc);
    expect(m.segments.map((s) => `${s.fromRef}→${s.toRef}`)).toEqual(['J1→B1', 'B1→J2', 'B1→J3']);
    expect(m.segments.map((s) => s.count)).toEqual([3, 2, 1]);
    // 앞구간(J1→B1)에는 세 본이 모두 지나간다 — "같은 경로를 공유하는 구간"
    expect(m.segments[0].wireIds).toEqual(['w1', 'w2', 'w3']);
    expect(m.segments[1].wireIds).toEqual(['w1', 'w2']);
    expect(m.segments[2].wireIds).toEqual(['w3']);
  });

  it('직결이 없는 배선(J2↔J3)도 트리 경로를 따라 두 구간에 함께 잡힌다', () => {
    const m = buildPhysicalModel(branchedDoc());
    const s = m.segments.find((x) => x.toRef === 'J3');
    expect(s).toBeDefined();
    expect(s!.wireIds).toContain('w9'); // J2 → J3 배선이 B1→J3 구간을 지난다
    const toJ2 = m.segments.find((x) => x.toRef === 'J2')!;
    expect(toJ2.wireIds).toContain('w9');
  });
});

describe('스플라이스 분기', () => {
  it('Claude Design 샘플 골격의 구간·본수를 재현한다', () => {
    const m = buildPhysicalModel(branchedDoc());
    expect(m.segments.map((s) => `${s.fromRef}→${s.toRef}`)).toEqual([
      'J1→B1', 'B1→B2', 'B1→J2', 'B1→J3', 'B2→D1',
    ]);
    expect(m.segments.map((s) => s.count)).toEqual([6, 3, 4, 3, 2]);
    // 샘플 표와 같은 포함 배선
    expect(m.segments[0].wireIds).toEqual(['w1', 'w4', 'w5', 'w6', 'w7', 'w8']);
    expect(m.segments[2].wireIds).toEqual(['w2', 'w4', 'w7', 'w9']);
    expect(m.segments[3].wireIds).toEqual(['w5', 'w6', 'w9']);
    expect(m.segments[4].wireIds).toEqual(['w3', 'w8']);
  });

  it('스플라이스가 있는 분기는 채움, 단순 분기는 빈 마커', () => {
    const m = buildPhysicalModel(branchedDoc());
    const branches = m.nodes.filter((n) => n.kind === 'branch');
    const b1 = branches.find((n) => n.ref === 'B1')!;
    const b2 = branches.find((n) => n.ref === 'B2')!;
    expect(b1.branchKind).toBe('simple'); // 부품 없는 단순 분기
    expect(b1.name).toBe('분기');
    expect(b2.branchKind).toBe('splice'); // SP1 — 내부 결선이 있다
    expect(b2.name).toBe('SP1 스플라이스');
    expect(b2.docId).toBe('SP1');
  });

  it('내부 결선(bridges)이 없는 스플라이스는 전기적 접속이 없으므로 빈 마커', () => {
    const doc = branchedDoc();
    doc.connectors[1] = splice('SP1', 3, false);
    const m = buildPhysicalModel(doc);
    const b2 = m.nodes.find((n) => n.ref === 'B2')!;
    expect(b2.branchKind).toBe('simple');
  });

  it('장치는 점선 카드로 표시되도록 표시된다', () => {
    const m = buildPhysicalModel(branchedDoc());
    const d1 = m.nodes.find((n) => n.ref === 'D1')!;
    expect(d1.kind).toBe('terminal');
    expect(d1.dashed).toBe(true);
  });
});

describe('길이 미입력', () => {
  it('길이가 하나도 없으면 구간 길이는 null · 전장도 만들지 않는다', () => {
    const m = buildPhysicalModel(simpleDoc(4, false));
    expect(m.segments[0].lengthMm).toBeNull();
    expect(m.longest).toBeNull();
    expect(m.totalWireMm).toBe(0);
    expect(m.missingLength).toBe(4);
  });

  it('일부만 입력돼 있으면 입력된 값 중 최댓값을 쓰고 미입력 수를 남긴다', () => {
    const doc = simpleDoc(3, false);
    doc.wires[1] = { ...doc.wires[1], lengthMm: 150 };
    const m = buildPhysicalModel(doc);
    expect(m.segments[0].lengthMm).toBe(150);
    expect(m.missingLength).toBe(2);
    expect(m.totalWireMm).toBe(150);
  });
});

describe('외경 추정', () => {
  it('√본수 × 대표 심선 외경 (AWG22 4본 ≈ Ø2.9)', () => {
    const m = buildPhysicalModel(simpleDoc(4));
    const core = wireDiameterMm({ system: 'awg', value: 22 });
    expect(m.segments[0].odMm).toBe(bundleDiameterMm(4, core));
    expect(m.segments[0].odMm).toBeCloseTo(2.9, 1);
  });

  it('본수가 늘면 외경 추정도 커진다', () => {
    const a = buildPhysicalModel(simpleDoc(2)).segments[0].odMm!;
    const b = buildPhysicalModel(simpleDoc(8)).segments[0].odMm!;
    expect(b).toBeGreaterThan(a);
  });
});

describe('경계와 결정론', () => {
  it('배선이 없으면 구간도 없다', () => {
    const m = buildPhysicalModel(makeDoc([housing('h6', 'MDB 6P', 6)], [conn('J1', 'h6', 6)], [], []));
    expect(m.segments).toEqual([]);
    expect(m.nodes).toEqual([]);
    expect(m.roots).toEqual([]);
    expect(m.longest).toBeNull();
  });

  it('같은 부품 안에서 도는 배선은 구간을 만들지 않는다', () => {
    const doc = makeDoc(
      [housing('h6', 'MDB 6P', 6)],
      [conn('J1', 'h6', 6)],
      [],
      [w('w1', pin('J1', 1), pin('J1', 2), 50)],
    );
    expect(buildPhysicalModel(doc).segments).toEqual([]);
  });

  it('같은 문서면 항상 같은 구간 · 코드는 S1 부터 빠짐없이 이어진다', () => {
    const doc = branchedDoc();
    const a = buildPhysicalModel(doc);
    const b = buildPhysicalModel(doc);
    expect(b.segments).toEqual(a.segments);
    expect(a.segments.map((s) => s.code)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(a.wireCodes.get('w9')).toBe('W9');
  });
});

describe('자재 요약', () => {
  it('실재하는 것만 넣는다 — 보호재는 데이터가 없으므로 없다', () => {
    const rows = materialRows(branchedDoc());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => /슬리브|테이프|보호재/.test(r.name))).toBe(false);
    expect(rows.some((r) => r.name === 'MDB 6P' && r.qty === '1ea')).toBe(true);
    expect(rows.some((r) => /AWG22/.test(r.name) && r.qty.endsWith('본'))).toBe(true);
  });
});
