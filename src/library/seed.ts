/**
 * Agent B 소유 — 부품 라이브러리 시드 + 인스턴스 생성.
 *
 * 출처(2026-08 확인):
 * - MDB: Molex Mini-Fit Jr 6way. VMC(마스터)=5557 시리즈 39-01-2060,
 *   주변기기=5569 시리즈 39-30-1060. 크림프핀 39-00-02xx 계열, 발치공구 11-03-0044.
 *   통신 9600bps, 9비트(모드비트), TTL 0-5V.
 * - RJ45: 8P8C, T568B/T568A 색상표 (ANSI/TIA-568)
 * - USB: 2.0 A/B=4핀, Mini/Micro-B=5핀(ID), 3.x A/B=9핀, Type-C=24핀
 * - 연호전자(YEONHO): 하우징(SMH)/웨이퍼(SMW·SMAW)/터미널(YST) 3종 세트 구조.
 *   SMH250(2.5mm)-YST025, SMH200(2.0mm)-YST200, YH396(3.96mm)-YT396.
 *   SMH250 ↔ SMW250/SMAW250/SMP250 결합, SMH200 ↔ SMW200/SMAW200 결합.
 */
import type { PartLibraryItem, Connector, ConnectorKind, Vec2, PinSlot } from '../types';

/** 그리드형 핀 배치 (cols × rows, 1-base) */
function grid(cols: number, rows: number): PinSlot[] {
  const layout: PinSlot[] = [];
  let index = 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      layout.push({ index, label: String(index), offset: { x, y } });
      index++;
    }
  }
  return layout;
}

/** 신호명 배열 → 1열 배치 */
function row(signals: string[], colors?: string[]): PinSlot[] {
  return signals.map((sig, i) => ({
    index: i + 1,
    label: String(i + 1),
    offset: { x: i, y: 0 },
    signal: sig,
    stdColor: colors?.[i] || undefined,
  }));
}

// ── MDB (Molex Mini-Fit Jr 6way, 2열×3) ───────────────────
const MDB_SIGNALS: PinSlot[] = [
  { index: 1, label: '1', offset: { x: 0, y: 0 }, signal: '+34V (무정전)', stdColor: 'red' },
  { index: 2, label: '2', offset: { x: 1, y: 0 }, signal: 'GND (무정전)', stdColor: 'black' },
  { index: 3, label: '3', offset: { x: 2, y: 0 }, signal: 'Master Receive', stdColor: 'white' },
  { index: 4, label: '4', offset: { x: 0, y: 1 }, signal: '+34V (스위치드)', stdColor: 'orange' },
  { index: 5, label: '5', offset: { x: 1, y: 1 }, signal: 'GND (스위치드)', stdColor: 'brown' },
  { index: 6, label: '6', offset: { x: 2, y: 1 }, signal: 'Master Transmit', stdColor: 'green' },
];

// ── RJ45 ──────────────────────────────────────────────────
const T568B_COLORS = ['white/orange','orange','white/green','blue','white/blue','green','white/brown','brown'];
const T568A_COLORS = ['white/green','green','white/orange','blue','white/blue','orange','white/brown','brown'];
const RJ45_SIGNALS = ['TX+','TX-','RX+','PoE','PoE','RX-','PoE','PoE'];


// ── 연호전자(YEONHO) 시리즈 ────────────────────────────────
// 하우징(SMH) + 웨이퍼(SMW=스트레이트 / SMAW=앵글) + 터미널(YST) 세트 구조.
type YeonhoSpec = {
  series: string;      // SMH250
  pitch: string;       // 2.5mm
  terminal: string;    // YST025
  mates: string;       // 결합 상대물
  pins: number[];      // 라이브러리에 넣을 핀수
};

const YEONHO_SERIES: YeonhoSpec[] = [
  { series: 'SMH250', pitch: '2.5mm', terminal: 'YST025', mates: 'SMW250 / SMAW250 / SMP250', pins: [2, 3, 4, 5, 6, 8, 10] },
  { series: 'SMH200', pitch: '2.0mm', terminal: 'YST200', mates: 'SMW200 / SMAW200 / YDH200', pins: [2, 3, 4, 5, 6, 8, 10] },
  { series: 'YH396', pitch: '3.96mm', terminal: 'YT396', mates: 'YW396 / YAW396 / SMP396', pins: [2, 3, 4, 6, 8, 10] },
];

