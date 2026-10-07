/**
 * 와이어 하네스 설계 툴 — 공유 타입 스키마 (동결 계약)
 * ------------------------------------------------------------------
 * 이 파일은 Wave 0에서 동결되는 "계약"이다.
 * 모든 에이전트(캔버스/라이브러리/속성패널/출력)는 이 타입에만 의존한다.
 * 동결 이후에는 읽기 전용. 변경이 필요하면 schemaVersion을 올리고 합의한다.
 */

// ================================================================
// 0. 공통 기본형
// ================================================================

/** 모든 엔티티의 고유 id (uuid 권장) */
export type Id = string;

/** 2D 좌표 */
export type Vec2 = { x: number; y: number };

/** 물리 뷰에서 커넥터 회전 각도 */
export type Orientation = 0 | 90 | 180 | 270;

/** ISO 8601 문자열 (예: "2026-08-11T05:58:00Z") */
export type IsoDateTime = string;

// ================================================================
// 1. 부품 라이브러리
//    - 물리적 형상/스펙은 여기(공유·재사용)에 산다.
//    - 인스턴스(Connector)는 이 항목을 id로 참조만 한다.
// ================================================================

export type PartCategory =
  | 'housing'        // 커넥터 하우징
  | 'terminal'       // 핀/단자(크림프)
  | 'splice'         // 결선(단순 꼬아 합치기 등)
  | 'board-to-wire'; // 보드투와이어 커넥터

/** 하우징 내 핀 한 자리의 물리 배치 (물리 뷰 렌더용) */
export type PinSlot = {
  /** 핀 번호. 1-base 기준 (실제 커넥터 번호와 일치) */
  index: number;
  /** 실크/도면 표기 ("1", "A1" 등). 없으면 index 사용 */
  label?: string;
  /** 하우징 기준 상대 좌표(정규화 단위). 물리 뷰에서 핀 위치 */
  offset: Vec2;
  /** 표준 신호명 (예: MDB "34V", RJ45 T568B "TX+"). 규격이 정해진 커넥터용 */
  signal?: string;
  /** 규격상 권장 색상 (예: RJ45 T568B pin1 = "white/orange") */
  stdColor?: string;
};

/**
 * 결합 성별.
 * - `receptacle` 암(리셉터클) — 전선측 하우징, 암 컨택
 * - `plug`       수(플러그)   — 전선측 플러그, 수 컨택
 * - `header`     보드 실장 헤더/웨이퍼
 * - `neutral`    성별 없음(스플라이스·터미널블럭·크림프 터미널 등)
 */
export type PartGender = 'receptacle' | 'plug' | 'header' | 'neutral';

