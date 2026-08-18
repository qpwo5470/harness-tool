/**
 * 물리 뷰 구간(Segment) 산출 — Claude Design 2차 §3.
 *
 * ## 왜 저장하지 않는가
 * README 는 `Seg` 타입을 저장 스키마로 제안하지만, 구간은 커넥터 위치와 배선
 * 연결관계에서 **전부 계산된다**. 저장하면 같은 사실을 두 벌 들고 있게 되어
 * 배선을 하나 고칠 때마다 도면과 구간표가 갈라진다. README 자신도 "물리 뷰의
 * 자동 구간 산출"을 미구현 항목으로 남겨 뒀다.
 * 그래서 이 파일은 문서를 **읽기만** 하는 순수 함수 모음이고,
 * `types/index.ts` 스키마는 한 줄도 늘리지 않는다.
 *
 * ## 산출 알고리즘 (4단계)
 * 1. **배선 그래프** — 커넥터(스플라이스 포함)와 장치를 정점으로, 두 정점 사이를
 *    잇는 배선 묶음을 간선(가중치 = 본수)으로 본다.
 * 2. **골격 트리** — 가중치 기준 *최대* 신장 숲(maximum spanning forest).
 *    본수가 많은 쌍일수록 실제로 함께 묶여 가는 다발이므로 그 쌍을 직결로 남기고,
 *    하네스에는 고리가 없으므로 나머지 배선은 트리 경로를 따라 우회시킨다.
 * 3. **분기점 삽입** — 커넥터에서 나온 배선은 하우징 입구에서 **한 다발**로 나와
 *    조금 뒤에 갈라진다. 그래서 트리 차수가 2 이상인 끝단(커넥터·장치)마다 바로
 *    바깥에 분기점을 하나 넣는다 → 빈 마커(단순 분기).
 *    스플라이스는 그 자체가 분기점이다 → 채움 마커(전기적 접속이 있는 분기).
 * 4. **구간** — 이렇게 만든 트리의 간선 하나가 구간 하나다. 각 배선의 트리 경로를
 *    훑어 지나가는 간선마다 배선을 적립하면 `count`(본수)와 `wireIds`(포함 배선)가
 *    나온다. 여러 배선이 함께 지나는 간선이 곧 하나의 다발이다.
 *
 * 검증: Claude Design §3 샘플 표(5구간) 중 4구간이 본수·포함 배선까지 그대로
 * 재현된다(J1→분기 6본 / 분기→J2 4본 W2·W4·W7·W9 / 분기→J3 3본 W5·W6·W9 /
 * 분기→D1 2본 W3·W8). 차이는 스플라이스를 분기점에 겹쳐 그릴지 짧은 지선으로
 * 뺄지 뿐이며, 그 선택은 데이터가 아니라 작도 취향이라 지선 쪽을 택했다.
 *
 * ## 숫자에 대한 태도
 * 물리 뷰는 **제조 도면**이다. 화면의 수치가 그대로 작업 지시가 되므로,
 * 틀린 숫자를 그럴듯하게 그리는 것보다 모르는 값을 모른다고 말하는 쪽이 낫다.
 *
 * - `derivedMm`(배선에서 유도한 구간 치수)는 **그 구간이 곧 전 경로인 배선**
 *   (트리 경로 길이 1)만 보고 정한다. 그런 배선이 있고 길이가 전부 같을 때만 값이
 *   되고, 아니면 `null` 이며 `lengthNote` 에 이유가 남는다.
 *   분기가 있는 하네스는 대부분 그런 배선이 없어 유도할 근거가 아예 없다 — 그래서
 *   **사람이 직접 넣은 값**(`doc.segmentLengths`)이 있으면 그것이 유도값을 이긴다.
 *   최종 표시값은 `lengthMm`, 그 값이 어디서 왔는지는 `lengthSource` 다.
 *   입력값도 실치수이므로 치수선을 그린다 — 출처 구분은 구간표·호버 카드가 한다.
 *   예전에는 "그 구간을 지나는 배선 길이의 최댓값"을 대표값으로 삼아 티크 달린
 *   정식 치수선으로 내보냈다. 그건 실치수가 아니다 — `J1—SP1` 100mm 2본과
 *   `SP1—J2` 150mm 2본에 `J1↔J2` 직결 900mm 를 하나 얹으면 두 구간 모두
 *   `900` 이 찍혔다(실제는 100 / 150). 경유하는 배선의 **전장**은 그 구간의
 *   길이에 대해 아무것도 말해 주지 않는다. 상한선일 뿐이다.
 * - `span`(전장)은 **끝단↔끝단 경로 길이의 최댓값**이다. 최장 배선 한 본이
 *   아니다 — 스플라이스로 이어진 500 + 500 은 전장 1,000 이다. 배선 그래프에
 *   고리가 있거나 길이가 비면 경로 합을 확정할 수 없으므로 값을 만들지 않고
 *   `spanNote` 에 이유를 남긴다. 그때 화면은 `longest`(최장 배선)를 **그 이름
 *   그대로** 쓴다.
 * - `odMm` 은 `√본수 × 대표 심선 외경` 의 **추정값**이다. UI 에 반드시 "추정"임을
 *   밝힌다.
 * - 배선 길이는 `store/wireLength.ts` 한 곳에서만 해석한다
 *   (`w.lengthMm ?? cable.lengthMm`). 물리 뷰만 케이블을 못 보던 시절에는 같은
 *   화면에 "케이블 500mm" 와 "전선 0mm · 길이 미입력 2본" 이 같이 떴다.
 * - 보호재(슬리브·테이프)는 문서에 데이터가 없다. 여기서 만들지 않는다.
 */
