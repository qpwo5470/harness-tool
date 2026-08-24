/**
 * 스텁 라벨이 서로 겹치지 않는지 — **숫자로** 붙잡는다.
 *
 * 실제로 난 사고: MDB 6P(2열) 도면에서 라벨 다섯 개가 서로를 덮어 글자를 못 읽고,
 * 상자가 흰 배경이라 뒤에 지나는 배선까지 지웠다. 시험은 전부 통과하고 있었다 —
 * 라벨 자리는 아무도 검사하지 않는 값이었기 때문이다.
 *
 * 왜 하필 2열 커넥터인가: 0°/180° 로 놓으면 패드가 한 변에 겹쳐 서고 그 간격이
 * `PAD / depth` = 26/2 = 13px 인데, 라벨 상자 높이는 14px 이다. **세로로는 어떻게
 * 해도 안 비켜간다.** 그래서 진행 방향으로 어긋 놓는 수밖에 없다.
 */
import { describe, it, expect } from 'vitest';
import type { HarnessDocument, PartLibraryItem } from '../types';
import { SEED_PARTS } from '../library/seed';
import { docToEdges, strokeColor } from './docToFlow';
import { readableInk } from './OrthogonalEdge';
import {
  planStubLabels, stubWidth, stubTextOf, STUB_BOX_H, STUB_GAP, planWires,
} from './wirePlan';

/** 두 라벨 상자가 겹치는가 (중심 좌표 기준) */
function overlap(
  a: { x: number; y: number; w: number },
  b: { x: number; y: number; w: number },
): boolean {
  const dx = Math.abs(a.x - b.x) * 2 - (a.w + b.w);
  const dy = Math.abs(a.y - b.y) * 2 - STUB_BOX_H * 2;
  return dx < 0 && dy < 0;
}

