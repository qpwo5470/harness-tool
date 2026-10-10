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

/* ================================================================
   실물 핀 배열(layout) + 뷰 기준(view) — 개선안 §2-8 / §6-2
   ----------------------------------------------------------------
   `pinLayout` 은 **이 툴이 도면에 그리는 좌표**이고, 아래 `layout` 은 **부품을
   손에 쥐었을 때 보이는 배열**이다. 다른 사실이라 필드가 다르다
   (types/index.ts 의 `PartLibraryItem.layout` 주석).

   ── 근거가 있는 것만 채운다
   개선안 §6-2 가 실제로 확인한 제조사 도면 4건은 **전부** `viewed from …`
   문구가 없었고, **Mini-Fit 과 Micro-Fit 의 번호 뷰는 서로 거울상**이었다.
   즉 "커넥터 번호는 대개 이렇더라" 라는 규칙이 성립하지 않는다. 근거 없이
   채우면 그 값이 그대로 오조립의 원인이 되므로, 근거가 없는 부품은 **비워
   둔다**. 비어 있는 것은 검증 패널이 알린다(store/validate.ts).

   ── 뷰 문구에 무엇을 적는가
   "어디까지가 도면에 인쇄된 값이고 어디부터가 연장한 값인지" 를 반드시 남긴다.
   그 구분이 없으면 실물 대조를 어디에 해야 하는지 아무도 모른다.
   ================================================================ */

/**
 * Mini-Fit Jr 5557 **6회로**.
 * 인쇄값: 10회로 예시의 번호뿐. 6회로 배열은 그 규칙을 연장한 값이다.
 */
const MINIFIT_6P_LAYOUT: (number | string | null)[][] = [
  [6, 5, 4],
  [3, 2, 1],
];
const MINIFIT_6P_VIEW =
  '각인 탭이 위로 오게 잡고 본 배열. ' +
  '**판매도면 SD-5557-003 에 뷰 기준(viewed from …) 문구가 없다.** ' +
  '도면이 번호를 인쇄한 것은 10회로 예시 하나뿐이다 — 아랫행 왼→오 5·4·3·2·1 / ' +
  '윗행 왼→오 10·9·(8)·7·6 (8번은 각인 탭에 가려 미인쇄). ' +
  '**6회로 배열은 도면에 없어 같은 규칙을 연장한 값이다 — 실물 대조 필요.** ' +
  'Micro-Fit(43025)의 번호 뷰와는 서로 거울상이므로 같은 면으로 가정하지 말 것.';

/**
 * Micro-Fit 3.0 43025 **10회로**.
 * 인쇄값: `CIRCUIT 1` · `CIRCUIT 2` · `LAST CIRCUIT` 세 점뿐. 3~10 은 연장한 값.
 */
const MICROFIT_10P_LAYOUT: (number | string | null)[][] = [
  [6, 7, 8, 9, 10],
  [1, 2, 3, 4, 5],
];
const MICROFIT_10P_VIEW =
  '**판매도면 430250000-SD 에 뷰 기준(viewed from …) 문구가 없다.** ' +
  '도면이 번호를 인쇄한 곳은 세 군데뿐이다 — `CIRCUIT 1`(아랫행 왼쪽 끝) · ' +
  '`CIRCUIT 2`(아랫행 왼쪽에서 둘째) · `LAST CIRCUIT`(윗행 오른쪽 끝). ' +
  '**3~10 은 그 세 점을 이어 연장한 값이다 — 실물 대조 필요.** ' +
  'Mini-Fit(5557)의 번호 뷰와는 서로 거울상이므로 같은 면으로 가정하지 말 것.';

/**
 * JST XH 하우징 XHP-n.
 * 인쇄값: `No. 1 circuit` 지시선(오른쪽 끝) 하나뿐. 나머지는 1열이라는 사실에서 연장.
 * 1열이라는 근거는 치수 A = (회로수−1)×피치 로 검산한 것이다(아래 시리즈 주석).
 */
const XH_VIEW =
  'JST eXH.pdf 4쪽 하우징 도면 기준. ' +
  '**뷰 기준(viewed from …) 문구가 없다.** ' +
  '도면이 인쇄한 번호는 `No. 1 circuit` 지시선(오른쪽 끝) 하나뿐이고, ' +
  '**나머지 번호는 1열이라는 사실(치수 A=(회로수−1)×피치로 검산)에서 연장한 값이다 — ' +
  '실물 대조 필요.**';
/* ── 제조사 원본 도면 캡처 (PDF 부록) ─────────────────────────────
 * 위 layout/view 의 근거가 된 그 도면을 캡처한 것이다(public/datasheets/).
 * **layout 을 준 부품에만** 붙인다 — 캡처가 근거인 부품이 그것뿐이다.
 * 문구는 이스턴웰스 하네스 세트 도면집(build.py DS_ITEMS)에서 옮겼다.
 * D-SUB 9F(db9f.png)는 아래 `DSUB9_F` 부품에 붙는다. */