import type { Endpoint, Gauge, HarnessDocument, Id } from '../types';
import { buildPartList } from '../export/exporters';
import { lengthResolver, tallyLengths } from '../store/wireLength';

// ================================================================
// 타입
// ================================================================

/** 분기점 종류 — 채움(스플라이스가 있는 분기) / 빈(단순 분기) */
export type BranchKind = 'splice' | 'simple';

export type PhysNode = {
  /** 물리 트리 정점 id — `con:<id>` | `dev:<id>` | `vb:<정점 id>`(가상 분기점) */
  id: string;
  kind: 'terminal' | 'branch';
  /** 도면 레퍼런스. 끝단은 J1/D1, 분기점은 B1(작도 순서로 부여) */
  ref: string;
  /** 끝단은 부품명, 분기점은 `SP1 스플라이스` 또는 `분기` */
  name: string;
  mpn?: string;
  pinCount?: number;
  /** 장치는 점선 카드 */
  dashed: boolean;
  /** 문서상의 커넥터/장치 id — 선택 대상. 가상 분기점은 없다 */
  docId?: Id;
  branchKind?: BranchKind;
};

/**
 * 구간 길이를 치수로 낼 수 없는 이유.
 * - `mixed`   이 구간이 전 경로인 배선들의 길이가 서로 다르다
 * - `through` 이 구간만 지나는 배선이 없다(전부 더 멀리 가는 경유 배선이다)
 * - `missing` 근거가 될 배선의 길이가 비어 있다
 * - `none`    지나는 배선이 없다(있을 수 없지만 방어적으로 둔다)
 */
export type SegmentLengthNote = 'mixed' | 'through' | 'missing' | 'none';

/**
 * 구간 길이가 어디서 왔는가.
 * - `entered` 사람이 직접 넣었다(`doc.segmentLengths`)
 * - `derived` 그 구간이 곧 전 경로인 배선에서 나왔다
 */
export type SegmentLengthSource = 'entered' | 'derived';

export type Segment = {
  /** S1, S2 … */
  code: string;
  /**
   * 저장 키 — `segmentKey(from, to)`. 입력한 구간 길이는 이 키로 문서에 붙는다.
   * 구간은 저장되지 않고 유도되므로, 입력값을 다시 찾아 붙이려면 안정된 키가 필요하다.
   */
  key: string;
  /** 정점 id */
  from: string;
  to: string;
  /** 도면 레퍼런스 (J1 → B1) */
  fromRef: string;
  toRef: string;
  /** 이 구간을 지나는 배선 (문서 순서) */
  wireIds: Id[];
  /** 이 구간이 **전 경로**인 배선 — 실치수의 유일한 근거 */
  directWireIds: Id[];
  /** 본수 = wireIds.length */
  count: number;
  /**
   * 구간 실치수(mm) — **표시·치수선에 쓰는 최종값**.
   * 입력값(`doc.segmentLengths`)이 있으면 그 값, 없으면 유도값(`derivedMm`).
   * `null` 이면 치수선을 그리지 않는다 — 근거가 없다는 뜻이고 이유는 `lengthNote`.
   */
  lengthMm: number | null;
  /** lengthMm 이 어디서 왔는지. 값이 없으면 null */
  lengthSource: SegmentLengthSource | null;
  /**
   * 배선에서 **유도한** 치수(mm). `directWireIds` 의 길이가 전부 같을 때만 값이 있다.
   * 입력값이 있어도 계산해 둔다 — 두 값이 어긋나는지 검증이 봐야 하기 때문이다.
   */
  derivedMm: number | null;
  /** derivedMm 이 null 인 이유(= 유도 실패 사유). 유도값이 있으면 null */
  lengthNote: SegmentLengthNote | null;
  /** 지나는 배선 **전장**의 범위 [최소, 최대]. 실치수가 아니라 참고값이다 */
  wireRangeMm: [number, number] | null;
  /** 지나는 배선 중 길이를 알 수 없는 본수 */
  missingLength: number;
  /** 외경 **추정**(mm) = √본수 × 대표 심선 외경 */
  odMm: number | null;
};

export type LongestRun = {
  wireId: Id;
  code: string;
  lengthMm: number;
  fromRef: string;
  toRef: string;
};

/**
 * 전장을 무엇을 더해 냈는가.
 * - `wire`    배선 한 본 한 본의 길이 (근거가 가장 직접적이다)
 * - `segment` 구간 길이 (그중 일부는 사람이 입력한 값이다)
 */
export type SpanBasis = 'wire' | 'segment';

/** 전장 — 끝단↔끝단 경로 길이의 최댓값 */
export type SpanRun = {
  lengthMm: number;
  fromRef: string;
  toRef: string;
  /** 그 경로에 놓인 것들의 코드 — 배선 기준이면 `W1 W2 …`, 구간 기준이면 `S1 S2 …` */
  pathCodes: string[];
  /** 무엇을 더한 값인지. 화면은 이것을 밝혀야 한다 */
  basis: SpanBasis;
};

/**
 * 전장을 확정할 수 없는 이유.
 * - `cycle`   배선이 고리를 이뤄 두 끝단 사이 경로가 하나로 정해지지 않는다
 * - `missing` 경로에 길이를 모르는 배선이 있다
 * - `empty`   길이를 아는 배선이 없다
 */
export type SpanNote = 'cycle' | 'missing' | 'empty';