export type PartLibraryItem = {
  id: Id;
  category: PartCategory;
  /** 표시명 ("JST XH 2.5 4P" 등) */
  name: string;
  manufacturer?: string;
  /** 제조사 부품번호 (BOM용) */
  mpn?: string;
  /** 자유 스펙: 피치, 정격 전류/전압, 재질 등 */
  spec?: Record<string, string>;

  /**
   * 결합 성별. 발주 시 암수를 잘못 사면 현장에서 못 쓴다.
   * optional 이라 기존 저장 파일과 호환된다 — schemaVersion 은 그대로.
   */
  gender?: PartGender;

  // --- housing / splice / board-to-wire 전용 ---
  /** 핀 개수 */
  pinCount?: number;
  /** 핀 물리 배치. 없으면 pinCount로 그리드 자동 생성 */
  pinLayout?: PinSlot[];

  /**
   * **실물 핀 배열** — 부품을 손에 쥐고 봤을 때 눈에 보이는 번호의 배열.
   * 행(row) 배열이고, `null` 은 **회로가 없는 빈 자리**다.
   *
   * ## `pinLayout` 과 무엇이 다른가 — 섞으면 안 된다
   * 둘은 **다른 사실**이라 필드를 나눈다.
   *  · `pinLayout` = 이 툴이 **도면에 그리는 좌표**다. 도면은 "배선이 나가는 변에
   *    긴 축을 붙인다" 는 작도 규칙을 따르므로, 10P 1열 커넥터가 도면에서는
   *    **세로로 선다**. 그건 그림이 읽히게 하려는 배치이지 실물이 아니다.
   *  · `layout` = **실물 배열**이다. 도면 규칙과 아무 상관이 없다.
   *
   * 둘이 어긋날 수 있다는 것이 바로 이 필드가 존재하는 이유다. 조립자가 도면
   * 좌표를 실물 배열로 믿고 압착하면 그대로 오조립이다. 그래서 도면에는 이
   * 배열을 **따로** 작은 격자로 찍고, 아래 `view` 로 어느 면인지 못 박는다.
   *
   * ## 값을 지어내지 않는다
   * 근거 없는 배열은 아무것도 없는 것보다 나쁘다 — 비어 있으면 사람이 실물을
   * 보지만, 틀린 값이 적혀 있으면 그대로 믿는다. 근거가 없으면 **비워 둔다**.
   *
   * optional 이라 이 필드가 없던 문서·라이브러리가 그대로 열린다 —
   * 그래서 schemaVersion 은 올리지 않는다.
   */
  layout?: (number | string | null)[][];

  /**
   * `layout` 을 **어느 면에서 본 것인가** (예: "결합면에서 본 배열 · 각인 탭 위").
   *
   * ## 왜 배열만으로는 부족한가
   * 커넥터는 뒤집으면 번호가 **좌우로 뒤집힌다**. 같은 배열도 결합면에서 본
   * 것인지 전선 삽입면에서 본 것인지에 따라 정반대의 물건이 된다.
   * 실제로 개선안 §6-2 가 확인한 제조사 도면 4건은 **전부** `viewed from …`
   * 표기가 없었고, **Mini-Fit 과 Micro-Fit 의 번호 뷰는 서로 거울상**이었다.
   * 같은 면을 그린 것으로 가정할 근거가 어디에도 없다는 뜻이다.
   *
   * ## 왜 타입상 필수가 아닌가
   * 개선안은 "필수화 권장" 이라고 적는다. 그런데 필수로 만들면 이 필드가 없던
   * 기존 저장 파일이 열리지 않고, 그러려면 schemaVersion 을 올려야 한다.
   * 그래서 **타입은 optional 로 두고, 비면 검증 패널이 경고한다**
   * (`store/validate.ts` 의 `pin-view-missing`). 강제하는 자리를 타입이 아니라
   * 검증으로 옮긴 것이지 강제를 포기한 것이 아니다.
   *
   * ## 무엇을 적는가
   * 뷰 기준 한 줄로 끝내지 말고, **어디까지가 도면에 인쇄된 값이고 어디부터가
   * 연장한 값인지**를 같이 적는다. 그 구분이 없으면 "실물 대조" 를 어디에
   * 해야 하는지 아무도 모른다.
   */
  view?: string;

  /**
   * `view` 의 도면용 한 줄 요약 ("eXH.pdf p.4 · 1번만 도면 표기 · 뷰 표기 없음").
   * A4 한 장의 핀 배열 칸은 좁아 긴 설명이 들어가지 않는다. `view` 가 없으면
   * 이 값만으로는 아무것도 그리지 않는다 — 요약은 원문을 대신하지 않는다.
   */
  viewBrief?: string;

  /**
   * 이 부품에 씌우는 **절연 슬리브 부품의 id** (파스톤 REC → 슬리브 등).
   *
   * 슬리브를 스펙 문장("슬리브 별도")으로만 적어 두면 사람이 읽고 손으로 옮겨
   * 적어야 하고, 그 한 번을 빠뜨리면 압착부가 노출된 채 전압이 지난다. id 로
   * 걸어 두면 부품표가 **줄을 세워** 자동으로 발주한다(export/exporters.ts).
   *
   * "이 부품에는 이런 슬리브가 맞는다" 는 **부품의 성질**이라 여기 있고,
   * "이 도면에서 실제로 씌울 것인가" 는 도면의 선택이라 `Connector.sleeve` 에 있다.
   */
  sleevePartId?: Id;

  /**
   * **제조사 원본 도면 캡처** — PDF 부록(커넥터 핀 번호)에 그대로 싣는다.
   * `src` 는 앱 기준 URL 경로(`datasheets/xh.png` — Vite base 앞에 붙는다),
   * `source` 는 어느 문서 몇 쪽인지, `note` 는 그 도면에서 읽은 것/연장한 것의 구분.
   * 근거 문서가 확인된 부품에만 붙인다. optional — schemaVersion 은 그대로.
   */
  datasheet?: { src: string; source: string; note?: string };
};

