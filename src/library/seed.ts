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
 *   SMH250 ↔ SMW250/SMAW250 (보드 실장 웨이퍼) 결합, SMH200 ↔ SMW200/SMAW200 결합.
 *   **SMP250 은 웨이퍼가 아니라 전선측 플러그(수)** 다. SMH250(암) 과 선 대 선으로
 *   맞물리며, 터미널도 SMH250 의 YST025 가 아니라 **SMT025** 를 쓴다 (데이터시트 SMP250-NN).
 * - Molex SPOX 2.50mm: 35155(하우징, Receptacle) ↔ 35312(수직 헤더) / 35184(플러그 하우징),
 *   터미널 5103. 두 시리즈 모두 Not Recommended For New Design.
 * - Molex Micro-Fit 3.0: 판매도면 **430250000-SD** 에서 직접 확인.
 *   43025(리셉터클 하우징, 2열) ↔ 43020(플러그 하우징) / 43045(PCB 헤더),
 *   터미널 43030(암)·43031(수). 피치 3.00mm(열·행 모두), 회로 02~24 짝수.
 *
 * 결합 성별(gender)은 문자열 `spec.형식` 이 아니라 `PartLibraryItem.gender` 에 둔다 —
 * 발주 시 암수를 잘못 사면 현장에서 못 쓰기 때문이다.
 */
import type { PartLibraryItem, Connector, ConnectorKind, PartGender, Vec2, PinSlot } from '../types';
// 핀 배치 해석은 캔버스와 같은 함수를 쓴다 — 기하는 geometry.ts 한 곳에만 산다
import { layoutCells } from '../canvas/geometry';

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
        gender: 'receptacle',
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
        gender: 'header',
        pinCount: n,
        pinLayout: grid(n, 1),
      });
    }
  }
  return out;
}

/**
 * 연호 SMP250 — 2.50mm 전선측 **플러그(수)**.
 *
 * 출처: 연호전자 데이터시트 `SMP250-NN`.
 *  - 종류 Wire to Wire Connector — Plug, 1열, 재질 Nylon 66 UL94V-0
 *  - AC/DC 250V · AC/DC 3A · -25℃~+85℃ · 접촉저항 30mΩ MAX
 *  - 적용 전선 AWG#22~#28 · 결합 하우징 SMH250-NN · 적용 터미널 **SMT025**
 *  - 데이터시트 표에 02~13 열두 종이 모두 실려 있다.
 *
 * SMH250 과 짝이지만 터미널이 다르다(YST025 아님). 잘못 시키면 압착이 안 들어간다.
 */
const SMP250_PINS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function yeonhoPlugs(): PartLibraryItem[] {
  return SMP250_PINS.map((n) => ({
    id: `lib-yh-smp250-${n}p`,
    category: 'housing' as const,
    name: `연호 SMP250-${String(n).padStart(2, '0')} (${n}P)`,
    manufacturer: 'Yeonho Electronics (연호전자)',
    mpn: `SMP250-${String(n).padStart(2, '0')}`,
    spec: {
      종류: 'Wire to Wire Connector — Plug',
      피치: '2.50mm',
      열: '1열',
      재질: 'Nylon 66, UL94V-0',
      정격: 'AC/DC 250V · AC/DC 3A',
      온도: '-25℃ ~ +85℃',
      접촉저항: '30mΩ MAX',
      적용전선: 'AWG #22 ~ #28',
      결합: 'SMH250-NN 하우징',
      터미널: 'SMT025',
      형식: '플러그(전선측, 수)',
      비고: '터미널이 SMH250 의 YST025 가 아니라 SMT025 다',
    },
    gender: 'plug' as const,
    pinCount: n,
    pinLayout: grid(n, 1),
  }));
}

