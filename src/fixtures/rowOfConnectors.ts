/**
 * 제3의 노드 관통 시험용 픽스처 — **커넥터를 한 줄로 늘어놓은 배치**.
 *
 * 왜 이 배치인가: 하네스 도면에서 가장 흔한 그림이다(좌→우로 흐르는 간선).
 * 그런데 예전 라우터는 **자기 양 끝 상자 둘만** 피했다. 양 끝을 잇는 배선은
 * 가운데 커넥터들을 통째로 관통했고, 하우징은 흰색으로 채워지므로 화면·PDF
 * 모두에서 선이 그 구간만 사라졌다.
 *
 * 실측(고치기 전): `배선 8본 · 제3노드 관통 3본`
 *   w2→[cB,cC,cD]  w3→[cB,cC,cD]  w4→[cB,cC,cD]
 *
 * ── 왜 시드 라이브러리를 쓰지 않고 하우징을 여기 적어 두나
 * 위 수치를 낸 배치는 시드의 연호 SMH250-06 / SMH250-04 로 잰 것이다. 그런데
 * 경계 상자의 **폭은 이름표 글자 폭**이 정하므로(geometry.connectorBox),
 * 시드의 `name`·`mpn` 이 한 글자만 바뀌어도 이 픽스처의 수치가 조용히 흔들린다.
 * 시드는 부품 데이터라 앞으로도 늘고 바뀐다 — 시험이 그걸 따라다닐 이유가 없다.
 * 그래서 그때 쓴 이름·품번·핀 배치를 여기 그대로 못박는다.
 */
import type { Connector, HarnessDocument, Orientation, PartLibraryItem, Wire } from '../types';

/**
 * 연호 SMH250 하우징 — 1행 N핀(시드의 `grid(n, 1)` 과 같은 모양).
 * `mpn` 이 있으면 하우징 아래에 캡션이 한 줄 붙고 그만큼 경계 상자가 높아진다.
 * 실측 배치가 그랬으므로 여기서도 붙인다.
 */
function smh250(n: number): PartLibraryItem {
  const nn = String(n).padStart(2, '0');
  return {
    id: `lib-yh-smh250-${n}p`,
    category: 'housing',
    name: `연호 SMH250-${nn} (${n}P)`,
    manufacturer: 'YEONHO',
    mpn: `SMH250-${nn}`,
    pinCount: n,
    pinLayout: Array.from({ length: n }, (_, k) => ({
      index: k + 1, label: String(k + 1), offset: { x: k, y: 0 },
    })),
  };
}

function conn(
  id: string, housing: PartLibraryItem, o: Orientation, x: number, y: number,
): Connector {
  return {
    id, kind: 'connector', housingId: housing.id, orientation: o,
    positions: { logical: { x, y } },
    pins: Array.from({ length: housing.pinCount ?? 0 }, (_, k) => ({
      id: `${id}p${k + 1}`, index: k + 1,
    })),
  };
}

/**
 * 커넥터 5개를 한 줄로 (x = 0 / 260 / 520 / 780 / 1040).
 *   cA — 6P, o=180 (핸들이 오른쪽 변 → 오른쪽으로 나간다)
 *   cB·cC·cD — 4P, o=0 (핸들이 왼쪽 변)
 *   cE — 6P, o=0
 *
 * 배선 8본:
 *   w1..w4  cA → cE   가운데 셋(cB·cC·cD)을 가로지른다
 *   w5      cB → cC   이웃끼리 (제3의 노드를 지날 일이 없는 대조)
 *   w6      cC → cD
 *   w7      cA → cB
 *   w8      cD → cE
 */
export function rowOfConnectorsDoc(): HarnessDocument {
  const p6 = smh250(6);
  const p4 = smh250(4);

  const cols = [
    conn('cA', p6, 180, 0, 0),
    conn('cB', p4, 0, 260, 40),
    conn('cC', p4, 0, 520, 40),
    conn('cD', p4, 0, 780, 40),
    conn('cE', p6, 0, 1040, 0),
  ];

  const wires: Wire[] = [];
  /** @param fp,tp 는 핀 배열의 **0-base** 자리 (핀 번호는 +1) */
  const add = (fi: number, fp: number, ti: number, tp: number) => {
    wires.push({
      id: `w${wires.length + 1}`,
      from: { type: 'pin', connectorId: cols[fi].id, pinId: cols[fi].pins[fp].id },
      to: { type: 'pin', connectorId: cols[ti].id, pinId: cols[ti].pins[tp].id },
      color: { base: ['red', 'black', 'blue', 'green', 'yellow', 'white'][wires.length % 6] },
      gauge: { system: 'awg', value: 22 },
      lengthMm: 200,
    });
  };
  for (let i = 0; i < 4; i += 1) add(0, i, 4, i);   // w1..w4 : cA → cE
  add(1, 0, 2, 0);                                  // w5 : cB → cC
  add(2, 1, 3, 1);                                  // w6 : cC → cD
  add(0, 4, 1, 1);                                  // w7 : cA → cB
  add(3, 2, 4, 4);                                  // w8 : cD → cE

  return {
    schemaVersion: 1, id: 'row', name: '한 줄 배치',
    createdAt: '2026-08-14T00:00:00Z', updatedAt: '2026-08-14T00:00:00Z',
    connectors: cols, devices: [], wires, cables: [], usedParts: [p6, p4],
  };
}