function yeonhoHousings(): PartLibraryItem[] {
  const out: PartLibraryItem[] = [];
  for (const y of YEONHO_SERIES) {
    for (const n of y.pins) {
      out.push({
        id: `lib-yh-${y.series.toLowerCase()}-${n}p`,
        category: 'housing',
        name: `연호 ${y.series}-${String(n).padStart(2, '0')} (${n}P)`,
        manufacturer: 'YEONHO',
        mpn: `${y.series}-${String(n).padStart(2, '0')}`,
        spec: { 피치: y.pitch, 터미널: y.terminal, 결합: y.mates, 형식: '하우징(암)' },
        pinCount: n,
        pinLayout: grid(n, 1),
      });
    }
  }
  return out;
}

/** 연호 웨이퍼(보드 실장) — SMW=스트레이트, SMAW=앵글 */
function yeonhoWafers(): PartLibraryItem[] {
  const out: PartLibraryItem[] = [];
  const wafers = [
    { base: 'SMW250', pitch: '2.5mm', mate: 'SMH250', type: '스트레이트', pins: [2, 3, 4, 5, 6, 8, 10] },
    { base: 'SMAW250', pitch: '2.5mm', mate: 'SMH250', type: '앵글', pins: [2, 3, 4, 5, 6, 8, 10] },
    { base: 'SMW200', pitch: '2.0mm', mate: 'SMH200', type: '스트레이트', pins: [2, 3, 4, 5, 6, 8, 10] },
    { base: 'SMAW200', pitch: '2.0mm', mate: 'SMH200', type: '앵글', pins: [2, 3, 4, 5, 6, 8, 10] },
  ];
  for (const w of wafers) {
    for (const n of w.pins) {
      out.push({
        id: `lib-yh-${w.base.toLowerCase()}-${n}p`,
        category: 'board-to-wire',
        name: `연호 ${w.base}-${String(n).padStart(2, '0')} (${n}P)`,
        manufacturer: 'YEONHO',
        mpn: `${w.base}-${String(n).padStart(2, '0')}`,
        spec: { 피치: w.pitch, 실장: w.type, 결합: `${w.mate} 하우징`, 형식: '웨이퍼(보드 실장, 수)' },
        pinCount: n,
        pinLayout: grid(n, 1),
      });
    }
  }
  return out;
}

const YEONHO_TERMINALS: PartLibraryItem[] = [
  {
    id: 'lib-yh-yst025', category: 'terminal', name: '연호 YST025 터미널 (SMH250용)',
    manufacturer: 'YEONHO', mpn: 'YST025',
    spec: { 적용: 'SMH250 (2.5mm)', 비고: '하우징에 압착해 삽입' },
  },
  {
    id: 'lib-yh-yst200', category: 'terminal', name: '연호 YST200 터미널 (SMH200용)',
    manufacturer: 'YEONHO', mpn: 'YST200',
    spec: { 적용: 'SMH200 / YDH200 (2.0mm)', 비고: '공용 터미널' },
  },
  {
    id: 'lib-yh-yt396', category: 'terminal', name: '연호 YT396 터미널 (YH396용)',
    manufacturer: 'YEONHO', mpn: 'YT396',
    spec: { 적용: 'YH396 (3.96mm)' },
  },
];

