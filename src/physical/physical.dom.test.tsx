/**
 * 물리 뷰(제조 도면) 렌더 테스트 — Claude Design 2차 §3.
 *
 * 확인하는 것: 구간표 · 끝단 카드 · 분기점 마커(채움/빈) · 치수 라벨 ·
 * 구간 ↔ 구간표 양방향 hover 동기 강조 · 자재 탭 · 선택 · 길이 미입력 표기.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type {
  Connector, Device, Endpoint, HarnessDocument, PartLibraryItem, Wire,
} from '../types';
import { PhysicalView } from './PhysicalView';
import { buildPhysicalModel } from './segments';

afterEach(cleanup);

// ---------------- 픽스처 ----------------

const housing = (id: string, name: string, pins: number, mpn?: string): PartLibraryItem => ({
  id, category: 'housing', name, mpn, pinCount: pins,
});

const conn = (id: string, housingId: string, n: number): Connector => ({
  id,
  kind: 'connector',
  housingId,
  orientation: 0,
  positions: {},
  pins: Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i + 1}`, index: i + 1 })),
});

const splice = (id: string, n: number): Connector => ({
  ...conn(id, 'lib-sp', n),
  kind: 'splice',
  bridges: [Array.from({ length: n }, (_, i) => `${id}-p${i + 1}`)],
});

const device = (id: string, name: string, terminals: string[]): Device => ({
  id, name, terminals, positions: {},
});

const pin = (c: string, i: number): Endpoint => ({ type: 'pin', connectorId: c, pinId: `${c}-p${i}` });
const dev = (d: string, t?: string): Endpoint => ({ type: 'device', deviceId: d, terminal: t });

const w = (id: string, from: Endpoint, to: Endpoint, lengthMm?: number): Wire => ({
  id, from, to, color: { base: 'red' }, gauge: { system: 'awg', value: 22 }, lengthMm,
});

function makeDoc(withLengths = true): HarnessDocument {
  const L = (n: number) => (withLengths ? n : undefined);
  return {
    schemaVersion: 1,
    id: 'doc',
    name: 'MDB 자판기 하네스',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    drawingNo: 'HRN-2408-01',
    rev: 'B',
    connectors: [conn('J1', 'h6', 6), splice('SP1', 3), conn('J2', 'h4', 4), conn('J3', 'h8', 8)],
    devices: [device('D1', 'Raspberry Pi 5', ['5V', 'GND', 'GPIO18'])],
    wires: [
      w('w1', pin('J1', 1), pin('SP1', 1), L(120)),
      w('w2', pin('SP1', 2), pin('J2', 1), L(180)),
      w('w3', pin('SP1', 3), dev('D1', '5V'), L(260)),
      w('w4', pin('J1', 2), pin('J2', 2), L(300)),
      w('w5', pin('J1', 3), pin('J3', 1), L(340)),
      w('w6', pin('J1', 4), pin('J3', 2), L(340)),
      w('w7', pin('J1', 5), pin('J2', 3), L(300)),
      w('w8', pin('J1', 6), dev('D1', 'GND'), L(380)),
      w('w9', pin('J2', 4), pin('J3', 3), L(210)),
    ],
    usedParts: [
      housing('h6', 'MDB VMC 마스터', 6, 'Molex 39-01-2060'),
      { id: 'lib-sp', category: 'splice', name: '꼬임 결선', pinCount: 3 },
      housing('h4', '연호 SMH250-04', 4, 'YEONHO SMH250-04'),
      housing('h8', 'RJ45 8P8C T568B', 8, 'ANSI/TIA-568B'),
    ],
  };
}

const draw = (doc = makeDoc(), selection: string | null = null, onSelect = vi.fn()) =>
  render(<PhysicalView doc={doc} selection={selection} onSelect={onSelect} />);

/** 부품명은 도면 카드와 자재 요약 양쪽에 나오므로 조회 범위를 좁힌다 */
const sheetOf = (c: HTMLElement) => c.querySelector('.pv-sheet') as HTMLElement;
const matOf = (c: HTMLElement) => c.querySelector('.pv-mat') as HTMLElement;

// ---------------- 테스트 ----------------