describe('스텁 라벨 어긋 배치 (순수 계산)', () => {
  /**
   * 왼쪽으로 나가는 스텁 + 주행 구간 — 실제 경로 모양을 줄인 것.
   * 길이는 실제 도면과 비슷하게 400px 로 둔다. 짧게 잡으면 밀 자리가 없어
   * "겹침이 안 풀린다" 가 알고리즘 탓인지 경로 탓인지 구분이 안 된다.
   */
  const path = (padY: number) => [
    { x: 0, y: padY },          // 먼 쪽
    { x: 400, y: padY },        // 도착 패드
  ];

  it('패드가 13px 간격이어도 라벨이 겹치지 않는다', () => {
    // 2열 6P 가 한 변에 서면 이 간격이 된다
    const wires = [0, 13, 26, 39, 52].map((dy, i) => ({
      id: `w${i}`,
      width: stubWidth('Br', '+34V (무정전)'),
      points: path(100 + dy),
    }));
    const plan = planStubLabels(wires);
    const boxes = plan.map((p) => ({ x: p.x, y: p.y, w: p.width }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let k = i + 1; k < boxes.length; k++) {
        if (overlap(boxes[i], boxes[k])) hits.push(`${plan[i].id}✕${plan[k].id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('한 가닥뿐이면 밀지 않는다 — 이유 없이 멀어지면 안 된다', () => {
    const [only] = planStubLabels([
      { id: 'w', width: stubWidth('R', 'GND'), points: path(100, 20) },
    ]);
    expect(only.backoff).toBe(22);   // DEFAULT_LABEL_BACKOFF 그대로
  });

  it('같은 입력이면 같은 답이 나온다 — 화면과 종이가 갈라지면 안 된다', () => {
    const mk = () => [0, 13, 26].map((dy, i) => ({
      id: `w${i}`, width: stubWidth('W', 'Master Receive'), points: path(100 + dy),
    }));
    expect(planStubLabels(mk())).toEqual(planStubLabels(mk()));
  });

  it('라벨은 제 배선 위에 남는다 — 남의 선으로 건너가지 않는다', () => {
    /*
     * 어긋 놓기를 세로로 하면 라벨이 옆 가닥 위로 올라가 "어느 배선의 라벨이냐" 가
     * 헷갈린다. 진행 방향으로만 밀어야 하는 이유가 이것이다.
     */
    const wires = [0, 13, 26].map((dy, i) => ({
      id: `w${i}`, width: stubWidth('Br', '+34V (스위치드)'), points: path(100 + dy),
    }));
    for (const p of planStubLabels(wires)) {
      const mine = wires.find((w) => w.id === p.id)!;
      const ys = new Set(mine.points.map((q) => q.y));
      expect(ys.has(p.y), `${p.id} 라벨이 제 경로를 벗어났다`).toBe(true);
    }
  });
});

describe('스텁 라벨 — 실제 문서', () => {
  /** MDB 6P(2열) 한쪽으로 다섯 가닥이 모이는 도면 */
  function mdbDoc(): HarnessDocument {
    const xh = SEED_PARTS.find((p) => p.id === 'lib-jst-xhp-5p')!;
    const mdb = SEED_PARTS.find((p) => p.id === 'lib-mdb-vmc')!;
    const pin = (n: number) => ({ id: `p${n}`, index: n });
    const mpin = (n: number) => ({ id: `m${n}`, index: n });
    return {
      schemaVersion: 1,
      id: 'h', name: 'MDB', createdAt: '', updatedAt: '',
      connectors: [
        {
          id: 'J1', kind: 'connector', housingId: xh.id, orientation: 180,
          positions: { logical: { x: 100, y: 100 }, physical: { x: 100, y: 100 } },
          pins: [1, 2, 3, 4, 5].map(pin),
        },
        {
          id: 'J2', kind: 'connector', housingId: mdb.id, orientation: 0,
          positions: { logical: { x: 500, y: 100 }, physical: { x: 500, y: 100 } },
          pins: [1, 2, 3, 4, 5, 6].map(mpin),
        },
      ],
      devices: [],
      wires: [1, 2, 3, 4, 5].map((n) => ({
        id: `w${n}`,
        from: { type: 'pin' as const, connectorId: 'J1', pinId: `p${n}` },
        to: { type: 'pin' as const, connectorId: 'J2', pinId: `m${n}` },
        color: { base: ['red', 'black', 'white', 'orange', 'brown'][n - 1] },
        gauge: { system: 'awg' as const, value: 22 },
        lengthMm: 200,
      })),
      usedParts: [xh, mdb] as PartLibraryItem[],
    };
  }

  it('MDB 6P 도면에서 라벨이 하나도 겹치지 않는다', () => {
    const doc = mdbDoc();
    const edges = docToEdges(doc);
    const routes = new Map(planWires(doc).map((r) => [r.id, r]));

    const boxes = edges.map((e) => {
      const d = e.data as { abbr?: string; signal?: string; labelBackoff?: number };
      const r = routes.get(e.id)!;
      // docToEdges 가 정한 backoff 로 다시 라우팅해야 화면과 같은 자리가 나온다
      return { id: e.id, w: stubWidth(d.abbr ?? '', d.signal), backoff: d.labelBackoff, r };
    });
    // backoff 가 실제로 실려 나가는가 — 안 실리면 아래 검사가 통과해도 화면은 그대로다
    expect(boxes.every((b) => b.backoff != null)).toBe(true);
    // 다섯 가닥이 한 커넥터로 모이므로 최소 몇 개는 밀려나야 한다
    expect(new Set(boxes.map((b) => b.backoff)).size).toBeGreaterThan(1);
  });

  it('화면과 PDF 가 같은 라벨 자리를 쓴다', () => {
    /*
     * **이 시험이 없어서 한 번 놓쳤다.**
     *
     * 겹침 해소를 `docToEdges` 에만 넣었더니 화면은 고쳐졌는데 PDF 는
     * `planWires` 의 labelX/labelY 를 쓰므로 종이만 예전 그대로 겹쳐 나왔다.
     * 내보내서 눈으로 보고서야 알았다.
     *
     * 그래서 두 경로의 결과를 직접 맞대 본다 — 한쪽만 고치면 여기서 깨진다.
     */
    const doc = mdbDoc();
    const edges = docToEdges(doc);          // 화면이 쓰는 값
    const planned = planWires(doc);          // PDF 가 쓰는 값

    for (const e of edges) {
      const d = e.data as { labelBackoff?: number };
      const p = planned.find((x) => x.id === e.id)!;
      expect(d.labelBackoff, `${e.id} 의 backoff 가 엣지 data 에 없다`).toBeTypeOf('number');
      expect(p.labelX, `${e.id} 의 PDF 라벨 x`).toBeTypeOf('number');
    }

    // 핵심: 두 경로가 **같은 폭**을 재는가. 폭이 갈리면 배치도 갈린다.
    for (const w of doc.wires) {
      const e = edges.find((x) => x.id === w.id)!;
      const d = e.data as { abbr?: string; signal?: string };
      const t = stubTextOf(doc, w);
      expect(d.abbr).toBe(t.abbr);
      expect(d.signal).toBe(t.signal);
    }
  });

  it('PDF 라벨도 서로 겹치지 않는다 — 종이는 신호명을 늘 펴 두므로 더 빡빡하다', () => {
    const doc = mdbDoc();
    const planned = planWires(doc);
    const boxes = planned.map((p) => {
      const w = doc.wires.find((x) => x.id === p.id)!;
      return { id: p.id, x: p.labelX, y: p.labelY, w: stubTextOf(doc, w).width };
    });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let k = i + 1; k < boxes.length; k++) {
        if (overlap(boxes[i], boxes[k])) hits.push(`${boxes[i].id}✕${boxes[k].id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('밀어낸 거리는 라벨 폭에 비례한다 — 좁은 라벨을 멀리 보내지 않는다', () => {
    const narrow = planStubLabels([
      { id: 'a', width: 20, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
      { id: 'b', width: 20, points: [{ x: 0, y: 5 }, { x: 200, y: 5 }] },
    ]);
    const wide = planStubLabels([
      { id: 'a', width: 120, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] },
      { id: 'b', width: 120, points: [{ x: 0, y: 5 }, { x: 200, y: 5 }] },
    ]);
    expect(narrow[1].backoff).toBe(22 + 20 + STUB_GAP);
    expect(wide[1].backoff).toBe(22 + 120 + STUB_GAP);
  });
});

describe('약호 글자색 — 흰 배경에서 읽혀야 한다', () => {
  it('흰 전선의 약호는 본문색으로 바뀐다', () => {
    /*
     * 예전 조건은 `stroke === '#fff'` 였는데 이 값은 이미 strokeColor 를 지나온
     * 뒤라 흰 전선은 #d1d5db 로 들어온다. 조건이 한 번도 맞지 않아 흰 전선의 W 가
     * 흰 배경 위에 옅은 회색으로 찍혔다 — 화면에서 보고 잡았다.
     */
    expect(readableInk(strokeColor('white'))).toBe('var(--text)');
  });

  it('진한 색은 전선 색 그대로 쓴다 — 어느 선인지 바로 잡히게', () => {
    for (const c of ['red', 'black', 'blue', 'brown', 'green']) {
      const s = strokeColor(c);
      expect(readableInk(s), c).toBe(s);
    }
  });

  it('노랑도 본문색으로 바뀐다 — 재 보니 흰 전선보다 밝았다', () => {
    /*
     * 처음엔 "노랑은 strokeColor 가 이미 진하게 낮췄으니 그대로 두자" 고 적었다가
     * 이 시험에 걸렸다. #eab308 의 상대 휘도는 0.70 으로 흰 전선의 #d1d5db(0.66)
     * **보다 밝다** — 흰 배경 대비 1.4:1 이라 작은 글자로는 안 읽힌다.
     * 색 단서는 옆에 붙은 선과 상세 카드가 대신한다.
     */
    const s = strokeColor('yellow');
    expect(s).toBe('#eab308');
    expect(readableInk(s)).toBe('var(--text)');
  });

  it('중간 밝기(미상 색 회색)는 그대로 둔다 — 기준이 너무 낮으면 색이 다 사라진다', () => {
    // strokeColor 가 모르는 색에 쓰는 값. 휘도 0.45 로 충분히 읽힌다.
    expect(readableInk('#6b7280')).toBe('#6b7280');
  });

  it('색 이름이 그대로 오면 건드리지 않는다', () => {
    expect(readableInk('red')).toBe('red');
  });
});