const YEONHO_TERMINALS: PartLibraryItem[] = [
  {
    id: 'lib-yh-yst025', category: 'terminal', name: '연호 YST025 터미널 (SMH250용)',
    manufacturer: 'YEONHO', mpn: 'YST025',
    spec: { 적용: 'SMH250 (2.5mm)', 비고: '하우징에 압착해 삽입' },
    gender: 'neutral',
  },
  {
    id: 'lib-yh-yst200', category: 'terminal', name: '연호 YST200 터미널 (SMH200용)',
    manufacturer: 'YEONHO', mpn: 'YST200',
    spec: { 적용: 'SMH200 / YDH200 (2.0mm)', 비고: '공용 터미널' },
    gender: 'neutral',
  },
  {
    id: 'lib-yh-yt396', category: 'terminal', name: '연호 YT396 터미널 (YH396용)',
    manufacturer: 'YEONHO', mpn: 'YT396',
    spec: { 적용: 'YH396 (3.96mm)' },
    gender: 'neutral',
  },
  {
    id: 'lib-yh-smt025', category: 'terminal', name: '연호 SMT025 터미널 (SMP250용)',
    manufacturer: 'Yeonho Electronics (연호전자)', mpn: 'SMT025',
    spec: { 적용: 'SMP250 (2.5mm)', 비고: 'AWG22~28 · SMH250 의 YST025 와 다르다' },
    gender: 'neutral',
  },
];

/**
 * Molex SPOX 2.50mm — 35155 하우징(암) ↔ 35312 수직 헤더.
 *
 * 출처: Molex 제품 데이터시트(2026-08 확인).
 * 두 시리즈 모두 **Not Recommended For New Design** 이라 신규 설계에 넣기 전에
 * 대체품을 확인해야 한다 — 비고에 남긴다.
 *
 * **검증된 품번만 넣는다.** 규칙(35155-0N00 / 35312-0N60)으로 없는 핀수를 만들어
 * 넣으면 존재하지 않는 품번을 발주하게 된다. 다른 핀수가 필요하면 비고의 규칙을 보고
 * 핀맵 에디터에서 복제해 쓴다.
 */
const MOLEX_SPOX: PartLibraryItem[] = [
  ...[3, 4, 5].map((n) => ({
    id: `lib-spox-35155-${n}p`,
    category: 'housing' as const,
    name: `Molex 35155-0${n}00 SPOX 2.50mm (${n}P)`,
    manufacturer: 'Molex',
    mpn: `35155-0${n}00`,
    spec: {
      시리즈: '35155',
      설명: '2.50mm Pitch Wire-to-Board Housing, Positive Lock, Natural',
      종류: 'Receptacle',
      피치: '2.50mm',
      열: '1열 (Number of Rows 1)',
      용도: 'Wire-to-Wire',
      결합: '35184 (Wire-to-Wire Plug Housings) / 35312 (Vertical Headers)',
      터미널: '5103 (SPOX Female Crimp Terminals)',
      온도: '-40°C ~ +105°C',
      상태: 'Not Recommended For New Design',
      비고:
        'Not Recommended For New Design — 신규 설계 전 대체품 확인. ' +
        '품번 규칙 35155-0N00 (N=회로수). 검증된 3·4·5P 만 등록했으니 ' +
        '다른 핀수는 복제해서 품번을 확인한 뒤 쓰세요.',
    },
    gender: 'receptacle' as const,
    pinCount: n,
    pinLayout: grid(n, 1),
  })),
  {
    id: 'lib-spox-35312-5p',
    category: 'board-to-wire',
    name: 'Molex 35312-0560 2.50mm 수직 헤더 (5P)',
    manufacturer: 'Molex',
    mpn: '35312-0560',
    spec: {
      시리즈: '35312',
      설명: '2.50mm Pitch Header, Vertical, Shrouded, with Positive Lock',
      종류: 'PCB Header',
      피치: '2.50mm',
      열: '1열 (Number of Rows 1)',
      용도: 'Wire-to-Board',
      결합: '35155',
      정격: '3.0A / 250V',
      재질: 'PA Nylon 66 Glass-filled · 도금 Tin',
      실장: 'Through Hole · Vertical · Partially Shrouded · PCB 1.60mm',
      온도: '-40°C ~ +105°C',
      상태: 'Not Recommended For New Design',
      비고:
        'Not Recommended For New Design — 신규 설계 전 대체품 확인. ' +
        '품번 규칙 35312-0N60 (N=회로수). 검증된 5P 만 등록했습니다.',
    },
    gender: 'header',
    pinCount: 5,
    pinLayout: grid(5, 1),
  },
];