describe('구간표', () => {
  it('구간 5개가 경로 · 길이 · 본수와 함께 나온다', () => {
    const { container } = draw();
    const rows = container.querySelectorAll('.pv-table tbody tr');
    expect(rows).toHaveLength(5);

    const s1 = screen.getByText('S1').closest('tr')!;
    expect(within(s1).getByText('J1 → B1')).toBeTruthy();
    expect(within(s1).getByText('6본')).toBeTruthy();
    // 보호재 데이터는 없다 — 지어내지 않고 미지정으로 둔다
    expect(within(s1).getByText('보호재 미지정')).toBeTruthy();

    expect(screen.getByRole('tab', { name: /구간/ }).textContent).toContain('5');
  });

  /**
   * 예전에는 이 구간에 `380mm`(= 지나는 배선 중 최장) 가 치수선과 함께 찍혔다.
   * 이 하네스는 J1 하우징 바깥에서 다발이 갈라져 어떤 배선도 한 구간에서
   * 끝나지 않는다 — 즉 어느 구간의 실치수도 이 문서로는 알 수 없다.
   * 모르는 값을 그럴듯한 치수선으로 그리는 것보다 모른다고 쓰는 쪽이 낫다.
   */
  it('실치수 근거가 없으면 치수를 만들지 않고 이유를 적는다', () => {
    const { container } = draw();
    const s1 = screen.getByText('S1').closest('tr')!;
    const len = s1.querySelector('td.c-len')!;
    expect(len.firstChild?.textContent).toBe('—');
    expect(len.textContent).toContain('지나가는 배선뿐');
    expect(within(s1).queryByText('380mm')).toBeNull();

    // 치수선(티크 달린 정식 치수)이 남는 곳은 실치수가 확정된 S5 하나뿐이다 —
    // SP1→D1 은 그 구간이 곧 전 경로인 W3(260mm)가 있다.
    const dims = [...container.querySelectorAll('.pv-dimval.num')].map((n) => n.textContent);
    expect(dims).toEqual(['260']);
    const s5 = screen.getByText('S5').closest('tr')!;
    expect(s5.querySelector('td.c-len')!.textContent).toBe('260mm');
  });

  it('길이가 없으면 치수를 지어내지 않고 — 로 둔다', () => {
    const { container } = draw(makeDoc(false));
    const dashes = [...container.querySelectorAll('.pv-table td.c-len')]
      .map((td) => td.firstChild?.textContent);
    expect(dashes).toEqual(['—', '—', '—', '—', '—']);
    expect(container.querySelector('.pv-dimval.is-empty')?.textContent).toContain('전장 미입력');
    // 상태바 · 자재 요약 양쪽에 미입력 본수가 드러난다 (0mm 로 뭉개지 않는다)
    expect(container.querySelector('.pv-status')!.textContent).toContain('길이 미입력 9본');
    expect(container.querySelector('.pv-mat')!.textContent).toContain('길이 미입력 9본');
  });

  it('상태바에 구간 수와 전선 총 길이가 나온다', () => {
    const { container } = draw();
    const status = container.querySelector('.pv-status')!;
    expect(status.textContent).toContain('구간');
    expect(status.textContent).toContain('2,430mm'); // 120+180+260+300+340+340+300+380+210
    expect(status.textContent).toContain('구간에 올리면 상세');
  });

  /**
   * 감사 재현 ③ — 예전 상태바는 `전선 0mm · 길이 미입력 2본` 이었다.
   * 같은 화면 자재표에는 `케이블 500mm` 가 잡혀 있었으니 한 화면에서 숫자가 갈렸다.
   */
  it('케이블 심선은 케이블 길이를 따른다 — 상태바가 자재표와 어긋나지 않는다', () => {
    const doc: HarnessDocument = {
      ...makeDoc(),
      connectors: [conn('J1', 'h6', 6), conn('J2', 'h4', 4)],
      devices: [],
      wires: [
        { ...w('w1', pin('J1', 1), pin('J2', 1)), cableId: 'cb1' },
        { ...w('w2', pin('J1', 2), pin('J2', 2)), cableId: 'cb1' },
      ],
      cables: [{ id: 'cb1', name: '2C 전원 케이블', coreCount: 2, lengthMm: 500 }],
    };
    const { container } = draw(doc);
    const status = container.querySelector('.pv-status')!;
    expect(status.textContent).toContain('1,000mm');
    expect(status.textContent).toContain('케이블 기준 2본');
    expect(status.textContent).not.toContain('길이 미입력');
    // 두 심선 다 500mm 이므로 구간 실치수가 확정된다
    expect(container.querySelector('.pv-table td.c-len')?.textContent).toBe('500mm');
  });
});

