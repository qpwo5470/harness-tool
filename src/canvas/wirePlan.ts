/**
 * 배선 기하의 **단일 출처** — 같은 문서면 화면과 PDF 가 같은 경로를 받는다.
 *
 * ── 왜 이 파일이 생겼나 (실측)
 * 화면은 route.ts 의 직교 라우터(레인 두 축 + 끝 노드 박스 회피)로 옮겼는데
 * PDF(pdfDraw.ts)는 제 경로 계산을 그대로 들고 있었다. 그래서 **같은 하네스에서
 * 두 그림이 갈렸다**:
 *   · 화면 — J1(o=0, 핸들이 왼쪽 변) → SP1 배선이 J1 박스 아래로 돌아 간다
 *   · PDF  — 같은 배선이 J1 박스를 관통한다. 하우징을 흰색으로 채우므로 선이
 *            덮여 사라지고, 박스 오른쪽 변에서 난데없이 튀어나온 것처럼 보인다
 * 게다가 pdfDraw 는 엣지 data 의 `lane` 을 읽고 있었는데 그 필드는 이미 `laneY`·
 * `laneX` 두 축으로 갈린 뒤였다. 즉 **PDF 의 레인 분리는 통째로 0 이었다**
 * (`data.lane ?? 0` 이 언제나 0). 20본 도면이면 스무 가닥이 한 줄에 포개진다.
 *
 * 도면은 공장에 나가는 산출물이다. 그림이 둘이면 어느 쪽이 맞는지 아무도 모른다.
 * 그래서 "문서 → 배선 경로" 를 여기 한 곳에만 둔다. 화면(OrthogonalEdge)도
 * PDF(pdfDraw)도 이 함수만 부른다. **좌표계 변환(px → pt, 스케일·평행이동)은
 * PDF 쪽에서만** 한다 — 기하는 여기서 끝난다.
 *
 * React·DOM 을 쓰지 않는다(그래야 PDF 쪽에서도 부를 수 있다).
 */
import type { Position } from '@xyflow/react';
import type { HarnessDocument, ViewMode } from '../types';
import { assignLanes } from './docToFlow';
import { routeOrthogonal, DEFAULT_STUB, type Box, type Pt, type Route } from './route';

/**
 * 엣지 양 끝 좌표.
 * 화면은 React Flow 가 **DOM 실측**으로 주고, PDF 는 geometry.ts 가 계산해서 준다.
 * 두 출처는 몇 px 어긋날 수 있다(REF_BLOCK_H 가 CSS 실측 근사값이라서).
 * 그래서 좌표만 밖에서 받고, 그 좌표로 무엇을 그리는지는 아래 한 함수가 정한다.
 */
export type EdgeEnds = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
};

/**
 * 배선 한 가닥의 레인·회피 정보.
 * `docToEdges` 가 엣지 data 에 싣는 필드와 **같은 모양**이라 그대로 넘길 수 있다.
 */
export type WireGeometry = {
  /** 가로 주행 구간의 y 오프셋 */
  laneY?: number;
  /** 세로 간선의 x 오프셋 */
  laneX?: number;
  /** 출발 노드 경계 상자 — 없으면 회피를 건너뛴다 */
  sourceBox?: Box;
  /** 도착 노드 경계 상자 */
  targetBox?: Box;
  /**
   * 제3의 노드 상자들 — 한 줄로 늘어선 커넥터 사이를 지나는 배선이 가운데
   * 하우징을 관통하지 않게 한다. 배선 전체가 **같은 배열**을 나눠 쓴다.
   */
  obstacles?: Box[];
};

/**
 * 배선 한 가닥의 경로. **화면과 PDF 가 둘 다 이 함수만 부른다.**
 *
 * 여기서 stub 기본값을 못박는 이유: 예전에 pdfDraw 가 `STUB_OUT = 14` 를 따로
 * 적어 두고 있었다. 상수를 베끼면 한쪽만 고쳐지고 두 그림이 조용히 갈라진다.
 */
export function routeWire(ends: EdgeEnds, g: WireGeometry = {}): Route {
  return routeOrthogonal({
    ...ends,
    laneY: g.laneY ?? 0,
    laneX: g.laneX ?? 0,
    stub: DEFAULT_STUB,
    sourceBox: g.sourceBox,
    targetBox: g.targetBox,
    obstacles: g.obstacles,
  });
}

/** 배선 한 가닥의 계획 — 꺾임점 · SVG path · 스텁 라벨 자리 */
export type PlannedWire = {
  /** 와이어 id */
  id: string;
  /** SVG path d (화면 좌표계) */
  d: string;
  /** 꺾임점 목록 (화면 좌표계) */
  points: Pt[];
  /** 스텁 라벨 중심 x */
  labelX: number;
  /** 스텁 라벨 중심 y */
  labelY: number;
};

/**
 * 문서 → 배선별 경로. 순서는 `doc.wires` 그대로다.
 *
 * 끝점 좌표·레인·노드 박스는 전부 `assignLanes`(docToFlow) 한 곳에서 나온다.
 * PDF 는 여기서 나온 점들에 **등비 변환만** 걸어 그린다.
 */
export function planWires(doc: HarnessDocument, view: ViewMode = 'logical'): PlannedWire[] {
  const lanes = assignLanes(doc, view);
  return doc.wires.map((w, i) => {
    const r = routeWire(
      {
        sourceX: lanes.from[i].x,
        sourceY: lanes.from[i].y,
        targetX: lanes.to[i].x,
        targetY: lanes.to[i].y,
        sourcePosition: lanes.from[i].side,
        targetPosition: lanes.to[i].side,
      },
      {
        laneY: lanes.laneY[i],
        laneX: lanes.laneX[i],
        sourceBox: lanes.fromBox[i],
        targetBox: lanes.toBox[i],
        obstacles: lanes.obstacles,
      },
    );
    return { id: w.id, d: r.d, points: r.points, labelX: r.labelX, labelY: r.labelY };
  });
}
