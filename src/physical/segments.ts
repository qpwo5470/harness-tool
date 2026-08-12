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
 * - `lengthMm` 은 그 구간을 지나는 배선 길이의 **대표값(최댓값)** 이다.
 *   배선 길이는 전 경로의 길이라 구간별로 쪼갤 근거가 없다. 하나도 입력돼 있지
 *   않으면 `null` 로 두고 화면에는 `—` 를 찍는다. 지어내지 않는다.
 * - `odMm` 은 `√본수 × 대표 심선 외경` 의 **추정값**이다. UI 에 반드시 "추정"임을
 *   밝힌다.
 * - 보호재(슬리브·테이프)는 문서에 데이터가 없다. 여기서 만들지 않는다.
 */
import type { Endpoint, Gauge, HarnessDocument, Id } from '../types';
import { buildPartList } from '../export/exporters';

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

export type Segment = {
  /** S1, S2 … */
  code: string;
  /** 정점 id */
  from: string;
  to: string;
  /** 도면 레퍼런스 (J1 → B1) */
  fromRef: string;
  toRef: string;
  /** 이 구간을 지나는 배선 (문서 순서) */
  wireIds: Id[];
  /** 본수 = wireIds.length */
  count: number;
  /** 대표 길이(mm). 구간의 배선 길이 중 최댓값. 전부 미입력이면 null */
  lengthMm: number | null;
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

export type PhysicalModel = {
  /** 끝단 + 분기점. 구간의 from/to 가 참조한다 */
  nodes: PhysNode[];
  /** 작도 순서(루트에서 BFS)로 번호가 붙은 구간들. 트리의 간선이기도 하다 */
  segments: Segment[];
  /** 컴포넌트별 루트 정점 id (도면 왼쪽 끝) */
  roots: string[];
  /** 배선 id → W 번호 (접속표·속성 탭과 같은 규칙) */
  wireCodes: Map<Id, string>;
  /** 길이가 입력된 배선의 합(mm) */
  totalWireMm: number;
  /** 길이가 비어 있는 배선 수 — 합계가 불완전함을 밝히기 위해 */
  missingLength: number;
  /** 가장 긴 배선 하나 (전장 치수 라벨용). 길이가 하나도 없으면 null */
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

const edgeKey = (u: string, v: string) => (u < v ? `${u}|${v}` : `${v}|${u}`);

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
    const k = edgeKey(a, b);
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
  treeEdges.forEach(([u, v], i) => segIndex.set(edgeKey(u, v), i));

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
        up.push(edgeKey(x, p));
        x = p;
      } else {
        const p = parent.get(y);
        if (p === undefined) break;
        down.push(edgeKey(y, p));
        y = p;
      }
    }
    return [...up, ...down.reverse()];
  };

  for (const [wid, [a, b]] of wireVerts) {
    for (const k of climb(a, b)) {
      const i = segIndex.get(k);
      if (i !== undefined) wireBuckets[i].push(wid);
    }
  }

  const wireById = new Map(doc.wires.map((w) => [w.id, w] as const));

  const segments: Segment[] = treeEdges.map(([u, v], i) => {
    const wireIds = wireBuckets[i];
    const lens = wireIds
      .map((id) => wireById.get(id)?.lengthMm)
      .filter((n): n is number => typeof n === 'number');
    const cores = wireIds
      .map((id) => wireById.get(id)?.gauge)
      .filter((g): g is Gauge => !!g)
      .map(wireDiameterMm);
    return {
      code: `S${i + 1}`,
      from: u,
      to: v,
      fromRef: refOf(u),
      toRef: refOf(v),
      wireIds,
      count: wireIds.length,
      lengthMm: lens.length ? Math.max(...lens) : null,
      odMm: cores.length ? bundleDiameterMm(wireIds.length, Math.max(...cores)) : null,
    };
  });

  // --- 합계 / 전장 ---
  let totalWireMm = 0;
  let missingLength = 0;
  for (const w of doc.wires) {
    if (typeof w.lengthMm === 'number') totalWireMm += w.lengthMm;
    else missingLength += 1;
  }

  let longest: LongestRun | null = null;
  for (const [wid, [a, b]] of wireVerts) {
    const len = wireById.get(wid)?.lengthMm;
    if (typeof len !== 'number') continue;
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

  // 트리에 실제로 쓰인 정점만 내보낸다 (배선이 없는 커넥터는 물리 도면에 나오지 않는다)
  const nodes = [...adj.keys()]
    .map((v) => meta.get(v))
    .filter((n): n is PhysNode => !!n)
    .sort((a, b) => ordOf(a.id) - ordOf(b.id));

  return { nodes, segments, roots, wireCodes: codes, totalWireMm, missingLength, longest };
}

// ================================================================
// 자재 요약
// ================================================================

/**
 * 자재 요약 — **실재하는 것만** 넣는다.
 * 보호재(슬리브·테이프)는 문서에 데이터가 없으므로 여기 오지 않는다.
 * 집계 규칙은 파트리스트(export/exporters)와 같은 것을 쓴다 —
 * 물리 뷰가 따로 세면 발주 숫자가 화면마다 달라진다.
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