describe('도면', () => {
  it('끝단 카드와 분기점 마커를 그린다', () => {
    const { container } = draw();
    const sheet = sheetOf(container);

    // 끝단 커넥터 카드 — 레퍼런스 + 핀수 배지 + 이름 + MPN
    expect(container.querySelectorAll('.pv-card')).toHaveLength(4); // J1 J2 J3 D1
    const j1 = within(sheet).getByText('MDB VMC 마스터').closest('.pv-card') as HTMLElement;
    expect(within(j1).getByText('J1')).toBeTruthy();
    expect(within(j1).getByText('6P')).toBeTruthy();
    expect(within(j1).getByText('Molex 39-01-2060')).toBeTruthy();
    expect(j1.style.width).toBe('118px');

    // 장치는 점선 카드
    const d1 = within(sheet).getByText('Raspberry Pi 5').closest('.pv-card')!;
    expect(d1.className).toContain('is-dev');

    // 분기점: 단순 분기(빈) 1 + 스플라이스 분기(채움) 1
    expect(container.querySelectorAll('.pv-branch')).toHaveLength(2);
    expect(container.querySelectorAll('.pv-branch.is-filled')).toHaveLength(1);
    expect(within(sheet).getByText('· 분기')).toBeTruthy();
    expect(within(sheet).getByText('· SP1 스플라이스')).toBeTruthy();
  });

  /**
   * 예전에는 최장 배선 한 본(380mm)에 `전장` 이라는 이름과 도면 전폭 치수선을
   * 붙였다. 이 하네스는 J1↔J2 직결과 J1→SP1→J2 우회가 함께 있어 끝단 간 경로가
   * 하나로 정해지지 않는다 — 그러면 전장을 만들지 않고 사실대로 "최장 배선"이라
   * 쓰고, 전폭 치수선도 그리지 않는다.
   */
  it('다발 굵기는 본수(최소 4)를 따르고 전장이 미확정이면 최장 배선으로 적는다', () => {
    const { container } = draw();
    const s1 = container.querySelector('[data-testid="pv-seg-S1"]')!;
    expect(s1.getAttribute('stroke-width')).toBe('6'); // 6본
    const s5 = container.querySelector('[data-testid="pv-seg-S5"]')!;
    expect(s5.getAttribute('stroke-width')).toBe('4'); // 2본이지만 최소 4

    const span = [...container.querySelectorAll('.pv-dimval')].find((n) =>
      n.textContent?.startsWith('최장 배선'),
    );
    expect(span?.textContent).toContain('최장 배선 380mm');
    expect(span?.textContent).toContain('W8');
    expect(span?.textContent).toContain('고리를 이뤄 전장을 확정할 수 없습니다');
    // 전장을 모르므로 도면 전폭 치수선은 그리지 않는다
    expect(screen.queryByTestId('pv-span-dim')).toBeNull();

    // 제목블록
    const title = container.querySelector('.pv-title')!;
    expect(title.textContent).toContain('MDB 자판기 하네스 · 물리');
    expect(title.textContent).toContain('치수 mm · 공차 ±5');
    expect(title.textContent).toContain('HRN-2408-01');
  });

  /**
   * 감사 재현 ② — 스플라이스로 이어진 500 + 500.
   * 이때는 전장이 확정되므로 이름도 `전장`, 도면 전폭 치수선도 그린다.
   */
  it('전장이 확정되면 경로 합을 치수선과 함께 적는다', () => {
    const doc: HarnessDocument = {
      ...makeDoc(),
      connectors: [conn('J1', 'h6', 6), splice('SP1', 2), conn('J2', 'h4', 4)],
      devices: [],
      wires: [
        w('w1', pin('J1', 1), pin('SP1', 1), 500),
        w('w2', pin('SP1', 2), pin('J2', 1), 500),
      ],
    };
    const { container } = draw(doc);
    const span = [...container.querySelectorAll('.pv-dimval')].find((n) =>
      n.textContent?.startsWith('전장'),
    );
    expect(span?.textContent).toContain('전장 1,000mm');
    expect(span?.textContent).toContain('J1 → J2');
    expect(span?.textContent).toContain('W1 + W2');
    expect(screen.getByTestId('pv-span-dim')).toBeTruthy();
  });
});

