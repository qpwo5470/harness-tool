/**
 * 속성 패널 — 2차 리디자인(§7)으로 들어온 새 동작 테스트.
 * 색 칩 / 게이지 세그먼트 / 방향 카드 / 패드 다중 선택 후 일괄 지정 /
 * 스플라이스 대체 안내 / 단자 행 추가·삭제 / 빈 상태.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useHarnessStore } from '../store/harnessStore';
import { PropertyPanel } from './PropertyPanel';
import type { HarnessDocument, PartLibraryItem, PinSlot } from '../types';

/** 3열 × 2행 하우징 (캔버스와 같은 격자 규격을 쓰는지 확인하기 위한 픽스처) */
const HOUSING_LAYOUT: PinSlot[] = [
  { index: 1, label: '1', offset: { x: 0, y: 0 } },
  { index: 2, label: '2', offset: { x: 1, y: 0 } },
  { index: 3, label: '3', offset: { x: 2, y: 0 } },
  { index: 4, label: '4', offset: { x: 0, y: 1 } },
  { index: 5, label: '5', offset: { x: 1, y: 1 } },
  { index: 6, label: '6', offset: { x: 2, y: 1 } },
];

const housing: PartLibraryItem = {
  id: 'h6',
  category: 'housing',
  name: '테스트 하우징 6P',
  mpn: 'TST-6',
  spec: { 피치: '2.5mm' },
  gender: 'receptacle',
  pinCount: 6,
  pinLayout: HOUSING_LAYOUT,
};

const spliceItem: PartLibraryItem = {
  id: 'hs3',
  category: 'splice',
  name: '스플라이스 3 (꼬임)',
  pinCount: 3,
};

/** 시드에 있는 실제 터미널 — 셀렉트 옵션 값으로 쓴다 */
const TERMINAL_ID = 'lib-minifit-terminal';

function makeDoc(): HarnessDocument {
  return {
    schemaVersion: 1,
    id: 'doc-t',
    name: '테스트 문서',
    createdAt: '2026-08-12T03:00:00Z',
    updatedAt: '2026-08-12T03:04:00Z',
    connectors: [
      {
        id: 'c1',
        kind: 'connector',
        housingId: 'h6',
        orientation: 0,
        positions: { logical: { x: 0, y: 0 } },
        pins: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `p${i}`, index: i, label: String(i) })),
      },
      {
        id: 'sp1',
        kind: 'splice',
        housingId: 'hs3',
        orientation: 0,
        positions: { logical: { x: 0, y: 0 } },
        pins: [1, 2, 3].map((i) => ({ id: `s${i}`, index: i, label: String(i) })),
        bridges: [['s1', 's2', 's3']],
      },
    ],
    devices: [
      { id: 'd1', name: '테스트 장치', terminals: ['5V', 'GND'], positions: { logical: { x: 0, y: 0 } } },
    ],
    wires: [
      {
        id: 'w1',
        from: { type: 'pin', connectorId: 'c1', pinId: 'p1' },
        to: { type: 'device', deviceId: 'd1', terminal: '5V' },
        color: { base: 'red' },
        gauge: { system: 'awg', value: 22 },
        lengthMm: 120,
      },
    ],
    cables: [],
    usedParts: [housing, spliceItem],
  };
}

function show(selection: string | null) {
  useHarnessStore.setState({ doc: makeDoc(), selection });
  return render(<PropertyPanel />);
}

const doc = () => useHarnessStore.getState().doc;

beforeEach(() => {
  useHarnessStore.setState({ doc: makeDoc(), selection: null });
});
afterEach(() => cleanup());

