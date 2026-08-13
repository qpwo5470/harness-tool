/**
 * 직교(맨해튼) 배선 엣지 — 도면형 리디자인.
 *
 * 왜 베지어가 아니라 직교인가:
 * 하네스 도면은 제작 지시서다. 곡선은 어느 핀에서 어느 핀으로 가는지
 * 눈으로 따라가기 어렵고, 여러 가닥이 겹치면 구분이 안 된다.
 *
 * 왜 getSmoothStepPath 를 안 쓰나 (실측):
 * 그 함수는 핸들 방향 조합에 따라 centerY 를 무시한다 —
 *   right->left · left->left · right->right 는 무시, left->right 만 반영.
 * 하필 하네스 표준 배치(왼쪽 o=180 → 오른쪽 o=0)가 right->left 라,
 * 우리가 계산한 레인이 화면에 전혀 반영되지 않았다(20본 실측: 세로 구간 겹침 123쌍).
 * 그래서 경로는 route.ts 에서 직접 계산한다. 자세한 배경은 그쪽 머리말 참고.
 *
 * 레인(lane) 두 축:
 *   laneY — 가로 주행 구간의 y (같은 x 대역을 지나는 배선끼리 벌린다)
 *   laneX — 세로 구간의 x (같은 변에서 나가는 배선끼리 벌린다)
 * 값은 docToFlow 가 구간 겹침 채색으로 자동 배정한다.
 *
 * 구성:
 *   [보이는 선] + [투명 히트 선(굵게)] → 얇은 선도 hover 가 잡히게
 *   [스텁 라벨] 도착 패드 옆에 색 약호 + 신호명
 */
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useSelectionStore } from '../store/selectionStore';
import { useHoverStore } from '../store/hoverStore';
import { routeOrthogonal, DEFAULT_STUB, type Box } from './route';

export type OrthoEdgeData = {
  /** 가로 주행 구간의 y 오프셋(px) */
  laneY?: number;
  /** 세로 구간의 x 오프셋(px) — 패드에서 바깥으로 밀어내는 거리 */
  laneX?: number;
  /** 출발 노드 경계 상자 — 선이 박스 뒤로 숨지 않게 (없으면 회피 없음) */
  sourceBox?: Box;
  /** 도착 노드 경계 상자 */
  targetBox?: Box;
  /** 스텁 라벨: 색 약호 (R, B, W/O …) */
  abbr?: string;
  /** 스텁 라벨: 신호명 */
  signal?: string;
  /** 강조 중인가 */
  on?: boolean;
  /** 다른 배선이 강조 중이라 흐려져야 하는가 */
  dim?: boolean;
  spec?: string;
};

/** 선 색 · 굵기는 style 로 들어온다 */
export function OrthogonalEdge(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, style, data, markerEnd, selected,
  } = props;
  const d = (data ?? {}) as OrthoEdgeData;
  const clickSelect = useSelectionStore((s) => s.click);
  const setHover = useHoverStore((s) => s.setHover);

  const { d: path, labelX, labelY } = routeOrthogonal({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    laneY: d.laneY ?? 0,
    laneX: d.laneX ?? 0,
    stub: DEFAULT_STUB,        // 패드에서 곧게 빠져나오는 거리
    // 엣지는 노드보다 아래층(zIndex 0)이라 박스를 지나면 선이 화면에서 사라진다.
    // 상자를 알면 주행 구간을 박스 바깥으로 돌린다(없으면 예전 경로 그대로).
    sourceBox: d.sourceBox,
    targetBox: d.targetBox,
  });

  const stroke = (style?.stroke as string) ?? 'var(--text)';

  return (
    <>
      {/* 고정 선택 표식 — 호버(임시)와 눈으로 구분되게 선 뒤에 얇은 스틸 실선을 깐다.
          정밀 도면이라 트랜지션은 넣지 않는다(§11: 전환은 즉시). */}
      {selected && (
        <path
          d={path}
          className="hz-edge-sel"
          fill="none"
          strokeWidth={7}
          pointerEvents="none"
        />
      )}
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {/*
        투명 히트 선 — 1.6px 선을 정확히 집기는 어렵다.

        포인터 이벤트를 **전부 여기서 직접 받는다**. React Flow 의
        onEdgeClick · onEdgeMouseEnter · onEdgeMouseLeave 에 맡겼더니 둘 다 샜다:
          · 수정키를 누른 클릭이 엣지가 아니라 pane 으로 가 선택이 통째로 풀렸고
          · 선을 벗어나도 onEdgeMouseLeave 가 오지 않아 상세 카드가 커서를 따라다녔다.
        둘 다 실제 화면에서 확인했다. 이 path 는 우리 것이고 호버 영역과 정확히
        같은 모양이라, 여기서 받으면 라이브러리의 사정에 휘둘리지 않는다.
      */}
      <path
        d={path}
        className="hz-edge-hit"
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        pointerEvents="stroke"
        onClick={(e) => {
          e.stopPropagation();
          clickSelect(id, e.shiftKey || e.metaKey || e.ctrlKey);
        }}
        /*
          enter/leave 가 아니라 over/out 을 쓴다.
          이 path 는 자식이 없어 둘의 뜻이 같은데, over/out 은 root 로 위임되는
          이벤트라 항상 오고 enter/leave 는 그렇지 않다. 실제로 leave 가 오지 않아
          카드가 커서를 따라다녔다.
        */
        onMouseOver={() => setHover(id, 'canvas')}
        onMouseOut={() => setHover(null)}
      />
      {d.abbr && (
        <EdgeLabelRenderer>
          <div
            className={`hz-stub${d.on ? ' on' : ''}${d.dim ? ' dim' : ''}${selected ? ' sel' : ''}`}
            style={{
              // 스텁은 도착 패드 **직전 구간** 위에 둔다(route.ts 가 경로를 되짚어 잡아준다).
              // 예전 코드는 이 주석을 달고도 실제로는 경로 중점을 썼고,
              // 그래서 한 커넥터로 여러 가닥이 모이면 라벨 좌표가 똑같아졌다.
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: selected ? 'var(--accent)' : d.on ? 'var(--text)' : 'var(--line)',
            }}
          >
            <b className="num" style={{ color: stroke === '#fff' ? 'var(--text)' : stroke }}>{d.abbr}</b>
            {d.signal && <span>{d.signal}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { ortho: OrthogonalEdge };
