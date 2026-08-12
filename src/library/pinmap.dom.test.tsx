/**
 * 핀맵 에디터 2차 리디자인(§8) 동작 테스트.
 *
 * 여기서 지키는 것:
 *  1) 2열 레이아웃 — 핀 속성이 그리드 아래 가로 스트립이고, 미선택이어도 자리가 남는다.
 *  2) 1번 핀 위치 4택 × 번호 방향 3택의 조합으로 번호가 즉시 다시 매겨진다.
 *  3) 신호·색은 물리 위치를 따라가고 번호만 새로 부여된다.
 *  4) 터미널 분기 — 압착 규격 · 압착 단면 도해 · 적용 하우징.
 *  5) 저장 결과(PartLibraryItem)의 필드 구성은 그대로다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PinMapEditor, numberingOrder, buildPins } from './PinMapEditor';
import type { PartLibraryItem } from '../types';

afterEach(() => cleanup());

/** 격자 패드를 aria-label 로 찾는다 — `핀 3 · 2열 1행 · GND` 형식 */
const padAt = (col: number, row: number) =>
  screen.getByLabelText(new RegExp(`^핀 \\d+ · ${col}열 ${row}행`));
const padNumberAt = (col: number, row: number) =>
  Number(/^핀 (\d+)/.exec(padAt(col, row).getAttribute('aria-label') ?? '')![1]);

function open(props: Partial<Parameters<typeof PinMapEditor>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<PinMapEditor onSave={onSave} onCancel={onCancel} {...props} />);
  return { onSave, onCancel };
}

describe('핀맵 에디터 — 2열 레이아웃', () => {
  it('핀 속성이 그리드 아래 가로 스트립이고, 미선택이어도 자리가 남는다', () => {
    open();
    // 헤더 · 우측 헤더
    expect(screen.getByText('새 부품 만들기')).toBeTruthy();
    expect(screen.getByText('핀 배치')).toBeTruthy();
    expect(screen.getByText('패드를 클릭해 신호·색을 넣는다')).toBeTruthy();

    // 스트립은 비어 있어도 렌더된다 — 제목 자리에 '—'
    const strip = screen.getByText('핀 속성').parentElement!.parentElement!;
    expect(strip.className).toContain('pm-strip');
    expect(strip.className).toContain('off');
    expect(within(strip).getByText('—')).toBeTruthy();

    // 필드도 자리를 지키되 잠겨 있다
    expect((screen.getByLabelText('신호명') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('핀 표기') as HTMLInputElement).disabled).toBe(true);
  });

  it('패드를 클릭하면 그 핀이 스트립에서 열리고 신호명이 패드 아래 캡션으로 붙는다', () => {
    open();
    fireEvent.click(padAt(2, 1)); // 2열 1행 = 기본(좌상·행 우선)에서 2번 핀

    expect(screen.getByText('핀 2')).toBeTruthy();
    const signal = screen.getByLabelText('신호명') as HTMLInputElement;
    expect(signal.disabled).toBe(false);

    fireEvent.change(signal, { target: { value: 'GND' } });
    // 캡션은 패드와 같은 격자 셀 안에 들어간다
    const cell = padAt(2, 1).parentElement!;
    expect(within(cell).getByText('GND')).toBeTruthy();

    // 규격 색 칩
    fireEvent.click(screen.getByLabelText('규격 색 흑'));
    expect((screen.getByLabelText('규격 색 직접 입력') as HTMLInputElement).value).toBe('black');
  });
});

describe('핀맵 에디터 — 1번 핀 위치 × 번호 방향', () => {
  it('1번 핀을 우상으로 옮기면 번호가 즉시 다시 매겨진다', () => {
    open();
    expect(padNumberAt(1, 1)).toBe(1);

    fireEvent.click(screen.getByRole('radio', { name: /우상/ }));

    // 4×1 격자에서 1번은 오른쪽 끝으로 간다
    expect(padNumberAt(4, 1)).toBe(1);
    expect(padNumberAt(1, 1)).toBe(4);
    // 기준 안내는 우측 헤더와 심볼 아래 두 곳에 같이 적힌다
    expect(screen.getAllByText('1번 핀 우상 · 래치 상면 · 결합면 기준').length).toBe(2);
  });

  it('번호 방향을 바꿔도 신호·색은 물리 위치를 따라가고 번호만 새로 부여된다', () => {
    open();
    // 4×2 로 키운다
    fireEvent.click(screen.getByLabelText('행 늘리기'));
    expect(screen.getByText('8핀')).toBeTruthy();

    // 2열 2행 패드에 신호를 넣는다 (행 우선 기준 6번)
    fireEvent.click(padAt(2, 2));
    expect(screen.getByText('핀 6')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('신호명'), { target: { value: 'TX' } });

    // 열 우선으로 바꾸면 같은 물리 위치의 번호가 4번이 된다
    fireEvent.click(screen.getByRole('radio', { name: /열 우선/ }));
    const pad = padAt(2, 2);
    expect(pad.getAttribute('aria-label')).toContain('핀 4');
    expect(pad.getAttribute('aria-label')).toContain('TX');
    expect(within(pad.parentElement!).getByText('TX')).toBeTruthy();

    // 지그재그는 2행의 방향을 뒤집는다 — 2열 2행은 7번
    fireEvent.click(screen.getByRole('radio', { name: /지그재그/ }));
    expect(padNumberAt(2, 2)).toBe(7);
  });

  it('번호 규칙(순수 함수)이 1번 핀 위치와 조합된다', () => {
    // 좌상 · 행 우선
    expect(numberingOrder(4, 2, 'tl', 'row')[0]).toEqual({ x: 0, y: 0 });
    // 우하 · 행 우선 → 1번은 우하
    expect(numberingOrder(4, 2, 'br', 'row')[0]).toEqual({ x: 3, y: 1 });
    // 좌상 · 열 우선 → 두 번째는 같은 열 아래
    expect(numberingOrder(4, 2, 'tl', 'col')[1]).toEqual({ x: 0, y: 1 });
    // 지그재그는 두 번째 행이 뒤집힌다
    expect(numberingOrder(4, 2, 'tl', 'snake')[4]).toEqual({ x: 3, y: 1 });

    // 격자를 줄이면 밖으로 나간 핀은 사라지고, 남은 핀의 신호는 위치를 따라간다
    const before = buildPins(4, 1, 'tl', 'row', []);
    before[3].signal = '멀리';
    before[0].signal = '가까이';
    const after = buildPins(2, 1, 'tl', 'row', before);
    expect(after).toHaveLength(2);
    expect(after[0].signal).toBe('가까이');
    expect(after.some((p) => p.signal === '멀리')).toBe(false);
  });
});

