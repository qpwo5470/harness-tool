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
 * - JST XH(2.50mm) · PH(2.00mm): JST 공식 데이터시트 **eXH.pdf / ePH.pdf** 에서 직접 확인.
 *   XH  하우징 XHP-n ↔ 헤더 BnB-XH-A(수직) / SnB-XH-A(앵글), 컨택트 SXH-001T-P0.6 계열.
 *   PH  하우징 PHR-n ↔ 헤더 BnB-PH-K-S(수직) / SnB-PH-K-S(앵글), 컨택트 SPH-002T-P0.5S 계열.
 * - Molex Mini-Fit Jr 5557(리셉터클 하우징, 2열): 판매도면 **SD-5557-003**.
 *   **39-01-2060 과 5557-06R 은 같은 물건**이다 (도면 주문표의 EDP No. ↔ ENG No.).
 *   짝: 5557 리셉터클 + 5556 암 터미널 / 5559 플러그 + 5558 수 터미널,
 *   보드측은 5566(수직 헤더)·5569(앵글 헤더).
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

/* ================================================================
   Molex SPOX 2.50mm — 35155 하우징(암) ↔ 35312 수직 헤더
   ----------------------------------------------------------------
   출처: Molex 제품 데이터시트 + **품번 단위 실재 확인**(2026-08).
    - molex.com 품번 상세 `part-detail/03515503 00` … 형식으로 회로 수·열 수를 하나씩 읽었다.
    - molex.com 에 스펙이 안 뜨는 단종 품번은 Mouser 제품 페이지로 교차 확인했다.

   ── molex.com 만 믿으면 안 되는 이유 (조사 중 확인한 함정)
   molex.com 은 **없는 품번에도 "Part Number Found" 를 표시**한다. 실재 판정은
   Physical Specifications 블록이 뜨는지로 해야 한다. 그런데 그 기준마저 단종품에는
   거짓 음성을 낸다 — 35155-1400/-1500 은 molex.com 에 스펙이 없지만 Mouser 에
   "14 Position / 15 Position, 2.5mm, 1 Row, Receptacle Housing, Obsolete" 로
   버젓이 실려 있다. 그래서 **molex.com 부재 → 유통사 교차 확인**의 두 단계를 밟았다.

   **검증된 품번만 넣는다.** 규칙(35155-0N00 / 35312-0N60)으로 없는 회로 수를 만들어
   넣으면 존재하지 않는 품번을 발주하게 된다.
   ================================================================ */

/**
 * 35155 회로 수 — molex.com 스펙으로 확인한 3~12 + Mouser 스펙으로 확인한 14·15.
 *
 * **13 을 뺀 이유**: 35155-1300 은 Octopart 에 별칭만 잡히고(재고 0) 회로 수를 적은
 * 스펙 페이지를 어디서도 찾지 못했다. 12 와 14 사이라고 13 을 채워 넣으면 그게 바로
 * 규칙으로 품번을 지어내는 일이다.
 */
const SPOX_35155_CIRCUITS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];

/** 35312 회로 수 — molex.com 스펙으로 2~12, Octopart/Newark 재고로 13("HDR 13 POS 2.5mm") */
const SPOX_35312_CIRCUITS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/** 두 자리 0 채움 — 품번은 35155-0300 이지 35155-300 이 아니다 */
const pad2 = (n: number) => String(n).padStart(2, '0');

