/**
 * 스플라이스 핸들은 **상대편 노드가 있는 쪽 변**에 붙는다 — 못박는 자리.
 *
 * 실측한 결함: "전선단 4가닥(왼쪽) → 검정 3가닥이 SP1 로 → SP1 출력 → 배럴잭(오른쪽)"
 * 에서 SP1 의 핸들이 전부 방향(0°) 쪽 왼쪽 변에 있어, 출력선이 SP1 왼쪽에서 나와
 * 도면 아래를 한 바퀴 돌아 오른쪽 잭으로 갔다. 레퍼런스(ref-09)는 입력은 왼쪽에서,
 * 출력은 오른쪽으로 낸다.
 *
 * 경로는 화면·PDF 가 함께 부르는 planWires 로 잰다(라우터의 자기 신고를 믿지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import { assignLanes, docToNodes, endpointAnchor, nodeBoxes, spliceSplits } from './docToFlow';
import { planWires } from './wirePlan';
import { connectorLayout, connectorRefParts, pinAnchor } from './geometry';
import { buildDrawing } from '../export/pdfDraw';
import type { Connector, HarnessDocument, PartLibraryItem, Wire } from '../types';

const row = (n: number) => Array.from({ length: n }, (_, k) => ({ index: k + 1, offset: { x: k, y: 0 } }));

const parts: PartLibraryItem[] = [
  { id: 'lib-l4', category: 'housing', name: '전선단 4P', pinCount: 4, pinLayout: row(4) },
  { id: 'lib-sp4', category: 'splice', name: '스플라이스 4 (꼬임)', pinCount: 4, pinLayout: row(4) },
  { id: 'lib-r2', category: 'housing', name: '배럴잭 2P', pinCount: 2, pinLayout: row(2) },
];

const conn = (id: string, kind: Connector['kind'], housingId: string, o: Connector['orientation'], x: number, y: number, n: number): Connector => ({
  id, kind, housingId, orientation: o,
  positions: { logical: { x, y } },
  pins: Array.from({ length: n }, (_, k) => ({ id: `${id}-${k + 1}`, index: k + 1 })),
  ...(kind === 'splice' ? { bridges: [Array.from({ length: n }, (_, k) => `${id}-${k + 1}`)] } : {}),
});

const wire = (id: string, a: [string, number], b: [string, number], base = 'black'): Wire => ({
  id,
  from: { type: 'pin', connectorId: a[0], pinId: `${a[0]}-${a[1]}` },
  to: { type: 'pin', connectorId: b[0], pinId: `${b[0]}-${b[1]}` },
  color: { base },
  gauge: { system: 'awg', value: 22 },
});

const docOf = (connectors: Connector[], wires: Wire[]): HarnessDocument => ({
  schemaVersion: 1,
  id: 'doc-sp',
  name: 'splice sides',
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
  connectors,
  devices: [],
  wires,
  cables: [],
  usedParts: parts,
});

/** LED 하네스 축소판 — J1(왼쪽, 180°) · SP1(가운데, 0°) · J2(오른쪽, 0°) */
function ledDoc(): HarnessDocument {
  return docOf(
    [
      conn('j1', 'connector', 'lib-l4', 180, 0, 40, 4),
      conn('sp', 'splice', 'lib-sp4', 0, 300, 40, 4),
      conn('j2', 'connector', 'lib-r2', 0, 600, 60, 2),
    ],
    [
      wire('w-red', ['j1', 4], ['j2', 1], 'red'),
      wire('w-b1', ['j1', 1], ['sp', 1]),
      wire('w-b2', ['j1', 2], ['sp', 2]),
      wire('w-b3', ['j1', 3], ['sp', 3]),
      wire('w-out', ['sp', 4], ['j2', 2]),
    ],
  );
}