export type PhysicalModel = {
  /** 끝단 + 분기점. 구간의 from/to 가 참조한다 */
  nodes: PhysNode[];
  /** 작도 순서(루트에서 BFS)로 번호가 붙은 구간들. 트리의 간선이기도 하다 */
  segments: Segment[];
  /** 컴포넌트별 루트 정점 id (도면 왼쪽 끝) */
  roots: string[];
  /** 배선 id → W 번호 (접속표·속성 탭과 같은 규칙) */
  wireCodes: Map<Id, string>;
  /** 길이를 아는 배선의 합(mm). 케이블 심선은 케이블 길이를 따른다 */
  totalWireMm: number;
  /** totalWireMm 이 몇 본치인지 */
  countedLength: number;
  /** 길이를 알 수 없는 배선 수 — 합계가 불완전함을 밝히기 위해 */
  missingLength: number;
  /** 케이블 길이를 따르는 배선 수 */
  cableLength: number;
  /** 전장 — 끝단↔끝단 최장 경로. 확정할 수 없으면 null */
  span: SpanRun | null;
  /** span 이 null 인 이유. span 이 있으면 null */
  spanNote: SpanNote | null;
  /**
   * 가장 긴 배선 **한 본**. 전장이 아니다 —
   * 전장을 확정할 수 없을 때 화면이 사실대로 쓸 수 있는 보조 표기다.
   */
  longest: LongestRun | null;
};

export type MaterialRow = {
  key: string;
  /** 항목명 */
  name: string;
  /** 규격 */
  spec: string;
  /** 수량(단위 포함) */
  qty: string;
};

// ================================================================
// 작은 유틸
// ================================================================

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 3자리 콤마 — Barlow tabular-nums 와 함께 도면 숫자 규칙 */
export function formatMm(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 구간 길이를 치수로 내지 못한 이유 — 화면 문구.
 * 문구를 여기 두는 이유: 구간표·호버 카드·시험이 같은 말을 써야 하고,
 * 판정(왜 `—` 인가)과 문구가 떨어져 있으면 한쪽만 고쳐진다.
 */
export function segmentLengthNoteText(note: SegmentLengthNote): string {
  if (note === 'mixed') return '배선마다 다름';
  if (note === 'through') return '지나가는 배선뿐 — 실치수 미상';
  if (note === 'missing') return '길이 미입력';
  return '배선 없음';
}

/** 전장을 확정할 수 없는 이유 — 화면 문구 */
export function spanNoteText(note: SpanNote): string {
  if (note === 'cycle') return '배선이 고리를 이뤄 전장을 확정할 수 없습니다';
  if (note === 'missing') return '길이 미입력이 있어 전장을 확정할 수 없습니다';
  return '배선 길이를 넣으면 전장이 잡힙니다';
}

/** 지나는 배선 전장의 범위 — "100–900mm". 하나뿐이면 한 값만 */
export function formatRange(range: [number, number]): string {
  const [lo, hi] = range;
  return lo === hi ? `${formatMm(lo)}mm` : `${formatMm(lo)}–${formatMm(hi)}mm`;
}

/**
 * 도면 레퍼런스 — 커넥터 J1.., 스플라이스 SP1.., 장치 D1..
 * 문서 등장 순서로 고정한다(다시 계산해도 같은 번호가 나와야 한다).
 * 캔버스와 같은 규칙이지만, 동시에 수정 중인 파일을 물고 있지 않도록 여기서 다시 센다.
 */
export function refLabels(doc: HarnessDocument): Map<Id, string> {
  const out = new Map<Id, string>();
  let j = 0;
  let sp = 0;
  let d = 0;
  for (const c of doc.connectors) out.set(c.id, c.kind === 'splice' ? `SP${++sp}` : `J${++j}`);
  for (const dev of doc.devices) out.set(dev.id, `D${++d}`);
  return out;
}

/** 배선 번호 W1.. — 접속표·파트 탭과 같은 규칙(문서 순서) */
export function wireCodes(doc: HarnessDocument): Map<Id, string> {
  return new Map(doc.wires.map((w, i) => [w.id, `W${i + 1}`] as const));
}

/**
 * 심선(도체) 지름 추정.
 * AWG: d = 0.127 × 92^((36−n)/39) mm — 규격 정의식.
 * mm²: 원형 단면 가정 d = 2√(A/π).
 */
export function conductorDiameterMm(g: Gauge): number {
  if (g.system === 'awg') return 0.127 * Math.pow(92, (36 - g.value) / 39);
  return 2 * Math.sqrt(Math.max(g.value, 0) / Math.PI);
}

/** 피복 두께 몫(지름 기준 가산치). 규격이 문서에 없으므로 고정 추정값이다. */
export const INSULATION_MM = 0.8;

/** 피복 포함 전선 외경 추정 */
export function wireDiameterMm(g: Gauge): number {
  return conductorDiameterMm(g) + INSULATION_MM;
}

/** 다발 외경 추정 = √본수 × 대표 심선 외경 (원형 충전 근사) */
export function bundleDiameterMm(count: number, coreMm: number): number {
  return r1(Math.sqrt(Math.max(count, 0)) * coreMm);
}

// ================================================================
// Union-Find (최대 신장 숲)
// ================================================================

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = this.parent.get(x)!;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }
  /** 합쳐졌으면 true (= 트리 간선으로 채택) */
  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }
}

// ================================================================
// 구간 키 — 저장부와 도출부가 같이 쓰는 **한 곳**
// ================================================================