const MOLEX_SPOX: PartLibraryItem[] = [
  ...SPOX_35155_CIRCUITS.map((n) => ({
    id: `lib-spox-35155-${n}p`,
    category: 'housing' as const,
    name: `Molex 35155-${pad2(n)}00 SPOX 2.50mm (${n}P)`,
    manufacturer: 'Molex',
    mpn: `35155-${pad2(n)}00`,
    spec: {
      시리즈: '35155',
      설명: '2.50mm Pitch Wire-to-Board Housing, Positive Lock, Natural',
      종류: 'Receptacle',
      피치: '2.50mm',
      열: '1열 (Number of Rows 1)',
      회로: String(n),
      용도: 'Wire-to-Wire',
      결합: '35184 (Wire-to-Wire Plug Housings) / 35312 (Vertical Headers)',
      터미널: '5103 (SPOX Female Crimp Terminals)',
      재질: 'Polyester · UL94V-0',
      온도: '-40°C ~ +105°C',
      상태: 'Not Recommended For New Design',
      비고:
        'Not Recommended For New Design — 신규 설계 전 대체품 확인. ' +
        '품번 규칙 35155-0N00 (N=회로수). 회로 수를 품번 단위로 확인한 ' +
        '3~12 · 14 · 15 만 등록했다. **13회로(35155-1300)는 확인하지 못했다** — ' +
        'Octopart 에 별칭만 잡히고 회로 수를 적은 스펙 페이지가 없어 뺐다. ' +
        '필요하면 유통사에서 회로 수를 확인한 뒤 핀맵 에디터에서 복제해 쓰세요.',
    },
    gender: 'receptacle' as const,
    pinCount: n,
    pinLayout: grid(n, 1),
  })),
  ...SPOX_35312_CIRCUITS.map((n) => ({
    id: `lib-spox-35312-${n}p`,
    category: 'board-to-wire' as const,
    name: `Molex 35312-${pad2(n)}60 2.50mm 수직 헤더 (${n}P)`,
    manufacturer: 'Molex',
    mpn: `35312-${pad2(n)}60`,
    spec: {
      시리즈: '35312',
      설명: '2.50mm Pitch Header, Vertical, Shrouded, with Positive Lock',
      종류: 'PCB Header',
      피치: '2.50mm',
      열: '1열 (Number of Rows 1)',
      회로: String(n),
      용도: 'Wire-to-Board',
      결합: '35155',
      정격: '3.0A / 250V',
      재질: 'PA Nylon 66 Glass-filled · 도금 Tin',
      실장: 'Through Hole · Vertical · Partially Shrouded · PCB 1.60mm',
      온도: '-40°C ~ +105°C',
      상태: 'Not Recommended For New Design',
      비고:
        'Not Recommended For New Design — 신규 설계 전 대체품 확인. ' +
        '품번 규칙 35312-0N60 (N=회로수). 회로 수를 품번 단위로 확인한 2~13 만 등록했다. ' +
        '**14회로는 어디서도 확인하지 못했고, 15회로(35312-1560)는 부품 검색 사이트에 ' +
        '이름만 있어 회로 수를 확인하지 못해 뺐다.** ' +
        '또 molex.com 스펙에 Gender 항목 자체가 없어 암수는 페이지로 확인하지 못했다 — ' +
        '35155(리셉터클)의 상대물이고 유통사 설명이 "Shrouded Header" 라 헤더로 넣었다.',
    },
    gender: 'header' as const,
    pinCount: n,
    pinLayout: grid(n, 1),
  })),
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

/* ================================================================
   JST XH (2.50mm) · PH (2.00mm)
   ----------------------------------------------------------------
   출처: JST 공식 데이터시트 **eXH.pdf** / **ePH.pdf** (jst-mfg.com).
   회로 수는 데이터시트의 품번표를 **한 행씩** 옮겼다. 규칙으로 늘리지 않았다.

   ── 하우징이 1열이라는 근거
   데이터시트 치수표의 A 가 곧 양끝 회로 중심거리다. XHP-3 A=5.0 = 2×2.5,
   XHP-16 A=37.5 = 15×2.5, PHR-2 A=2.0, PHR-16 A=30.0 = 15×2.0 —
   A = (회로수−1)×피치 가 정확히 맞는다. 2열이면 이 식이 성립하지 않는다.

   ── 낱개로 있던 lib-xh-* · lib-ph-* 를 왜 안 지웠나
   저장 문서는 `usedParts` 스냅샷으로 열리므로 지워도 도면은 안 깨진다. 하지만
   (1) 라이브러리 목록에서 사라져 **다시 배치할 수 없고**,
   (2) 실제 저장 파일(이스턴웰스-하네스세트)이 `lib-xh-2p` 를 물고 있으며,
   (3) 옛 id 커넥터와 새 id 커넥터가 BOM 에서 **별개 품목으로 이중 계상**된다.
   그래서 남겨 두고 비고에만 "시리즈 항목으로 옮겨 가라"고 적었다.
   ================================================================ */

/** XH 하우징 XHP-n — eXH.pdf 하우징 품번표 (1~16, 20). 특수 피치품은 뺐다. */
const XH_HOUSING_CIRCUITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20];
/** XH 수직 헤더 BnB-XH-A — 보스 없는 형. 1회로는 표에 "-" 라 없다(보스형 B1B-XH-AM 뿐). */
const XH_HEADER_TOP_CIRCUITS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20];
/** XH 앵글 헤더 SnB-XH-A — C 치수 9.2mm 형. 표에 20회로는 없다. */
const XH_HEADER_SIDE_CIRCUITS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
/** PH 하우징·헤더 모두 2~16 (ePH.pdf 세 표가 모두 같은 범위) */
const PH_CIRCUITS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/** eXH.pdf 1쪽 Specifications — 전기·환경 값은 시리즈 공통이다 */
const XH_COMMON = {
  피치: '2.50mm',
  정격: '3A AC/DC (AWG #22) · 250V AC/DC',
  온도: '-25℃ ~ +85℃ (통전 온도상승 포함)',
  접촉저항: '초기 10mΩ max. · 환경시험 후 20mΩ max.',
  절연저항: '1,000MΩ min.',
  내전압: 'AC 1,000V 1분',
  적용전선: 'AWG #30 ~ #22 (피복 외경 φ0.9 ~ φ1.9mm)',
} as const;

