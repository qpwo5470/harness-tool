/**
 * 밀도 시험용 픽스처 — 20본 두 열 팬아웃.
 *
 * 이 배치에서 예전 구현이 실제로 무너졌다: 세로 구간 겹침 123쌍(전부 같은 x 에
 * 포개짐), 스텁 라벨 좌표가 완전히 같은 쌍 6개. 그 수치를 못박는 자리다.
 *
 * 화면(docToFlow.test)과 PDF(pdfRoute.test)가 **같은 문서**를 봐야 두 그림을
 * 비교하는 뜻이 있어서 시험 파일이 아니라 픽스처로 뺐다.
 */
import type {
  Connector, Device, HarnessDocument, Orientation, PartLibraryItem, Wire,
} from '../types';

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

/**
 * 이름표 가림 시험용 픽스처 — **되돌아오는(backhaul) 배치** 10본.
 *
 * 왜 fanoutDoc 으로는 못 잡나: 거기서는 두 커넥터가 서로를 마주 본다(왼쪽 것이
 * 오른쪽으로, 오른쪽 것이 왼쪽으로 나간다). 경로가 곧장 가로질러 가므로 이름표
 * 띠(하우징 위 17px)를 지날 일이 없다.
 *
 * 여기서는 반대로 **서로 등을 지게** 둔다:
 *   J-L(o=0, 핸들이 왼쪽 변)  ← 왼쪽으로 나갔다가 오른쪽 상대에게 되돌아온다
 *   J-R(o=180, 핸들이 오른쪽 변) → 오른쪽으로 나갔다가 왼쪽 상대에게 되돌아온다
 * 그러면 두 스텁이 제 하우징 **옆구리를 스치며 위아래로** 달린다. 그 세로 간선이
 * 지나는 x 가 바로 이름표가 삐져나오던 자리다 — 예전 그림에서 J-R 의 이름표는
 * 하우징 오른쪽으로 100px 넘게 나와 있었고, 그 뒤로 배선이 사라졌다.
 *
 * 하우징에 mpn 을 붙여 캡션(하우징 아래 흰 띠)까지 함께 잰다.
 */
export function labelOverhangDoc(): HarnessDocument {
  const h10: PartLibraryItem = { ...strip('lib-strip-10', 10), mpn: 'SMH250-10-K' };
  const L = conn('J-L', h10.id, 10, 0, 40, 40);
  const R = conn('J-R', h10.id, 10, 180, 600, 40);
  const wires: Wire[] = Array.from({ length: 10 }, (_, k) => ({
    id: `lr${k}`,
    from: { type: 'pin', connectorId: R.id, pinId: R.pins[k].id },
    to: { type: 'pin', connectorId: L.id, pinId: L.pins[9 - k].id },
    color: { base: 'red' },
    gauge: { system: 'awg', value: 22 },
  }));
  return {
    schemaVersion: 1, id: 'labels', name: '이름표 가림',
    createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
    connectors: [L, R], devices: [], wires, cables: [], usedParts: [h10],
  };
}

/**
 * **장치** 이름표 가림 시험용 픽스처 — 배선이 장치 옆을 지나간다.
 *
 * 왜 장치를 배선에 물리지 않았나: 이번 결함은 장치가 **제3의 노드**일 때 가장
 * 잘 드러난다. 라우터도 검증 규칙(`wire-crosses-part`)도 장치의 **경계 상자**만
 * 본다. 예전 상자는 단자 이름 길이로만 잡은 48px 이었고, 그 위에 붙는 이름표는
 * 171px 이라 120px 넘게 상자 밖으로 나가 있었다 — 아무도 모르는 흰 띠다.
 * 배선이 그 띠를 지나면 화면·PDF 에서 그 구간만 사라지는데 검증은 조용하다.
 *
 * 좌표를 이렇게 고른 근거(전부 손으로 검산한 값이다):
 *   · 장치 (300, 300) · 이름표 띠 = x 300~471 · y 300~317
 *   · J-A 핸들 (390, 200) → J-B 핸들 (760, 416) · 주행 구간 y = (200+416)/2 = 308
 *   · 주행 구간 x = 404 ~ 746 → 이름표 띠와 x 404~471 에서 겹친다
 *   · 예전 상자(300~348)는 주행 구간 x 범위(404~)에 닿지 않아 **비켜 주지 않았다**
 * 그래서 고치기 전에는 이 한 본이 이름표를 정통으로 지나고, 상자를 이름표만큼
 * 넓히면 주행 구간이 상자 위(y=288)로 밀려 띠를 벗어난다.
 */
export function deviceLabelDoc(): HarnessDocument {
  const h1 = strip('lib-strip-1', 1);
  const A = conn('J-A', h1.id, 1, 180, 352, 164);   // 핸들 (390, 200)
  const B = conn('J-B', h1.id, 1, 0, 760, 380);     // 핸들 (760, 416)
  const dev: Device = {
    id: 'dev-1',
    // 제조 도면에서 실제로 쓰는 길이의 이름. 자르면 조립 지시가 사라진다.
    name: '리어 도어 락 액추에이터 모듈',
    terminals: ['+B', 'GND'],
    positions: { logical: { x: 300, y: 300 } },
  };
  return {
    schemaVersion: 1, id: 'dev-labels', name: '장치 이름표 가림',
    createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
    connectors: [A, B],
    devices: [dev],
    wires: [{
      id: 'ab',
      from: { type: 'pin', connectorId: A.id, pinId: A.pins[0].id },
      to: { type: 'pin', connectorId: B.id, pinId: B.pins[0].id },
      color: { base: 'red' },
      gauge: { system: 'awg', value: 22 },
    }],
    cables: [], usedParts: [h1],
  };
}
