/**
 * 화면 엣지가 **공용 라우터(wirePlan.routeWire)** 로 그린다는 것을 못박는다.
 *
 * 왜 필요한가: PDF 쪽 시험(export/pdfRoute.test.ts)은 "PDF 가 routeWire 결과를
 * 좌표 변환만 해서 그린다"를 붙잡는다. 그 짝으로 화면 쪽도 붙잡아야 두 시험이
 * 함께 "같은 문서 → 같은 그림"을 보증한다. 여기가 없으면 OrthogonalEdge 만
 * 몰래 제 경로 계산으로 돌아가도 아무 시험도 깨지지 않는다.
 *
 * 그려진 `d` 를 DOM 에서 직접 읽는다 — 컴포넌트 속을 들여다보지 않는다.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { OrthogonalEdge, type OrthoEdgeData } from './OrthogonalEdge';
import { planWires, routeWire, type EdgeEnds } from './wirePlan';
import { assignLanes, docToEdges } from './docToFlow';
import { fanoutDoc } from '../fixtures/fanoutDoc';

afterEach(cleanup);

const ENDS: EdgeEnds = {
  sourceX: 300, sourceY: 260, targetX: 900, targetY: 300,
  // 핸들 방향이 목적지 반대 — 상자를 비켜 가야 하는 그 배치(J1→SP1 실측 사례)
  sourcePosition: Position.Left, targetPosition: Position.Left,
};

/** 레인·상자가 모두 걸린 가장 빡센 경우 */
const DATA: OrthoEdgeData = {
  laneY: 24,
  laneX: 10,
  sourceBox: { x: 300, y: 200, w: 160, h: 120 },
  targetBox: { x: 900, y: 250, w: 140, h: 110 },
};

function draw(data: OrthoEdgeData) {
  const props = {
    id: 'w1', source: 'n1', target: 'n2', ...ENDS, data,
  } as unknown as EdgeProps;
  // BaseEdge 는 <path> 만 내놓으므로 React Flow 컨텍스트 없이 svg 안에 바로 심는다.
  // data 에 abbr 이 없으면 스텁 라벨(EdgeLabelRenderer)은 그리지 않는다.
  return render(<svg><OrthogonalEdge {...props} /></svg>).container;
}

describe('OrthogonalEdge — 화면 경로의 출처', () => {
  it('그려진 path d 가 routeWire 결과와 글자 하나까지 같다', () => {
    const container = draw(DATA);
    const expected = routeWire(ENDS, DATA).d;
    expect(container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toBe(expected);
  });

  it('히트 선도 같은 모양이다 (집는 자리와 보이는 선이 어긋나지 않게)', () => {
    const container = draw(DATA);
    expect(container.querySelector('.hz-edge-hit')?.getAttribute('d')).toBe(
      routeWire(ENDS, DATA).d,
    );
  });

  /**
   * ── 문서에서 화면까지 한 줄로 이어 붙인다
   *
   * 위 세 시험은 "엣지가 routeWire 를 쓴다" 만 잡는다. 그 사이에 `docToEdges` 가
   * **엣지 data 에 무엇을 싣는가** 라는 고리가 하나 더 있고, 거기서 값 하나가
   * 빠지면 화면만 다른 그림이 된다. 실제로 45° 사선을 넣으면서 `diagCenter` 를
   * data 에 안 실으면 **화면만 직교로** 그려진다 — 종이(planWires)는 사선인데.
   *
   * 그래서 문서 → docToEdges → 화면 path 를 실제로 그려서, 종이가 받는
   * `planWires` 의 d 와 글자 하나까지 같은지 본다.
   */
  it('문서 → 엣지 data → 화면 path 가 planWires 와 글자 하나까지 같다', () => {
    const doc = fanoutDoc();
    const edges = docToEdges(doc, new Set(), null, 'logical');
    const lanes = assignLanes(doc, 'logical');
    const planned = planWires(doc, 'logical');

    let diagonals = 0;
    edges.forEach((e, i) => {
      const ends: EdgeEnds = {
        sourceX: lanes.from[i].x, sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x, targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side, targetPosition: lanes.to[i].side,
      };
      // 라벨(abbr)은 뺀다 — EdgeLabelRenderer 가 ReactFlowProvider 를 요구하는데
      // 여기서 재는 것은 **경로**이고 라벨 글자는 경로에 영향을 주지 않는다.
      // (라벨 자리는 stubLabel.test.ts · docToFlow.test.ts 가 따로 잰다)
      const { abbr: _a, signal: _s, ...data } = e.data as OrthoEdgeData;
      const props = {
        id: e.id, source: e.source, target: e.target, ...ends, data,
      } as unknown as EdgeProps;
      const c = render(<svg><OrthogonalEdge {...props} /></svg>).container;
      const drawn = c.querySelector('.react-flow__edge-path')?.getAttribute('d');
      expect(drawn, e.id).toBe(planned[i].d);
      if (/L [\d.]+ [\d.]+ L [\d.]+ [\d.]+/.test(drawn ?? '')
        && planned[i].points.some((p, k) => k > 0
          && Math.abs(p.x - planned[i].points[k - 1].x) > 1e-6
          && Math.abs(p.y - planned[i].points[k - 1].y) > 1e-6)) diagonals++;
      cleanup();
    });
    // 이 문서는 사선으로 그려진다 — 시험이 직교만 보고 통과한 것이 아님을 못박는다
    expect(diagonals).toBe(20);
  });

  it('레인·상자를 빼면 경로가 실제로 달라진다 (대조군 — 시험이 헛돌지 않는지)', () => {
    const withAll = draw(DATA).querySelector('.hz-edge-hit')?.getAttribute('d');
    cleanup();
    const bare = draw({}).querySelector('.hz-edge-hit')?.getAttribute('d');
    expect(bare).toBe(routeWire(ENDS, {}).d);
    expect(bare).not.toBe(withAll);
  });
});