/* ================================================================
   Molex Micro-Fit 3.0 — 43025(리셉터클) · 43020(플러그) · 43030/43031(터미널)
   ----------------------------------------------------------------
   출처: Molex 판매도면 **430250000-SD**.

   도면에서 직접 읽은 것:
    - 43025 는 2열(dual row) 리셉터클 하우징, 품번 `43025-XX00` (XX = 두 자리 회로 수)
    - 회로 수 02·04·06·08·10·12·14·16·18·20·22·24
    - 피치 3.00mm — 열 방향·행 방향 모두
    - 격자는 2행 × (회로수/2)열. 도면 치수 B = (열수 − 1) × 3.00mm 로 검산했다
      (8회로 B=9.00 · 24회로 B=33.00 — 열수가 회로수/2 라야 맞는 숫자다)
    - 짝은 43020(플러그 하우징) 및 43045(PCB 헤더), 터미널은 43030 계열(암)/46235
    - 2·4 회로는 상단 풀탭이 없다 (도면 주8)
    - 회로 1 은 하우징의 식별 리브 또는 각인 "1" 로 표시된다 (도면 주11)

   ── 43045(PCB 헤더)를 왜 뺐나
   하네스 도면에 그리는 것은 전선 양 끝에 붙는 43025·43020 이고, 43045 는 상대
   기판의 자재다. 게다가 43045 는 43025 와 달리 끝 두 자리가 회로 수가 아니라
   **실장 방향·페그·도금 변형**을 물고 있어서, 43025 도면만 보고 `43045-XX00` 을
   만들어 넣으면 **존재하지 않는 품번을 발주**하게 된다. SPOX(35155/35312)에서
   세운 규칙 — 검증된 품번만 넣는다 — 을 그대로 지킨다. 보드측이 필요하면
   43045 도면을 확인한 뒤 핀맵 에디터로 추가하면 된다.
   ================================================================ */

/** 43025/43020 이 공통으로 갖는 회로 수 (판매도면 430250000-SD) */
const MICROFIT30_CIRCUITS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

/**
 * **확인하지 못한 것 — 2열 중 어느 행이 1..n/2 인가.**
 *
 * 격자 크기(2행 × 회로수/2열)와 피치(3.00mm)는 도면 치수로 검산했지만, 회로 번호가
 * 어느 행에서 시작하는지는 도면 **그림 안**에 있어 글자로 뽑아내지 못했다. 그래서
 * Molex 2열 커넥터의 통상 규칙(한 행에 1..n/2, 다른 행에 n/2+1..n)대로 `grid()` 로
 * 깔되, 아는 척하지 않고 각 부품 비고에 확인 지시를 남긴다. 도면이 진실을 말해 줄
 * 때까지 이 배열은 **가정**이다.
 */
const MICROFIT30_PIN_NOTE =
  '회로 번호 배열은 하우징의 회로1 식별 리브/각인으로 확인할 것 — ' +
  '2열 중 어느 행이 1..n/2 인지는 판매도면 그림 안에 있어 확인하지 못했고, ' +
  'Molex 2열 커넥터의 통상 규칙(윗줄 1..n/2 · 아랫줄 n/2+1..n)으로 깔아 두었다. ' +
  '다르면 라이브러리의 핀맵 에디터에서 고쳐 쓰세요.';

type MicroFit30Series = {
  series: '43025' | '43020';
  /** 이름 꼬리표 */
  표시: string;
  종류: string;
  gender: PartGender;
  터미널: string;
  결합: string;
  /** 시리즈별로 더 붙는 비고 */
  extraNote?: string;
};