/**
 * 간선(=구간) 하나의 키. 양 끝 정점 id 를 정렬해 붙인다 → `a|b`.
 *
 * ## 왜 이 키인가
 * 구간은 저장되지 않고 배선 그래프에서 유도되므로(파일 첫머리 주석), 사람이 넣은
 * 구간 길이를 다시 그 구간에 붙이려면 **다시 계산해도 같은 값이 나오는 이름**이
 * 있어야 한다. 정점 id 는 문서 안의 커넥터·장치 id(와 그 바깥 분기점)에서 오므로
 * 배선을 더하고 빼도 변하지 않는다. 반면 `S1`·`B1` 같은 코드는 **작도 순서**로
 * 매겨져 배선 한 본만 늘어도 통째로 밀린다 — 그걸 키로 쓰면 어제 넣은 300mm 가
 * 오늘 옆 구간에 가서 붙는다. 정렬해 붙이는 이유는 같은 구간을 어느 쪽에서
 * 부르든 한 키여야 하기 때문이다.
 *
 * 이 함수는 배선 그래프의 간선·트리 간선·저장 키가 **전부** 지나간다.
 * 두 벌로 만들면 도출부와 저장부가 다른 이름을 쓰게 되고, 그러면 입력한 길이가
 * 아무 데도 붙지 않은 채 파일에만 남는다.
 */
export function segmentKey(u: string, v: string): string {
  return u < v ? `${u}|${v}` : `${v}|${u}`;
}

/** 정점 id → 그 정점이 가리키는 문서 id (`con:x` · `dev:x` · `vb:con:x`) */
const VERTEX_RE = /^(?:vb:)?(?:con|dev):(.+)$/;

/**
 * 저장된 구간 키가 가리키는 **문서 id 들**. 형식이 아니면 null.
 * 불러오기(`store/persistence.ts`)가 "존재하지 않는 부품을 가리키는 키"를 걸러낼 때
 * 쓴다 — 키를 만드는 곳과 읽는 곳이 같은 파일에 있어야 규칙이 갈라지지 않는다.
 */
export function segmentKeyRefs(key: string): Id[] | null {
  const parts = key.split('|');
  // id 에 `|` 가 섞이면 두 토막으로 갈리지 않는다 — 그런 키는 우리가 만든 적이 없다
  if (parts.length !== 2) return null;
  const ids: Id[] = [];
  for (const p of parts) {
    const m = VERTEX_RE.exec(p);
    if (!m) return null;
    ids.push(m[1]);
  }
  // 정렬 규칙을 어긴 키는 도출부가 절대 만들지 않는다 → 어디에도 붙지 않을 키다
  if (segmentKey(parts[0], parts[1]) !== key) return null;
  return ids;
}

/**
 * 문서에 든 입력 길이 하나를 읽는다. 숫자가 아니거나 0 이하면 **없는 것으로** 본다.
 * (불러오기에서 이미 걸러 내지만, 손으로 만든 문서가 곧장 들어오는 길도 있다.)
 */