/** ePH.pdf 1쪽 Specifications */
const PH_COMMON = {
  피치: '2.00mm',
  정격: '2A AC/DC (AWG #24) · 100V AC/DC',
  온도: '-40℃ ~ +105℃ (통전 온도상승 포함)',
  접촉저항: '초기 10mΩ max. · 시험 후 20mΩ max.',
  절연저항: '1,000MΩ min.',
  내전압: 'AC 800V 1분',
  적용전선: 'AWG #32 ~ #24 (피복 외경 φ0.5 ~ φ1.5mm)',
} as const;

/**
 * 하우징 색상은 품번 뒤에 접미사로 붙는다(XHP-5-BK 등). 기본(무표기)은 natural white 다.
 * 자연색 기준 품번만 넣고, 색상 지정이 필요하면 데이터시트 색상표를 보라고 적는다 —
 * 색 코드를 외워서 붙이면 없는 조합을 발주하게 된다.
 */
const JST_COLOR_NOTE =
  '색상 지정은 품번 뒤 접미사다(예: XHP-5-BK 흑색). 기본(무표기)은 natural white — ' +
  '색상 코드는 데이터시트 "Model number allocation" 을 확인할 것.';

type JstSeries = {
  시리즈: 'XH' | 'PH';
  /** id 접두사 조각 */
  slug: string;
  /** 품번을 만드는 함수 — 회로 수가 품번 어디에 들어가는지가 시리즈마다 다르다 */
  mpn: (n: number) => string;
  표시: string;
  category: PartLibraryItem['category'];
  종류: string;
  gender: PartGender;
  공통: Record<string, string>;
  결합: string;
  터미널: string;
  출처: string;
  circuits: number[];
  비고: string;
};

function jstItems(s: JstSeries): PartLibraryItem[] {
  return s.circuits.map((n) => ({
    id: `lib-jst-${s.slug}-${n}p`,
    category: s.category,
    name: `JST ${s.mpn(n)} ${s.표시} (${n}P)`,
    manufacturer: 'JST',
    mpn: s.mpn(n),
    spec: {
      시리즈: s.시리즈,
      종류: s.종류,
      ...s.공통,
      열: '1열 (치수 A = (회로수−1)×피치 로 검산)',
      회로: String(n),
      결합: s.결합,
      터미널: s.터미널,
      출처: s.출처,
      비고: s.비고,
    },
    gender: s.gender,
    pinCount: n,
    pinLayout: grid(n, 1),
  }));
}

