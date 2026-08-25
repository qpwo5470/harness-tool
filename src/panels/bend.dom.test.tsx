/**
 * 속성 패널의 **꺾임** 칸이 실제로 도면을 움직이는지.
 *
 * 왜 따로 있나: 이 레포에서 가장 비싼 결함은 "시험은 통과하는데 화면이 안 되는 것"
 * 이었다(§10-3 — 케이블 길이 칸이 아예 없었고, 하네스 BOM 은 체크만 되고 코드가
 * 없었다). 그래서 순수 함수 시험(canvas/manualRoute.test.ts)과 **짝으로** 여기서
 * 버튼을 실제로 눌러 보고, 눌린 결과가 문서를 지나 **그려지는 경로**까지
 * 도달하는지 확인한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useHarnessStore } from '../store/harnessStore';
import { PropertyPanel } from './PropertyPanel';
import { assignLanes, LANE_Y_STEP, LANE_X_STEP } from '../canvas/docToFlow';
import { planWires } from '../canvas/wirePlan';
import { sampleDoc } from '../fixtures/sampleDoc';
import type { HarnessDocument, PartLibraryItem } from '../types';

const housing: PartLibraryItem = {
  id: 'h4',
  category: 'housing',
  name: '테스트 하우징 4P',
  pinCount: 4,
  pinLayout: [0, 1, 2, 3].map((k) => ({ index: k + 1, offset: { x: k, y: 0 } })),
};

/** 두 커넥터를 나란히 놓고 두 본을 잇는다 — 레인이 실제로 갈리는 최소 배치 */
function makeDoc(): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'doc-bend',
    name: '꺾임 시험',
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-25T00:00:00Z',
    connectors: [
      {
        id: 'cL', kind: 'connector', housingId: 'h4', orientation: 180,
        positions: { logical: { x: 0, y: 0 } },
        pins: [1, 2, 3, 4].map((i) => ({ id: `l${i}`, index: i })),
      },
      {
        id: 'cR', kind: 'connector', housingId: 'h4', orientation: 0,
        positions: { logical: { x: 460, y: 40 } },
        pins: [1, 2, 3, 4].map((i) => ({ id: `r${i}`, index: i })),
      },
    ],
    devices: [],
    wires: [
      {
        id: 'w1',
        from: { type: 'pin', connectorId: 'cL', pinId: 'l1' },
        to: { type: 'pin', connectorId: 'cR', pinId: 'r1' },
        color: { base: 'red' }, gauge: { system: 'awg', value: 22 },
      },
      {
        id: 'w2',
        from: { type: 'pin', connectorId: 'cL', pinId: 'l2' },
        to: { type: 'pin', connectorId: 'cR', pinId: 'r2' },
        color: { base: 'black' }, gauge: { system: 'awg', value: 22 },
      },
    ],
    cables: [],
    usedParts: [housing],
  };
}

const S = () => useHarnessStore.getState();
const doc = () => S().doc;
const routeOf = (id: string) => doc().wires.find((w) => w.id === id)?.route;
const pointsOf = (id: string) =>
  JSON.stringify(planWires(doc(), 'logical').find((r) => r.id === id)!.points);
/** 지정을 통째로 뺀 문서로 그린 경로 — "정말 그대로인가" 를 재는 대조군 */
const autoPoints = (id: string) => {
  const bare = { ...doc(), wires: doc().wires.map(({ route: _drop, ...w }) => w) };
  return JSON.stringify(planWires(bare, 'logical').find((r) => r.id === id)!.points);
};

/** replaceDoc 으로 넣어야 실행취소 스택이 이 시험 안에서 깨끗하다 */
function show(wireId: string) {
  S().replaceDoc(makeDoc());
  useHarnessStore.setState({ selection: wireId });
  return render(<PropertyPanel />);
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => S().replaceDoc(makeDoc()));
afterEach(() => cleanup());