function enteredLengthOf(doc: HarnessDocument, key: string): number | null {
  const v = doc.segmentLengths?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

// ================================================================
// 전장(끝단↔끝단 최장 경로)
// ================================================================

/**
 * 길이를 아는 간선 하나.
 * 배선 기준이면 배선 한 본(`id` = 배선 id), 구간 기준이면 구간 하나(`id` = S 코드).
 */
export type SpanEdge = { a: string; b: string; id: string; mm: number | null };

/**
 * 끝단↔끝단 경로 길이의 최댓값(전장)을 구한다.
 *
 * ## 왜 "최장 배선 한 본" 이 아닌가
 * 스플라이스로 이어진 `J1→SP1 500` + `SP1→J2 500` 은 끝에서 끝까지 1,000mm 다.
 * 최장 배선을 전장이라 부르면 도면 전폭 치수선에 500 이 찍힌다 — 절반이 거짓이다.
 *
 * ## 언제 값을 만들지 않는가
 * - 배선 그래프에 **고리**가 있으면 두 끝단 사이 경로가 여러 개라 전장이 하나로
 *   정해지지 않는다(어느 경로를 따라 재는지 도면 데이터에 없다).
 * - 길이를 모르는 배선이 하나라도 있으면 경로 합을 낼 수 없다. 아는 것만 더하면
 *   **실제보다 짧은** 숫자가 나와 그게 제일 나쁘다.
 * 두 경우 모두 `null` 을 돌려주고 이유를 남긴다. 화면은 그때 "최장 배선"이라고
 * 사실대로 쓴다.
 *
 * ## 같은 두 부품을 잇는 배선이 여러 본이면
 * 하나의 간선으로 합치되 길이는 **최댓값**을 쓴다. 그 배선들은 같은 다발을
 * 지나가므로 도면상 두 부품이 벌어진 거리는 가장 긴 배선을 따른다(짧은 쪽은
 * 여유가 덜 든 것이다). 이렇게 해야 `J1↔J2` 6본짜리 단순 하네스처럼 고리가
 * 아닌 경우를 고리로 오판하지 않는다.
 *
 * ## 무엇을 간선으로 넣는가
 * 이 함수는 "길이를 아는 간선들"만 알면 된다. `buildPhysicalModel` 은 두 번 부른다:
 * 배선 한 본씩(가장 직접적인 근거)으로 한 번, 그것이 실패하면 **구간 길이**로 한 번.
 * 구간 길이에는 사람이 입력한 값이 들어 있으므로, 배선만으로는 고리·미입력 때문에
 * 확정할 수 없던 하네스도 전장이 잡힌다. 구간 트리는 정의상 고리가 없다.
 */
export function endToEndSpan(
  edges: SpanEdge[],
): { run: { from: string; to: string; mm: number; path: string[] } | null; note: SpanNote | null } {
  if (!edges.length) return { run: null, note: 'empty' };
  if (edges.some((e) => e.mm == null)) return { run: null, note: 'missing' };

  // 평행 간선(같은 두 부품 사이 여러 본)을 최댓값 하나로 합친다
  const merged = new Map<string, { a: string; b: string; id: string; mm: number }>();
  for (const e of edges) {
    const k = segmentKey(e.a, e.b);
    const cur = merged.get(k);
    if (!cur || (e.mm as number) > cur.mm) merged.set(k, { a: e.a, b: e.b, id: e.id, mm: e.mm as number });
  }

  const adj = new Map<string, { to: string; mm: number; id: string }[]>();
  const link = (u: string, v: string, mm: number, id: string) => {
    const list = adj.get(u) ?? [];
    list.push({ to: v, mm, id });
    adj.set(u, list);
  };
  for (const e of merged.values()) {
    link(e.a, e.b, e.mm, e.id);
    link(e.b, e.a, e.mm, e.id);
  }

  /** 한 정점에서 가장 먼 정점까지 — 나무이므로 방문 표시만으로 충분하다 */
  const farthest = (start: string) => {
    const dist = new Map<string, number>([[start, 0]]);
    const via = new Map<string, { from: string; id: string }>();
    const stack = [start];
    let best = start;
    const comp: string[] = [];
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const e of adj.get(v) ?? []) {
        if (dist.has(e.to)) continue;
        dist.set(e.to, (dist.get(v) ?? 0) + e.mm);
        via.set(e.to, { from: v, id: e.id });
        if ((dist.get(e.to) ?? 0) > (dist.get(best) ?? 0)) best = e.to;
        stack.push(e.to);
      }
    }
    return { best, dist, via, comp };
  };

  const seen = new Set<string>();
  let out: { from: string; to: string; mm: number; path: string[] } | null = null;

  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const first = farthest(start);
    for (const v of first.comp) seen.add(v);

    // 나무인가 — 간선 수가 정점 수 - 1 이어야 한다
    const compSet = new Set(first.comp);
    let deg = 0;
    for (const v of first.comp) deg += (adj.get(v) ?? []).length;
    if (deg / 2 !== compSet.size - 1) return { run: null, note: 'cycle' };

    // 두 번째 탐색 = 지름
    const second = farthest(first.best);
    const mm = second.dist.get(second.best) ?? 0;
    if (!out || mm > out.mm) {
      const path: string[] = [];
      let cur = second.best;
      while (cur !== first.best) {
        const step = second.via.get(cur);
        if (!step) break;
        path.push(step.id);
        cur = step.from;
      }
      out = { from: first.best, to: second.best, mm, path: path.reverse() };
    }
  }

  return out ? { run: out, note: null } : { run: null, note: 'empty' };
}

// ================================================================
// 본체
// ================================================================