const JST_XH: PartLibraryItem[] = [
  ...jstItems({
    시리즈: 'XH',
    circuits: XH_HOUSING_CIRCUITS,
    slug: 'xhp',
    mpn: (n) => `XHP-${n}`,
    표시: 'XH 하우징',
    category: 'housing',
    종류: 'Housing (전선측, 암 컨택) · PA 6, natural(white)',
    gender: 'receptacle',
    공통: { ...XH_COMMON },
    결합: 'BnB-XH-A (수직 헤더) / SnB-XH-A (앵글 헤더)',
    터미널: 'SXH-001T-P0.6 (AWG#28~22) · SXH-002T-P0.6 (AWG#30~26)',
    출처: 'JST eXH.pdf — Housing 품번표',
    비고:
      `${JST_COLOR_NOTE} 데이터시트 표의 1~16 · 20회로만 등록했다. ` +
      '특수 피치품 XHP-2(10.0)-U · XHP-6(5.0)-U 는 피치가 달라 뺐다. ' +
      '**금도금품은 데이터시트가 "Contact JST" 라고만 적어 품번을 확인하지 못했다.**',
  }),
  ...jstItems({
    시리즈: 'XH',
    circuits: XH_HEADER_TOP_CIRCUITS,
    slug: 'b-xh-a',
    mpn: (n) => `B${n}B-XH-A`,
    표시: 'XH 수직 헤더',
    category: 'board-to-wire',
    종류: 'Header, Top entry(수직) · Post 황동 주석도금 / Wafer PA 66',
    gender: 'header',
    공통: { ...XH_COMMON, 적용기판: '기판 두께 1.6mm' },
    결합: 'XHP-n 하우징',
    터미널: '상대 하우징에 SXH-001T-P0.6 계열',
    출처: 'JST eXH.pdf — Header/Top entry 품번표',
    비고:
      '보스 없는 형만 등록했다. 보스형(BnB-XH-AM)은 데이터시트에 일부 회로 수만 있어 뺐다. ' +
      '**1회로 수직 헤더는 보스 없는 형이 존재하지 않는다** — 표에 B1B-XH-A 자리가 "-" 이고 ' +
      'B1B-XH-AM(보스형)만 있다. PA66 글라스품(BnB-XH-2)·SMT(SnB-XH-SM4-TB)·래디얼테이프품은 ' +
      '별도 품번이라 넣지 않았다.',
  }),
  ...jstItems({
    시리즈: 'XH',
    circuits: XH_HEADER_SIDE_CIRCUITS,
    slug: 's-xh-a',
    mpn: (n) => `S${n}B-XH-A`,
    표시: 'XH 앵글 헤더',
    category: 'board-to-wire',
    종류: 'Header, Side entry(앵글) · Post 황동 주석도금 / Wafer PA 66',
    gender: 'header',
    공통: { ...XH_COMMON, 적용기판: '기판 두께 1.6mm' },
    결합: 'XHP-n 하우징',
    터미널: '상대 하우징에 SXH-001T-P0.6 계열',
    출처: 'JST eXH.pdf — Header/Side entry 품번표',
    비고:
      'C 치수 9.2mm 형만 등록했다. C=7.6mm 형은 품번이 아예 다르다(SnB-XH-A-1) — ' +
      '16회로에는 그 형이 없어 시리즈로 넣지 않았다. 앵글 헤더 표에 20회로는 없다.',
  }),
];

const JST_PH: PartLibraryItem[] = [
  ...jstItems({
    시리즈: 'PH',
    circuits: PH_CIRCUITS,
    slug: 'phr',
    mpn: (n) => `PHR-${n}`,
    표시: 'PH 하우징',
    category: 'housing',
    종류: 'Housing (전선측, 암 컨택) · PA, natural(white)',
    gender: 'receptacle',
    공통: { ...PH_COMMON },
    결합: 'BnB-PH-K-S (수직 헤더) / SnB-PH-K-S (앵글 헤더)',
    터미널: 'SPH-002T-P0.5S (AWG#30~24) · SPH-004T-P0.5S (AWG#32~28)',
    출처: 'JST ePH.pdf — Housing 품번표',
    비고: `${JST_COLOR_NOTE} 데이터시트 표의 2~16회로를 그대로 등록했다.`,
  }),
  ...jstItems({
    시리즈: 'PH',
    circuits: PH_CIRCUITS,
    slug: 'b-ph-k-s',
    mpn: (n) => `B${n}B-PH-K-S`,
    표시: 'PH 수직 헤더',
    category: 'board-to-wire',
    종류: 'Header, Through-hole/Top entry(수직) · Post 동합금 주석도금 / PA',
    gender: 'header',
    공통: { ...PH_COMMON, 적용기판: '기판 두께 0.8 ~ 1.6mm' },
    결합: 'PHR-n 하우징',
    터미널: '상대 하우징에 SPH-002T-P0.5S 계열',
    출처: 'JST ePH.pdf — Header(Through-hole type) 품번표',
    비고: 'SMT 형(BnB-PH-SM4-TB)은 별도 품번이라 넣지 않았다.',
  }),
  ...jstItems({
    시리즈: 'PH',
    circuits: PH_CIRCUITS,
    slug: 's-ph-k-s',
    mpn: (n) => `S${n}B-PH-K-S`,
    표시: 'PH 앵글 헤더',
    category: 'board-to-wire',
    종류: 'Header, Through-hole/Side entry(앵글) · Post 동합금 주석도금 / PA',
    gender: 'header',
    공통: { ...PH_COMMON, 적용기판: '기판 두께 0.8 ~ 1.6mm' },
    결합: 'PHR-n 하우징',
    터미널: '상대 하우징에 SPH-002T-P0.5S 계열',
    출처: 'JST ePH.pdf — Header(Through-hole type) 품번표',
    비고: 'SMT 형(SnB-PH-SM4-TB)은 별도 품번이라 넣지 않았다.',
  }),
];