describe('스플라이스 — 양쪽에 이웃이 있으면 변을 가른다', () => {
  it('입력은 왼쪽 변, 출력은 오른쪽 변 (같은 변 안은 상대편 y 순)', () => {
    const doc = ledDoc();
    expect(spliceSplits(doc, 'logical').get('sp')).toEqual({ left: [1, 2, 3], right: [4] });

    const lanes = assignLanes(doc, 'logical');
    const i = doc.wires.findIndex((w) => w.id === 'w-out');
    expect(lanes.from[i].side).toBe(Position.Right);
    for (const id of ['w-b1', 'w-b2', 'w-b3']) {
      expect(lanes.to[doc.wires.findIndex((w) => w.id === id)].side).toBe(Position.Left);
    }
  });

  it('우회가 없다 — 경로가 두 끝 노드 사이 띠 안에 머물고, 출력은 오른쪽으로 나간다', () => {
    const doc = ledDoc();
    // 노드마다 첫 상자가 경계 상자다(양쪽 스플라이스는 이름표 사각형이 같은 id 로 뒤따른다)
    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const n of nodeBoxes(doc, 'logical')) if (!boxes.has(n.id)) boxes.set(n.id, n.box);
    const j1 = boxes.get('j1')!;
    const j2 = boxes.get('j2')!;
    const sp = boxes.get('sp')!;
    const top = Math.min(j1.y, j2.y, sp.y);
    const bottom = Math.max(j1.y + j1.h, j2.y + j2.h, sp.y + sp.h);

    const plans = planWires(doc, 'logical');
    for (const id of ['w-b1', 'w-b2', 'w-b3', 'w-out']) {
      const pts = plans.find((p) => p.id === id)!.points;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      // 가로: J1 오른쪽 변 ~ J2 왼쪽 변 사이 (노드 바깥으로 돌아 나가지 않는다)
      expect(Math.min(...xs), id).toBeGreaterThanOrEqual(j1.x + j1.w - 1e-6);
      expect(Math.max(...xs), id).toBeLessThanOrEqual(j2.x + 1e-6);
      // 세로: 세 노드가 차지하는 띠 안 (도면 아래로 한 바퀴 돌지 않는다)
      expect(Math.min(...ys), id).toBeGreaterThanOrEqual(top - 1e-6);
      expect(Math.max(...ys), id).toBeLessThanOrEqual(bottom + 1e-6);
    }

    const out = plans.find((p) => p.id === 'w-out')!.points;
    // 첫 구간(스텁)은 오른쪽으로, 스플라이스 하우징 오른쪽 변에서 시작한다
    expect(out[1].x).toBeGreaterThan(out[0].x);
    expect(out[0].x).toBeCloseTo(sp.x + sp.w, 6);
    // 출력은 SP 하우징 왼쪽으로 한 번도 넘어가지 않는다
    expect(Math.min(...out.map((p) => p.x))).toBeGreaterThanOrEqual(sp.x + sp.w - 1e-6);
  });

  it('출력 핸들은 입력 묶음 한가운데 높이에서 나간다', () => {
    const doc = ledDoc();
    const sp = doc.connectors[1];
    const split = spliceSplits(doc, 'logical').get('sp');
    const g = connectorLayout(sp, parts[1], split);
    const ins = [1, 2, 3].map((k) => g.handleOffset(k).y);
    expect(g.handleOffset(4).y).toBeCloseTo((Math.min(...ins) + Math.max(...ins)) / 2, 6);
    expect(g.handleOffset(4).x).toBe(g.boxW);
    for (const k of [1, 2, 3]) expect(g.handleOffset(k).x).toBe(0);
  });

  it('핸들은 언제나 경계 상자 변 위에 있다 (스텁 불변식)', () => {
    const doc = ledDoc();
    const lanes = assignLanes(doc, 'logical');
    const sp = nodeBoxes(doc, 'logical').find((n) => n.id === 'sp')!.box;
    doc.wires.forEach((w, i) => {
      for (const [e, a] of [[w.from, lanes.from[i]], [w.to, lanes.to[i]]] as const) {
        if (e.type !== 'pin' || e.connectorId !== 'sp') continue;
        expect([sp.x, sp.x + sp.w]).toContain(a.x);
        expect(a.y).toBeGreaterThan(sp.y);
        expect(a.y).toBeLessThan(sp.y + sp.h);
      }
    });
  });

  it('화면 노드·PDF·배선 계획이 같은 변 배정을 쓴다', () => {
    const doc = ledDoc();
    const split = spliceSplits(doc, 'logical').get('sp');
    const node = docToNodes(doc, 'logical').find((n) => n.id === 'sp')!;
    expect((node.data as { split?: unknown }).split).toEqual(split);

    // PDF 스플라이스 심볼이 선을 당기는 핸들 = 배선 계획의 끝점
    const drawing = buildDrawing(doc);
    const spNode = drawing.nodes.find((n) => n.id === 'sp')!;
    for (const pad of spNode.pads) {
      const a = endpointAnchor(doc, { type: 'pin', connectorId: 'sp', pinId: pad.pinId! }, 'logical');
      expect(pad.handle).toEqual({ x: a.x, y: a.y });
    }
    expect(spNode.centered).toBe(true);
  });
});

describe('스플라이스 — 이웃이 한쪽에만 있으면 예전 그대로', () => {
  const sameAsBefore = (doc: HarnessDocument) => {
    expect(spliceSplits(doc, 'logical').size).toBe(0);
    const sp = doc.connectors.find((c) => c.kind === 'splice')!;
    const lanes = assignLanes(doc, 'logical');
    doc.wires.forEach((w, i) => {
      for (const [e, a] of [[w.from, lanes.from[i]], [w.to, lanes.to[i]]] as const) {
        if (e.type !== 'pin' || e.connectorId !== sp.id) continue;
        const index = sp.pins.find((p) => p.id === e.pinId)!.index;
        // 분할 없는 예전 식과 좌표·변이 그대로 같다 — 방향(0°) 쪽 왼쪽 변
        expect(a).toEqual(pinAnchor(sp, parts[1], index, sp.positions.logical!));
        expect(a.side).toBe(Position.Left);
      }
    });
  };

  it('이웃이 전부 왼쪽', () => {
    sameAsBefore(docOf(
      [conn('j1', 'connector', 'lib-l4', 180, 0, 40, 4), conn('sp', 'splice', 'lib-sp4', 0, 300, 40, 4)],
      [wire('a', ['j1', 1], ['sp', 1]), wire('b', ['j1', 2], ['sp', 2]), wire('c', ['j1', 3], ['sp', 3])],
    ));
  });

  it('이웃이 전부 오른쪽이어도 방향 쪽 변을 지킨다', () => {
    sameAsBefore(docOf(
      [conn('sp', 'splice', 'lib-sp4', 0, 0, 40, 4), conn('j2', 'connector', 'lib-l4', 0, 400, 40, 4)],
      [wire('a', ['sp', 1], ['j2', 1]), wire('b', ['sp', 2], ['j2', 2])],
    ));
  });

  it('이름표에는 방향 글자가 그대로, 스플라이스 표시 글리프(⑂)는 없다', () => {
    const sp = conn('sp', 'splice', 'lib-sp4', 0, 0, 0, 4);
    const p = connectorRefParts(sp, parts[1], 'SP1');
    expect(p.name).toBe('스플라이스 4 (꼬임)');
    expect(p.dir).toContain('0°');
    // 양쪽으로 가르면 방향 칸이 빈다 — "← 0° 왼쪽" 이 거짓말이 되기 때문
    expect(connectorRefParts(sp, parts[1], 'SP1', { left: [1], right: [2] }).dir).toBe('');
  });
});