export function buildPhysicalModel(doc: HarnessDocument): PhysicalModel {
  const refs = refLabels(doc);
  const codes = wireCodes(doc);

  const connIndex = new Map(doc.connectors.map((c, i) => [c.id, i] as const));
  const devIndex = new Map(doc.devices.map((d, i) => [d.id, i] as const));

  /** 끝점 → 물리 트리 정점 id (문서에 없는 참조는 버린다) */
  const vertexOf = (e: Endpoint): string | null => {
    if (e.type === 'pin') return connIndex.has(e.connectorId) ? `con:${e.connectorId}` : null;
    return devIndex.has(e.deviceId) ? `dev:${e.deviceId}` : null;
  };

  // --- 정점 메타 (끝단 카드 / 스플라이스 마커) ---
  const meta = new Map<string, PhysNode>();
  for (const c of doc.connectors) {
    const part = doc.usedParts.find((p) => p.id === c.housingId);
    const isSplice = c.kind === 'splice';
    meta.set(`con:${c.id}`, {
      id: `con:${c.id}`,
      kind: isSplice ? 'branch' : 'terminal',
      ref: isSplice ? '' : (refs.get(c.id) ?? c.id),
      name: isSplice ? `${refs.get(c.id) ?? c.id} 스플라이스` : (part?.name ?? '커넥터'),
      mpn: part?.mpn,
      pinCount: c.pins.length,
      dashed: false,
      docId: c.id,
      // 내부 결선(bridges)이 있으면 실제 압착/꼬임 접속이 있는 분기 → 채움
      branchKind: isSplice ? ((c.bridges?.length ?? 0) > 0 ? 'splice' : 'simple') : undefined,
    });
  }
  for (const d of doc.devices) {
    meta.set(`dev:${d.id}`, {
      id: `dev:${d.id}`,
      kind: 'terminal',
      ref: refs.get(d.id) ?? d.id,
      name: d.name,
      pinCount: d.terminals?.length,
      dashed: true,
      docId: d.id,
    });
  }

  /** 자식 정렬·루트 결정을 위한 결정론적 순서 */
  const ordOf = (v: string): number => {
    if (v.startsWith('vb:')) return ordOf(v.slice(3)) + 0.5;
    const id = v.slice(4);
    if (v.startsWith('con:')) return connIndex.get(id) ?? 0;
    return doc.connectors.length + (devIndex.get(id) ?? 0);
  };

  // --- 1) 배선 그래프 ---
  type Link = { a: string; b: string; wires: Id[]; order: number };
  const links = new Map<string, Link>();
  /** 배선 → 양 끝 정점 (문서 순서 유지) */
  const wireVerts = new Map<Id, [string, string]>();
  let seen = 0;
  for (const w of doc.wires) {
    const a = vertexOf(w.from);
    const b = vertexOf(w.to);
    if (!a || !b || a === b) continue; // 같은 부품 안에서 도는 배선은 구간을 만들지 않는다
    wireVerts.set(w.id, [a, b]);
    const k = segmentKey(a, b);
    const cur = links.get(k);
    if (cur) cur.wires.push(w.id);
    else links.set(k, { a: a < b ? a : b, b: a < b ? b : a, wires: [w.id], order: seen++ });
  }

  // --- 2) 최대 신장 숲 (본수 많은 쌍 우선) ---
  const uf = new UnionFind();
  const adj = new Map<string, Set<string>>();
  const nbrs = (v: string) => {
    let s = adj.get(v);
    if (!s) {
      s = new Set<string>();
      adj.set(v, s);
    }
    return s;
  };
  const addEdge = (u: string, v: string) => {
    nbrs(u).add(v);
    nbrs(v).add(u);
  };
  const delEdge = (u: string, v: string) => {
    nbrs(u).delete(v);
    nbrs(v).delete(u);
  };

  const ranked = [...links.values()].sort(
    (x, y) => y.wires.length - x.wires.length || x.order - y.order,
  );
  for (const l of ranked) {
    if (uf.union(l.a, l.b)) addEdge(l.a, l.b);
  }

  // --- 3) 분기점 삽입 ---
  // 차수 2 이상인 끝단은 하우징 바로 바깥에서 다발이 갈라진다 → 가상 분기점(빈 마커)
  for (const v of [...adj.keys()]) {
    const node = meta.get(v);
    if (!node || node.kind !== 'terminal') continue;
    const around = [...nbrs(v)];
    if (around.length < 2) continue;
    const b = `vb:${v}`;
    meta.set(b, { id: b, kind: 'branch', ref: '', name: '분기', dashed: false, branchKind: 'simple' });
    for (const u of around) {
      delEdge(v, u);
      addEdge(b, u);
    }
    addEdge(v, b);
  }

  // --- 4) 루트 선택 + BFS (작도 순서 = 번호 순서) ---
  const wireCountAt = new Map<string, number>();
  for (const [, [a, b]] of wireVerts) {
    wireCountAt.set(a, (wireCountAt.get(a) ?? 0) + 1);
    wireCountAt.set(b, (wireCountAt.get(b) ?? 0) + 1);
  }

  const allVerts = [...adj.keys()].sort((a, b) => ordOf(a) - ordOf(b));
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const depth = new Map<string, number>();
  const roots: string[] = [];
  const treeEdges: [string, string][] = [];
  const branchOrder: string[] = [];

  for (const start of allVerts) {
    if (visited.has(start)) continue;

    // 컴포넌트 수집
    const comp: string[] = [];
    const stack = [start];
    const mark = new Set<string>([start]);
    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const u of nbrs(v)) if (!mark.has(u)) { mark.add(u); stack.push(u); }
    }

    // 루트 = 배선이 가장 많이 물린 끝단 (동률이면 문서 순서). 끝단이 없으면 첫 정점.
    const terminals = comp.filter((v) => meta.get(v)?.kind === 'terminal');
    const pool = terminals.length ? terminals : comp;
    const root = pool.reduce((best, v) => {
      const bw = wireCountAt.get(best) ?? 0;
      const vw = wireCountAt.get(v) ?? 0;
      if (vw !== bw) return vw > bw ? v : best;
      return ordOf(v) < ordOf(best) ? v : best;
    }, pool[0]);

    roots.push(root);
    visited.add(root);
    depth.set(root, 0);
    if (meta.get(root)?.kind === 'branch') branchOrder.push(root);

    const queue = [root];
    while (queue.length) {
      const v = queue.shift()!;
      const children = [...nbrs(v)]
        .filter((u) => !visited.has(u))
        .sort((a, b) => ordOf(a) - ordOf(b));
      for (const u of children) {
        visited.add(u);
        parent.set(u, v);
        depth.set(u, (depth.get(v) ?? 0) + 1);
        treeEdges.push([v, u]);
        if (meta.get(u)?.kind === 'branch') branchOrder.push(u);
        queue.push(u);
      }
    }
  }

  // 분기점 레퍼런스 B1.. — 작도 순서(왼쪽에서 오른쪽)로 붙는다
  branchOrder.forEach((v, i) => {
    const node = meta.get(v);
    if (node) meta.set(v, { ...node, ref: `B${i + 1}` });
  });

  const refOf = (v: string) => meta.get(v)?.ref ?? v;

  // --- 구간 골격 ---
  const segIndex = new Map<string, number>();
  const wireBuckets: Id[][] = treeEdges.map(() => []);
  /** 그 구간이 **전 경로**인 배선 — 구간 실치수의 유일한 근거 */
  const directBuckets: Id[][] = treeEdges.map(() => []);
  treeEdges.forEach(([u, v], i) => segIndex.set(segmentKey(u, v), i));

  // 각 배선의 트리 경로를 훑어 지나가는 구간에 적립
  const climb = (a: string, b: string): string[] => {
    const up: string[] = [];
    const down: string[] = [];
    let x = a;
    let y = b;
    let guard = 0;
    while (x !== y && guard++ < 4096) {
      const dx = depth.get(x) ?? 0;
      const dy = depth.get(y) ?? 0;
      if (dx >= dy) {
        const p = parent.get(x);
        if (p === undefined) break;
        up.push(segmentKey(x, p));
        x = p;
      } else {
        const p = parent.get(y);
        if (p === undefined) break;
        down.push(segmentKey(y, p));
        y = p;
      }
    }
    return [...up, ...down.reverse()];
  };

  for (const [wid, [a, b]] of wireVerts) {
    const path = climb(a, b);
    for (const k of path) {
      const i = segIndex.get(k);
      if (i === undefined) continue;
      wireBuckets[i].push(wid);
      // 경로가 이 간선 하나뿐이면 배선의 전장이 곧 이 구간의 길이다.
      // 두 칸 이상 가는 배선의 전장은 이 구간에 대해 상한선일 뿐이다.
      if (path.length === 1) directBuckets[i].push(wid);
    }
  }

  const wireById = new Map(doc.wires.map((w) => [w.id, w] as const));
  // 길이는 공용 해석기로만 읽는다 — 케이블 심선도 케이블 길이를 따른다
  const resolve = lengthResolver(doc);
  const lengthOfId = (id: Id): number | null => {
    const w = wireById.get(id);
    return w ? resolve(w).mm : null;
  };

  const segments: Segment[] = treeEdges.map(([u, v], i) => {
    const wireIds = wireBuckets[i];
    const directIds = directBuckets[i];
    const key = segmentKey(u, v);

    // --- 유도값: 이 구간이 전 경로인 배선만 근거로 삼는다 ---
    const directLens = directIds.map(lengthOfId);
    const known = directLens.filter((n): n is number => n != null);
    let derivedMm: number | null = null;
    let lengthNote: SegmentLengthNote | null = null;
    if (!wireIds.length) lengthNote = 'none';
    else if (!directIds.length) lengthNote = 'through';
    else if (known.length < directIds.length) lengthNote = 'missing';
    else if (Math.min(...known) !== Math.max(...known)) lengthNote = 'mixed';
    else derivedMm = known[0];

    // --- 입력값이 유도값을 이긴다 ---
    // 유도값은 "그 구간이 곧 전 경로인 배선"이 있을 때만 나온다. 분기가 있는
    // 하네스에는 그런 배선이 없어 근거가 아예 없고, 그 자리를 메우라고 사람이
    // 넣는 값이다. 다만 **덮어썼다는 사실을 감추지 않는다** — lengthSource 로
    // 출처를 밝히고, 유도값도 derivedMm 에 그대로 남겨 검증이 대조하게 둔다.
    const enteredMm = enteredLengthOf(doc, key);
    const lengthMm = enteredMm ?? derivedMm;
    const lengthSource: SegmentLengthSource | null =
      enteredMm != null ? 'entered' : derivedMm != null ? 'derived' : null;

    // --- 참고값: 지나는 배선 전장의 범위 (치수가 아니다) ---
    const allLens = wireIds.map(lengthOfId).filter((n): n is number => n != null);
    const cores = wireIds
      .map((id) => wireById.get(id)?.gauge)
      .filter((g): g is Gauge => !!g)
      .map(wireDiameterMm);

    return {
      code: `S${i + 1}`,
      key,
      from: u,
      to: v,
      fromRef: refOf(u),
      toRef: refOf(v),
      wireIds,
      directWireIds: directIds,
      count: wireIds.length,
      lengthMm,
      lengthSource,
      derivedMm,
      lengthNote,
      wireRangeMm: allLens.length ? [Math.min(...allLens), Math.max(...allLens)] : null,
      missingLength: wireIds.length - allLens.length,
      odMm: cores.length ? bundleDiameterMm(wireIds.length, Math.max(...cores)) : null,
    };
  });

  // --- 합계 ---
  const tally = tallyLengths(doc.wires, resolve);

  // --- 최장 배선 한 본 (전장이 아니다) ---
  let longest: LongestRun | null = null;
  for (const [wid, [a, b]] of wireVerts) {
    const len = lengthOfId(wid);
    if (len == null) continue;
    if (!longest || len > longest.lengthMm) {
      longest = {
        wireId: wid,
        code: codes.get(wid) ?? wid,
        lengthMm: len,
        fromRef: refOf(a),
        toRef: refOf(b),
      };
    }
  }

  // --- 전장 = 끝단↔끝단 최장 경로 ---
  // ① 배선 기준. 전선 한 본 한 본의 실제 길이를 더한 것이라 근거가 가장 직접적이다.
  const wireSpan = endToEndSpan(
    [...wireVerts].map(([wid, [a, b]]) => ({ a, b, id: wid, mm: lengthOfId(wid) })),
  );
  // ② 구간 기준(대체). 배선만으로는 고리·미입력 때문에 확정할 수 없던 하네스도,
  //    사람이 구간 길이를 넣어 두면 전장이 잡힌다. 구간 트리는 고리가 없고
  //    모든 구간 길이가 확정됐을 때만 값이 나온다(하나라도 비면 endToEndSpan 이
  //    'missing' 을 돌려준다) — 아는 것만 더해 실제보다 짧은 숫자를 내지 않는다.
  //    ①이 성공하면 그것을 쓴다: 이미 확정된 근거를 입력값으로 뒤집지 않는다.
  //    두 값이 어긋나면 조용히 고르는 대신 검증이 짚는다(segment-length-conflict).
  const segSpan = wireSpan.run
    ? null
    : endToEndSpan(segments.map((s) => ({ a: s.from, b: s.to, id: s.code, mm: s.lengthMm })));
  const run = wireSpan.run ?? segSpan?.run ?? null;
  const basis: SpanBasis = wireSpan.run ? 'wire' : 'segment';
  // 대체 계산도 실패했으면 이유는 **배선 기준의 이유**를 그대로 쓴다 —
  // 사용자가 먼저 손볼 곳은 배선 길이·고리이지 구간 입력칸이 아니다.
  const spanNote = run ? null : wireSpan.note;
  // 라벨은 도면과 같은 방향으로 읽혀야 한다(왼쪽 → 오른쪽 = 작도 순서).
  // 지름 탐색은 어느 끝에서 시작했느냐에 따라 방향이 뒤집히므로 여기서 맞춘다.
  const flip = run ? ordOf(run.to) < ordOf(run.from) : false;
  const span: SpanRun | null = run
    ? {
        lengthMm: run.mm,
        fromRef: refOf(flip ? run.to : run.from),
        toRef: refOf(flip ? run.from : run.to),
        pathCodes: (flip ? [...run.path].reverse() : run.path).map(
          // 배선 기준일 때만 W 번호로 옮긴다. 구간 기준은 이미 S 코드다.
          (id) => (basis === 'wire' ? (codes.get(id) ?? id) : id),
        ),
        basis,
      }
    : null;

  // 트리에 실제로 쓰인 정점만 내보낸다 (배선이 없는 커넥터는 물리 도면에 나오지 않는다)
  const nodes = [...adj.keys()]
    .map((v) => meta.get(v))
    .filter((n): n is PhysNode => !!n)
    .sort((a, b) => ordOf(a.id) - ordOf(b.id));

  return {
    nodes,
    segments,
    roots,
    wireCodes: codes,
    totalWireMm: tally.totalMm,
    countedLength: tally.counted,
    missingLength: tally.missing,
    cableLength: tally.fromCable,
    span,
    spanNote,
    longest,
  };
}

