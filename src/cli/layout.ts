/**
 * CLI 자동 배치 — 좌표 없이 만든 하네스가 GUI·PDF 에서 바로 읽히게 놓는다.
 *
 * 규칙(스펙 CLI-스펙.md):
 *  · 두 열. 왼쪽 열은 rot=180(핸들이 오른쪽 변), 오른쪽 열은 rot=0(핸들이 왼쪽 변).
 *    그래서 두 열이 마주 보고, 배선은 가운데 통로를 가로지른다.
 *  · 어느 열에 앉을지는 **배선이 정한다** — 선언 순서로 처음 만나는 끝단이 왼쪽,
 *    그와 배선으로 이어진 끝단은 오른쪽(스플라이스를 건너서도). 같은 열 안의 순서는
 *    선언 순서다. 배선이 없는 끝단은 왼쪽.
 *  · 스플라이스는 가운데 열. 장치 블록은 단자 핸들이 오른쪽 변에 고정이라 언제나 왼쪽.
 *  · 상자 크기는 화면·PDF 와 같은 함수(canvas/geometry.connectorBox·deviceBox)로 잰다 —
 *    이름표·MPN 캡션까지 들어간 상자라 서로 겹치지 않는다.
 *
 * 이미 자리가 있는 노드(사람이 GUI 에서 옮긴 것)는 건드리지 않는다. 새 노드만 그
 * 열의 맨 아래에 붙인다. 다시 다 놓고 싶으면 DSL `layout`.
 */
import type { Connector, Device, HarnessDocument, Orientation, Vec2 } from '../types';
import { connectorBox, deviceBox, type NodeBox } from '../canvas/geometry';
import { refLabels } from '../canvas/docToFlow';

/** 두 열 사이 통로 폭(px) — 스텁 라벨(색·게이지)과 레인이 들어갈 자리 */
export const AISLE = 360;
/** 같은 열 안 세로 간격 */
export const ROW_GAP = 48;
const ORIGIN: Vec2 = { x: 40, y: 40 };

type Side = 'L' | 'M' | 'R';
type NodeRef = { kind: 'c'; c: Connector } | { kind: 'd'; d: Device };

const idOf = (n: NodeRef) => (n.kind === 'c' ? n.c.id : n.d.id);

function boxOf(doc: HarnessDocument, n: NodeRef, at: Vec2, refs: Map<string, string>): NodeBox {
  if (n.kind === 'd') return deviceBox(n.d, at, refs.get(n.d.id));
  const housing = doc.usedParts.find((p) => p.id === n.c.housingId);
  return connectorBox(n.c, housing, at, 'logical', refs.get(n.c.id));
}

/** 노드 id → 이웃 id (스플라이스는 건너뛰어 그 너머를 이웃으로 본다) */
function adjacency(doc: HarnessDocument): Map<string, Set<string>> {
  const nodeOf = (e: HarnessDocument['wires'][number]['from']) => (e.type === 'pin' ? e.connectorId : e.deviceId);
  const direct = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!direct.has(a)) direct.set(a, new Set());
    if (!direct.has(b)) direct.set(b, new Set());
    direct.get(a)!.add(b);
    direct.get(b)!.add(a);
  };
  for (const w of doc.wires) link(nodeOf(w.from), nodeOf(w.to));
  const splice = new Set(doc.connectors.filter((c) => c.kind === 'splice').map((c) => c.id));
  const out = new Map<string, Set<string>>();
  for (const [id, ns] of direct) {
    if (splice.has(id)) continue;
    const s = new Set<string>();
    const seen = new Set<string>([id]);
    const stack = [...ns];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      if (splice.has(n)) stack.push(...(direct.get(n) ?? []));
      else s.add(n);
    }
    out.set(id, s);
  }
  return out;
}

/** 오른쪽/왼쪽 판정 — 이미 놓인 노드는 방향으로 읽는다 */
function sideOfPlaced(n: NodeRef): Side {
  if (n.kind === 'd') return 'L';
  if (n.c.kind === 'splice') return 'M';
  return n.c.orientation === 180 ? 'L' : 'R';
}

