/**
 * 논리 뷰의 **자켓(케이블 외피)** 레이어.
 *
 * 케이블은 여러 심선이 한 외피 안에 든 물건인데, 도면에서는 그냥 따로 노는 선
 * 여러 가닥으로 보였다 — 제작자가 "이 세 가닥은 한 케이블" 이라는 걸 알 방법이
 * 없었다. 그래서 나란히 가는 구간을 슬리브 윤곽으로 감싸고 이름을 붙인다.
 *
 * ── 기하는 여기서 만들지 않는다
 * 사각형도 이름표 자리도 전부 `wirePlan.planJackets` 에서 온다. PDF(pdfDraw)도
 * **같은 함수**를 부른다 — 경로에서 두 번 났던 "화면과 종이가 다른 그림" 사고를
 * 자켓에서 되풀이하지 않기 위해서다.
 *
 * ── 왜 ViewportPortal 인가
 * 자켓은 노드도 엣지도 아니지만 **도면 좌표계**에 놓여야 한다(줌·팬을 따라가야
 * 한다). React Flow 가 그 용도로 열어 둔 구멍이 ViewportPortal 이다. 엣지로
 * 흉내 내려면 없는 source/target 노드를 지어내야 하고, 그러면 배선 목록에
 * 케이블이 배선인 척 섞여 든다.
 *
 * ── 좌표 출처가 배선과 다르다
 * 화면 배선은 React Flow 의 DOM 실측 좌표로 그려지고, 자켓은 geometry 계산
 * 좌표로 그려진다(두 출처는 몇 px 어긋날 수 있다 — wirePlan.EdgeEnds 주석).
 * 그래서 자켓 벽은 심선 바깥으로 JACKET_PAD(7px) 띄운다 — 그만큼이 완충이다.
 */
import { useMemo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { HarnessDocument, ViewMode } from '../types';
import { useSelectionStore } from '../store/selectionStore';
import { jacketPaint } from './docToFlow';
import { planJackets } from './wirePlan';

export function JacketLayer({
  doc,
  view,
  selection,
}: {
  doc: HarnessDocument;
  view: ViewMode;
  selection: string | null;
}) {
  const setIds = useSelectionStore((s) => s.setIds);
  const jackets = useMemo(() => planJackets(doc, view), [doc, view]);
  const drawn = jackets.filter((j) => j.runs.length > 0);
  if (!drawn.length) return null;

  return (
    <ViewportPortal>
      {/*
        폭·높이 0 짜리 SVG 에 overflow:visible 로 그린다 — 도면 크기를 미리 알 수
        없고, 알더라도 배선이 바뀔 때마다 캔버스를 다시 잡아야 하기 때문이다.
        좌표는 flow 좌표를 그대로 쓴다(포털이 뷰포트 변환 안에 있다).

        zIndex -1 은 **PDF 와 같은 겹침 순서**를 만들려는 것이다. 포털은 DOM 에서
        엣지·노드보다 뒤에 놓여 그냥 두면 자켓이 배선 위에 뜨는데, 종이는
        자켓 → 배선 → 하우징 순으로 그린다(pdfDraw.drawDrawing). 두 그림이
        갈리지 않게 화면도 아래로 내린다.
      */}
      <svg
        className="hz-jackets"
        style={{
          position: 'absolute', left: 0, top: 0, width: 0, height: 0,
          overflow: 'visible', zIndex: -1,
        }}
      >
        {drawn.map((j) => {
          const paint = jacketPaint(j.jacketColor);
          const on = selection === j.cableId;
          return (
            <g key={j.cableId} data-cable={j.cableId}>
              {j.runs.map((r, i) => (
                <g key={`${r.axis}-${i}`}>
                  <rect
                    className={`hz-jacket${on ? ' on' : ''}`}
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill="none"
                    stroke={paint.color}
                    strokeWidth={on ? 2.6 : 1.4}
                    /* 자켓색 미지정은 점선 — 색을 지어내지 않는다(docToFlow.jacketPaint) */
                    strokeDasharray={paint.dashed ? '7 4' : undefined}
                  />
                  {/*
                    히트 영역은 **윤곽선 위**에만 둔다. 사각형 안쪽을 잡으면 자켓
                    속을 달리는 심선을 클릭할 수 없게 된다 — 심선이 먼저다.
                  */}
                  <rect
                    className="hz-jacket-hit"
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10}
                    pointerEvents="stroke"
                    onClick={(e) => {
                      e.stopPropagation();
                      // 수정키는 받지 않는다 — 다중 선택은 배선 공통 속성용이고
                      // 케이블과 배선을 섞으면 속성 탭이 다룰 공통 속성이 없다(§11).
                      setIds([j.cableId]);
                    }}
                  />
                </g>
              ))}
              {j.labelAt && (
                <text
                  className={`hz-jacket-label${on ? ' on' : ''}`}
                  x={j.labelAt.x}
                  y={j.labelAt.y}
                  fill={paint.color}
                >
                  {j.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}