// ================================================================
// 케이블 자켓 — 물리 뷰
// ================================================================

/**
 * 한 케이블의 심선들이 **함께 지나는 구간**.
 *
 * 논리 뷰의 자켓(canvas/wirePlan.planJackets)과 **같은 뜻**이다: 심선 2본 이상이
 * 나란히 가는 구간이 자켓이고, 그 바깥은 이미 갈라진 뒤다. 다만 물리 뷰는 좌표가
 * 아니라 **구간 트리** 위에 그려지므로(layoutTree) 사각형이 아니라 구간 코드로
 * 답한다 — 두 뷰의 기하는 애초에 같은 좌표계가 아니다.
 *
 * 왜 여기 있나: 구간을 아는 곳이 여기뿐이다. 화면(PhysicalView)이 직접 세면
 * 도면의 S3 와 자켓의 S3 가 갈릴 수 있다(구간 규칙은 이 파일 한 곳에 있다).
 */
export type CableRun = {
  cableId: Id;
  /** 이 케이블 심선이 **2본 이상** 지나는 구간 코드 (작도 순서) */
  segCodes: string[];
  /** 문서에 적힌 심선 id (문서 순서) */
  coreIds: Id[];
  /** 자켓색 원문. 미지정이면 undefined — 색을 지어내지 않는다 */
  jacketColor?: string;
  name: string;
};

