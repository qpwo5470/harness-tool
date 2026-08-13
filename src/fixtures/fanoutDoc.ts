/**
 * 밀도 시험용 픽스처 — 20본 두 열 팬아웃.
 *
 * 이 배치에서 예전 구현이 실제로 무너졌다: 세로 구간 겹침 123쌍(전부 같은 x 에
 * 포개짐), 스텁 라벨 좌표가 완전히 같은 쌍 6개. 그 수치를 못박는 자리다.
 *
 * 화면(docToFlow.test)과 PDF(pdfRoute.test)가 **같은 문서**를 봐야 두 그림을
 * 비교하는 뜻이 있어서 시험 파일이 아니라 픽스처로 뺐다.
 */
import type { Connector, HarnessDocument, Orientation, PartLibraryItem, Wire } from '../types';

/**
 * **1행 N핀** 스트립 하우징 — 실제 부품표에서 가장 흔한 모양이다.
 *
 * 예전에는 이 픽스처가 1열 N행(`offset: {x:0, y:k}`)이었다. 캔버스가 정의 격자를
 * 그대로 그리던 시절에는 그래야만 패드가 세로로 서서 핸들이 PITCH 간격으로
 * 벌어졌기 때문이다 — 즉 **결함을 피해 간 픽스처**였다. 1행으로 적으면 예전
 * 구현에서 핸들 10개가 38px 변에 3.8px 간격으로 뭉갠다.
 *
 * 지금은 그리는 쪽이 방향에 맞춰 격자를 세우므로(geometry.drawGrid) 좌우로
 * 나가는 이 배치에서 1행 정의도 세로 열로 그려진다. 그림은 예전과 똑같고
 * (박스 38×308 · 핸들 30px 간격), 대신 이 밀도 시험이 **결함을 실제로 붙잡는다**.
 */
export function strip(id: string, n: number): PartLibraryItem {
  return {
    id, category: 'housing', name: `${n}P 스트립`, pinCount: n,
    pinLayout: Array.from({ length: n }, (_, k) => ({ index: k + 1, offset: { x: k, y: 0 } })),
  };
}

export function conn(
  id: string, housingId: string, n: number, o: Orientation, x: number, y: number,
): Connector {
  return {
    id, kind: 'connector', housingId, orientation: o,
    positions: { logical: { x, y } },
    pins: Array.from({ length: n }, (_, k) => ({ id: `${id}p${k + 1}`, index: k + 1 })),
  };
}

/**
 * 왼쪽 두 열(오른쪽으로 나감) → 오른쪽 두 열(왼쪽으로 나감), 20본.
 * 핀 순서를 뒤집어 물려 배선이 서로 교차하게 한다(가장 빡센 경우).
 */
export function fanoutDoc(): HarnessDocument {
  const h10 = strip('lib-strip-10', 10);
  const A = conn('J-A', h10.id, 10, 180, 40, 40);
  const B = conn('J-B', h10.id, 10, 180, 40, 420);
  const C = conn('J-C', h10.id, 10, 0, 900, 40);
  const D = conn('J-D', h10.id, 10, 0, 900, 420);
  const wires: Wire[] = [];
  const link = (from: Connector, to: Connector, tag: string) => {
    for (let k = 0; k < 10; k++) {
      wires.push({
        id: `${tag}${k}`,
        from: { type: 'pin', connectorId: from.id, pinId: from.pins[k].id },
        to: { type: 'pin', connectorId: to.id, pinId: to.pins[9 - k].id },
        color: { base: 'red' },
        gauge: { system: 'awg', value: 22 },
      });
    }
  };
  link(A, C, 'ac');
  link(B, D, 'bd');
  return {
    schemaVersion: 1, id: 'fan', name: '팬아웃',
    createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
    connectors: [A, B, C, D], devices: [], wires, cables: [], usedParts: [h10],
  };
}