export const SEED_PARTS: PartLibraryItem[] = [
  // ===== MDB =====
  {
    id: 'lib-mdb-vmc', category: 'housing', name: 'MDB VMC(마스터) 6P',
    manufacturer: 'Molex', mpn: '39-01-2060',
    spec: { 시리즈: 'Mini-Fit Jr 5557', 피치: '4.2mm', 정격: '9A/600V', 통신: '9600bps 9bit TTL', 비고: '자판기 본체(VMC) 측' },
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-mdb-periph', category: 'housing', name: 'MDB 주변기기 6P',
    manufacturer: 'Molex', mpn: '39-30-1060',
    spec: { 시리즈: 'Mini-Fit Jr 5569', 피치: '4.2mm', 정격: '9A/600V', 비고: '지폐/코인/캐시리스 측' },
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-minifit-terminal', category: 'terminal', name: 'Mini-Fit Jr 크림프핀 18-24AWG',
    manufacturer: 'Molex', mpn: '39-00-0207',
    spec: { 적용: 'MDB / Mini-Fit Jr', 발치공구: '11-03-0044' },
  },

  // ===== LAN =====
  {
    id: 'lib-rj45-t568b', category: 'housing', name: 'RJ45 8P8C (T568B)',
    spec: { 규격: 'ANSI/TIA-568', 배선: 'T568B(국내 표준)', 비고: '양단 동일 규격' },
    pinCount: 8, pinLayout: row(RJ45_SIGNALS, T568B_COLORS),
  },
  {
    id: 'lib-rj45-t568a', category: 'housing', name: 'RJ45 8P8C (T568A)',
    spec: { 규격: 'ANSI/TIA-568', 배선: 'T568A(녹/주황 교체)' },
    pinCount: 8, pinLayout: row(['RX+','RX-','TX+','PoE','PoE','TX-','PoE','PoE'], T568A_COLORS),
  },
  {
    id: 'lib-rj45-jack', category: 'board-to-wire', name: 'RJ45 잭(보드 실장)',
    spec: { 형식: 'PCB 실장 8P8C', 비고: '자석/LED 내장 여부 확인' },
    pinCount: 8, pinLayout: row(RJ45_SIGNALS, T568B_COLORS),
  },

  // ===== USB =====
  {
    id: 'lib-usb-a-20', category: 'housing', name: 'USB 2.0 Type-A (4P)',
    spec: { 규격: 'USB 2.0', 속도: '480Mbps', 비고: '호스트(다운스트림)' },
    pinCount: 4, pinLayout: row(['VBUS +5V','D-','D+','GND'], ['red','white','green','black']),
  },
  {
    id: 'lib-usb-b-20', category: 'housing', name: 'USB 2.0 Type-B (4P)',
    spec: { 규격: 'USB 2.0', 비고: '디바이스 측 · 프린터/산업장비' },
    pinCount: 4, pinLayout: row(['VBUS +5V','D-','D+','GND'], ['red','white','green','black']),
  },
  {
    id: 'lib-usb-a-30', category: 'housing', name: 'USB 3.x Type-A (9P)',
    spec: { 규격: 'USB 3.2 Gen1', 속도: '5Gbps', 비고: '5~9번이 SuperSpeed 추가핀' },
    pinCount: 9,
    pinLayout: row(
      ['VBUS +5V','D-','D+','GND','SSRX-','SSRX+','GND_DRAIN','SSTX-','SSTX+'],
      ['red','white','green','black','blue','yellow','black','purple','orange'],
    ),
  },
  {
    id: 'lib-usb-b-30', category: 'housing', name: 'USB 3.x Type-B (9P)',
    spec: { 규격: 'USB 3.2 Gen1', 비고: 'USB2.0 플러그 하위호환' },
    pinCount: 9,
    pinLayout: row(
      ['VBUS +5V','D-','D+','GND','SSRX-','SSRX+','GND_DRAIN','SSTX-','SSTX+'],
      ['red','white','green','black','blue','yellow','black','purple','orange'],
    ),
  },
  {
    id: 'lib-usb-mini-b', category: 'housing', name: 'USB Mini-B (5P)',
    spec: { 규격: 'USB 2.0', 비고: 'ID핀 OTG 판별 · 구형 장비' },
    pinCount: 5, pinLayout: row(['VBUS +5V','D-','D+','ID','GND'], ['red','white','green','','black']),
  },
  {
    id: 'lib-usb-micro-b', category: 'housing', name: 'USB Micro-B (5P)',
    spec: { 규격: 'USB 2.0', 비고: '비OTG 케이블은 ID(4번) 미결선' },
    pinCount: 5, pinLayout: row(['VBUS +5V','D-','D+','ID','GND'], ['red','white','green','','black']),
  },
  {
    id: 'lib-usb-c', category: 'housing', name: 'USB Type-C (24P)',
    spec: { 규격: 'USB Type-C', 비고: '리버서블 24핀(2열 대칭) · CC핀 PD/Alt 협상', 주의: '충전전용은 일부 핀만 결선' },
    pinCount: 24,
    pinLayout: [
      ...['GND','TX1+','TX1-','VBUS','CC1','D+','D-','SBU1','VBUS','RX2-','RX2+','GND']
        .map((sig, i) => ({ index: i + 1, label: `A${i + 1}`, offset: { x: i, y: 0 }, signal: sig })),
      ...['GND','TX2+','TX2-','VBUS','CC2','D+','D-','SBU2','VBUS','RX1-','RX1+','GND']
        .map((sig, i) => ({ index: i + 13, label: `B${i + 1}`, offset: { x: i, y: 1 }, signal: sig })),
    ],
  },
  {
    id: 'lib-usb-c-b2w', category: 'board-to-wire', name: 'USB Type-C 리셉터클(보드)',
    spec: { 실장: 'SMD/THT', 비고: '전원전용 6핀 축약형도 있음' },
    pinCount: 24, pinLayout: grid(12, 2),
  },

  // ===== 범용 하우징 =====
  { id: 'lib-xh-2p', category: 'housing', name: 'JST XH 2.5 2P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-xh-4p', category: 'housing', name: 'JST XH 2.5 4P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-xh-6p', category: 'housing', name: 'JST XH 2.5 6P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, pinCount: 6, pinLayout: grid(6, 1) },
  { id: 'lib-ph-4p', category: 'housing', name: 'JST PH 2.0 4P', manufacturer: 'JST',
    spec: { 피치: '2.0mm', 정격: '2A' }, pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-minifit-4p', category: 'housing', name: 'Molex Mini-Fit Jr 4P', manufacturer: 'Molex',
    spec: { 피치: '4.2mm', 정격: '9A', 비고: '전원 배선용' }, pinCount: 4, pinLayout: grid(2, 2) },
  { id: 'lib-molex-2x5', category: 'housing', name: 'Molex 2x5 (10P)', manufacturer: 'Molex',
    spec: { 피치: '2.54mm' }, pinCount: 10, pinLayout: grid(5, 2) },

  // ===== 보드투와이어 / 스플라이스 =====
  { id: 'lib-b2w-2p', category: 'board-to-wire', name: 'Board-to-Wire 2P',
    spec: { 실장: 'THT' }, pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-b2w-4p', category: 'board-to-wire', name: 'Board-to-Wire 4P',
    spec: { 실장: 'THT' }, pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-terminal-block-2p', category: 'board-to-wire', name: '터미널블럭 2P',
    spec: { 결선: '나사식', 비고: '전원 인입용' }, pinCount: 2, pinLayout: grid(2, 1) },
  // ===== 와이어투와이어 (중간 결선/연장) =====
  { id: 'lib-w2w-2p', category: 'housing', name: '와이어투와이어 2P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-w2w-4p', category: 'housing', name: '와이어투와이어 4P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-w2w-6p', category: 'housing', name: '와이어투와이어 6P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    pinCount: 6, pinLayout: grid(6, 1) },

  { id: 'lib-splice-3', category: 'splice', name: '스플라이스 3 (꼬임)',
    pinCount: 3, pinLayout: grid(3, 1) },
  { id: 'lib-splice-4', category: 'splice', name: '스플라이스 4 (꼬임)',
    pinCount: 4, pinLayout: grid(4, 1) },

  // ===== 연호전자 =====
  ...yeonhoHousings(),
  ...yeonhoWafers(),
  ...YEONHO_TERMINALS,
];

const kindOf = (cat: PartLibraryItem['category']): ConnectorKind =>
  cat === 'splice' ? 'splice' : cat === 'board-to-wire' ? 'board-to-wire' : 'connector';

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** 라이브러리 항목 → 캔버스에 놓을 Connector 인스턴스 */
export function instantiate(item: PartLibraryItem, at: Vec2): Connector {
  const n = item.pinCount ?? item.pinLayout?.length ?? 2;
  const pins = Array.from({ length: n }, (_, i) => ({
    id: uid('pin'),
    index: item.pinLayout?.[i]?.index ?? i + 1,
    label: item.pinLayout?.[i]?.label,
  }));
  const kind = kindOf(item.category);
  const conn: Connector = {
    id: uid('con'), kind, housingId: item.id, orientation: 0,
    positions: { logical: at, physical: at }, pins,
  };
  if (kind === 'splice') conn.bridges = [pins.map((p) => p.id)];
  return conn;
}

/** 규격 색상 제안 (RJ45/USB/MDB 등 표준 커넥터의 핀 색) */
export function suggestedColor(item: PartLibraryItem | undefined, pinIndex: number): string | undefined {
  return item?.pinLayout?.find((s) => s.index === pinIndex)?.stdColor || undefined;
}