type Datasheet = NonNullable<PartLibraryItem['datasheet']>;
const DS_XH: Datasheet = {
  src: 'datasheets/xh.png',
  source: 'JST eXH.pdf p.4 하우징 · 도면에 뷰 기준 표기 없음',
  note: '도면에 찍힌 것은 "No. 1 circuit" 지시선(오른쪽 끝) 하나뿐\n나머지 회로 번호는 도면 미표기',
};
const DS_MICROFIT_10P: Datasheet = {
  src: 'datasheets/mf10.png',
  source: 'Molex 430250000-SD rev A · 도면에 뷰 기준 표기 없음',
  note:
    '도면 표기는 CIRCUIT 1(아랫행 왼쪽 끝) · CIRCUIT 2(아랫행 둘째) · LAST CIRCUIT(윗행 오른쪽 끝) 뿐\n' +
    '3~10 은 이 규칙을 연장한 값 — 실물 대조 필요',
};
const DS_MINIFIT_6P: Datasheet = {
  src: 'datasheets/mfj6.png',
  source: 'Molex SD-5557-003 rev K1 · 도면에 뷰 기준 표기 없음',
  note:
    '번호 뷰는 10ckt 예시만 있음. 각인 탭 위 기준 아랫행 5·4·3·2·1 / 윗행 10·9·(8)·7·6\n' +
    '8은 각인 탭에 가려 도면에 미인쇄. 6ckt 배열은 도면에 없어 같은 규칙을 연장함 — 실물 대조 필요',
};

const DS_DSUB9_F: Datasheet = {
  src: 'datasheets/db9f.png',
  source: 'Amphenol CN-DSUB9SKT00-000 rev A1 · 도면에 뷰 기준 표기 없음',
  note:
    '원본 페이지가 눕혀 작도돼 있어 반시계 90° 회전함\n' +
    'D쉘 넓은쪽 위 기준 윗행 5·4·3·2·1 / 아랫행 9·8·7·6 — 1~9 전부 도면에서 판독',
};

/**
 * D-SUB 9P 암(소켓) — Amphenol 도면 **CN-DSUB9SKT00-000** rev A1.
 * 인쇄값: 1~9 **전부**. 연장한 값이 없다 — 다른 셋과 다른 점이다.
 * 남는 불확실성은 뷰 기준 문구가 없다는 것 하나다(넓은 쪽 위로 잡았을 때의 배열).
 * 빈 자리(null)는 아랫행이 4개라 넓은 윗행보다 반 칸 들어가 있음을 나타낸다.
 */
const DSUB9_F_LAYOUT: (number | string | null)[][] = [
  [5, 4, 3, 2, 1],
  [null, 9, 8, 7, 6],
];
const DSUB9_F_VIEW =
  'D쉘의 넓은 쪽이 위로 오게 잡고 본 배열. ' +
  'Amphenol 도면 CN-DSUB9SKT00-000 rev A1 기준(원본 페이지가 눕혀 작도돼 있어 반시계 90° 회전해 읽음). ' +
  '**도면에 뷰 기준(viewed from …) 문구가 없다.** ' +
  '번호는 1~9 전부 도면에 인쇄돼 있어 그대로 읽었다 — 연장한 값은 없다. ' +
  '윗행 왼→오 5·4·3·2·1 / 아랫행 왼→오 9·8·7·6. ' +
  '**결합면에서 본 것인지 반대면(전선측)에서 본 것인지는 도면이 말하지 않으므로 실물 대조 필요.**';

/** 오른쪽 끝이 1번이므로 왼→오 = n … 1 (1열) */
function xhLayout(n: number): (number | string | null)[][] {
  return [Array.from({ length: n }, (_, i) => n - i)];
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
      // 짧은 이름은 리셉터클(43025)에만 — 플러그(43020)에 같은 글자를 주면 도면에서 둘이 같아 보인다
      ...(s.series === '43025' ? { shortName: `Micro-Fit 3.0 ${n}P` } : {}),
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
      // 실물 배열은 **10회로 리셉터클만** 채운다 — 개선안 §6-2 가 근거를 남긴 것이
      // 그것뿐이다. 43020(플러그)은 결합하면 좌우가 뒤집히는데 그 뷰를 확인하지
      // 못했고, 다른 회로 수도 도면에 번호가 없다. 규칙으로 늘리지 않는다.
      ...(s.series === '43025' && n === 10
        ? { layout: MICROFIT_10P_LAYOUT, view: MICROFIT_10P_VIEW, viewBrief: '430250000-SD · 래치 위 · 뷰 표기 없음', datasheet: DS_MICROFIT_10P }
        : {}),
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
  /**
   * 실물 핀 배열(회로 수별). **근거가 있는 시리즈에만 준다.**
   * 헤더(BnB/SnB)에는 주지 않는다 — 헤더는 하우징과 맞물리는 면이라 번호가
   * 좌우로 뒤집히는데, 그 뷰를 확인한 도면이 없다. 짐작으로 뒤집으면 그 값이
   * 그대로 오조립이 된다.
   */
  layout?: (n: number) => (number | string | null)[][];
  view?: string;
  viewBrief?: string;
  /** layout 의 근거가 된 원본 도면 캡처 — layout 과 같은 시리즈에만 */
  datasheet?: Datasheet;
  /**
   * 도면용 짧은 이름. **하우징에만** 준다 — 헤더에 같은 글자를 주면 도면에서
   * 하우징과 헤더가 같은 이름으로 보인다.
   */
  shortName?: (n: number) => string;
};

