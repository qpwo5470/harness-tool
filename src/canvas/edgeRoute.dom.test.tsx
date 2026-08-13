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
import { routeWire, type EdgeEnds } from './wirePlan';

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

  it('레인·상자를 빼면 경로가 실제로 달라진다 (대조군 — 시험이 헛돌지 않는지)', () => {
    const withAll = draw(DATA).querySelector('.hz-edge-hit')?.getAttribute('d');
    cleanup();
    const bare = draw({}).querySelector('.hz-edge-hit')?.getAttribute('d');
    expect(bare).toBe(routeWire(ENDS, {}).d);
    expect(bare).not.toBe(withAll);
  });
});
