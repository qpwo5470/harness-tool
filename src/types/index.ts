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

  connectors: Connector[];
  devices: Device[];
  wires: Wire[];
  cables?: Cable[];

  /**
   * 자기완결(self-contained) 저장용 스냅샷.
   * 문서에서 실제 쓰인 라이브러리 항목을 함께 저장 → 라이브러리가 나중에
   * 바뀌어도 JSON 파일 단독으로 도면/파트리스트를 정확히 재현.
   */
  usedParts: PartLibraryItem[];
};

// ================================================================
// 7. 스토어 계약 (앱 상태 인터페이스)
//    - 구현체(Zustand 등)는 이 시그니처를 따른다.
// ================================================================

export type ViewMode = 'logical' | 'physical';

export interface HarnessStore {
  doc: HarnessDocument;
  selection: Id | null;
  activeView: ViewMode;

  // 조회/선택
  select(id: Id | null): void;
  setView(view: ViewMode): void;

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

  // 공통
  remove(id: Id): void;
  replaceDoc(doc: HarnessDocument): void; // 불러오기
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
