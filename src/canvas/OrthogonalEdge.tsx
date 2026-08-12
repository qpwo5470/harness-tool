/**
 * 직교(맨해튼) 배선 엣지 — 도면형 리디자인.
 *
 * 왜 베지어가 아니라 직교인가:
 * 하네스 도면은 제작 지시서다. 곡선은 어느 핀에서 어느 핀으로 가는지
 * 눈으로 따라가기 어렵고, 여러 가닥이 겹치면 구분이 안 된다.
 *
 * 레인(lane):
 * 수평 구간이 서로 겹치지 않도록 배선마다 고유한 y 오프셋을 준다.
 * Claude Design 목업은 이 값을 손으로 배정했지만(README 명시),
 * 여기서는 **배선 순서로 자동 배정**한다. docToFlow.assignLanes 참고.
 *
 * 구성:
 *   [보이는 선] + [투명 히트 선(굵게)] → 얇은 선도 hover 가 잡히게
 *   [스텁 라벨] 도착 패드 옆에 색 약호 + 신호명
 */
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export type OrthoEdgeData = {
  /** 레인 오프셋(px). 수평 구간이 겹치지 않게 배선마다 다르게 준다. */
  lane?: number;
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

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 0,           // 도면 요소는 각진 모서리
    offset: 14,                // 패드에서 수직으로 빠져나오는 거리
    centerY: (sourceY + targetY) / 2 + (d.lane ?? 0),
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
      {/* 투명 히트 선 — 1.6px 선을 정확히 집기는 어렵다 */}
      <path
        d={path}
        className="hz-edge-hit"
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        pointerEvents="stroke"
      />
      {d.abbr && (
        <EdgeLabelRenderer>
          <div
            className={`hz-stub${d.on ? ' on' : ''}${d.dim ? ' dim' : ''}${selected ? ' sel' : ''}`}
            style={{
              // 스텁은 도착 패드 쪽에 둔다. 출발 기준으로 놓으면
              // 한 커넥터에서 여러 가닥이 나갈 때 라벨끼리 겹친다.
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