function jstItems(s: JstSeries): PartLibraryItem[] {
  return s.circuits.map((n) => ({
    id: `lib-jst-${s.slug}-${n}p`,
    category: s.category,
    name: `JST ${s.mpn(n)} ${s.표시} (${n}P)`,
    ...(s.shortName ? { shortName: s.shortName(n) } : {}),
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
    ...(s.layout ? { layout: s.layout(n) } : {}),
    ...(s.view ? { view: s.view } : {}),
    ...(s.viewBrief ? { viewBrief: s.viewBrief } : {}),
    ...(s.datasheet ? { datasheet: s.datasheet } : {}),
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
    // 실물 배열은 하우징(XHP-n)에만 준다 — 근거(§6-2)가 하우징 도면 하나뿐이다.
    layout: xhLayout,
    view: XH_VIEW,
    viewBrief: 'eXH.pdf p.4 · 1번만 도면 표기 · 뷰 표기 없음',
    datasheet: DS_XH,
    shortName: (n) => `JST-XH ${n}P`,
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
    shortName: (n) => `JST-PH ${n}P`,
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
    shortName: `Mini-Fit Jr. ${n}P`,
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
    // 실물 배열은 **6회로만** 채운다 — 개선안 §6-2 가 근거를 남긴 것이 그것뿐이다.
    // (도면이 번호를 인쇄한 것은 10회로 예시이고, 6회로는 그 규칙을 연장한 값이다.
    //  10회로 자체를 채우지 않는 이유는 8번이 각인 탭에 가려 미인쇄이기 때문 —
    //  인쇄되지 않은 자리를 확정값처럼 적을 수 없다.)
    ...(n === 6 ? { layout: MINIFIT_6P_LAYOUT, view: MINIFIT_6P_VIEW, viewBrief: 'SD-5557-003 · 각인 탭 위 · 뷰 표기 없음', datasheet: DS_MINIFIT_6P } : {}),
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

/* ═══════════════════════════════════════════════════════════════════
   D-SUB · DC 배럴잭 · 납처리 전선단 — 이스턴웰스 하네스 세트(data.py)에서 온 끝단
   ═══════════════════════════════════════════════════════════════════

   출처: 이스턴웰스-하네스세트/data.py (EW-06 시리얼 A · EW-09 LED) 와
   build.py DS_ITEMS(원본 도면 캡처 캡션). 거기 적힌 것만 옮겼다.

   ## 품번을 비워 둔 이유
   - D-SUB: data.py 의 품번 칸은 `DB-9F` — 규격 호칭이지 제조사 품번이 아니다.
     `CN-DSUB9SKT00-000` 은 핀 번호를 읽은 **Amphenol 도면 번호**다. 주문 품번이라고
     적힌 곳이 없어 `mpn` 에 넣지 않고 `spec.도면` 에 적었다.
   - 배럴잭: data.py 는 `5.5mm / 2.1mm` (외경/내경) 만 준다. 제조사·품번이 없다.
   둘 다 `mpn: '미정'` — 지어내면 그대로 발주서에 실린다.
*/

/**
 * D-SUB 9P 암. 도면 좌표(`pinLayout`)는 윗행 1~5 · 아랫행 6~9 의 2행 격자다
 * (Micro-Fit 10P 처럼 행마다 y 를 한 칸씩). 실물 배열은 `layout` 이 따로 말한다.
 */
const DSUB9_F: PartLibraryItem = {
  id: 'lib-dsub-9p-f',
  category: 'housing',
  name: 'D-SUB 9P 암 (DB-9F)',
  shortName: 'D-SUB 9P 암',
  endKind: 'dsub',
  manufacturer: 'Amphenol',
  mpn: '미정',
  spec: {
    호칭: 'DB-9F (D-SUB 9P 암)',
    열: '2열 (윗행 5 · 아랫행 4)',
    도면: 'Amphenol CN-DSUB9SKT00-000 rev A1 — 핀 번호를 읽은 도면 번호. 주문 품번으로 확인되지 않았다',
    제조사품번: '미정',
    비고:
      '결선 방식(솔더컵/크림프)·백쉘·고정 나사는 품번을 정할 때 함께 확인할 것. ' +
      '핀 1~9 는 도면에 전부 인쇄돼 있어 그대로 읽었다(실물 배열 참조).',
  },
  gender: 'receptacle',
  pinCount: 9,
  pinLayout: [
    ...[1, 2, 3, 4, 5].map((n, i) => ({ index: n, label: String(n), offset: { x: i, y: 0 } })),
    ...[6, 7, 8, 9].map((n, i) => ({ index: n, label: String(n), offset: { x: i, y: 1 } })),
  ],
  layout: DSUB9_F_LAYOUT,
  view: DSUB9_F_VIEW,
  viewBrief: 'CN-DSUB9SKT00 · D쉘 넓은쪽 위 · 뷰 표기 없음',
  datasheet: DS_DSUB9_F,
};

/**
 * DC 배럴잭 암 5.5/2.1 — 전선측 2극(센터 · 슬리브).
 *
 * 극 이름 `+`(센터) · `−`(슬리브)는 EW-09 LED 하네스가 그렇게 결선했기 때문이다
 * (data.py: "빨강 1가닥은 센터(+) … 슬리브(−)"). 센터 극성은 상대 기기가 정하는
 * 것이라 규격이 아니다 — 비고에 남긴다.
 *
 * 실물 배열(`layout`)은 두지 않는다. 센터와 슬리브는 동심원이라 "행·열" 이 없다.
 */
const DC_BARREL_F: PartLibraryItem = {
  id: 'lib-dc-barrel-f-5521',
  category: 'housing',
  name: 'DC 배럴잭 암 5.5/2.1',
  shortName: 'DC 배럴잭 암',
  endKind: 'barrel',
  mpn: '미정',
  spec: {
    외경: '5.5mm',
    내경: '2.1mm',
    극: '센터(+) · 슬리브(−)',
    제조사품번: '미정',
    비고:
      '이스턴웰스 하네스 세트 EW-09(LED) 의 표기 "5.5mm / 2.1mm" 만 근거다 — 제조사·품번은 구매처에서 정할 것. ' +
      '센터(+) 극성은 그 하네스의 결선이지 규격이 아니다 — 상대 기기의 극성 표시를 확인할 것.',
  },
  gender: 'receptacle',
  pinCount: 2,
  pinLayout: [
    { index: 1, label: '+', offset: { x: 0, y: 0 }, signal: '+ (센터)' },
    { index: 2, label: '−', offset: { x: 1, y: 0 }, signal: '− (슬리브)' },
  ],
};

/**
 * 납처리 전선단 — **커넥터 없는 끝**(피복탈거 후 예비 납땜).
 *
 * 사는 물건이 아니라 **가공 지시**다. 그래도 라이브러리에 두는 이유: 하네스의 한쪽
 * 끝이 이것뿐인 경우(EW-09 LED 좌측)에 배선의 끝점을 그릴 자리가 없으면 도면이
 * 안 선다. 가닥 수만큼 핀이 있는 노드로 놓는다.
 *
 * `mpn` 은 두지 않는다 — 발주할 품번이 없다. 가닥 수(1~8)는 data.py EW-09 의 4가닥을
 * 포함하도록 고른 범위이고, 다른 수가 필요하면 핀맵 에디터에서 복제해 쓴다.
 */
const FREE_END_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
const FREE_ENDS: PartLibraryItem[] = FREE_END_COUNTS.map((n) => ({
  id: `lib-free-end-${n}p`,
  category: 'housing' as const,
  name: `납처리 전선단 ${n}가닥`,
  shortName: '납처리 전선단',
  endKind: 'free' as const,
  spec: {
    처리: '피복탈거 · 납처리(예비 납땜)',
    구매: '구매품 아님 — 전선 끝 가공 지시',
    비고: '피복 탈거 길이·납 처리 길이는 도면 비고에 적을 것.',
  },
  gender: 'neutral' as const,
  pinCount: n,
  pinLayout: grid(n, 1),
}));

/* ═══════════════════════════════════════════════════════════════════
   압착 러그 (나사 단자 · 파스톤)
   ═══════════════════════════════════════════════════════════════════

   지금까지 라이브러리의 '단자' 는 전부 **하우징 안에 들어가는 컨택트**였다
   (SXH-001T, YST025, 5556 …). 그래서 나사 단자대나 탭에 붙는 러그는 고를 수가
   없었고, 터미널블럭으로 끝나는 하네스는 단자 칸이 영영 비어 있었다.

   ## 품번을 어떻게 적었나 — 여기가 이 블록에서 가장 조심한 부분이다

   러그는 커넥터와 달리 **제조사 품번보다 규격 호칭으로 발주한다.**
   국내 유통은 `전선단면적(sq) - 스터드지름(mm)` 호칭으로 주문이 통한다
   (`2-4` = 2sq 전선 · M4 볼트). 그래서 `mpn` 에는 그 호칭만 넣고,
   **제조사·카탈로그 번호는 비워 두었다** — 지어내면 그대로 발주서에 실린다.
   구매처를 정하면 `spec.제조사품번` 을 채워라.

   전선 적용 범위는 JIS C 2805 의 호칭별 범위를 따랐다. 제조사마다 상하한이
   조금씩 다르므로 경계값(예: 1.65mm²)에서는 카탈로그를 봐야 한다.

   ## 왜 하우징 컨택트와 한 계열에 두지 않았나
   컨택트는 **하우징과 짝**이라 시리즈 안에 산다. 러그는 짝이 하우징이 아니라
   **볼트(스터드)나 탭**이다. 축이 다르므로 `taxonomy.ts` 에서도 계열을 따로 뒀다.
*/

/** 호칭별 적용 전선 (JIS C 2805) */
const LUG_WIRE: Record<string, string> = {
  '1.25': '0.25~1.65mm² (AWG #22~#16)',
  '2': '1.04~2.63mm² (AWG #16~#14)',
  '5.5': '2.63~6.64mm² (AWG #12~#10)',
};

/**
 * 러그 한 종.
 *
 * ## `pinCount: 1` 을 **적어 두는** 이유
 * 러그의 압착 통은 하나다 — 전선 한 본이 러그 하나에 압착된다. 예전에는 이 값을
 * 비워 뒀는데, 러그는 캔버스에 놓을 것이 아니라고 봤기 때문이다. 지금은 놓는다
 * (`taxonomy.isStandaloneLug`). 비워 두면 `instantiate` 의 `pinCount ?? 2` 가
 * 걸려 핀이 **두 개** 달린 러그가 도면에 생기고, 있지도 않은 자리에 배선할 수 있게
 * 된다. 값을 적어 두면 검증(`pin-overflow`)도 손으로 고친 JSON 을 잡아낸다.
 *
 * `pinLayout` 은 두지 않는다. 그건 하우징 안에서 핀이 **어디 앉는가**를 적는 값인데
 * 러그에는 앉을 하우징이 없다. 없으면 `instantiate` 가 pinCount 로 내려간다.
 *
 * `category` 는 `'terminal'` 그대로다 — 속성 패널의 핀 단자 후보 목록이 그 값으로
 * 거르므로, 바꾸면 "단자대 커넥터의 핀에 링 러그를 지정" 하는 쓰임이 죽는다.
 */
function lug(
  id: string, name: string, mpn: string, kind: string, wire: string, extra: Record<string, string>,
): PartLibraryItem {
  return {
    id, category: 'terminal', name, mpn,
    gender: 'neutral',
    pinCount: 1,
    spec: {
      종류: kind,
      적용전선: wire,
      호칭: `${mpn} — 국내 유통 호칭. 제조사 카탈로그 번호는 구매처에서 정할 것`,
      제조사품번: '미정',
      ...extra,
    },
  };
}

/** 링(O형) — 볼트를 완전히 빼야 끼울 수 있지만 진동에 가장 강하다 */
const RING_LUGS: PartLibraryItem[] = [
  ['1.25', 3], ['1.25', 4], ['1.25', 5],
  ['2', 4], ['2', 5], ['2', 6],
  ['5.5', 5], ['5.5', 6], ['5.5', 8],
].map(([sq, stud]) => ({ endKind: 'ring' as const, shortName: `링 압착단자 ${sq}-${stud}`, ...lug(
  `lib-lug-ring-${String(sq).replace('.', '')}-${stud}`,
  `링(O형) 압착단자 ${sq}-${stud}`,
  `${sq}-${stud}`,
  '링(O형) 압착단자 — 나사 스터드용',
  LUG_WIRE[String(sq)],
  {
    스터드: `M${stud}`,
    비고: '볼트를 빼야 끼울 수 있다. 빠질 염려가 없어 진동·전원선에 쓴다. 절연캡은 별도.',
  },
) }));

/**
 * Y형(포크·스페이드) — 볼트를 풀기만 하면 옆으로 끼운다.
 * 단자대 정비가 잦은 자리에 쓴다. 대신 완전히 조이지 않으면 빠질 수 있다.
 */
const FORK_LUGS: PartLibraryItem[] = [
  ['1.25', 3], ['1.25', 4], ['1.25', 5],
  ['2', 4], ['2', 5], ['2', 6],
  ['5.5', 5], ['5.5', 6],
].map(([sq, stud]) => ({ endKind: 'fork' as const, shortName: `Y형 압착단자 ${sq}-${stud}`, ...lug(
  `lib-lug-fork-${String(sq).replace('.', '')}-${stud}`,
  `Y형(포크) 압착단자 ${sq}-${stud}`,
  `${sq}-${stud}`,
  'Y형(포크·스페이드) 압착단자 — 나사 스터드용',
  LUG_WIRE[String(sq)],
  {
    스터드: `M${stud}`,
    비고: '볼트를 풀기만 하면 옆에서 끼운다 — 정비가 잦은 단자대용. 진동이 큰 곳은 링(O형)을 쓴다.',
  },
) }));

/**
 * 페룰(봉형 압착단자) — **속 빈 원통**이다.
 *
 * 벗긴 연선을 통 안에 넣고 눌러, 가닥이 풀리거나 삐져나오는 것을 막는다.
 * 조임식·푸시인 단자대에 연선을 그대로 물리면 가닥이 눌려 접촉이 나빠지고
 * 옆 극과 단락될 수 있어서, 단자대로 끝나는 배선은 대개 이걸 끼운다.
 *
 * ## 호칭이 러그와 다르다 — 여기서 한 번 틀렸다
 * 러그는 `전선sq-스터드mm`(2-4)인데, 페룰은 스터드에 붙지 않으므로 그 호칭이 없다.
 * **DIN 46228-4 의 `E<단면적><길이>`** 를 쓴다 — `E0508` = 0.5mm² · 통 길이 8mm.
 * 처음에 이걸 러그 호칭(1.25/2/5.5)으로 적었던 것을 바로잡았다.
 *
 * 길이는 단자대 깊이에 맞춰 고른다(8mm 가 기본, 깊으면 10·12mm).
 */
const FERRULE_SIZES: [string, string, number[]][] = [
  ['0.5', '05', [8, 10]],
  ['0.75', '75', [8, 10]],
  ['1.0', '10', [8, 12]],
  ['1.5', '15', [8, 12]],
  ['2.5', '25', [8, 12]],
  ['4.0', '40', [9, 12]],
  ['6.0', '60', [12, 18]],
];
const FERRULE_LUGS: PartLibraryItem[] = FERRULE_SIZES.flatMap(([sq, code, lens]) =>
  lens.map((len) => ({
    endKind: 'ferrule' as const,
    shortName: `페룰 E${code}${String(len).padStart(2, '0')}`,
    ...lug(
    // 길이는 **두 자리로 채운다**. 안 채우면 0.5mm²·8mm 가 E0508 이 아니라 E058 이
    // 되어 발주가 안 되는 품번이 나온다 — 시험이 잡아 준 자리다.
    `lib-lug-ferrule-${code}${String(len).padStart(2, '0')}`,
    `페룰(봉형) 압착단자 E${code}${String(len).padStart(2, '0')} ${sq}mm²·${len}mm`,
    `E${code}${String(len).padStart(2, '0')}`,
    '페룰 — 속 빈 원통. 벗긴 연선을 넣고 압착한다',
    `${sq}mm²`,
    {
      통길이: `${len}mm`,
      규격: 'DIN 46228-4 (절연 목깃 포함 기준)',
      압착: '사각(square) 또는 사다리꼴 압착 다이 — 전용 페룰 압착기가 필요하다',
      비고:
        '조임식·푸시인 단자대용. 연선을 그대로 물리면 가닥이 풀려 접촉이 나빠지고 ' +
        '옆 극과 닿을 수 있다. ' +
        '**절연 목깃 색은 규격(DIN 46228-4 / 프랑스식)마다 달라 구매처에서 확인할 것** — ' +
        '색으로 굵기를 판단하지 마라. 비절연 페룰도 같은 호칭으로 나온다.',
    },
  ) })));

/**
 * 파스톤(평형) — 나사가 아니라 **탭에 끼우는** 단자.
 * `REC` 가 암(리셉터클, 씌우는 쪽)이고 `TAB` 이 수(칼날)다. 국내 유통도
 * "250 REC" · "250 TAB" 으로 부른다. 폭(mm)이 호칭 앞자리다.
 */
const FASTON_LUGS: PartLibraryItem[] = [
  ['110', 2.8], ['187', 4.8], ['250', 6.35],
].flatMap(([size, w]) => ([
  {
    /*
     * 짝이 되는 절연슬리브를 **id 로** 건다.
     *
     * 아래 `절연:` 스펙에도 같은 id 가 문장으로 적혀 있지만 그건 사람이 읽는
     * 글이라 부품표가 알아볼 수 없다. 문장만 두면 발주서에 슬리브 줄이 서지
     * 않고, 그 한 번을 빠뜨리면 압착부가 노출된 채 전압이 지난다(개선안 §2-11).
     * 실제로 씌울지 말지는 도면이 정한다 — `Connector.sleeve`.
     */
    sleevePartId: `lib-lug-faston-${size}-sleeve`,
    endKind: 'faston' as const,
    shortName: `파스톤 ${size} REC`,
    ...lug(
    `lib-lug-faston-${size}-rec`,
    `파스톤 ${size} REC (암) ${w}mm`,
    `${size} REC`,
    '파스톤(평형) 리셉터클 — 암. 탭에 씌운다',
    '호칭별 상이 — 구매처 카탈로그 확인',
    {
      탭폭: `${w}mm`,
      결합: `파스톤 ${size} TAB (수)`,
      절연: `절연슬리브를 따로 끼운다 — lib-lug-faston-${size}-sleeve`,
      비고:
        '모터·스위치·릴레이의 탭 단자에 끼운다. ' +
        '**슬리브 없이 쓰면 압착부가 노출된다** — 슬리브를 쓸지 말지는 발주 때 정해야 한다.',
    },
    ),
  },
  {
  endKind: 'faston' as const,
  shortName: `파스톤 ${size} TAB`,
  ...lug(
    `lib-lug-faston-${size}-tab`,
    `파스톤 ${size} TAB (수) ${w}mm`,
    `${size} TAB`,
    '파스톤(평형) 탭 — 수. 칼날 쪽',
    '호칭별 상이 — 구매처 카탈로그 확인',
    {
      탭폭: `${w}mm`,
      결합: `파스톤 ${size} REC (암)`,
      비고: '전선에 압착하는 탭. 부품에 이미 달린 탭이면 발주 대상이 아니다.',
    },
  ),
  },
  /*
   * 절연슬리브(절연캡) — REC 한 개에 하나씩 **따로 사는 물건**이다.
   *
   * ## 왜 REC 안에 스펙 한 줄로 적지 않고 항목을 따로 냈나
   * 발주서에 줄이 서야 현장에 도착한다. REC 의 `비고` 에 "슬리브 별도" 라고
   * 적어 두면 사람이 읽고 손으로 옮겨 적어야 하고, 그 한 번을 빠뜨리면
   * 압착부가 노출된 채로 24V 가 지나간다. 짝(REC↔TAB)을 항목으로 나눠 둔 것과
   * 같은 이유다.
   *
   * ## 왜 파스톤 계열 안에 두었나
   * 슬리브는 압착단자가 아니지만 **파스톤 호칭(110·187·250)이 곧 규격**이라
   * REC 를 고르는 자리에서 같이 보여야 한다. 계열을 새로 파면 "110 REC 슬리브는
   * 어디" 가 다시 답이 없는 질문이 된다(taxonomy.ts 머리말 §축은 하나).
   * `lib-lug-` id 를 쓰므로 품번 관례(호칭만·제조사품번 미정)를 시험이 그대로
   * 강제한다.
   *
   * ## 알면서 남겨 둔 어긋남
   * `isStandaloneLug` 가 참이 되어 캔버스에도 놓인다 — 슬리브만 떠 있는 노드는
   * 뜻이 없다. 그래도 판정 근거를 계열 하나로 두는 편(`taxonomy.isStandaloneLug`
   * 머리말)이 부품마다 예외 표시를 다는 것보다 어긋날 자리가 적다고 봤다.
   * 하네스에서는 REC 핀의 `terminalId` 로 매달아 쓴다.
   */
  lug(
    `lib-lug-faston-${size}-sleeve`,
    `파스톤 ${size} 절연슬리브 (REC용)`,
    `${size} 슬리브`,
    '파스톤 절연슬리브(절연캡) — REC 에 씌운다. 압착단자가 아니다',
    '짝이 되는 REC 의 적용전선을 따른다',
    {
      적용: `파스톤 ${size} REC (암) — lib-lug-faston-${size}-rec 1개당 1개`,
      탭폭: `${w}mm`,
      재질: 'PVC 또는 나일론(PA66) — 내열 등급이 갈리므로 구매처에서 확인할 것',
      색상: '미정 — 적/흑으로 극성을 구분하는 관례가 있으나 규격이 아니다',
      비고:
        '압착 후 씌우는 절연캡이다. **REC 와 별개 품목이라 따로 발주해야 한다.** ' +
        '일체형(절연 피복이 붙어 나오는) REC 를 사면 이 항목은 필요 없다 — ' +
        '어느 쪽을 살지는 구매처에서 정한다.',
    },
  ),
]));

export const CRIMP_LUGS: PartLibraryItem[] = [
  ...RING_LUGS, ...FORK_LUGS, ...FERRULE_LUGS, ...FASTON_LUGS,
];

/* ═══════════════════════════════════════════════════════════════════
   터미널블럭 (단자대)
   ═══════════════════════════════════════════════════════════════════

   지금까지 `터미널블럭 2P` 한 종뿐이었다. 실제로는 종류가 여러 가지이고,
   **하네스 입장에서 중요한 건 극수가 아니라 결선 방식**이다 — 그게 전선 끝에
   무엇을 압착할지를 정한다.

     나사 스터드(배리어)  → 링(O형) 또는 Y형(포크) 러그
     조임 나사(구멍)      → 페룰. 연선을 그냥 물리면 가닥이 풀린다
     스프링 · 푸시인      → 페룰 (사실상 필수)

   그래서 각 부품의 `spec.필요단자` 에 그 대응을 적어 둔다. 단자대를 고르면
   전선 끝단이 따라 정해지도록.

   품번은 러그와 같은 이유로 **규격 호칭만** 넣는다(피치·극수·결선방식).
   제조사 카탈로그 번호는 `미정` 이다.
*/
function tblock(
  id: string, name: string, mpn: string, poles: number, spec: Record<string, string>,
): PartLibraryItem {
  return {
    id, category: 'board-to-wire', name, mpn,
    gender: 'neutral',
    pinCount: poles,
    spec: { 제조사품번: '미정', ...spec },
  };
}

/** 유러피언 PCB 터미널블럭 — 기판에 앉는 나사식. 피치가 곧 품번이다. */
const TB_EURO: PartLibraryItem[] = [3.5, 5.0, 5.08, 7.62].flatMap((pitch) => {
  // 자리수를 맞춰 적는다. `5mm` 로 줄여 쓰면 5.08 과 눈으로 구분이 안 된다 —
  // 아래 비고가 경고하는 바로 그 혼동을 표기가 먼저 만들면 안 된다.
  const label = pitch.toFixed(2);
  return [2, 3, 4, 6, 8].map((p) => tblock(
    `lib-tb-euro-${String(pitch).replace('.', 'p')}-${p}p`,
    `유러피언 단자대 ${label}mm ${p}P (PCB 나사식)`,
    `${label}mm-${p}P`,
    p,
    {
      형식: 'PCB 실장 · 나사 조임식(구멍에 넣고 위에서 조임)',
      피치: `${label}mm`,
      필요단자: '페룰 권장 — 연선을 그대로 물리면 가닥이 풀린다. 단선이면 그대로 가능',
      비고: '피치가 다르면 기판 패턴이 안 맞는다. 3.50 / 5.00 / 5.08 은 서로 비슷해 보이므로 도면에서 확인할 것.',
    },
  ));
});

/** 배리어(고정식) 단자대 — 베이클라이트 몸체에 나사 스터드. 잘라서 극수를 맞춘다. */
const TB_BARRIER: PartLibraryItem[] = [
  ['15A', 'M3'], ['20A', 'M3.5'], ['30A', 'M4'],
].flatMap(([amp, stud]) =>
  [3, 4, 6, 12].map((p) => tblock(
    `lib-tb-barrier-${amp.toLowerCase()}-${p}p`,
    `배리어 단자대 ${amp} ${p}P (${stud} 스터드)`,
    `TB-${amp}-${p}P`,
    p,
    {
      형식: '고정식(배리어) · 나사 스터드 조임',
      스터드: stud,
      정격: amp,
      필요단자: `링(O형) 또는 Y형(포크) 러그 — 스터드 ${stud} 에 맞는 호칭을 고를 것`,
      비고: '극 사이에 격벽이 있어 단락에 강하다. 12P 를 잘라 필요한 극수로 쓰는 것이 관행이라 극수는 참고값이다.',
    },
  )));

/** DIN 레일 조립식 — 레일에 끼워 필요한 만큼 늘린다 */
const TB_DIN: PartLibraryItem[] = [
  ['2.5', '나사식'], ['4', '나사식'], ['6', '나사식'], ['10', '나사식'],
  ['2.5', '스프링'], ['4', '스프링'], ['6', '스프링'],
].map(([sq, kind]) => tblock(
  `lib-tb-din-${String(sq).replace('.', 'p')}-${kind === '나사식' ? 'screw' : 'spring'}`,
  `DIN레일 단자대 ${sq}mm² ${kind}`,
  `DIN-${sq}-${kind}`,
  1,
  {
    형식: `DIN 35mm 레일 조립식 · ${kind}`,
    적용전선: `${sq}mm² 까지`,
    필요단자: kind === '스프링'
      ? '페룰 필수 — 스프링에 연선을 직접 물리면 가닥이 눌려 접촉이 나빠진다'
      : '페룰 권장',
    비고:
      '한 극짜리를 레일에 붙여 늘린다 — 극수는 몇 개를 붙이느냐의 문제라 이 항목의 핀 수는 1 이다. ' +
      '엔드플레이트·엔드스토퍼·점퍼바는 별도 발주다.',
  },
));

export const TERMINAL_BLOCKS: PartLibraryItem[] = [...TB_EURO, ...TB_BARRIER, ...TB_DIN];

export const SEED_PARTS: PartLibraryItem[] = [
  ...CRIMP_LUGS,
  ...TERMINAL_BLOCKS,
  // ===== MDB =====
  {
    id: 'lib-mdb-vmc', category: 'housing', name: 'MDB VMC(마스터) 6P',
    // lib-minifit-5557-06p 와 같은 물건 — 짧은 이름도 같다
    shortName: 'Mini-Fit Jr. 6P',
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
    // lib-minifit-5557-06p 와 **같은 물건**이므로 실물 배열도 같아야 한다.
    // 같은 상수를 쓴다 — 손으로 두 번 적으면 언젠가 두 부품이 다른 배열을 말한다.
    layout: MINIFIT_6P_LAYOUT,
    view: MINIFIT_6P_VIEW,
    viewBrief: 'SD-5557-003 · 각인 탭 위 · 뷰 표기 없음',
    datasheet: DS_MINIFIT_6P,
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
  { id: 'lib-xh-2p', category: 'housing', name: 'JST XH 2.5 2P (구 항목)', shortName: 'JST-XH 2P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-2p (XHP-2)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-2 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 2, pinLayout: grid(2, 1) },
  { id: 'lib-xh-4p', category: 'housing', name: 'JST XH 2.5 4P (구 항목)', shortName: 'JST-XH 4P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-4p (XHP-4)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-4 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 4, pinLayout: grid(4, 1) },
  { id: 'lib-xh-6p', category: 'housing', name: 'JST XH 2.5 6P (구 항목)', shortName: 'JST-XH 6P', manufacturer: 'JST',
    spec: { 피치: '2.5mm', 정격: '3A', 대체: 'lib-jst-xhp-6p (XHP-6)',
      비고: '품번 없는 옛 항목 — 신규 설계는 품번이 있는 XHP-6 항목을 쓰세요. 기존 도면 호환을 위해 남겨 둡니다.' },
    gender: 'receptacle', pinCount: 6, pinLayout: grid(6, 1) },
  { id: 'lib-ph-4p', category: 'housing', name: 'JST PH 2.0 4P (구 항목)', shortName: 'JST-PH 4P', manufacturer: 'JST',
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

  // ===== D-SUB · DC 배럴잭 · 납처리 전선단 (이스턴웰스 하네스 세트) =====
  DSUB9_F,
  DC_BARREL_F,
  ...FREE_ENDS,

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

/**
 * 부품 종류 → 캔버스 인스턴스 종류.
 *
 * 단독 배치되는 압착 러그(`category: 'terminal'`)는 `'connector'` 로 떨어진다.
 * `ConnectorKind` 에 `'lug'` 를 더하지 않은 이유: 그 값은 저장 파일에 그대로 나가는
 * 동결 계약이라 새 값을 넣으면 옛 툴이 못 여는 문서가 생긴다(schemaVersion 을
 * 올려야 한다). 러그인지 아닌지는 `housingId` 가 가리키는 부품에 **이미 적혀
 * 있으므로**(`taxonomy.isStandaloneLug`) 문서에 사실을 하나 더 저장할 이유가 없다.
 * 화면·발주는 전부 그 판정을 부른다.
 */
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