// ================================================================
// 2. 커넥터 인스턴스 (캔버스에 놓이는 실제 커넥터)
//    - 스플라이스도 커넥터의 한 종류(kind)로 통일한다.
// ================================================================

export type ConnectorKind = 'connector' | 'splice' | 'board-to-wire';

/** 커넥터 인스턴스의 핀 하나 */
export type Pin = {
  id: Id;
  /** 하우징 pinLayout의 index와 매칭 (1-base) */
  index: number;
  /** 인스턴스별 표기 (없으면 라이브러리 PinSlot.label) */
  label?: string;
  /** 이 핀에 압착되는 단자(라이브러리 terminal) 참조 — BOM용 */
  terminalId?: Id;
};

export type Connector = {
  id: Id;
  kind: ConnectorKind;
  /** PartLibraryItem(id, category=housing|splice|board-to-wire) 참조 */
  housingId: Id;
  pins: Pin[];
  /** 물리 뷰 회전 */
  orientation: Orientation;
  /** 뷰별 독립 배치 — 논리/물리 뷰가 서로 위치를 공유하지 않음 */
  positions: {
    logical?: Vec2;
    physical?: Vec2;
  };
  /**
   * 내부 결선 그룹. 같은 배열에 든 핀 id들은 내부적으로 하나의 네트로 이어짐.
   * - 단순 스플라이스: [[모든 핀 id]]
   * - 일반 커넥터: 생략(undefined)
   */
  bridges?: Id[][];

  /**
   * **이 도면에서 일부러 비워 두는 핀** (핀 번호 또는 라벨).
   *
   * ## 왜 필요한가
   * 지금 도면은 "안 쓰는 핀"과 "아직 안 그린 핀"을 구분하지 못한다 — 둘 다
   * 흰 패드에 회색 번호다. 조립자는 그것이 확정된 공백인지 도면이 덜 된
   * 것인지 알 수 없고, 확인하러 가지 않으면 자기 판단으로 채운다. 그게 오조립이다.
   * 여기 적힌 핀은 패드에 X 를 그어 **"비우는 것이 맞다"** 고 말한다.
   *
   * ## 왜 `PartLibraryItem` 이 아니라 여기인가
   * 부품이 아니라 **이 도면의 선택**이기 때문이다. 같은 6P 하우징이라도 이
   * 하네스에서는 3번을 안 쓰고 옆 하네스에서는 쓴다. 부품에 적으면 그 부품을
   * 쓰는 모든 도면이 함께 X 표시를 받는다.
   *
   * 규격상 N/C 라서 **언제나** 비는 자리는 부품의 성질이 맞지만, 그건 이미
   * `PartLibraryItem.pinLayout[].signal` 에 "N.C." 로 적을 자리가 있다.
   * 없는 축을 새로 만들지 않는다.
   *
   * optional 이라 기존 저장 파일과 호환된다 — schemaVersion 은 그대로.
   */
  unused?: (number | string)[];

  /**
   * 이 끝단의 압착부에 **절연 슬리브를 씌우는가** (개선안 §2-11).
   *
   * 부품 성질이 아니라 **이 도면의 선택**이라 여기 있다 — 파스톤 REC 는 슬리브를
   * 씌워 쓰기도 하고, 절연 피복이 붙어 나오는 일체형을 사서 안 씌우기도 한다.
   * 어느 쪽인지는 부품이 아니라 그 도면이 정한다.
   *
   * 켜면 부품표에 슬리브가 **별도 품목으로 한 줄** 선다. 어떤 슬리브인지는
   * 하우징의 `sleevePartId` 가 안다.
   */
  sleeve?: boolean;

  note?: string;
};

// ================================================================
// 3. 장치 블록 (연결되는 장치를 네모로 표기)
// ================================================================