describe('구간 ↔ 구간표 동기 강조', () => {
  it('도면에서 올리면 표 행이 강조되고 상세 카드가 뜬다', () => {
    const { container } = draw();
    const s3 = container.querySelectorAll('.pv-table tbody tr')[2];
    fireEvent.mouseEnter(container.querySelector('[data-testid="pv-hit-S3"]')!);

    expect(s3.className).toContain('is-hot');
    expect(container.querySelector('[data-testid="pv-seg-S3"]')!.getAttribute('class')).toContain('is-hot');
    // 나머지 구간은 흐려진다
    expect(container.querySelector('[data-testid="pv-seg-S1"]')!.getAttribute('class')).toContain('is-dim');

    const card = screen.getByTestId('pv-hover');
    expect(card.textContent).toContain('S3');
    expect(card.textContent).toContain('외경 추정');
    expect(card.textContent).toContain('W2 W4 W7 W9'); // 포함 배선
    expect(container.querySelector('.pv-status')!.textContent).toContain('S3 강조 중');
  });

  it('표에서 올리면 도면이 강조되지만 상세 카드는 뜨지 않는다', () => {
    const { container } = draw();
    const s2 = container.querySelectorAll('.pv-table tbody tr')[1];
    fireEvent.mouseEnter(s2);

    expect(container.querySelector('[data-testid="pv-seg-S2"]')!.getAttribute('class')).toContain('is-hot');
    expect(screen.queryByTestId('pv-hover')).toBeNull();

    fireEvent.mouseLeave(s2);
    expect(container.querySelector('[data-testid="pv-seg-S2"]')!.getAttribute('class')).not.toContain('is-hot');
  });
});

// ================================================================
// 구간 길이 직접 입력
//
// 분기가 있는 하네스는 구간 실치수를 유도할 근거가 아예 없다(위 시험).
// 그 자리를 사람이 채운다. 화면은 그 값이 **입력값임을 밝혀야** 한다.
// ================================================================

