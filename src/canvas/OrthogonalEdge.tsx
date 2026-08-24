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
import type { Box } from './route';
import { routeWire } from './wirePlan';

export type OrthoEdgeData = {
  /** 가로 주행 구간의 y 오프셋(px) */
  laneY?: number;
  /** 세로 구간의 x 오프셋(px) — 패드에서 바깥으로 밀어내는 거리 */
  laneX?: number;
  /** 출발 노드 경계 상자 — 선이 박스 뒤로 숨지 않게 (없으면 회피 없음) */
  sourceBox?: Box;
  /** 도착 노드 경계 상자 */
  targetBox?: Box;
  /**
   * 제3의 노드 상자들 — 이 배선의 끝이 아닌 부품 뒤로도 선이 숨지 않게.
   * 문서의 모든 노드가 들어 있고, 엣지 전체가 **같은 배열 참조**를 나눠 쓴다.
   */
  obstacles?: Box[];
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

/**
 * 흰 배경 위에서 읽히는 글자색.
 *
 * 도면 약호는 전선 색으로 찍어야 어느 선인지 바로 잡히지만, 밝은 색은 흰 배경에서
 * 사라진다. 그런 색만 본문색으로 바꾼다.
 *
 * 기준은 상대 휘도 0.62. 이 선을 넘는 것은 지금 두 가지다.
 *   흰 전선  `#d1d5db` 휘도 0.66 → 흰 배경 대비 1.5:1
 *   노랑     `#eab308` 휘도 0.70 → 흰 배경 대비 1.4:1
 * 둘 다 작은 굵은 글자로는 읽히지 않는 대비다(4.5:1 이 본문 기준).
 * 처음엔 노랑은 남길 생각이었는데 재 보니 흰 전선보다 더 밝았다 — 시험이 잡았다.
 *
 * **잃는 것**: 그 두 색은 약호에서 색 단서가 빠진다. 대신 약호 글자(`W`·`Y`) 자체가
 * 색을 말하고, 라벨이 앉은 선이 바로 옆에 있으며, 상세 카드에 `색` 칸이 있다.
 * 읽히지 않는 글자보다는 낫다.
 *
 * 값 하나를 비교하지 않고 **밝기**로 가르므로 새 색을 넣어도 규칙이 따라온다.
 */
export function readableInk(stroke: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(stroke.trim());
  if (!m) return stroke;                       // 색 이름(red 등)은 대개 충분히 진하다
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  // 눈이 느끼는 밝기 — 초록에 가장 민감하다(ITU-R BT.709)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.62 ? 'var(--text)' : stroke;
}

/** 선 색 · 굵기는 style 로 들어온다 */
export function OrthogonalEdge(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, style, data, markerEnd, selected,
  } = props;
  const d = (data ?? {}) as OrthoEdgeData;
  const clickSelect = useSelectionStore((s) => s.click);
  const setHover = useHoverStore((s) => s.setHover);

  /**
   * 경로는 **wirePlan.routeWire 하나**에서만 나온다 — PDF(pdfDraw)도 같은 함수를
   * 부른다. 여기서 따로 계산하면 종이와 화면이 다른 그림이 된다(실제로 그랬다).
   * 이쪽 좌표는 React Flow 의 DOM 실측값이고 PDF 는 geometry 계산값이라 출처만
   * 다르다. 레인·상자는 data 에 실려 온 것을 그대로 넘긴다.
   */
  const { d: path, labelX, labelY } = routeWire(
    { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition },
    d,
  );

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
            {/*
              약호는 전선 색으로 쓰되 **읽히는 한에서만** 그렇게 한다.

              예전 조건은 `stroke === '#fff'` 였는데, 이 값은 이미 `strokeColor` 를
              지나온 뒤라 흰 전선은 `#fff` 가 아니라 `#d1d5db` 로 들어온다.
              그래서 조건이 한 번도 맞지 않았고, 흰 전선의 W 가 흰 배경 위에
              옅은 회색으로 찍혀 **읽을 수가 없었다**(화면에서 확인).
              값 하나를 비교하는 대신 밝기로 판단한다 — 노랑처럼 밝은 색도 함께 걸린다.
            */}
            <b className="num" style={{ color: readableInk(stroke) }}>{d.abbr}</b>
            {/*
              신호명은 **강조된 가닥에만** 편다.

              색 약호는 두세 글자라 어디에 놓든 자리가 나지만, 신호명은
              "+34V (무정전)" 처럼 길어 상자를 90px 넘게 벌린다. 한 커넥터로
              대여섯 가닥이 모이면 그 상자들이 뒤에 지나는 **배선을 통째로 덮는다**
              (흰 배경이라 지워 버린다). 실제 MDB 6P 도면이 그랬다.

              어긋 배치(planStubLabels)로 상자끼리 겹치는 것은 풀었지만, 넓은
              상자가 도면을 가리는 것은 자리를 옮겨서 될 일이 아니다 — 평소에는
              접어 두고 그 가닥을 짚었을 때만 편다. 신호명은 커넥터 핀 칸·접속표·
              상세 카드에도 있으므로 잃는 정보가 없다.
              종이(PDF)는 짚을 수가 없으니 늘 펴 둔다.
            */}
            {d.signal && (d.on || selected) && <span>{d.signal}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { ortho: OrthogonalEdge };