export function cableRuns(doc: HarnessDocument, model: PhysicalModel): CableRun[] {
  return (doc.cables ?? []).map((cb) => {
    const coreIds = doc.wires.filter((w) => w.cableId === cb.id).map((w) => w.id);
    const mine = new Set(coreIds);
    const segCodes = model.segments
      .filter((s) => s.wireIds.filter((id) => mine.has(id)).length >= 2)
      .map((s) => s.code);
    return {
      cableId: cb.id,
      segCodes,
      coreIds,
      ...(cb.jacketColor != null ? { jacketColor: cb.jacketColor } : {}),
      name: cb.name ?? `${cb.coreCount}C 케이블`,
    };
  });
}

// ================================================================
// 자재 요약
// ================================================================

/**
 * 자재 요약 — **실재하는 것만** 넣는다.
 * 보호재(슬리브·테이프)는 문서에 데이터가 없으므로 여기 오지 않는다.
 * 집계 규칙은 파트리스트(export/exporters)와 같은 것을 쓴다 —
 * 물리 뷰가 따로 세면 발주 숫자가 화면마다 달라진다.
 *
 * ## 입력한 구간 길이는 여기 오지 않는다
 * 발주하는 것은 **전선 길이**지 구간 길이가 아니다. 구간은 여러 전선이 함께 지나는
 * 다발이라, 구간 길이를 자재에 더하면 같은 전선을 구간 수만큼 다시 세는 꼴이 된다
 * (S1 6본 300mm + S2 4본 200mm 를 더하면 실제 사야 할 전선보다 훨씬 길다).
 * 구간 길이는 **작업 지시용 치수**이고, 자재는 배선 하나하나의 재단 길이로만 낸다
 * (`store/wireLength.ts`). 그래서 이 함수는 `doc.segmentLengths` 를 보지 않는다.
 */
export function materialRows(doc: HarnessDocument): MaterialRow[] {
  const unit: Record<string, string> = { 커넥터: 'ea', 터미널: 'ea', 와이어: '본', 케이블: 'ea' };
  const spec: Record<string, string> = {
    커넥터: '하우징',
    터미널: '압착단자',
    와이어: '길이 미입력',
    케이블: '케이블',
  };
  return buildPartList(doc).map((r, i) => ({
    key: `${r.category}-${r.part}-${i}`,
    name: r.part,
    spec: r.detail ?? spec[r.category] ?? r.category,
    qty: `${r.qty}${unit[r.category] ?? 'ea'}`,
  }));
}