/**
 * JST 크림프 컨택트.
 *
 * PH 쪽에 함정이 있다: 흔히 "SPH-002T-P0.5" 라고 부르지만 데이터시트 표에 그런 품번은
 * **없다**. 표준형은 접미사 S 가 붙은 `SPH-002T-P0.5S` 이고, `-P0.5L` 은 저삽입력형이라
 * 압착 높이가 다르다. 접미사를 떼고 발주하면 물건이 안 온다.
 */
const JST_CONTACTS: PartLibraryItem[] = [
  {
    id: 'lib-jst-sxh-001t', category: 'terminal', name: 'JST SXH-001T-P0.6 컨택트 (XH용)',
    manufacturer: 'JST', mpn: 'SXH-001T-P0.6',
    spec: {
      적용: 'XH (2.50mm) — XHP-n 하우징',
      적용전선: 'AWG #28 ~ #22 (0.08~0.33mm²) · 피복 외경 0.9~1.9mm',
      재질: '인청동, 주석도금 · Strip form',
      압착기: 'AP-K2N + APLMK SXH001-06',
      출처: 'JST eXH.pdf — Contact 품번표',
      비고: '표준형. 저삽입력형은 접미사 N 이 붙은 SXH-001T-P0.6N 으로 진동에 약하다.',
    },
    gender: 'neutral',
  },
  {
    id: 'lib-jst-sxh-002t', category: 'terminal', name: 'JST SXH-002T-P0.6 컨택트 (XH용, 세선)',
    manufacturer: 'JST', mpn: 'SXH-002T-P0.6',
    spec: {
      적용: 'XH (2.50mm) — XHP-n 하우징',
      적용전선: 'AWG #30 ~ #26 (0.05~0.13mm²) · 피복 외경 0.9~1.3mm',
      재질: '인청동, 주석도금 · Strip form',
      압착기: 'AP-K2N + APLMK SXH002-06',
      출처: 'JST eXH.pdf — Contact 품번표',
      비고: '세선용. 굵은 선(AWG#22)에는 SXH-001T-P0.6 을 쓴다.',
    },
    gender: 'neutral',
  },
  {
    id: 'lib-jst-sph-002t', category: 'terminal', name: 'JST SPH-002T-P0.5S 컨택트 (PH용)',
    manufacturer: 'JST', mpn: 'SPH-002T-P0.5S',
    spec: {
      적용: 'PH (2.00mm) — PHR-n 하우징',
      적용전선: 'AWG #30 ~ #24 (0.05~0.22mm²) · 피복 외경 0.8~1.5mm',
      재질: '동합금, 주석도금 · Strip form',
      압착기: 'MKS-L + APLMK SPH002-05S',
      출처: 'JST ePH.pdf — Contact 품번표',
      비고:
        '**접미사 S(표준형)까지가 품번이다.** 데이터시트 표에 "SPH-002T-P0.5"(접미사 없는 형)는 ' +
        '없다 — 그 이름으로 발주하면 안 된다. 저삽입력형 SPH-002T-P0.5L 은 압착 높이가 달라 ' +
        '같은 다이로 찍을 수 없다.',
    },
    gender: 'neutral',
  },
  {
    id: 'lib-jst-sph-004t', category: 'terminal', name: 'JST SPH-004T-P0.5S 컨택트 (PH용, 세선)',
    manufacturer: 'JST', mpn: 'SPH-004T-P0.5S',
    spec: {
      적용: 'PH (2.00mm) — PHR-n 하우징',
      적용전선: 'AWG #32 ~ #28 (0.032~0.08mm²) · 피복 외경 0.5~0.9mm',
      재질: '동합금, 주석도금 · Strip form',
      압착기: 'AP-K2N + APLMK SPH004-05S',
      출처: 'JST ePH.pdf — Contact 품번표',
      비고: '세선용. AWG#24 까지 쓰려면 SPH-002T-P0.5S.',
    },
    gender: 'neutral',
  },
];

