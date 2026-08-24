/**
 * 스텁 라벨 자리 — 겹치지 않게 어긋 배치.
 *
 * **이 파일은 docToFlow 를 부르지 않는다.** 그게 이 파일이 따로 있는 이유다.
 * 처음에 이 계산을 `wirePlan.ts` 에 넣었더니 `docToFlow → wirePlan → docToFlow`
 * 순환이 생겼고, 모듈 초기화 순서에 따라 `LANE_Y_STEP` 이 아직 undefined 인
 * 상태로 읽혀 `JACKET_MAX_GAP` 이 NaN 이 됐다. NaN 비교는 전부 false 라
 * 자켓을 끊어야 할 자리에서 안 끊고, **그리면 안 될 자켓이 생겼다**.
 * 시험(jacket.test.ts)이 그걸 잡았다 — 라벨을 고치다 자켓을 깨뜨린 것이다.
 *
 * 그래서 라벨 배치는 기하(route·geometry)에만 기대게 떼어 둔다.
 */
import { estimateTextWidth } from './geometry';
import { DEFAULT_LABEL_BACKOFF, DEFAULT_STUB, type Pt } from './route';

const EPS = 1e-6;
const segLen = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * ── 왜 필요한가 (실측)
 *
 * 라벨은 도착 패드에서 `DEFAULT_LABEL_BACKOFF` 만큼 경로를 되짚은 자리에 **가운데
 * 정렬**로 놓인다. 한 커넥터로 여러 가닥이 모이면 그 자리들이 서로 너무 가깝다.
 *
 * 특히 **2열 커넥터**가 0°/180° 로 놓이면 패드가 한 변에 겹쳐 서는데, 그 간격은
 * `PAD / depth` = 26/2 = **13px** 이다. 라벨 상자 높이는 14px 이므로 세로로는
 * 어떻게 해도 안 비켜간다. 실제 도면(MDB 6P)에서 라벨 다섯 개가 서로를 덮어
 * 글자를 못 읽고, 상자가 흰 배경이라 뒤에 지나는 **배선까지 지웠다**.
 *
 * ── 그래서 진행 방향으로 어긋 놓는다
 * 세로가 막혔으니 남은 축은 경로를 따라가는 방향뿐이다. backoff 를 한 칸씩 늘리면
 * 라벨이 제 배선을 타고 커넥터에서 멀어진다 — **자기 선 위에 남으므로** 어느 배선의
 * 라벨인지 헷갈리지 않는다. 도면에서 흔히 쓰는 계단식 배치가 이것이다.
 *
 * 화면·PDF 가 같은 값을 써야 두 그림이 갈라지지 않으므로 여기 한 곳에서만 정한다.
 */

/** 라벨 상자 높이(논리 px) — canvas.css `.hz-stub` 의 실측 높이와 같은 값 */
export const STUB_BOX_H = 14;

/** 라벨 글꼴 크기(논리 px) — canvas.css `.hz-stub` 와 같은 값 */
export const STUB_FONT_PX = 10;

/**
 * 라벨 상자 폭(논리 px).
 *
 * 겹침을 푸는 쪽·화면·PDF 가 **같은 폭**을 써야 한다. 예전에는 pdfDraw 가 이
 * 계산을 따로 들고 있었다 — 상수를 베끼면 한쪽만 고쳐지고 두 그림이 갈라진다
 * (이 파일 머리말의 그 사고와 같은 종류다).
 */
export function stubWidth(abbr: string, signal?: string): number {
  const a = estimateTextWidth(abbr, STUB_FONT_PX);
  const s = signal ? estimateTextWidth(signal, STUB_FONT_PX) + 4 : 0;
  return a + s + 8;
}

/** 어긋 놓을 때 상자 사이에 두는 최소 틈 */
export const STUB_GAP = 4;

/** 한 배선을 이 횟수까지 밀어 본다. 넘으면 포기하고 마지막 자리에 둔다. */
export const STUB_MAX_STEPS = 6;

export type StubLabelInput = {
  /** 배선 id — 결과를 되찾는 열쇠 */
  id: string;
  /** 라벨 상자 폭(논리 px). 글자 폭에서 온다 */
  width: number;
  /** 이 배선의 경로 꺾임점 */
  points: Pt[];
};

export type StubLabelPlan = {
  id: string;
  /** `routeOrthogonal` 에 넘길 되짚기 거리 */
  backoff: number;
  /** 그 거리로 잡은 라벨 중심 */
  x: number;
  y: number;
  width: number;
};

/** 경로 끝에서 `back` 만큼 되짚은 점 — route.ts 의 `pointFromEnd` 와 같은 계산 */
function backFrom(points: Pt[], back: number): Pt {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  let left = back;
  for (let k = points.length - 1; k > 0; k--) {
    const b = points[k];
    const a = points[k - 1];
    const len = segLen(a, b);
    if (len >= left) {
      const t = len < EPS ? 0 : left / len;
      return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
    }
    left -= len;
  }
  return points[0];
}

const boxesHit = (
  a: { x: number; y: number; width: number },
  b: { x: number; y: number; width: number },
) =>
  Math.abs(a.x - b.x) * 2 < a.width + b.width + STUB_GAP
  && Math.abs(a.y - b.y) * 2 < STUB_BOX_H * 2 + STUB_GAP;

/**
 * 배선들의 라벨을 서로 겹치지 않게 배치한다.
 *
 * 순서는 **입력 순서(문서 순서)** 를 지킨다 — 같은 문서면 언제나 같은 그림이 나와야
 * 화면과 PDF, 그리고 두 번 연 도면이 서로 어긋나지 않는다.
 */
export function planStubLabels(
  wires: StubLabelInput[],
  base = DEFAULT_LABEL_BACKOFF,
): StubLabelPlan[] {
  const placed: StubLabelPlan[] = [];
  for (const w of wires) {
    /*
     * 경로보다 멀리 되짚을 수는 없다.
     *
     * 처음엔 이 상한이 없었다. 그러면 `backFrom` 이 경로 시작점을 돌려주는데,
     * 밀린 라벨들이 **전부 그 한 점에 뭉쳐** 겹침이 되레 심해진다(시험이 잡았다).
     * 짧은 배선에서는 어긋 놓을 자리가 없다는 게 사실이므로, 억지로 밀지 않고
     * 갈 수 있는 데까지만 간다. 남는 겹침은 화면 쪽에서 신호명을 접어 푼다.
     */
    const total = w.points.reduce((s, p, k) => (k === 0 ? 0 : s + segLen(w.points[k - 1], p)), 0);
    const limit = Math.max(base, total - DEFAULT_STUB);

    let chosen: StubLabelPlan | null = null;
    for (let step = 0; step <= STUB_MAX_STEPS; step++) {
      // 한 칸 = 상자 폭 + 틈. 폭이 제각각이라 칸도 제각각이지만, 겹치는지는
      // 아래에서 실제 상자로 다시 확인하므로 칸 크기는 첫 시도값일 뿐이다.
      const want = base + step * (w.width + STUB_GAP);
      if (step > 0 && want > limit) break;     // 더 밀 자리가 없다 — 직전 자리를 쓴다
      const p = backFrom(w.points, want);
      const cand: StubLabelPlan = { id: w.id, backoff: want, x: p.x, y: p.y, width: w.width };
      chosen = cand;
      if (!placed.some((q) => boxesHit(cand, q))) break;
    }
    placed.push(chosen!);
  }
  return placed;
}
