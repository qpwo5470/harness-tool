/**
 * 스키마 검증용 픽스처.
 * types.ts 계약이 실제 하네스(스플라이스·다중결선·보드투와이어·장치블록·멀티코어)를
 * 모두 표현할 수 있는지 컴파일 타임에 증명한다.
 */
import type {
  PartLibraryItem,
  Connector,
  Device,
  Wire,
  Cable,
  HarnessDocument,
} from '../types';

// --- 라이브러리 ---
const housingXH4: PartLibraryItem = {
  id: 'lib-xh-4p',
  category: 'housing',
  name: 'JST XH 2.5 4P',
  spec: { pitch: '2.5mm', current: '3A' },
  pinCount: 4,
  pinLayout: [
    { index: 1, offset: { x: 0, y: 0 } },
    { index: 2, offset: { x: 1, y: 0 } },
    { index: 3, offset: { x: 2, y: 0 } },
    { index: 4, offset: { x: 3, y: 0 } },
  ],
};

const spliceItem: PartLibraryItem = {
  id: 'lib-splice',
  category: 'splice',
  name: '단순 결선(꼬임)',
  pinCount: 3,
};

const b2wItem: PartLibraryItem = {
  id: 'lib-b2w-2p',
  category: 'board-to-wire',
  name: 'Board-to-Wire 2P',
  pinCount: 2,
};

// --- 커넥터 인스턴스 ---
const conA: Connector = {
  id: 'con-a',
  kind: 'connector',
  housingId: 'lib-xh-4p',
  orientation: 0,
  positions: { logical: { x: 40, y: 40 }, physical: { x: 60, y: 200 } },
  pins: [
    { id: 'a1', index: 1 },
    { id: 'a2', index: 2 },
    { id: 'a3', index: 3 },
    { id: 'a4', index: 4 },
  ],
};

// 스플라이스: 3핀이 내부적으로 전부 한 네트 (bridges)
const splice: Connector = {
  id: 'sp-1',
  kind: 'splice',
  housingId: 'lib-splice',
  orientation: 0,
  positions: { logical: { x: 240, y: 80 } },
  pins: [
    { id: 's1', index: 1 },
    { id: 's2', index: 2 },
    { id: 's3', index: 3 },
  ],
  bridges: [['s1', 's2', 's3']],
};

const b2w: Connector = {
  id: 'con-b2w',
  kind: 'board-to-wire',
  housingId: 'lib-b2w-2p',
  orientation: 90,
  positions: { logical: { x: 440, y: 120 } },
  pins: [
    { id: 'p1', index: 1 },
    { id: 'p2', index: 2 },
  ],
};

// --- 장치 블록 ---
const pi: Device = {
  id: 'dev-pi',
  name: 'Raspberry Pi',
  terminals: ['5V', 'GND', 'GPIO18'],
  positions: { logical: { x: 440, y: 320 } },
};

// --- 멀티코어 케이블 ---
const cable: Cable = {
  id: 'cbl-1',
  name: '2C 전원 케이블',
  coreCount: 2,
  gauge: { system: 'mm2', value: 0.5 },
  jacketColor: 'black',
  lengthMm: 300,
};

// --- 와이어 ---
const wires: Wire[] = [
  // 커넥터 → 스플라이스
  {
    id: 'w1',
    from: { type: 'pin', connectorId: 'con-a', pinId: 'a1' },
    to: { type: 'pin', connectorId: 'sp-1', pinId: 's1' },
    color: { base: 'red', stripe: 'white' }, // 2톤
    gauge: { system: 'awg', value: 22 },
    lengthMm: 120,
  },
  // 스플라이스에서 갈라져 나가는 두 가닥(Y자 = 같은 스플라이스 공유)
  {
    id: 'w2',
    from: { type: 'pin', connectorId: 'sp-1', pinId: 's2' },
    to: { type: 'pin', connectorId: 'con-b2w', pinId: 'p1' },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
    cableId: 'cbl-1',
  },
  {
    id: 'w3',
    from: { type: 'pin', connectorId: 'sp-1', pinId: 's3' },
    to: { type: 'device', deviceId: 'dev-pi', terminal: '5V' }, // 장치 블록에 직결
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
    cableId: 'cbl-1',
  },
];

export const sampleDoc: HarnessDocument = {
  schemaVersion: 1,
  id: 'doc-1',
  name: '샘플 하네스',
  createdAt: '2026-08-11T05:58:00Z',
  updatedAt: '2026-08-11T05:58:00Z',
  connectors: [conA, splice, b2w],
  devices: [pi],
  wires,
  cables: [cable],
  usedParts: [housingXH4, spliceItem, b2wItem],
};