export type Device = {
  id: Id;
  /** 사용자가 지정하는 이름 ("Raspberry Pi", "24V PSU" 등) */
  name: string;
  /** 선택: 명명된 단자 ("+24V", "GND", "TX" 등) */
  terminals?: string[];
  positions: {
    logical?: Vec2;
    physical?: Vec2;
  };
  note?: string;
};

// ================================================================
// 4. 배선 끝점 (와이어가 닿는 곳)
//    - 커넥터의 핀, 또는 장치 블록의 단자
// ================================================================

export type Endpoint =
  | { type: 'pin'; connectorId: Id; pinId: Id }
  | { type: 'device'; deviceId: Id; terminal?: string };

// ================================================================
// 5. 와이어 / 케이블
// ================================================================

/** 와이어 색 (2톤 지원: 예 base=red, stripe=white → 적/백) */
export type WireColor = {
  base: string;
  stripe?: string;
};

/** 게이지: AWG 또는 mm²(SQ) 둘 다 지원 */
export type Gauge = {
  system: 'awg' | 'mm2';
  value: number;
};

/**
 * **사람이 직접 지정한 꺾임(레인) 위치**(px).
 *
 * ## 왜 저장하는가
 * 레인은 원래 파생값이다 — 도면을 고치면 레인도 따라와야 하므로 자동 배정
 * (`canvas/docToFlow.assignLanes`)이 정한다. 그런데 자동 배정은 "겹치지 않게"
 * 까지만 하고 **어느 쪽이 읽기 좋은지는 모른다.** 배선이 빽빽해지면 사람이 눈으로
 * 보고 한 가닥을 위/아래로 비켜 놓고 싶어지는데, 그건 도면 어디에도 적혀 있지
 * 않은 **새 사실**이라 유도할 근거가 없다(구간 길이 `segmentLengths` 와 같은 부류).
 * 그래서 유도할 수 있는 것(레인 배정)은 유도하고, 유도할 수 없는 것(사람의 판단)만
 * 담는다.
 *
 * ## 규칙
 * - 여기 있는 값이 자동값을 **이긴다**. 축마다 따로 이긴다(한쪽만 지정 가능).
 * - **0 은 "없음"이 아니다.** 0 은 "가운데 레인"이라는 뜻이라, 0 을 비움으로 쓰면
 *   가운데로 끌어오라는 지시와 자동에 맡기라는 지시가 구분되지 않는다.
 *   비우려면 **키를 지운다**(길이가 `null`/키 삭제인 것과 같은 이유).
 * - 축이 둘 다 없어지면 `route` 자체를 지운다 — 빈 객체를 남기면 이 기능을 쓴 적
 *   없는 문서와 저장 파일이 달라져 형상관리에서 없는 변경이 보인다.
 * - 자동 배정은 이 값이 있어도 **그대로 다 돈다**. 지정한 배선을 배정에서 빼면
 *   남은 배선의 레인 번호가 다시 매겨져, 한 가닥을 손보는 순간 상관없는 배선들이
 *   함께 움직인다. 값을 지우면 정확히 예전 그림으로 돌아와야 한다.
 *
 * ## 좌표의 뜻 (route.ts 의 레인 두 축과 같다)
 * - `laneY` — 가로 주행 구간의 y 오프셋. 음수가 위, 양수가 아래.
 * - `laneX` — 세로 간선의 x 오프셋. 패드에서 바깥으로 밀어내는 거리.
 *
 * 다만 라우터는 노드 상자를 비켜 갈 때 **부호를 접는다**(`|lane|`, route.pushAside).
 * 그래서 상자를 돌아 나가는 배선에서는 부호가 결과를 바꾸지 않을 수 있다 —
 * 정확한 예측은 불가능하고, 그래서 속성 패널은 "값을 넣고 도면에서 확인하라"고
 * 말한다. 지어낸 규칙을 화면에 적지 않는다.
 *
 * optional 이라 이 필드가 없던 문서는 그대로 열리고, 새 문서를 옛 툴이 열어도
 * 이 필드만 무시된다 — 그래서 schemaVersion 은 올리지 않는다.
 */
export type WireRoute = {
  /** 가로 주행 구간의 y 오프셋(px). 없으면 자동. */
  laneY?: number;
  /** 세로 간선의 x 오프셋(px). 없으면 자동. */
  laneX?: number;
};