/* ================================================================
   Molex Mini-Fit Jr 5557 — 리셉터클 하우징 (2열, 4.20mm)
   ----------------------------------------------------------------
   출처: Molex 판매도면 **SD-5557-003** (rev K1)
        "MINIFIT JR / RECEPTACLE HOUSING DUAL ROW 2-24 CKT"
        + 제품 사양서 **PS-5556-001** (Mini-Fit Jr. Connector System)

   ── 사용자가 물었던 것: "39-01-2060 이 5557 이랑 같은 거냐"
   **같다.** SD-5557-003 주문표는 한 행에 EDP No. 와 ENG No. 를 나란히 적는다:
        39-01-2060 | 5557-06R | 6
   즉 39-01-2060(Molex 발주번호)과 5557-06R(엔지니어링 번호)은 **같은 물건의 두 이름**이다.
   Newark 도 같은 페이지에 "Mini-Fit Jr. 5557 Series" 와 "Also Known As 5557-06R" 을 적는다.
   이 대응을 각 부품 `spec.대응품번` 에 박아 둔다 — 다음 사람이 같은 질문을 안 하도록.

   ── 왜 5559(플러그) 를 규칙으로 늘리지 않았나
   39-01-2041 을 열어 봤더니 5557 이 아니라 **5559 플러그**(패널 마운팅 이어 달린 4회로)였다.
   즉 39-01-2xxx 대역은 5557 전용이 아니다. 5557 도면의 번호 규칙을 5559 에 옮겨 쓰면
   엉뚱한 물건을 발주하게 된다. 5559 하우징은 그 도면을 본 뒤에 넣는다.
   ================================================================ */

/**
 * SD-5557-003 주문표가 싣고 있는 회로 수 — **짝수 12종**.
 *
 * 홀수 2열 제품은 도면에 하나도 없다(다만 "홀수는 없다"고 쓰인 문장이 있는 것은 아니다).
 * 39-01-2030 · -2260 · -2280 은 도면 표에도 없고 molex.com 스펙도 안 뜬다.
 */
const MINIFIT_5557_CIRCUITS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

/**
 * **확인하지 못한 것 — 2열 중 어느 행이 1..n/2 인가.**
 * Micro-Fit 3.0 과 같은 사정이다. 회로 수·열 수·피치는 도면과 품번 상세로 확인했지만
 * 회로 번호가 어느 행에서 시작하는지는 도면 그림 안에 있어 글자로 뽑아내지 못했다.
 */
const MINIFIT_PIN_NOTE =
  '회로 번호 배열은 하우징의 회로1 표시로 확인할 것 — ' +
  '2열 중 어느 행이 1..n/2 인지는 판매도면 그림 안에 있어 확인하지 못했고, ' +
  'Molex 2열 커넥터의 통상 규칙(윗줄 1..n/2 · 아랫줄 n/2+1..n)으로 깔아 두었다. ' +
  '다르면 라이브러리의 핀맵 에디터에서 고쳐 쓰세요.';