describe('(A) 와이어 — 색', () => {
  it('규격 색 칩을 고르면 색이 바뀌고 직접 입력칸도 따라간다', () => {
    show('w1');
    fireEvent.click(screen.getByLabelText('기본색 흑(black)'));
    expect(doc().wires[0].color.base).toBe('black');
    expect((screen.getByLabelText('기본색 직접 입력') as HTMLInputElement).value).toBe('black');

    // 줄무늬 칩 → 약호가 합성된다
    fireEvent.click(screen.getByLabelText('줄무늬색 백(white)'));
    expect(doc().wires[0].color.stripe).toBe('white');
    expect(screen.getAllByText('B/W').length).toBeGreaterThan(0);

    // "없음" 칩으로 줄무늬 해제
    fireEvent.click(screen.getByText('없음'));
    expect(doc().wires[0].color.stripe).toBeUndefined();
  });

  it('규격 외 색은 직접 입력으로 넣을 수 있고, 규격 색을 적으면 칩 선택이 따라간다', () => {
    show('w1');
    const input = screen.getByLabelText('기본색 직접 입력');
    fireEvent.change(input, { target: { value: '형광연두' } });
    expect(doc().wires[0].color.base).toBe('형광연두');

    fireEvent.change(screen.getByLabelText('기본색 직접 입력'), { target: { value: 'green' } });
    expect(screen.getByLabelText('기본색 녹(green)').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('(A) 와이어 — 게이지', () => {
  it('AWG · mm² 세그먼트를 바꾸면 값이 환산되고 반대 단위가 표시된다', () => {
    show('w1');
    expect(screen.getAllByText(/게이지/).length).toBeGreaterThan(0);
    expect(screen.getByText('≈ 0.34 mm²')).toBeTruthy();

    fireEvent.click(screen.getByText('mm²'));
    expect(doc().wires[0].gauge).toEqual({ system: 'mm2', value: 0.34 });
    expect(screen.getByText('≈ AWG 22')).toBeTruthy();
  });
});

describe('(B) 커넥터 — 방향 카드', () => {
  it('드롭다운 대신 하우징 심볼 4카드로 방향을 고른다', () => {
    show('c1');
    const cards = ['방향 0° 왼쪽', '방향 90° 위쪽', '방향 180° 오른쪽', '방향 270° 아래쪽'];
    for (const label of cards) expect(screen.getByLabelText(label)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('방향 90° 위쪽'));
    expect(doc().connectors[0].orientation).toBe(90);
    expect(screen.getByLabelText('방향 90° 위쪽').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('(B) 커넥터 — 결합 성별', () => {
  it('요약 카드에 암수가 한 줄로 선다', () => {
    show('c1');
    const line = screen.getByText(/결합 성별/);
    expect(line.textContent).toContain('암');
    expect(line.textContent).toContain('리셉터클');
  });

  it('성별이 없는 부품(스플라이스)에는 줄을 만들지 않는다', () => {
    show('sp1');
    expect(screen.queryByText(/결합 성별/)).toBeNull();
  });
});

describe('(B) 커넥터 — 패드 다중 선택 후 일괄 지정', () => {
  it('패드를 여러 개 고른 뒤 셀렉트 하나로 터미널을 지정한다', () => {
    const { container } = show('c1');
    expect(screen.getAllByText(/터미널 지정/).length).toBeGreaterThan(0);
    expect(screen.getByText('핀 6개')).toBeTruthy();
    expect(screen.getByText('핀을 고르면 지정')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('핀 1'));
    fireEvent.click(screen.getByLabelText('핀 3'));
    expect(screen.getByText('선택 2핀에 지정')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('터미널 선택'), { target: { value: TERMINAL_ID } });

    const pins = doc().connectors[0].pins;
    expect(pins.filter((p) => p.terminalId === TERMINAL_ID).map((p) => p.index)).toEqual([1, 3]);
    // 지정한 터미널은 파트리스트용 스냅샷에도 들어간다
    expect(doc().usedParts.some((p) => p.id === TERMINAL_ID)).toBe(true);
    // 범례: A 2핀 / 미지정 4핀
    expect(screen.getByText('2핀')).toBeTruthy();
    expect(screen.getByText('4핀')).toBeTruthy();
    expect(screen.getByText('미지정')).toBeTruthy();

    // 핀 수와 무관하게 컨트롤은 셀렉트 1개뿐이다 (기존: 핀 수만큼 세로 드롭다운)
    expect(container.querySelectorAll('select').length).toBe(1);
  });

  it('모두 선택 / 선택 해제로 전체 핀을 한 번에 다룬다', () => {
    show('c1');
    fireEvent.click(screen.getByText('모두 선택'));
    expect(screen.getByText('선택 6핀에 지정')).toBeTruthy();
    fireEvent.click(screen.getByText('선택 해제'));
    expect(screen.getByText('핀을 고르면 지정')).toBeTruthy();
  });
});

describe('(B-2) 스플라이스', () => {
  it('터미널 영역이 통째로 안내로 대체된다', () => {
    const { container } = show('sp1');
    expect(screen.getByText(/압착단자가 필요 없습니다/)).toBeTruthy();
    expect(container.querySelectorAll('select').length).toBe(0);
    expect(screen.queryByText('모두 선택')).toBeNull();
  });
});

describe('(C) 장치 — 단자 행 목록', () => {
  it('단자를 추가하고, 배선된 단자는 지울 수 없다', () => {
    show('d1');
    expect(screen.getByText(/W1 배선됨/)).toBeTruthy();

    // 1번 단자(5V)는 W1 이 물려 있어 삭제 불가
    expect((screen.getByLabelText('단자 1 삭제') as HTMLButtonElement).disabled).toBe(true);
    // 2번 단자(GND)는 배선이 없어 삭제 가능
    expect((screen.getByLabelText('단자 2 삭제') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('단자 2 삭제'));
    expect(doc().devices[0].terminals).toEqual(['5V']);

    fireEvent.click(screen.getByText('+ 단자 추가'));
    expect(doc().devices[0].terminals).toHaveLength(2);
  });

  it('단자 이름을 바꾸면 그 단자를 쓰는 배선의 끝점도 따라간다', () => {
    show('d1');
    fireEvent.change(screen.getByLabelText('단자 1 이름'), { target: { value: 'VCC' } });
    expect(doc().devices[0].terminals?.[0]).toBe('VCC');
    const to = doc().wires[0].to;
    expect(to.type === 'device' && to.terminal).toBe('VCC');
  });
});

describe('(D) 미선택 — 빈 상태', () => {
  it('드로잉·안내 태그·문서 요약 4칸이 보인다', () => {
    const { container } = show(null);
    expect(screen.getByText('선택된 항목이 없습니다')).toBeTruthy();

    for (const tag of ['WIRE', 'CONN', 'DEV']) {
      expect(screen.getAllByText(tag).length).toBeGreaterThan(0);
    }

    const stats = [...container.querySelectorAll('.pp-stat')].map((el) => el.textContent);
    expect(stats).toEqual(['CONN2', 'DEV1', 'WIRE1', 'NET2']);
    // 배선된 핀 중 터미널이 지정되지 않은 것 = c1 의 1번 핀 하나
    expect(screen.getByText(/미완성 1/)).toBeTruthy();
    // 빈 상태에서는 삭제할 대상이 없다
    expect(container.querySelector('.pp-danger')).toBeNull();
  });
});

// ============================================================
// (A) 와이어 — 케이블 (감사 A-1 ~ A-7)
//
// 이 카드에는 케이블을 만들 버튼만 있고 **길이를 넣을 칸도, 지울 길도 없었다.**
// 그래서 "길이는 케이블을 따릅니다" 라는 이 기능의 존재 이유가 UI 만으로는
// 성립하지 않았다 — 새 케이블에 심선을 넣는 순간 그 심선은 '길이 미입력'
// error 가 되고, 고칠 길은 JSON 을 손으로 여는 것뿐이었다.
// ============================================================
describe('(A) 와이어 — 케이블', () => {
  /** 케이블 하나(2C)에 w1 이 든 문서. 히스토리를 비우고 시작한다 */
  function showCableDoc(over?: (d: HarnessDocument) => void) {
    const d = makeDoc();
    d.cables = [{ id: 'cb1', name: '2C 전원', coreCount: 2 }];
    d.wires = d.wires.map((w) => ({ ...w, cableId: 'cb1', lengthMm: undefined }));
    over?.(d);
    useHarnessStore.getState().replaceDoc(d);   // 히스토리 초기화 겸용
    useHarnessStore.setState({ selection: 'w1' });
    return render(<PropertyPanel />);
  }
  const cable0 = () => doc().cables![0];

  it('A-1 케이블 길이를 넣고 Enter 로 확정한다', () => {
    showCableDoc();
    const input = screen.getByLabelText('케이블 길이') as HTMLInputElement;
    expect(input.value).toBe('');                       // 미입력이 0 으로 보이지 않는다
    fireEvent.change(input, { target: { value: '300' } });
    expect(cable0().lengthMm).toBeUndefined();          // 타이핑 중에는 쌓지 않는다
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(cable0().lengthMm).toBe(300);
    // 심선 길이칸은 비어 있어도 이제 케이블 길이를 따른다고 말할 수 있다
    expect(screen.getByText(/케이블 길이 300mm를 따릅니다/)).toBeTruthy();
  });

  it('A-1 비우고 확정하면 길이를 0 이 아니라 미입력으로 되돌린다', () => {
    showCableDoc((d) => { d.cables![0].lengthMm = 300; });
    const input = screen.getByLabelText('케이블 길이');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(cable0().lengthMm).toBeUndefined();
  });

  it('A-2 케이블을 지우면 심선은 단선으로 남는다', () => {
    showCableDoc();
    fireEvent.click(screen.getByLabelText('케이블 삭제'));
    expect(doc().cables).toEqual([]);
    expect(doc().wires).toHaveLength(1);                // 배선까지 지우지 않는다
    expect(doc().wires[0].cableId).toBeUndefined();
  });

  it('A-3 없는 케이블을 가리키면 화면이 그 사실을 말한다', () => {
    showCableDoc((d) => { d.cables = []; });
    // 고치기 전: '단선' 도 어느 케이블도 아닌 아무것도 안 눌린 상태로 보였다
    expect(screen.getByRole('button', { name: '단선' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/문서에 없는 케이블/)).toBeTruthy();
  });

  it('A-4 코어 수는 실제 심선 수 아래로 내려가지 않는다', () => {
    // 2C 케이블에 심선 2본 → 더는 줄일 수 없다 (1코어에 심선 2본은 존재할 수 없다)
    showCableDoc((d) => {
      d.wires = [
        { ...d.wires[0] },
        { ...d.wires[0], id: 'w2', from: { type: 'pin', connectorId: 'c1', pinId: 'p2' } },
      ];
    });
    expect((screen.getByLabelText('코어 수 감소') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('코어 수 증가'));
    expect(cable0().coreCount).toBe(3);
    expect((screen.getByLabelText('코어 수 감소') as HTMLButtonElement).disabled).toBe(false);
    // 예비심이 생겼다는 사실도 카드에 적힌다
    expect(screen.getByText(/1심 예비/)).toBeTruthy();
  });

  it('A-4 코어 수 상한을 넘기지 않는다', () => {
    showCableDoc((d) => { d.cables![0].coreCount = 64; });
    expect((screen.getByLabelText('코어 수 증가') as HTMLButtonElement).disabled).toBe(true);
  });

  it('A-6 "+ 새 케이블" 을 연달아 눌러도 id 가 겹치지 않는다', () => {
    // 연타는 **같은 밀리초**에 들어온다 — 시계를 세워야 그 상황이 재현된다.
    // 고치기 전에는 id 가 `cbl-${Date.now()}` 뿐이라 두 케이블이 같은 id 를 갖고
    // (목록 버튼 2개 · duplicate-id error · React key 경고) 배선이 어느 쪽을
    // 가리키는지 정할 수 없었다.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      showCableDoc((d) => { d.cables = []; d.wires = d.wires.map((w) => ({ ...w, cableId: undefined })); });
      fireEvent.click(screen.getByText('+ 새 케이블'));
      fireEvent.click(screen.getByText('+ 새 케이블'));
      const list = doc().cables!;
      expect(list).toHaveLength(2);
      expect(new Set(list.map((c) => c.id)).size).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('A-7 "+ 새 케이블" 은 ⌘Z 한 번으로 통째로 사라진다', () => {
    showCableDoc((d) => { d.cables = []; d.wires = d.wires.map((w) => ({ ...w, cableId: undefined })); });
    fireEvent.click(screen.getByText('+ 새 케이블'));
    expect(doc().cables).toHaveLength(1);
    expect(doc().wires[0].cableId).toBeTruthy();

    useHarnessStore.getState().undo();
    // 고치기 전: 한 번 되돌리면 심선 0본짜리 유령 케이블이 남았고, 그 케이블은
    // 지울 수도 없는데 자재표에는 그대로 발주됐다.
    expect(doc().cables).toHaveLength(0);
    expect(doc().wires[0].cableId).toBeUndefined();
  });

  it('A-5 심선에 길이를 넣으면 문구가 이중 계상을 감추지 않는다', () => {
    showCableDoc((d) => { d.cables![0].lengthMm = 300; });
    fireEvent.change(screen.getByLabelText('길이'), { target: { value: '720' } });
    expect(doc().wires[0].lengthMm).toBe(720);
    // 고치기 전: 값을 넣은 뒤에도 "길이는 케이블을 따릅니다" 라고 적혀 있어
    // 전선 720mm + 케이블 300mm 로 같은 가닥을 두 번 사는 것을 감췄다.
    expect(screen.getByText('이 심선만 따로 재단 · 발주는 케이블로')).toBeTruthy();
  });
});

describe('푸터', () => {
  it('선택 종류에 맞는 삭제 버튼이 하단에 고정된다', () => {
    show('w1');
    expect(screen.getByText('배선 삭제')).toBeTruthy();
    cleanup();

    show('c1');
    expect(screen.getByText('커넥터 삭제')).toBeTruthy();
    cleanup();

    show('d1');
    expect(screen.getByText('장치 삭제')).toBeTruthy();
  });
});
