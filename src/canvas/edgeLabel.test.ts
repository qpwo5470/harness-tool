import { describe, it, expect } from 'vitest';
import { assignLanes, docToEdges } from './docToFlow';
import { sampleDoc } from '../fixtures/sampleDoc';
import { fanoutDoc } from '../fixtures/fanoutDoc';

type EdgeData = {
  spec: string; detail?: string; abbr: string;
  /** 레인은 두 축이다 — 가로 주행 구간의 y, 세로 간선의 x */
  laneY: number; laneX: number;
  on: boolean; dim: boolean;
};
const dataOf = (e: { data?: unknown }) => e.data as EdgeData;

describe('배선 라벨 표시 규칙', () => {
  it('평소에는 상세 라벨이 없다 (선끼리 겹쳐 잘리는 문제 방지)', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => dataOf(e).detail === undefined)).toBe(true);
  });

  it('스텁(색 약호)은 항상 붙는다 — 클릭 없이도 어느 색인지 읽힌다', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => Boolean(dataOf(e).abbr))).toBe(true);
    // 2톤은 슬래시 약호로
    expect(dataOf(edges.find((e) => e.id === 'w1')!).abbr).toBe('R/W');
  });

  it('클릭한 배선 하나에만 상세가 나온다 (네트 전체 아님)', () => {
    // w1 클릭 → 스플라이스로 이어진 w1,w2,w3 가 모두 강조되지만
    // 상세는 w1 에만 떠야 겹치지 않는다
    const hl = new Set(['w1', 'w2', 'w3']);
    const edges = docToEdges(sampleDoc, hl, 'w1');
    expect(dataOf(edges.find((e) => e.id === 'w1')!).detail).toBeTruthy();
    expect(dataOf(edges.find((e) => e.id === 'w2')!).detail).toBeUndefined();
    expect(dataOf(edges.find((e) => e.id === 'w3')!).detail).toBeUndefined();
    // 강조는 셋 다 유지
    expect(edges.filter((e) => e.style?.strokeWidth === 3.2)).toHaveLength(3);
  });

  it('상세에 색·게이지·길이가 들어간다', () => {
    const edges = docToEdges(sampleDoc, new Set(['w1']), 'w1');
    const detail = String(dataOf(edges.find((e) => e.id === 'w1')!).detail);
    expect(detail).toContain('red/white'); // 2톤 색
    expect(detail).toContain('AWG22');     // 게이지 대문자
    expect(detail).toContain('120mm');     // 길이
  });

  it('배선마다 레인이 달라 수평 구간이 겹치지 않는다', () => {
    const edges = docToEdges(sampleDoc);
    // 샘플의 세 배선은 x 구간이 서로 겹치므로 주행 구간 y 가 전부 갈려야 한다
    const lanes = edges.map((e) => dataOf(e).laneY);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  /**
   * 예전에는 여기서 샘플 문서의 w2·w3(스플라이스 왼쪽 변에서 나가는 두 가닥)이
   * **서로 다른** laneX 를 받는지 봤다. 그런데 그건 스플라이스 3핀의 핸들이
   * 12.7px 간격으로 뭉쳐 있어서 세로 스텁이 실제로 겹쳤기 때문이다.
   * 격자를 방향에 맞춰 세운 뒤(geometry.drawGrid) 그 핸들은 30px 씩 벌어져
   * 스텁이 더는 겹치지 않는다 — 겹치지 않는 배선에 레인을 쓰면 부채꼴만
   * 쓸데없이 넓어진다(colorRuns 머리말). 그래서 "언제나 다르다"가 아니라
   * **겹칠 때 갈린다**를 잰다. 20본 팬아웃이 실제로 겹치는 배치다.
   */
  it('세로 간선 레인도 함께 실린다 (겹치는 가닥끼리 x 를 벌린다)', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => typeof dataOf(e).laneX === 'number')).toBe(true);

    // 한 커넥터 한 변에서 10가닥이 나가 세로 스텁이 서로 겹치는 배치
    const lanes = assignLanes(fanoutDoc(), 'logical');
    expect(new Set(lanes.laneX).size).toBeGreaterThan(1);
    // 그래도 배선 수만큼 벌어지지는 않는다 (겹치는 만큼만 쓴다)
    expect(new Set(lanes.laneX).size).toBeLessThanOrEqual(10);
  });

  it('직교 라우팅 엣지 타입을 쓴다 (베지어 아님)', () => {
    expect(docToEdges(sampleDoc).every((e) => e.type === 'ortho')).toBe(true);
  });

  it('선택 안 해도 스펙을 data 로 들고 있다 (툴팁용)', () => {
    const edges = docToEdges(sampleDoc);
    const e = edges.find((x) => x.id === 'w1')!;
    expect((e.data as { spec: string }).spec).toContain('AWG22');
  });

  it('선 색은 항상 유지된다 (라벨 없어도 색으로 구분 가능)', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => e.style?.stroke)).toBe(true);
  });
});

describe('선 색 처리', () => {
  it('흰색 와이어는 옅은 회색으로 그려진다 (배경에 안 묻히게)', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('white')).toBe('#d1d5db');
  });

  it('노란색은 진하게 보정된다', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('yellow')).toBe('#eab308');
  });

  it('일반 색은 그대로', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('red')).toBe('red');
    expect(strokeColor('black')).toBe('black');
  });

  it('hex 코드도 허용', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('#ff8800')).toBe('#ff8800');
  });

  it('알 수 없는 값은 회색 (검정으로 오인 방지)', async () => {
    const { strokeColor } = await import('./docToFlow');
    expect(strokeColor('없는색')).toBe('#6b7280');
  });
});

describe('배선 레이어', () => {
  it('엣지는 노드 아래층(zIndex 0)에 그려진다', () => {
    const edges = docToEdges(sampleDoc);
    expect(edges.every((e) => e.zIndex === 0)).toBe(true);
  });
});

describe('노드 레이어', () => {
  it('노드는 엣지보다 위층(zIndex 1)이다 — 선이 블록을 가로지르지 않음', async () => {
    const { docToNodes } = await import('./docToFlow');
    const nodes = docToNodes(sampleDoc, 'logical');
    expect(nodes.every((n) => n.zIndex === 1)).toBe(true);
  });
});