const MINIFIT_5557: PartLibraryItem[] = MINIFIT_5557_CIRCUITS.map((n) => {
  const nn = pad2(n);
  return {
    id: `lib-minifit-5557-${nn}p`,
    category: 'housing' as const,
    name: `Molex 39-01-2${nn}0 Mini-Fit Jr 5557 리셉터클 (${n}회로)`,
    manufacturer: 'Molex',
    mpn: `39-01-2${nn}0`,
    spec: {
      시리즈: 'Mini-Fit Jr 5557',
      // 사용자가 실제로 물었던 질문의 답. 이름·비고가 아니라 전용 칸에 둬서 눈에 띄게 한다.
      대응품번: `39-01-2${nn}0 = 5557-${nn}R (EDP No. = ENG No., 같은 물건)`,
      종류: 'Receptacle Housing, Dual Row (전선측, 암 컨택)',
      피치: '4.20mm',
      열: `2열 (2행 × ${n / 2}열)`,
      회로: String(n),
      결합: '5559 (플러그 하우징) · 5566 (수직 헤더) · 5569 (앵글 헤더, 39-30-10xx)',
      터미널: '5556 (암 크림프 터미널) — 45750/46083 계열도 들어간다',
      정격: '9.0A max (16AWG) / 600V AC(RMS)·DC max',
      적용전선: 'AWG #16 ~ #28',
      온도: '-40°C ~ +105°C (Solid Brass·인청동 터미널) · Formed Brass 는 -40 ~ +80°C',
      출처: 'Molex 판매도면 SD-5557-003 · 제품사양서 PS-5556-001',
      비고:
        `${MINIFIT_PIN_NOTE} ` +
        '도면 주문표에 실린 짝수 12종(2~24)만 등록했다 — 홀수 2열 제품은 도면에 없다. ' +
        '품번 끝자리 0 은 UL94V-2 자연색이고, 끝자리 5 는 같은 회로 수의 UL94V-0 판이다' +
        '(39-01-2045 = 5557-04R-210). ' +
        '**정격 9.0A 는 16AWG 최대치다** — PS-5556-001 표는 회로 수가 늘수록 낮아진다' +
        '(4~6회로 8A · 7~10회로 7A · 12~24회로 6A). 회로 수에 맞는 값은 사양서를 볼 것.',
    },
    gender: 'receptacle' as const,
    pinCount: n,
    pinLayout: grid(n / 2, 2),
  };
});

/**
 * Mini-Fit Jr 크림프 터미널 — 하우징과 암수가 뒤집혀 있다.
 * 리셉터클(5557)에 **암**(5556), 플러그(5559)에 **수**(5558).
 * Micro-Fit 3.0 에서 겪은 것과 같은 함정이라 여기에도 적어 둔다.
 *
 * 끝자리(5556-xxxx / 39-00-00xx)는 도금·포장을 물어서 확인하지 못했다 —
 * 43030/43031 과 같이 시리즈 번호만 적는다.
 */
const MINIFIT_TERMINALS: PartLibraryItem[] = [
  {
    id: 'lib-minifit-5556', category: 'terminal', name: 'Molex 5556 Mini-Fit Jr 크림프 터미널 (암)',
    manufacturer: 'Molex', mpn: '5556',
    spec: {
      적용: '5557 Mini-Fit Jr 리셉터클 하우징 (4.20mm)',
      적용전선: 'AWG #16 ~ #28',
      출처: 'SD-5557-003 주6 "USED WITH MOLEX FEMALE TERMINAL #5556, #45750"',
      비고:
        '암 컨택 — 플러그 하우징(5559)에는 5558(수)을 쓴다. ' +
        '도금·포장을 가르는 끝자리(5556-xxxx / EDP 39-00-00xx)는 확인하지 못했으니 발주 전에 확인할 것. ' +
        '기존 lib-minifit-terminal(39-00-0207)이 이 계열의 한 품번이다.',
    },
    gender: 'neutral',
  },
  {
    id: 'lib-minifit-5558', category: 'terminal', name: 'Molex 5558 Mini-Fit Jr 크림프 터미널 (수)',
    manufacturer: 'Molex', mpn: '5558',
    spec: {
      적용: '5559 Mini-Fit Jr 플러그 하우징 (4.20mm)',
      적용전선: 'AWG #16 ~ #28',
      출처: 'Molex Mini-Fit Jr 카탈로그 — 5558 "Use With: 5559, 42475, 30068 plug housings"',
      비고:
        '수 컨택 — 리셉터클 하우징(5557)에는 5556(암)을 쓴다. ' +
        '5559 플러그 하우징은 품번표를 확인하지 못해 라이브러리에 넣지 않았다. ' +
        '끝자리는 도금·포장을 물어 확인하지 못했다.',
    },
    gender: 'neutral',
  },
];