describe('구간 길이 직접 입력', () => {
  /** i 번째 구간의 저장 키 — UI 가 콜백에 실어 보내는 값과 같아야 한다 */
  const keyAt = (doc: HarnessDocument, i = 0) => buildPhysicalModel(doc).segments[i].key;

  const editable = (doc = makeDoc(), onSegmentLength = vi.fn()) => ({
    onSegmentLength,
    ...render(
      <PhysicalView
        doc={doc}
        selection={null}
        onSelect={vi.fn()}
        onSegmentLength={onSegmentLength}
      />,
    ),
  });

  /** 구간표 한 줄의 길이 입력칸 */
  const lenInput = (code: string) =>
    within(screen.getByText(code).closest('tr')!).getByLabelText(`${code} 구간 길이 (mm)`, {
      selector: 'input',
    }) as HTMLInputElement;

  it('길이 칸에 넣고 Enter 를 누르면 그 구간 키로 값이 나간다', () => {
    const doc = makeDoc();
    const { onSegmentLength } = editable(doc);
    const input = lenInput('S1');

    fireEvent.change(input, { target: { value: '250' } });
    // 타이핑마다 문서를 고치면 실행취소 스택이 글자 수만큼 쌓인다 — 아직은 조용하다
    expect(onSegmentLength).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSegmentLength).toHaveBeenCalledTimes(1);
    expect(onSegmentLength).toHaveBeenCalledWith(keyAt(doc), 250);
  });

  it('비우고 확정하면 입력값을 지운다 — 유도값/미상으로 돌아가라는 뜻이다', () => {
    const doc = makeDoc();
    const withLen = { ...doc, segmentLengths: { [keyAt(doc)]: 250 } };
    const { onSegmentLength } = editable(withLen);
    const input = lenInput('S1');
    expect(input.value).toBe('250');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onSegmentLength).toHaveBeenCalledWith(keyAt(doc), null);
  });

  it('0 · 음수 · 글자는 받지 않는다 — 0mm 치수는 "0mm 로 자르라"가 된다', () => {
    const { onSegmentLength } = editable();
    const input = lenInput('S1');
    for (const bad of ['0', '-5', '길이']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(onSegmentLength).not.toHaveBeenCalled();
  });

  it('입력값은 치수선으로 나가고 표에는 입력값이라고 밝힌다', () => {
    const doc = makeDoc();
    // S1(J1→B1)은 지나가는 배선뿐이라 예전에는 영영 — 이던 구간이다
    const { container } = editable({ ...doc, segmentLengths: { [keyAt(doc)]: 250 } });
    const s1 = screen.getByText('S1').closest('tr')!;
    expect(within(s1).getByText('입력값')).toBeTruthy();
    expect(lenInput('S1').value).toBe('250');
    // 도면에도 정식 치수로 올라간다 (예전에는 S5 260 하나뿐이었다)
    const dims = [...container.querySelectorAll('.pv-dimval.num')].map((n) => n.textContent);
    expect(dims).toContain('250');
  });

  it('유도값은 흐린 글씨로 비치기만 하고 입력값 표시가 붙지 않는다', () => {
    editable();
    // S5 는 W3 260mm 가 통째로 지나는 구간 — 배선에서 나온 값이다
    const input = lenInput('S5');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('260');
    const s5 = screen.getByText('S5').closest('tr')!;
    expect(within(s5).queryByText('입력값')).toBeNull();
  });

  it('유도값과 다른 값을 넣으면 그 자리에서 두 값을 같이 보여 준다', () => {
    const doc = makeDoc();
    const key = buildPhysicalModel(doc).segments[4].key;   // S5 (SP1 → D1)
    editable({ ...doc, segmentLengths: { [key]: 300 } });
    const s5 = screen.getByText('S5').closest('tr')!;
    expect(s5.textContent).toContain('입력값');
    expect(s5.textContent).toContain('배선 260mm');
  });

  it('입력 통로가 없으면 길이 칸은 읽기만 한다 — 눌러도 되지 않는 칸은 만들지 않는다', () => {
    const doc = makeDoc();
    const { container } = draw({ ...doc, segmentLengths: { [keyAt(doc)]: 250 } });
    expect(container.querySelectorAll('.pv-leninput')).toHaveLength(0);
    const s1 = screen.getByText('S1').closest('tr')!;
    // 값과 출처는 그대로 보인다
    expect(s1.querySelector('td.c-len')!.textContent).toContain('250mm');
    expect(within(s1).getByText('입력값')).toBeTruthy();
  });

  it('전장이 구간 길이로 잡히면 무엇을 더한 값인지 밝힌다', () => {
    const doc = makeDoc();
    const keys = buildPhysicalModel(doc).segments.map((s) => s.key);
    const { container } = editable({
      ...doc,
      segmentLengths: { [keys[0]]: 100, [keys[1]]: 50, [keys[2]]: 200, [keys[3]]: 300 },
    });
    const span = [...container.querySelectorAll('.pv-dimval')].find((n) =>
      n.textContent?.startsWith('전장'),
    );
    expect(span?.textContent).toContain('전장 610mm');
    expect(span?.textContent).toContain('구간 길이 기준');
    expect(screen.getByTestId('pv-span-dim')).toBeTruthy();
  });
});