export type Wire = {
  id: Id;
  from: Endpoint;
  /** 다중 결선 = 여러 Wire가 같은 Endpoint(핀)를 공유하면 됨 */
  to: Endpoint;
  color: WireColor;
  gauge: Gauge;
  /** 길이(mm). 케이블(cableId)에 속하면 케이블 길이를 따르므로 생략 가능 */
  lengthMm?: number;
  /** 멀티코어 케이블 그룹(선택). 같은 cableId = 한 다심 케이블 안의 심선들 */
  cableId?: Id;
  label?: string;
  /** 사람이 손으로 잡은 꺾임 위치(선택) — 위 `WireRoute` 주석 참고 */
  route?: WireRoute;
};

/** 멀티코어 케이블(선택). "몇 코어짜리 하네스" 표현용 */
export type Cable = {
  id: Id;
  name?: string;
  /** 코어(심선) 수 */
  coreCount: number;
  /** 케이블 기본 게이지 */
  gauge?: Gauge;
  jacketColor?: string;
  /** 케이블 전체 길이(mm) */
  lengthMm?: number;
};

// ================================================================
// 6. 문서 (유일한 공유 자산)
// ================================================================

export type HarnessDocument = {
  /** 스키마 버전 — 저장된 JSON 마이그레이션 기준 */
  schemaVersion: 1;
  id: Id;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  /**
   * 도면 제목블록 정보 (선택).
   * 둘 다 optional 이라 기존 저장 파일과 호환된다 — schemaVersion 은 그대로 1.
   * 없으면 제목블록에 "—" 로 표시된다.
   */
  drawingNo?: string;
  rev?: string;

  /**
   * 세트 안에서의 식별 문자 (A, B, C …). 세트에 속할 때만 쓴다.
   * optional 이라 단일 하네스 문서와 호환된다.
   */
  letter?: string;

  /**
   * 도면 **비고** — PDF 부품표 아래 `비고` 칸에 그대로 찍힌다.
   * 비고 칸에는 이 글 뒤에 "전선 색상은 규격 지정 사항이 아님 — 사내 배정." 이
   * 언제나 붙는다(export/pdfPages.ts). optional — schemaVersion 은 그대로.
   */
  note?: string;

  /**
   * **완제품 구매 품목**인가. 켜면 PDF 가 결선도 대신 `구매 품목` 면을 그린다
   * (제작 대상이 아니므로 결선도를 그리면 제작 지시로 오독된다).
   * optional — 없으면 제작 하네스. schemaVersion 은 그대로.
   */
  purchased?: boolean;

  connectors: Connector[];
  devices: Device[];
  wires: Wire[];
  cables?: Cable[];

  /**
   * **사람이 직접 입력한 구간(다발) 길이**(mm). 키는 구간 양 끝 정점 id 를 정렬해
   * 만든 문자열이며, 그 키를 만드는 함수는 `physical/segments.ts` 의
   * `segmentKey()` **한 곳**에만 있다(도출부와 저장부가 같은 함수를 쓴다).
   *
   * ## 왜 구간이 아니라 길이만 저장하는가
   * 구간 자체는 배선 그래프에서 **유도된다**(physical/segments.ts 주석). 그러니
   * 구간을 저장하면 배선을 고칠 때마다 도면과 구간표가 갈라진다. 반대로 구간
   * 길이는 배선 어디에도 적혀 있지 않은 **새 사실**이다 — 분기가 있는 하네스는
   * 그 구간이 곧 전 경로인 배선이 없어 유도할 근거가 아예 없다. 그래서 유도할 수
   * 있는 것(구간의 존재·본수)은 유도하고, 유도할 수 없는 것(그 길이)만 담는다.
   *
   * ## 규칙
   * - 여기 있는 값이 유도값을 **이긴다**. 다만 화면은 그것이 입력값임을 밝힌다.
   * - 유도값과 다르면 조용히 덮지 않고 검증(`segment-length-conflict`)이 알린다.
   *   자동으로 고치지 않는다 — 어느 쪽이 맞는지는 사람만 안다.
   * - 값을 지우면 이 키를 **지운다**(0 을 넣지 않는다). 그러면 다시 유도값/미상이다.
   * - 자재표(발주)는 이 값을 보지 않는다 — 발주하는 것은 전선 길이지 구간 길이가
   *   아니라서 더하면 이중 계상이 된다(export/exporters.ts 참고).
   *
   * optional 이라 이 필드가 없던 문서는 그대로 열리고, 새 문서를 옛 툴이 열어도
   * 이 필드만 무시된다 — 그래서 schemaVersion 은 올리지 않는다.
   */
  segmentLengths?: Record<string, number>;

  /**
   * 자기완결(self-contained) 저장용 스냅샷.
   * 문서에서 실제 쓰인 라이브러리 항목을 함께 저장 → 라이브러리가 나중에
   * 바뀌어도 JSON 파일 단독으로 도면/파트리스트를 정확히 재현.
   */
  usedParts: PartLibraryItem[];
};