function microFit30Housings(s: MicroFit30Series): PartLibraryItem[] {
  return MICROFIT30_CIRCUITS.map((n) => {
    const xx = String(n).padStart(2, '0');   // 품번은 두 자리 0 채움 → 43025-0600
    const cols = n / 2;                      // 2행 고정이므로 열수 = 회로수/2
    return {
      id: `lib-mf3-${s.series}-${xx}p`,
      category: 'housing' as const,
      name: `Molex ${s.series}-${xx}00 Micro-Fit 3.0 ${s.표시} (${n}회로)`,
      manufacturer: 'Molex',
      mpn: `${s.series}-${xx}00`,
      spec: {
        시리즈: s.series,
        종류: s.종류,
        피치: '3.00mm (열 방향·행 방향 모두)',
        열: `2열 (2행 × ${cols}열)`,
        회로: String(n),
        결합: s.결합,
        터미널: s.터미널,
        적용전선: 'AWG #18 ~ #30',
        회로1표시: '하우징의 식별 리브 또는 각인 "1" (판매도면 주11)',
        // 2·4 회로만 다른 사실이라 그 둘에만 적는다 — 나머지에 "있음"이라 적으면
        // 도면이 말하지 않은 것을 말하는 셈이 된다(주8은 없는 쪽만 밝힌다).
        ...(n <= 4 ? { 풀탭: '없음 — 2·4 회로는 상단 풀탭이 없다 (판매도면 주8)' } : {}),
        비고: [MICROFIT30_PIN_NOTE, s.extraNote].filter(Boolean).join(' '),
      },
      gender: s.gender,
      pinCount: n,
      pinLayout: grid(cols, 2),
    };
  });
}

const MICROFIT30: PartLibraryItem[] = [
  ...microFit30Housings({
    series: '43025',
    표시: '리셉터클',
    종류: 'Receptacle Housing (전선측, 암 컨택)',
    gender: 'receptacle',
    터미널: '43030 계열(암) 또는 46235',
    결합: '43020 (플러그 하우징) · 43045 (PCB 헤더)',
  }),
  ...microFit30Housings({
    series: '43020',
    표시: '플러그',
    종류: 'Plug Housing (전선측, 수 컨택)',
    gender: 'plug',
    터미널: '43031 (수)',
    결합: '43025 (리셉터클 하우징)',
    // 도면으로 확인한 품번 규칙은 43025 쪽이다. 43020 은 "같은 회로 수 구성" 까지만
    // 확인했으므로 규칙을 옮겨 적었다는 사실을 숨기지 않는다.
    extraNote:
      '품번은 43025 판매도면(430250000-SD)에서 확인한 규칙을 옮겨 43020-XX00 으로 적었다 — ' +
      '발주 전에 43020 도면으로 대조할 것.',
  }),
];

/**
 * Micro-Fit 3.0 크림프 터미널.
 *
 * 하우징과 암수가 **뒤집혀 있다**: 리셉터클 하우징(43025)에 암 터미널(43030),
 * 플러그 하우징(43020)에 수 터미널(43031) 이 들어간다. 잘못 시키면 압착은 되는데
 * 하우징에 들어가지 않는다 — SMH250/SMP250 에서 겪은 것과 같은 함정이라 적어 둔다.
 */
const MICROFIT30_TERMINALS: PartLibraryItem[] = [
  {
    id: 'lib-mf3-43030',
    category: 'terminal',
    name: 'Molex 43030 Micro-Fit 3.0 크림프 터미널 (암)',
    manufacturer: 'Molex',
    mpn: '43030',
    spec: {
      적용: '43025 Micro-Fit 3.0 리셉터클 하우징 (3.00mm)',
      적용전선: 'AWG #18 ~ #30',
      비고:
        '암 컨택 — 플러그 하우징(43020)에는 43031(수)을 쓴다. ' +
        '43025 에는 46235 계열도 들어간다. 도금·포장을 가르는 끝자리(43030-NNNN)는 발주 전에 확인할 것.',
    },
    gender: 'neutral',
  },
  {
    id: 'lib-mf3-43031',
    category: 'terminal',
    name: 'Molex 43031 Micro-Fit 3.0 크림프 터미널 (수)',
    manufacturer: 'Molex',
    mpn: '43031',
    spec: {
      적용: '43020 Micro-Fit 3.0 플러그 하우징 (3.00mm)',
      적용전선: 'AWG #18 ~ #30',
      비고:
        '수 컨택 — 리셉터클 하우징(43025)에는 43030(암)을 쓴다. ' +
        '도금·포장을 가르는 끝자리(43031-NNNN)는 발주 전에 확인할 것.',
    },
    gender: 'neutral',
  },
];