export const SEED_PARTS: PartLibraryItem[] = [
  // ===== MDB =====
  {
    id: 'lib-mdb-vmc', category: 'housing', name: 'MDB VMC(마스터) 6P',
    manufacturer: 'Molex', mpn: '39-01-2060',
    spec: {
      시리즈: 'Mini-Fit Jr 5557', 피치: '4.2mm', 정격: '9A/600V', 통신: '9600bps 9bit TTL',
      // 사용자가 물었던 "39-01-2060 이 5557 이랑 같은 거냐" 의 답을 여기에도 박아 둔다.
      대응품번: '39-01-2060 = 5557-06R (EDP No. = ENG No., 같은 물건 — 판매도면 SD-5557-003)',
      비고:
        '자판기 본체(VMC) 측. 이 부품은 lib-minifit-5557-06p 와 같은 물건이다 — ' +
        'MDB 신호명·규격색이 붙어 있어 따로 둔다(품번 39-01-2060 은 같으니 BOM 은 어긋나지 않는다).',
    },
    // Mini-Fit Jr 5557 은 Molex 카탈로그상 Receptacle Housing(5556 암 크림프핀).
    gender: 'receptacle',
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-mdb-periph', category: 'housing', name: 'MDB 주변기기 6P',
    manufacturer: 'Molex', mpn: '39-30-1060',
    spec: {
      시리즈: 'Mini-Fit Jr 5569', 피치: '4.2mm', 정격: '13A/600V',
      대응품번: '39-30-1060 = 5569-06A2 (판매도면 55690002-SD)',
      종류: 'Right Angle Header, Dual Row (보드 실장, 수) · 스루홀 + 페그 마운트',
      결합: '5557 리셉터클 하우징 (도면 주5 "MATES WITH MINI-FIT JR. RECEPTACLE SERIES 5557")',
      출처: 'Molex 판매도면 55690002-SD · 제품사양서 PS-5556-001',
      비고:
        '지폐/코인/캐시리스 측. **5557(lib-mdb-vmc)의 짝이지 중복이 아니다** — ' +
        '이쪽은 기판에 앉는 앵글 헤더(수)이고, 케이블 쪽에 5557 하우징 + 5556 암 터미널이 붙는다. ' +
        '정격 13A 는 Mini-Fit Plus HCS 터미널(45750/46012) 기준이고, ' +
        '표준 5556 브라스 터미널이면 9.0A 가 상한이다.',
    },
    // 판매도면 55690002-SD 와 품번 상세(Gender: Male, Orientation: Right Angle)로 확정.
    // 예전 주석이 "전선측 소켓인지 보드 헤더인지 갈린다"고 비워 뒀던 자리다.
    gender: 'header',
    pinCount: 6, pinLayout: MDB_SIGNALS,
  },
  {
    id: 'lib-minifit-terminal', category: 'terminal', name: 'Mini-Fit Jr 크림프핀 18-24AWG',
    manufacturer: 'Molex', mpn: '39-00-0207',
    spec: {
      적용: 'MDB / Mini-Fit Jr', 발치공구: '11-03-0044',
      비고: '5556(암) 계열의 한 품번이다 — 시리즈 항목은 lib-minifit-5556 참조.',
    },
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
  // JST XH·PH 의 `하우징`(XHP-n / PHR-n)은 암 컨택을 담는 전선측 하우징이고,
  // 보드측 상대물은 별도 헤더(BnB-XH-A 등)다 — 그래서 receptacle.
  //
  // 아래 넷은 **품번 없는 옛 낱개 항목**이다. 데이터시트로 확인한 XHP-n / PHR-n
  // 시리즈(lib-jst-*)가 이것들을 대체하지만 지우지 않았다 — 지우면 이미 이 id 로
  // 저장된 도면을 다시 배치할 수 없고, 새 id 로 옮겨 그린 커넥터와 옛 id 커넥터가
  // BOM 에서 별개 품목으로 이중 계상된다. 비고로만 갈아탈 곳을 가리킨다.
  { id: 'lib-xh-2p', category: 'housing', name: 'JST XH 2.5 2P (구 항목)', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-2p (XHP-2)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-2 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-xh-4p', category: 'housing', name: 'JST XH 2.5 4P (구 항목)', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-4p (XHP-4)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-4 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-xh-6p', category: 'housing', name: 'JST XH 2.5 6P (구 항목)', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-6p (XHP-6)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-6 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 6, pinLayout: grid(6, 1) },
  { id: 'lib-ph-4p', category: 'housing', name: 'JST PH 2.0 4P (구 항목)', manufacturer: 'JST',
    spec: { 피치: '2.0mm', 정격: '2A', 대체: 'lib-jst-phr-4p (PHR-4)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 PHR-4 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 4, pinLayout: grid(4, 1) },
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

  // ===== Molex Mini-Fit Jr 5557 (39-01-2xx0) + 5556/5558 터미널 =====
  ...MINIFIT_5557,
  ...MINIFIT_TERMINALS,

  // ===== JST XH (2.50mm) / PH (2.00mm) =====
  ...JST_XH,
  ...JST_PH,
  ...JST_CONTACTS,

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