// ================================================================
// 6-2. 세트 (발주 단위)
//
// 자판기 1대분처럼 **여러 종의 하네스를 묶어** 발주하는 경우를 담는다.
// (예: A 1개 + B 2개 + C 1개 = 세트 1개)
//
// 설계 원칙: HarnessDocument 는 **하네스 한 종**을 뜻하며 그대로 둔다.
// 캔버스·접속표·파트·속성은 전부 하네스 하나만 다루므로 기존 코드가
// 손대지 않고 그대로 동작한다. 세트는 그 위를 감싸는 컨테이너다.
// ================================================================

/** 세트 구성 한 줄 — 어떤 하네스가 세트당 몇 개 들어가는가 */
export type SetItem = {
  harnessId: Id;
  /** 세트 1개당 수량 */
  perSet: number;
};

export type HarnessSet = {
  id: Id;
  /** 세트 품번 (KIT-2408) */
  pn: string;
  name: string;
  rev?: string;
  items: SetItem[];
  /** 주문할 세트 수 */
  orderQty: number;
};

/**
 * 최상위 저장 단위. 하네스 여러 종 + 세트 하나.
 *
 * 총수량은 언제나 `perSet × orderQty` 로 **파생**한다 — 저장하지 않는다.
 * 수동 입력 총수량을 두면 화면 숫자와 발주 숫자가 갈라진다.
 */
export type KitDocument = {
  schemaVersion: 2;
  id: Id;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  harnesses: HarnessDocument[];
  set: HarnessSet;
};

/** 저장 파일은 v1(하네스 하나) 또는 v2(세트) 둘 다 올 수 있다 */
export type AnyDocument = HarnessDocument | KitDocument;

// ================================================================
// 7. 스토어 계약 (앱 상태 인터페이스)
//    - 구현체(Zustand 등)는 이 시그니처를 따른다.
// ================================================================

export type ViewMode = 'logical' | 'physical';

export interface HarnessStore {
  /**
   * **현재 편집 중인 하네스 하나.**
   * 캔버스·접속표·속성·파트는 전부 이 문서만 다룬다.
   * 세트 전체를 합산해 보는 화면은 세트 개요 하나뿐이다.
   */
  doc: HarnessDocument;
  /** 하네스 여러 종을 담는 상위 컨테이너 */
  kit: KitDocument;
  activeHarnessId: Id;
  selection: Id | null;
  activeView: ViewMode;

  // 조회/선택
  select(id: Id | null): void;
  setView(view: ViewMode): void;

  // 세트
  /** 편집 대상 하네스를 바꾼다 (현재 하네스는 세트에 먼저 반영된다) */
  setActiveHarness(id: Id): void;
  updateSet(patch: Partial<HarnessSet>): void;
  /** 세트당 수량 변경 */
  setPerSet(harnessId: Id, perSet: number): void;
  /** 하네스 추가 — blank(빈) / duplicate(활성 하네스 복제) */
  addHarness(mode: 'blank' | 'duplicate', doc?: HarnessDocument): void;
  removeHarness(id: Id): void;
  replaceKit(kit: KitDocument): void;

  // 커넥터
  addConnector(c: Connector): void;
  updateConnector(id: Id, patch: Partial<Connector>): void;