describe('속성 패널 — 꺾임 조정', () => {
  it('손대기 전에는 자동값을 placeholder 로 보여 주고 값은 비어 있다', () => {
    show('w1');
    const auto = assignLanes(doc(), 'logical').autoLaneY[0];
    const el = input('가로 간선 꺾임 위치');
    expect(el.value).toBe('');                       // 지정 없음 = 빈칸
    expect(el.placeholder).toBe(String(auto));       // 지금 자동은 몇인가
    expect(screen.queryByText('손으로 지정됨')).toBeNull();
  });

  it('+ 를 누르면 레인 한 칸만큼 내려가고 **도면이 실제로 바뀐다**', () => {
    show('w1');
    const auto = assignLanes(doc(), 'logical').autoLaneY[0];
    const before = pointsOf('w1');

    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));

    expect(routeOf('w1')).toEqual({ laneY: auto + LANE_Y_STEP });
    expect(pointsOf('w1')).not.toBe(before);
    expect(screen.getByText('손으로 지정됨')).toBeTruthy();
  });

  it('− 를 누르면 반대로 간다 (방향을 고를 수 있다)', () => {
    show('w1');
    const auto = assignLanes(doc(), 'logical').autoLaneY[0];
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 빼기'));
    expect(routeOf('w1')).toEqual({ laneY: auto - LANE_Y_STEP });
  });

  it('세로 간선도 제 단위(LANE_X_STEP)로 움직인다', () => {
    show('w1');
    const auto = assignLanes(doc(), 'logical').autoLaneX[0];
    fireEvent.click(screen.getByLabelText('세로 간선 한 칸 더하기'));
    expect(routeOf('w1')).toEqual({ laneX: auto + LANE_X_STEP });
  });

  it('숫자를 쳐서 Enter 로 확정한다 — 타이핑 중에는 문서가 바뀌지 않는다', () => {
    show('w1');
    const el = input('가로 간선 꺾임 위치');
    fireEvent.change(el, { target: { value: '-4' } });
    expect(routeOf('w1')).toBeUndefined();           // 아직 초안
    fireEvent.change(el, { target: { value: '-48' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(routeOf('w1')).toEqual({ laneY: -48 });
  });

  it('0 을 넣으면 지정으로 남는다 — 비움이 아니다', () => {
    show('w1');
    const el = input('가로 간선 꺾임 위치');
    fireEvent.change(el, { target: { value: '0' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(routeOf('w1')).toEqual({ laneY: 0 });
  });

  it('빈칸으로 확정하면 자동으로 돌아간다', () => {
    show('w1');
    const auto = pointsOf('w1');
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    expect(pointsOf('w1')).not.toBe(auto);

    const el = input('가로 간선 꺾임 위치');
    fireEvent.change(el, { target: { value: '' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(routeOf('w1')).toBeUndefined();
    expect(pointsOf('w1')).toBe(auto);               // 글자 하나까지 예전 그림
  });

  it('"자동으로" 는 두 축을 함께 지우고, ⌘Z 한 번으로 되돌아온다', () => {
    show('w1');
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    fireEvent.click(screen.getByLabelText('세로 간선 한 칸 더하기'));
    const both = routeOf('w1');
    expect(both?.laneY).toBeDefined();
    expect(both?.laneX).toBeDefined();

    fireEvent.click(screen.getByText('자동으로'));
    expect(routeOf('w1')).toBeUndefined();

    S().undo();
    expect(routeOf('w1')).toEqual(both);             // 반만 되돌아오지 않는다
  });

  it('한 본을 옮겨도 옆 배선의 경로는 그대로다', () => {
    show('w1');
    const other = pointsOf('w2');
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    expect(pointsOf('w2')).toBe(other);
  });

  /**
   * ── 브라우저에서 실제로 만난 상태를 시험으로 옮긴 것
   * 샘플 문서의 w2(도착 핸들이 위쪽)는 경로가 이미 도착 상자를 비켜 그 바깥으로
   * 밀려 있어, laneY 를 한 칸 올려도 **꺾임점이 한 점도 바뀌지 않았다.** 값만 바뀌고
   * 도면은 그대로 — §10-3 이 말하는 "눌러도 반응 없음" 이다. 화면이 그 사실을
   * 말하는지 여기서 붙잡는다.
   */
  it('값이 그림을 못 바꾸면 화면이 그렇게 말한다', () => {
    // 실제로 만난 그 배선을 그대로 쓴다 — 샘플 문서의 w2(SP1 → J2, 도착 핸들이 위쪽)
    S().replaceDoc(sampleDoc);
    useHarnessStore.setState({ selection: 'w2' });
    render(<PropertyPanel />);

    // 브라우저에서 + 한 번(자동 12 → 24)을 눌렀을 때 꺾임점이 하나도 안 바뀌었다
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    expect(routeOf('w2')).toEqual({ laneY: 24 });
    expect(pointsOf('w2')).toBe(autoPoints('w2'));      // 정말로 그림이 그대로다
    expect(screen.getByText(/도면을 바꾸지 못합니다/)).toBeTruthy();
    expect(screen.getAllByText('입력값 · 그림은 그대로').length).toBeGreaterThan(0);
  });

  it('그림이 실제로 바뀌는 값에서는 그 안내가 뜨지 않는다 (대조군)', () => {
    show('w1');
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    expect(screen.queryByText(/도면을 바꾸지 못합니다/)).toBeNull();
  });

  it('± 를 두 번 누르면 실행취소도 두 번이다 (한 번에 다 풀리지 않는다)', () => {
    show('w1');
    const auto = assignLanes(doc(), 'logical').autoLaneY[0];
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    fireEvent.click(screen.getByLabelText('가로 간선 한 칸 더하기'));
    expect(routeOf('w1')).toEqual({ laneY: auto + LANE_Y_STEP * 2 });
    S().undo();
    expect(routeOf('w1')).toEqual({ laneY: auto + LANE_Y_STEP });
    S().undo();
    expect(routeOf('w1')).toBeUndefined();
  });
});