export const SEED_PARTS: PartLibraryItem[] = [
  // ===== MDB =====
  {
    id: 'lib-mdb-vmc', category: 'housing', name: 'MDB VMC(마스터) 6P',
    manufacturer: 'Molex', mpn: '39-01-2060',
    spec: { 시리즈: 'Mini-Fit Jr 5557', 피치: '4.2mm', 정격: '9A/600V', 통신: '9600bps 9bit TTL', 비고: '자판기 본체(VMC) 측' },
    // Mini-Fit Jr 5557 은 Molex 카탈로그상 Receptacle Housing(5556 암 크림프핀).
    gender: 'receptacle',
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-mdb-periph', category: 'housing', name: 'MDB 주변기기 6P',
    manufacturer: 'Molex', mpn: '39-30-1060',
    spec: { 시리즈: 'Mini-Fit Jr 5569', 피치: '4.2mm', 정격: '9A/600V', 비고: '지폐/코인/캐시리스 측' },
    // gender 미지정 — 5569 를 보드 실장 헤더로 보는 자료와 전선측 소켓으로 보는
    // 기존 주석이 갈린다. 데이터시트를 확인하기 전까지 비워 둔다(틀린 값보다 낫다).
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-minifit-terminal', category: 'terminal', name: 'Mini-Fit Jr 크림프핀 18-24AWG',
    manufacturer: 'Molex', mpn: '39-00-0207',
    spec: { 적용: 'MDB / Mini-Fit Jr', 발치공구: '11-03-0044' },
    gender: 'neutral',
  },

  // ===== LAN =====
  {
    id: 'lib-rj45-t568b', category: 'housing', name: 'RJ45 8P8C (T568B)',
    spec: { 규격: 'ANSI/TIA-568', 배선: 'T568B(국내 표준)', 비고: '양단 동일 규격' },
    gender: 'plug',   // 전선에 압착하는 8P8C 모듈러 플러그
    pinCount: 8, pinLayout: row(RJ45_SIGNALS, T568B_COLORS),
  },
  {
    id: 'lib-rj45-t568a', category: 'housing', name: 'RJ45 8P8C (T568A)',
    spec: { 규격: 'ANSI/TIA-568', 배선: 'T568A(녹/주황 교체)' },
    gender: 'plug',
    pinCount: 8, pinLayout: row(['RX+','RX-','TX+','PoE','PoE','TX-','PoE','PoE'], T568A_COLORS),
  },
  {
    id: 'lib-rj45-jack', category: 'board-to-wire', name: 'RJ45 잭(보드 실장)',
    spec: { 형식: 'PCB 실장 8P8C', 비고: '자석/LED 내장 여부 확인' },
    gender: 'header',
    pinCount: 8, pinLayout: row(RJ45_SIGNALS, T568B_COLORS),
  },

  // ===== USB =====
  // 전선에 붙는 USB 커넥터는 전부 플러그(케이블 엔드)다.
  // 보드에 앉는 것은 아래 `lib-usb-c-b2w` 처럼 따로 둔다.
  {
    id: 'lib-usb-a-20', category: 'housing', name: 'USB 2.0 Type-A (4P)',
    spec: { 규격: 'USB 2.0', 속도: '480Mbps', 비고: '호스트(다운스트림)' },
    gender: 'plug',
    pinCount: 4, pinLayout: row(['VBUS +5V','D-','D+','GND'], ['red','white','green','black']),
  },
  {
    id: 'lib-usb-b-20', category: 'housing', name: 'USB 2.0 Type-B (4P)',
    spec: { 규격: 'USB 2.0', 비고: '디바이스 측 · 프린터/산업장비' },
    gender: 'plug',
    pinCount: 4, pinLayout: row(['VBUS +5V','D-','D+','GND'], ['red','white','green','black']),
  },
  {
    id: 'lib-usb-a-30', category: 'housing', name: 'USB 3.x Type-A (9P)',
    spec: { 규격: 'USB 3.2 Gen1', 속도: '5Gbps', 비고: '5~9번이 SuperSpeed 추가핀' },
    gender: 'plug',
    pinCount: 9,
    pinLayout: row(
      ['VBUS +5V','D-','D+','GND','SSRX-','SSRX+','GND_DRAIN','SSTX-','SSTX+'],
      ['red','white','green','black','blue','yellow','black','purple','orange'],
    ),
  },
  {
    id: 'lib-usb-b-30', category: 'housing', name: 'USB 3.x Type-B (9P)',
    spec: { 규격: 'USB 3.2 Gen1', 비고: 'USB2.0 플러그 하위호환' },
    gender: 'plug',
    pinCount: 9,
    pinLayout: row(
      ['VBUS +5V','D-','D+','GND','SSRX-','SSRX+','GND_DRAIN','SSTX-','SSTX+'],
      ['red','white','green','black','blue','yellow','black','purple','orange'],
    ),
  },
  {
    id: 'lib-usb-mini-b', category: 'housing', name: 'USB Mini-B (5P)',
    spec: { 규격: 'USB 2.0', 비고: 'ID핀 OTG 판별 · 구형 장비' },
    gender: 'plug',
    pinCount: 5, pinLayout: row(['VBUS +5V','D-','D+','ID','GND'], ['red','white','green','','black']),
  },
  {
    id: 'lib-usb-micro-b', category: 'housing', name: 'USB Micro-B (5P)',
    spec: { 규격: 'USB 2.0', 비고: '비OTG 케이블은 ID(4번) 미결선' },
    gender: 'plug',
    pinCount: 5, pinLayout: row(['VBUS +5V','D-','D+','ID','GND'], ['red','white','green','','black']),
  },
  {
    id: 'lib-usb-c', category: 'housing', name: 'USB Type-C (24P)',
    spec: { 규격: 'USB Type-C', 비고: '리버서블 24핀(2열 대칭) · CC핀 PD/Alt 협상', 주의: '충전전용은 일부 핀만 결선' },
    // 리버서블이지만 케이블 끝단은 플러그다(보드측은 아래 리셉터클 항목).
    gender: 'plug',
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
    gender: 'header',
    pinCount: 24, pinLayout: grid(12, 2),
  },

  // ===== 범용 하우징 =====
  // JST XH·PH 의 `하우징`(XHP-nn / PHR-n)은 암 컨택을 담는 전선측 하우징이고,
  // 보드측 상대물은 별도 헤더(B nB-XH-A 등)다 — 그래서 receptacle.
  { id: 'lib-xh-2p', category: 'housing', name: 'JST XH 2.5 2P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, gender: 'receptacle', pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-xh-4p', category: 'housing', name: 'JST XH 2.5 4P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, gender: 'receptacle', pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-xh-6p', category: 'housing', name: 'JST XH 2.5 6P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A' }, gender: 'receptacle', pinCount: 6, pinLayout: grid(6, 1) },
  { id: 'lib-ph-4p', category: 'housing', name: 'JST PH 2.0 4P', manufacturer: 'JST',
    spec: { 피치: '2.0mm', 정격: '2A' }, gender: 'receptacle', pinCount: 4, pinLayout: grid(4, 1) },
  // 아래 둘은 시리즈가 특정되지 않아 암수를 단정할 수 없다(Mini-Fit 은 5557 암 /
  // 5559 수가 같은 4.2mm 다). 미지정으로 두고 쓰는 사람이 채우게 한다.
  { id: 'lib-minifit-4p', category: 'housing', name: 'Molex Mini-Fit Jr 4P', manufacturer: 'Molex',
    spec: { 피치: '4.2mm', 정격: '9A', 비고: '전원 배선용 · 암수는 시리즈(5557/5559) 확인 필요' },
    pinCount: 4, pinLayout: grid(2, 2) },
  // 2.54mm 2×5 — 시리즈도 품번도 없는 범용 항목이다. 아래 Micro-Fit 3.0 의
  // 10회로(43025-1000)도 2×5 격자라 목록에서 헷갈리기 쉬워 피치를 비고에도 적는다.
  { id: 'lib-molex-2x5', category: 'housing', name: 'Molex 2x5 (10P)', manufacturer: 'Molex',
    spec: { 피치: '2.54mm', 비고: '시리즈 미상 · 2.54mm — 3.00mm Micro-Fit 3.0(43025-1000)과 다른 부품' },
    pinCount: 10, pinLayout: grid(5, 2) },

  // ===== Molex SPOX 2.50mm (35155 / 35312) =====
  ...MOLEX_SPOX,

  // ===== Molex Micro-Fit 3.0 (43025 / 43020 / 43030 / 43031) =====
  ...MICROFIT30,
  ...MICROFIT30_TERMINALS,

  // ===== 보드투와이어 / 스플라이스 =====
  { id: 'lib-b2w-2p', category: 'board-to-wire', name: 'Board-to-Wire 2P',
    spec: { 실장: 'THT' }, gender: 'header', pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-b2w-4p', category: 'board-to-wire', name: 'Board-to-Wire 4P',
    spec: { 실장: 'THT' }, gender: 'header', pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-terminal-block-2p', category: 'board-to-wire', name: '터미널블럭 2P',
    spec: { 결선: '나사식', 비고: '전원 인입용' }, gender: 'neutral', pinCount: 2, pinLayout: grid(2, 1) },
  // ===== 와이어투와이어 (중간 결선/연장) =====
  // 암수 한 쌍을 함께 사는 품목이라 항목 자체에는 성별이 없다.
  { id: 'lib-w2w-2p', category: 'housing', name: '와이어투와이어 2P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    gender: 'neutral', pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-w2w-4p', category: 'housing', name: '와이어투와이어 4P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    gender: 'neutral', pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-w2w-6p', category: 'housing', name: '와이어투와이어 6P (중간결선)',
    spec: { 용도: '선 대 선 연결/연장', 비고: '암수 한 쌍으로 사용' },
    gender: 'neutral', pinCount: 6, pinLayout: grid(6, 1) },

  { id: 'lib-splice-3', category: 'splice', name: '스플라이스 3 (꼬임)',
    gender: 'neutral', pinCount: 3, pinLayout: grid(3, 1) },
  { id: 'lib-splice-4', category: 'splice', name: '스플라이스 4 (꼬임)',
    gender: 'neutral', pinCount: 4, pinLayout: grid(4, 1) },

  // ===== 연호전자 =====
  ...yeonhoHousings(),
  ...yeonhoWafers(),
  ...yeonhoPlugs(),
  ...YEONHO_TERMINALS,
];

const kindOf = (cat: PartLibraryItem['category']): ConnectorKind =>
  cat === 'splice' ? 'splice' : cat === 'board-to-wire' ? 'board-to-wire' : 'connector';

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/**
 * 라이브러리 항목 → 캔버스에 놓을 Connector 인스턴스.
 *
 * 핀 수는 **그릴 수 있는 배치(pinLayout)** 를 우선한다. pinCount 와 pinLayout 이
 * 어긋난 부품(손으로 고친 JSON, 깨진 가져오기)에서 pinCount 를 믿으면 하우징
 * 박스에 자리가 없는 핀이 생겨 패드가 박스 밖에 떠 버린다 — 도면이 조용히 틀어진다.
 * 배치는 index 순으로 정렬해서 쓴다(파일 안 순서를 믿지 않는다).
 */
export function instantiate(item: PartLibraryItem, at: Vec2): Connector {
  const slots = layoutCells(item.pinLayout)?.slice().sort((a, b) => a.index - b.index);
  const n = slots?.length ?? item.pinCount ?? 2;
  const pins = Array.from({ length: n }, (_, i) => ({
    id: uid('pin'),
    index: slots?.[i]?.index ?? i + 1,
    label: slots?.[i]?.label,
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
