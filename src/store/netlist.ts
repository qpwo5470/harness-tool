/**
 * 넷리스트 계산 (리드 소유 · 순수 함수)
 * 와이어 + 스플라이스 내부 브리지를 합쳐 "전기적으로 하나로 이어진 그룹(네트)"을 구한다.
 * - Y자 분기: 스플라이스 커넥터의 bridges로 자연히 한 네트가 됨
 * - 한 핀 다중 결선: 같은 핀을 공유하는 와이어들이 자동으로 합쳐짐
 */
import type { HarnessDocument, Endpoint } from '../types';

/** 끝점의 정규화 키 (네트 노드 식별자) */
export function endpointKey(e: Endpoint): string {
  return e.type === 'pin'
    ? `pin:${e.connectorId}:${e.pinId}`
    : `dev:${e.deviceId}:${e.terminal ?? '*'}`;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = this.parent.get(x)!;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type Net = {
  id: string;
  /** 이 네트에 속한 끝점 키들 */
  members: string[];
  /** 이 네트를 구성하는 와이어 id들 */
  wireIds: string[];
  /** 사람이 읽을 수 있는 라벨 (대표 끝점 기준) */
  label: string;
  /**
   * 짧은 네트 코드 (N1, N2 …). 접속표의 NET 열처럼 폭이 좁은 곳에서 쓴다.
   * label 은 "Raspberry Pi.5V" 처럼 길어질 수 있어 좁은 열에서 줄바꿈된다.
   */
  code: string;
};

export function computeNets(doc: HarnessDocument): Net[] {
  const uf = new UnionFind();

  // 1) 와이어로 연결
  for (const w of doc.wires) {
    uf.union(endpointKey(w.from), endpointKey(w.to));
  }

  // 2) 스플라이스 등 커넥터 내부 브리지로 연결
  for (const c of doc.connectors) {
    for (const group of c.bridges ?? []) {
      for (let i = 1; i < group.length; i++) {
        uf.union(`pin:${c.id}:${group[0]}`, `pin:${c.id}:${group[i]}`);
      }
    }
  }

  // 3) 그룹핑
  const byRoot = new Map<string, { members: Set<string>; wires: Set<string> }>();
  const touch = (root: string) => {
    if (!byRoot.has(root)) byRoot.set(root, { members: new Set(), wires: new Set() });
    return byRoot.get(root)!;
  };

  for (const w of doc.wires) {
    const root = uf.find(endpointKey(w.from));
    const g = touch(root);
    g.members.add(endpointKey(w.from));
    g.members.add(endpointKey(w.to));
    g.wires.add(w.id);
  }
  for (const c of doc.connectors) {
    for (const group of c.bridges ?? []) {
      for (const pinId of group) {
        const key = `pin:${c.id}:${pinId}`;
        touch(uf.find(key)).members.add(key);
      }
    }
  }

  // 4) 라벨링: 장치 단자를 우선 대표로 (읽기 쉬움)
  const nameOf = (key: string): string => {
    const [kind, id, tail] = key.split(':');
    if (kind === 'dev') {
      const d = doc.devices.find((x) => x.id === id);
      return `${d?.name ?? id}${tail && tail !== '*' ? `.${tail}` : ''}`;
    }
    const c = doc.connectors.find((x) => x.id === id);
    const pin = c?.pins.find((p) => p.id === tail);
    const housing = doc.usedParts.find((p) => p.id === c?.housingId)?.name ?? c?.kind ?? id;
    return `${housing}#${pin?.label ?? pin?.index ?? '?'}`;
  };

  return [...byRoot.entries()].map(([root, g], i) => {
    const members = [...g.members].sort();
    const devMember = members.find((m) => m.startsWith('dev:'));
    return {
      id: root,
      members,
      wireIds: [...g.wires],
      label: nameOf(devMember ?? members[0] ?? root) || `NET${i + 1}`,
      code: `N${i + 1}`,
    };
  });
}