  // 장치
  addDevice(d: Device): void;
  updateDevice(id: Id, patch: Partial<Device>): void;

  // 와이어 / 케이블
  addWire(w: Wire): void;
  updateWire(id: Id, patch: Partial<Wire>): void;
  addCable(c: Cable): void;
  updateCable(id: Id, patch: Partial<Cable>): void;

  /**
   * 케이블을 만들면서 그 자리에서 심선 하나를 넣는다 (선택 액션).
   *
   * `addCable` 뒤에 `updateWire` 를 부르면 한 손동작에 실행취소가 **두 단계**
   * 쌓여, 한 번만 되돌린 사용자에게 심선 0본짜리 케이블이 남는다. 그 케이블은
   * 자재표에 그대로 발주된다. 한 동작이면 한 단계여야 해서 통로를 하나 더 둔다.
   * `syncUsedPart` 와 같이 optional 로만 얹으므로 기존 구현체는 그대로 유효하다.
   */
  addCableForWire?(c: Cable, wireId: Id): void;

  /** 라이브러리에서 쓴 부품을 문서 스냅샷(usedParts)에 추가 (중복 무시) */
  addUsedPart(part: PartLibraryItem): void;

  /**
   * 이미 문서에 든 부품의 **정의를 갱신**한다 (선택 액션).
   *
   * `addUsedPart` 는 계약상 중복을 무시하므로, 핀맵 에디터에서 이미 쓰고 있는
   * 부품을 고쳐도 도면 스냅샷은 옛 정의 그대로였다. 그 통로가 필요해 더한다.
   * 기존 필드의 뜻은 그대로 두고 optional 로만 얹으므로 schemaVersion 은 1 이다.
   */
  syncUsedPart?(part: PartLibraryItem): void;

  /**
   * 구간 길이 입력 (선택 액션).
   *
   * `mm` 이 null 이거나 0 이하면 그 키를 **지운다** — 지우면 다시 배선에서
   * 유도된 값(없으면 미상)으로 돌아간다. 0 을 남기면 "0mm 로 자르라"가 된다.
   * 한 번 확정할 때 실행취소 한 단계만 쌓는다(타이핑마다 쌓이면 되돌릴 수 없다).
   * `syncUsedPart` 와 같이 optional 로만 얹으므로 기존 구현체는 그대로 유효하다.
   */
  setSegmentLength?(key: string, mm: number | null): void;

  /**
   * 배선 꺾임(레인) 수동 지정 (선택 액션).
   *
   * `patch` 에 **들어 있는 축만** 건드린다. 값이 `null` 이면 그 축을 **지운다** —
   * 지우면 그 축은 다시 자동 배정으로 돌아간다. **0 을 비움으로 쓰지 않는다**:
   * 0 은 "가운데 레인"이라는 뜻이라 두 지시가 구분되지 않는다(`WireRoute` 주석).
   * 두 축이 모두 사라지면 `route` 필드 자체를 지운다.
   *
   * `updateWire` 로도 못 할 것은 없지만 통로를 따로 두는 이유는 **키를 지우는 일**
   * 때문이다. `updateWire(id, { route: undefined })` 는 얕은 병합이라 키가 남고,
   * 그러면 이 기능을 쓴 적 없는 문서와 저장 파일이 달라진다. ± 버튼 한 번이
   * 실행취소 한 단계다(값이 안 바뀌면 쌓지 않는다).
   * `setSegmentLength` 와 같이 optional 로만 얹으므로 기존 구현체는 그대로 유효하다.
   */
  setWireRoute?(wireId: Id, patch: { laneY?: number | null; laneX?: number | null }): void;

  // 공통
  remove(id: Id): void;
  replaceDoc(doc: HarnessDocument): void; // 불러오기
  /** 도번·Rev 등 문서 메타 변경 (제목블록·PDF 에 반영) */
  setDocMeta(patch: Pick<Partial<HarnessDocument>, 'drawingNo' | 'rev' | 'note' | 'purchased'>): void;

  /** 문서 이름 변경 */
  rename(name: string): void;

  // 실행취소 / 다시실행
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // 영속화
  exportJson(): string;
  importJson(json: string): void;
}
