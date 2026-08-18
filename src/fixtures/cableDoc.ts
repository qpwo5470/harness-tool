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
