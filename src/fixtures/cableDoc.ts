/**
 * 자켓(케이블 외피) 시험용 픽스처.
 *
 * 케이블 도면의 핵심 정보는 **"어디까지 함께 가고 어디서 갈라지는가"** 다.
 * 그래서 한 문서에 두 가지를 담는다.
 *   · CB-P 3심 — J1 에서 J2 로 **끝까지 나란히** 간다
 *   · CB-Y 3심 — J1 에서 함께 나갔다가 한 본은 J2, 두 본은 J3 로 **갈라진다**
 * 여기에 케이블에 속하지 않은 맨선을 한 본 섞어, 자켓이 **제 심선만** 감싸는지
 * 볼 수 있게 한다.
 *
 * 화면(canvas)과 PDF 가 **같은 문서**를 봐야 두 그림을 비교하는 뜻이 있어서
 * 시험 파일이 아니라 픽스처로 뺀다(fanoutDoc 과 같은 이유).
 */
import type { Cable, HarnessDocument, Wire } from '../types';
import { conn, strip } from './fanoutDoc';

/** 심선 하나 — 색만 다르고 규격은 같다(자켓 기하가 규격에 흔들리지 않게) */
function core(
  id: string,
  from: [string, string],
  to: [string, string],
  base: string,
  cableId?: string,
): Wire {
  return {
    id,
    from: { type: 'pin', connectorId: from[0], pinId: from[1] },
    to: { type: 'pin', connectorId: to[0], pinId: to[1] },
    color: { base },
    gauge: { system: 'awg', value: 22 },
    ...(cableId ? { cableId } : {}),
    lengthMm: 400,
  };
}

export type CableDocOptions = {
  /** CB-P 의 자켓색. 넘기지 않으면 **미지정** (점선 윤곽으로 그려져야 한다) */
  jacketColor?: string;
};

/**
 * J1(7P, 오른쪽으로 나감) → J2(4P) · J3(3P) (둘 다 왼쪽으로 나감).
 *
 *   CB-P  3심 : J1#1→J2#1 · J1#2→J2#2 · J1#3→J2#3   (끝까지 나란히)
 *   CB-Y  3심 : J1#4→J2#4 · J1#5→J3#1 · J1#6→J3#2   (도중에 1 : 2 로 갈라진다)
 *   맨선  1본 : J1#7→J3#3                            (케이블 아님)
 */
export function cableDoc(opts: CableDocOptions = {}): HarnessDocument {
  const h7 = strip('lib-strip-7', 7);
  const h4 = strip('lib-strip-4', 4);
  const h3 = strip('lib-strip-3', 3);
  const J1 = conn('J-1', h7.id, 7, 180, 40, 40);
  const J2 = conn('J-2', h4.id, 4, 0, 820, 40);
  const J3 = conn('J-3', h3.id, 3, 0, 820, 420);

  const cbP: Cable = {
    id: 'cb-p',
    name: '3C 제어',
    coreCount: 3,
    lengthMm: 400,
    ...(opts.jacketColor ? { jacketColor: opts.jacketColor } : {}),
  };
  const cbY: Cable = {
    id: 'cb-y',
    name: '3C 분기',
    coreCount: 3,
    lengthMm: 400,
    jacketColor: 'gray',
  };

  const wires: Wire[] = [
    core('p1', ['J-1', 'J-1p1'], ['J-2', 'J-2p1'], 'red', cbP.id),
    core('p2', ['J-1', 'J-1p2'], ['J-2', 'J-2p2'], 'black', cbP.id),
    core('p3', ['J-1', 'J-1p3'], ['J-2', 'J-2p3'], 'white', cbP.id),
    core('y1', ['J-1', 'J-1p4'], ['J-2', 'J-2p4'], 'green', cbY.id),
    core('y2', ['J-1', 'J-1p5'], ['J-3', 'J-3p1'], 'blue', cbY.id),
    core('y3', ['J-1', 'J-1p6'], ['J-3', 'J-3p2'], 'brown', cbY.id),
    core('bare', ['J-1', 'J-1p7'], ['J-3', 'J-3p3'], 'yellow'),
  ];

  return {
    schemaVersion: 1,
    id: 'doc-cable-jacket',
    name: '자켓 시험',
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    connectors: [J1, J2, J3],
    devices: [],
    wires,
    cables: [cbP, cbY],
    usedParts: [h7, h4, h3],
  };
}

/**
 * **레인 배정이 케이블을 갈라 놓던** 배치 — 자켓이 통째로 사라지던 자리다.
 *
 * ── 왜 이 모양인가 (숫자를 손으로 검산한 값이다)
 * J-L(6P, 오른쪽으로) ↔ J-R(6P, 왼쪽으로) 를 **핀을 뒤집어** 잇는다. 그러면 여섯
 * 본의 두 패드 중점 y 가 전부 같아져(=136) **레인 오프셋이 곧 도면 높이**가 된다.
 * fanoutDoc 이 같은 이유로 뒤집어 물린다 — 레인만 따로 떼어 보는 배치다.
 *
 * 레인 채색은 케이블을 모르므로 배선 순서대로 번호를 나눠 준다:
 *   w1→0(+0) · w2→1(+12) · w3→2(−18) · w4→3(+24) · w5→4(−30) · w6→5(+36)
 * 도면 위에서 아래로 늘어놓으면  w5 · w3 · **w1** · w2 · **w4** · w6.
 * 케이블 심선은 w1 과 w4 인데 **그 사이를 w2 가 지난다** — 자켓은 남의 전선을
 * 삼킬 수 없으므로(wirePlan.bundleAt) 무리가 끊기고 사각형이 하나도 안 나온다.
 *
 * 심선을 이웃 높이로 몰면(docToFlow.groupLanesByCable) w1(+0) · w4(+12) 가 되어
 * 12px 간격으로 나란히 달리고, 자켓이 한 토막으로 이어진다.
 */
export function laneSplitDoc(): HarnessDocument {
  const h6 = strip('lib-strip-6', 6);
  const L = conn('J-L', h6.id, 6, 180, 40, 40);
  const R = conn('J-R', h6.id, 6, 0, 820, 40);
  const cores = new Set(['w1', 'w4']);
  const wires: Wire[] = Array.from({ length: 6 }, (_, k) => {
    const id = `w${k + 1}`;
    return core(
      id,
      ['J-L', L.pins[k].id],
      ['J-R', R.pins[5 - k].id],
      'red',
      cores.has(id) ? 'cb-s' : undefined,
    );
  });
  return {
    schemaVersion: 1,
    id: 'doc-lane-split',
    name: '레인 갈림',
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    connectors: [L, R],
    devices: [],
    wires,
    cables: [{ id: 'cb-s', name: '2C 신호', coreCount: 2, lengthMm: 400 }],
    usedParts: [h6],
  };
}