describe('자재 요약 · 선택', () => {
  it('자재 탭으로 바꾸면 실재하는 자재만 나온다(보호재 없음)', () => {
    const { container } = draw();
    fireEvent.click(screen.getByRole('tab', { name: /자재/ }));

    const rows = container.querySelectorAll('.pv-mat-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(container.querySelector('.pv-table')).toBeNull();
    expect(within(matOf(container)).getByText('MDB VMC 마스터')).toBeTruthy();
    expect([...rows].some((r) => /슬리브|테이프/.test(r.textContent ?? ''))).toBe(false);
  });

  it('끝단 카드를 누르면 그 커넥터가 선택되고, 선택된 카드는 강조된다', () => {
    const onSelect = vi.fn();
    const { container } = draw(makeDoc(), 'J2', onSelect);
    const sheet = sheetOf(container);
    const j2 = within(sheet).getByText('연호 SMH250-04').closest('.pv-card')!;
    expect(j2.className).toContain('is-sel');

    fireEvent.click(within(sheet).getByText('Raspberry Pi 5').closest('.pv-card')!);
    expect(onSelect).toHaveBeenCalledWith('D1');

    fireEvent.click(container.querySelector('[data-testid="pv-canvas"]')!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

// ============================================================
// 케이블 자켓 — 논리 뷰와 같은 규칙, 다른 좌표계
//
// 물리 뷰는 구간 트리 위에 그려지므로 사각형이 아니라 **구간 위에 덧그린 슬리브**다.
// 뜻은 같다: 심선 2본 이상이 함께 지나는 구간에만 두르고, 끊기는 자리가 브레이크아웃.
// 고치기 전에는 이 화면 어디에도 케이블이라는 사실이 나오지 않았다.
// ============================================================
describe('케이블 자켓', () => {
  /** w5·w6 (J1 → J3) 을 한 케이블로 묶는다 — 두 본이 같은 구간을 함께 지난다 */
  function cabled(jacketColor?: string): HarnessDocument {
    const doc = makeDoc();
    const mine = new Set(['w5', 'w6']);
    return {
      ...doc,
      cables: [{ id: 'cb1', name: '2C 이더넷', coreCount: 2, lengthMm: 340, ...(jacketColor ? { jacketColor } : {}) }],
      wires: doc.wires.map((x) => (mine.has(x.id) ? { ...x, cableId: 'cb1' } : x)),
    };
  }

  it('대조군 — 케이블을 지정하지 않으면 자켓이 하나도 그려지지 않는다', () => {
    const { container } = draw(makeDoc());
    expect(container.querySelectorAll('.pv-jacket')).toHaveLength(0);
  });

  it('심선 2본이 함께 지나는 구간에만 자켓이 덧그려진다', () => {
    const doc = cabled('gray');
    const { container } = draw(doc);
    const model = buildPhysicalModel(doc);
    // 그 구간을 손으로 골라 두지 않는다 — 구간 산출은 segments.ts 한 곳이 정한다
    const expected = model.segments.filter(
      (s) => s.wireIds.filter((id) => id === 'w5' || id === 'w6').length >= 2,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.pv-jacket')).toHaveLength(expected.length);
    for (const s of expected) {
      expect(screen.getByTestId(`pv-jacket-cb1-${s.code}`)).toBeTruthy();
    }
    // 심선이 갈라진 뒤의 구간에는 자켓이 없다 — 그게 브레이크아웃이다
    const lone = model.segments.find((s) => s.wireIds.includes('w5') && !s.wireIds.includes('w6'));
    if (lone) expect(screen.queryByTestId(`pv-jacket-cb1-${lone.code}`)).toBeNull();
  });

  it('자켓색 미지정은 점선 — 논리 뷰·PDF 와 같은 규칙이다', () => {
    // SVG 요소의 className 은 SVGAnimatedString 이라 문자열로 직접 읽는다
    const classOf = (c: HTMLElement) => c.querySelector('.pv-jacket')!.getAttribute('class') ?? '';
    const { container } = draw(cabled());
    expect(classOf(container)).toContain('is-unspec');
    cleanup();

    const { container: c2 } = draw(cabled('gray'));
    expect(classOf(c2)).not.toContain('is-unspec');
  });

  it('구간 호버 카드가 어느 케이블 자켓을 지나는지 밝힌다', () => {
    const doc = cabled('gray');
    const { container } = draw(doc);
    const code = buildPhysicalModel(doc).segments.find(
      (s) => s.wireIds.includes('w5') && s.wireIds.includes('w6'),
    )!.code;
    fireEvent.mouseEnter(container.querySelector(`[data-testid="pv-hit-${code}"]`)!);
    const card = screen.getByTestId('pv-hover');
    expect(within(card).getByText('케이블 자켓')).toBeTruthy();
    expect(within(card).getByText('2C 이더넷')).toBeTruthy();
  });
});