export type LayoutOptions = {
  /** 놓을 노드 id. 나머지는 제자리. 생략하면 전부 다시 놓는다. */
  place?: Set<string>;
  /** 사용자가 rot= 로 정한 노드 — 방향은 건드리지 않고 자리만 정한다 */
  keepRotation?: Set<string>;
};

/** 새 문서를 돌려준다(원본 불변). */
export function autoLayout(doc: HarnessDocument, opts: LayoutOptions = {}): HarnessDocument {
  const nodes: NodeRef[] = [
    ...doc.connectors.map((c) => ({ kind: 'c' as const, c })),
    ...doc.devices.map((d) => ({ kind: 'd' as const, d })),
  ];
  const all = new Set(nodes.map(idOf));
  const place = opts.place ?? all;
  if (![...place].some((id) => all.has(id))) return doc;
  const keepRot = opts.keepRotation ?? new Set<string>();
  const adj = adjacency(doc);

  // ── 열 정하기 ────────────────────────────────────────────────────────
  const side = new Map<string, Side>();
  for (const n of nodes) {
    const id = idOf(n);
    if (!place.has(id)) side.set(id, sideOfPlaced(n));
    else if (n.kind === 'c' && n.c.kind === 'splice') side.set(id, 'M');
    else if (n.kind === 'd') side.set(id, 'L');
  }
  const opposite = (s: Side): Side => (s === 'L' ? 'R' : 'L');
  // 이미 열이 정해진 노드에서 먼저 퍼뜨리고, 그다음 선언 순서로 새 씨앗을 왼쪽에 둔다
  const spread = (start: string) => {
    const q = [start];
    while (q.length) {
      const id = q.shift()!;
      const s = side.get(id)!;
      if (s === 'M') continue;
      for (const nb of adj.get(id) ?? []) {
        if (side.has(nb)) continue;
        side.set(nb, opposite(s));
        q.push(nb);
      }
    }
  };
  for (const n of nodes) if (side.has(idOf(n))) spread(idOf(n));
  for (const n of nodes) {
    const id = idOf(n);
    if (side.has(id)) continue;
    side.set(id, 'L');
    spread(id);
  }

  // ── 방향 ─────────────────────────────────────────────────────────────
  const refs = refLabels(doc);
  const rotOf = (id: string, cur: Orientation): Orientation => {
    if (!place.has(id) || keepRot.has(id)) return cur;
    const s = side.get(id);
    return s === 'L' ? 180 : 0;
  };
  const connectors = doc.connectors.map((c) => ({ ...c, orientation: rotOf(c.id, c.orientation) }));
  const devices = doc.devices.map((d) => ({ ...d }));
  const work: HarnessDocument = { ...doc, connectors, devices };
  const refOf = (id: string): NodeRef => {
    const c = connectors.find((x) => x.id === id);
    return c ? { kind: 'c', c } : { kind: 'd', d: devices.find((x) => x.id === id)! };
  };

  // ── 자리 ─────────────────────────────────────────────────────────────
  const fixed = [...all].filter((id) => !place.has(id));
  const posOf = (n: NodeRef) => (n.kind === 'c' ? n.c.positions.logical : n.d.positions.logical) ?? ORIGIN;
  const fixedBoxes = fixed.map((id) => ({ id, s: side.get(id)!, b: boxOf(work, refOf(id), posOf(refOf(id)), refs) }));

  const sizes = new Map<string, NodeBox>();
  for (const id of all) if (place.has(id)) sizes.set(id, boxOf(work, refOf(id), { x: 0, y: 0 }, refs));
  const colOf = (s: Side) => [...all].filter((id) => place.has(id) && side.get(id) === s);
  const L = colOf('L'), M = colOf('M'), R = colOf('R');
  const height = (ids: string[]) => ids.reduce((h, id) => h + sizes.get(id)!.h, 0) + Math.max(0, ids.length - 1) * ROW_GAP;
  const width = (ids: string[]) => ids.reduce((w, id) => Math.max(w, sizes.get(id)!.w), 0);

  const fL = fixedBoxes.filter((f) => f.s === 'L');
  const fR = fixedBoxes.filter((f) => f.s === 'R');
  const fM = fixedBoxes.filter((f) => f.s === 'M');
  const maxR = (bs: { b: NodeBox }[]) => Math.max(...bs.map((f) => f.b.x + f.b.w));
  const minX = (bs: { b: NodeBox }[]) => Math.min(...bs.map((f) => f.b.x));
  const bottom = (bs: { b: NodeBox }[]) => Math.max(...bs.map((f) => f.b.y + f.b.h));

  // 왼쪽 열의 오른쪽 변(핸들이 서는 선)과 오른쪽 열의 왼쪽 변
  const midW = Math.max(width(M), fM.length ? Math.max(...fM.map((f) => f.b.w)) : 0);
  const aisle = midW > 0 ? AISLE + midW : AISLE;
  let leftEdge: number;
  let rightEdge: number;
  if (fL.length) {
    leftEdge = maxR(fL);
    rightEdge = fR.length ? minX(fR) : leftEdge + aisle;
  } else if (fR.length) {
    rightEdge = minX(fR);
    leftEdge = rightEdge - aisle;
  } else {
    leftEdge = ORIGIN.x + width(L);
    rightEdge = leftEdge + aisle;
  }

  const startY = (ids: string[], fixedCol: { b: NodeBox }[], others: number) => {
    if (fixedCol.length) return bottom(fixedCol) + ROW_GAP;
    if (fixedBoxes.length) return ORIGIN.y;
    // 처음 놓는 문서면 짧은 열을 긴 열의 가운데에 맞춘다 — 배선이 대칭으로 퍼진다
    return ORIGIN.y + Math.max(0, (others - height(ids)) / 2);
  };
  const tallest = Math.max(height(L), height(R), height(M));
  const at = new Map<string, Vec2>();
  const stack = (ids: string[], y0: number, xOf: (b: NodeBox) => number) => {
    let y = y0;
    for (const id of ids) {
      const b = sizes.get(id)!;
      // 상자의 좌상단 오프셋(라벨이 왼쪽으로 넘치면 b.x < 0)을 빼서 노드 좌표로 돌린다
      at.set(id, { x: Math.round(xOf(b) - b.x), y: Math.round(y - b.y) });
      y += b.h + ROW_GAP;
    }
  };
  stack(L, startY(L, fL, tallest), (b) => leftEdge - b.w);
  stack(R, startY(R, fR, tallest), () => rightEdge);
  const midX = (leftEdge + rightEdge) / 2;
  stack(M, startY(M, fM, tallest), (b) => midX - b.w / 2);

  // 물리 뷰 좌표도 같은 자리로 — 라이브러리 instantiate() 가 하는 그대로다
  const put = (id: string) => ({ logical: at.get(id)!, physical: at.get(id)! });
  return {
    ...work,
    connectors: connectors.map((c) => (at.has(c.id) ? { ...c, positions: put(c.id) } : c)),
    devices: devices.map((d) => (at.has(d.id) ? { ...d, positions: put(d.id) } : d)),
  };
}

/** 확인용 — 노드 경계 상자끼리 겹치는 쌍 수 (시험이 쓴다) */
export function overlaps(doc: HarnessDocument): number {
  const refs = refLabels(doc);
  const boxes = [
    ...doc.connectors.map((c) => boxOf(doc, { kind: 'c', c }, c.positions.logical ?? ORIGIN, refs)),
    ...doc.devices.map((d) => boxOf(doc, { kind: 'd', d }, d.positions.logical ?? ORIGIN, refs)),
  ];
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) n++;
    }
  }
  return n;
}