describe('핀맵 에디터 — 터미널 분기', () => {
  it('터미널이면 좌측에 압착 규격, 우측에 압착 단면 도해와 적용 하우징이 나온다', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: '터미널' }));

    // 핀 배열 UI 는 사라진다
    expect(screen.queryByLabelText('열 늘리기')).toBeNull();
    expect(screen.getAllByText(/핀 배치를 정의하지 않습니다/).length).toBeGreaterThan(0);

    // 좌: 압착 범위 · 공구
    expect(screen.getByPlaceholderText('AWG 22–26')).toBeTruthy();
    expect(screen.getByPlaceholderText('예: YRF-880')).toBeTruthy();

    // 우: 압착 단면 도해 3구간 + 적용 하우징 칩 입력
    expect(screen.getByText('피복')).toBeTruthy();
    expect(screen.getByText('심선')).toBeTruthy();
    expect(screen.getByText('접촉부')).toBeTruthy();
    const apply = screen.getByPlaceholderText('SMH250 (2.5mm)');
    fireEvent.change(apply, { target: { value: 'SMH250 (2.5mm)' } });
    fireEvent.keyDown(apply, { key: 'Enter' });
    expect(screen.getByLabelText('SMH250 (2.5mm) 제거')).toBeTruthy();
  });
});

describe('핀맵 에디터 — 저장', () => {
  it('저장은 이름이 있어야 열리고, 부품 필드 구성은 그대로다', () => {
    const { onSave } = open();
    const saveBtn = screen.getByText('저장') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByText('이름을 입력해야 저장됩니다')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '내 전용 4P' } });
    fireEvent.change(screen.getByLabelText('피치'), { target: { value: '2.5mm' } });
    fireEvent.click(padAt(1, 1));
    fireEvent.change(screen.getByLabelText('신호명'), { target: { value: '+24V' } });
    fireEvent.click(screen.getByLabelText('규격 색 적'));

    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const part = onSave.mock.calls[0][0] as PartLibraryItem;
    expect(part.id.startsWith('custom-')).toBe(true);
    expect(part.category).toBe('housing');
    expect(part.name).toBe('내 전용 4P');
    expect(part.spec).toEqual({ 피치: '2.5mm' });
    expect(part.pinCount).toBe(4);
    expect(part.pinLayout).toHaveLength(4);
    expect(part.pinLayout![0]).toMatchObject({
      index: 1, offset: { x: 0, y: 0 }, signal: '+24V', stdColor: 'red',
    });
    // 번호 오름차순으로 저장된다
    expect(part.pinLayout!.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('기존 부품을 편집하면 핀 배치와 id 가 보존된다', () => {
    const initial: PartLibraryItem = {
      id: 'custom-xyz',
      category: 'housing',
      name: '기존 6P',
      pinCount: 6,
      pinLayout: [
        { index: 1, label: 'A1', offset: { x: 0, y: 0 }, signal: 'VCC' },
        { index: 2, label: 'A2', offset: { x: 1, y: 0 } },
        { index: 3, label: 'A3', offset: { x: 2, y: 0 } },
        { index: 4, label: 'B1', offset: { x: 0, y: 1 } },
        { index: 5, label: 'B2', offset: { x: 1, y: 1 } },
        { index: 6, label: 'B3', offset: { x: 2, y: 1 } },
      ],
    };
    const { onSave } = open({ initial });

    expect(screen.getByText('부품 편집')).toBeTruthy();
    expect(screen.getByText('6핀')).toBeTruthy();
    // 표기(A1 등)는 첫 렌더에서 다시 매겨지지 않는다
    expect(within(padAt(1, 1)).getByText('A1')).toBeTruthy();

    fireEvent.click(screen.getByText('저장'));
    const part = onSave.mock.calls[0][0] as PartLibraryItem;
    expect(part.id).toBe('custom-xyz');
    expect(part.pinLayout!.map((p) => p.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
  });
});
