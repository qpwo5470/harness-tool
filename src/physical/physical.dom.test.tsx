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
