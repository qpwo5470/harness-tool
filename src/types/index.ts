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

  // 공통
  remove(id: Id): void;
  replaceDoc(doc: HarnessDocument): void; // 불러오기
  /** 도번·Rev 등 문서 메타 변경 (제목블록·PDF 에 반영) */
  setDocMeta(patch: Pick<Partial<HarnessDocument>, 'drawingNo' | 'rev'>): void;

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
