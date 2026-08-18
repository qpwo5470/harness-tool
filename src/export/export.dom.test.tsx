/**
 * 내보내기 대화상자 — Claude Design 2차 §6 동작 테스트.
 *
 * 확인하는 것: 범위 전환 → 파일 목록, 항목 체크 해제 → 파일 제거,
 * 파일명 규칙, 3개 초과 ZIP 안내, 여유율 세그먼트, Esc·스크림 닫기,
 * onExport 로 넘어가는 plan, 건수가 실제 데이터에서 나오는지.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { HarnessDocument, KitDocument, PartLibraryItem } from '../types';
import { buildRunList, buildPartList } from './exporters';
import { ExportDialog } from './ExportDialog';
import type { ExportPlan } from './ExportDialog';

afterEach(cleanup);

const housing: PartLibraryItem = {
  id: 'h4', category: 'housing', name: '테스트 하우징 4P', pinCount: 4,
  spec: { 터미널: 'TST-T' },
};

/** wireCount 본짜리 하네스 하나 */
function makeHarness(id: string, letter: string, wireCount: number): HarnessDocument {
  const pins = [1, 2, 3, 4].map((i) => ({ id: `${id}-p${i}`, index: i, label: String(i) }));
  return {
    schemaVersion: 1,
    id,
    name: `하네스 ${letter}`,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    letter,
    connectors: [
      {
        id: `${id}-c1`, kind: 'connector', housingId: 'h4', orientation: 0,
        positions: { logical: { x: 0, y: 0 } }, pins,
      },
    ],
    devices: [
      {
        id: `${id}-d1`, name: '장치', terminals: ['T1', 'T2', 'T3', 'T4'],
        positions: { logical: { x: 200, y: 0 } },
      },
    ],
    wires: Array.from({ length: wireCount }, (_, i) => ({
      id: `${id}-w${i + 1}`,
      from: { type: 'pin' as const, connectorId: `${id}-c1`, pinId: `${id}-p${(i % 4) + 1}` },
      to: { type: 'device' as const, deviceId: `${id}-d1`, terminal: `T${(i % 4) + 1}` },
      color: { base: 'black' },
      gauge: { system: 'awg' as const, value: 22 },
      lengthMm: 100 + i,
    })),
    usedParts: [housing],
  };
}

function makeKit(): KitDocument {
  const harnesses = [makeHarness('hA', 'A', 3), makeHarness('hB', 'B', 2), makeHarness('hC', 'C', 1)];
  return {
    schemaVersion: 2,
    id: 'kit-1',
    name: '자판기 1대분 하네스 세트',
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
    harnesses,
    set: {
      id: 'set-1', pn: 'KIT-2408', name: '자판기 1대분 하네스 세트', rev: 'B',
      items: harnesses.map((h) => ({ harnessId: h.id, perSet: 1 })),
      orderQty: 5,
    },
  };
}

function open(over?: Partial<React.ComponentProps<typeof ExportDialog>>) {
  const kit = makeKit();
  const onCancel = vi.fn();
  const onExport = vi.fn();
  render(
    <ExportDialog kit={kit} activeHarnessId="hA" onCancel={onCancel} onExport={onExport} {...over} />,
  );
  return { kit, onCancel, onExport };
}

const fileNames = () =>
  within(screen.getByLabelText('나올 파일'))
    .getAllByRole('listitem')
    .map((li) => li.textContent ?? '');

describe('내보내기 대화상자 §6', () => {
  it('범위를 세트 전체로 바꾸면 파일이 하네스 종 수만큼 늘어난다', () => {
    open();
    expect(fileNames()).toHaveLength(3);           // 하네스 A · PDF/접속표/파트리스트
    fireEvent.click(screen.getByRole('button', { name: '세트 전체 (A+B+C)' }));
    expect(fileNames()).toHaveLength(9);           // 3종 × 3
    expect(screen.getByText('9개')).toBeTruthy();
    expect(screen.getByText('세트 전체 · 하네스 3종 기준')).toBeTruthy();
  });

  it('항목 체크를 끄면 그 파일이 목록에서 빠지고, 켜면 다시 붙는다', () => {
    open();
    const pdf = screen.getByRole('checkbox', { name: '도면 PDF' });
    expect(pdf.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(pdf);
    expect(pdf.getAttribute('aria-checked')).toBe('false');
    expect(fileNames().some((n) => n.includes('도면'))).toBe(false);
    expect(fileNames()).toHaveLength(2);

    fireEvent.click(screen.getByRole('checkbox', { name: '문서 JSON' }));
    expect(fileNames().some((n) => n.includes('KIT-2408_문서_RevB.json'))).toBe(true);
  });

  it('파일명은 [세트]_[하네스]_[종류]_[Rev] 규칙을 따른다', () => {
    open();
    expect(fileNames()).toEqual([
      expect.stringContaining('KIT-2408_A_도면_RevB.pdf'),
      expect.stringContaining('KIT-2408_A_접속표_RevB.csv'),
      expect.stringContaining('KIT-2408_A_파트리스트_RevB.csv'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '하네스 C' }));
    expect(fileNames()[1]).toContain('KIT-2408_C_접속표_RevB.csv');
    // 세트 단위 산출물은 하네스 문자를 달지 않는다
    fireEvent.click(screen.getByRole('checkbox', { name: '하네스 BOM CSV' }));
    expect(fileNames().some((n) => n.includes('KIT-2408_하네스BOM_RevB.csv'))).toBe(true);
  });

  /**
   * 안내 문구가 "3개를 넘으면" → "2개 이상이면" 으로 바뀐 이유.
   * 예전 규칙은 파일을 하나씩 <a download> 로 눌렀고, 브라우저가 두 번째부터
   * 막아 세트 27개 중 1개만 떨어졌다(오류도 없었다). 이제 둘 이상이면 무조건
   * ZIP 한 개다 — 연속 다운로드 차단을 아예 만나지 않는다.
   */
  it('파일이 2개 이상이면 ZIP 안내로 바뀐다', () => {
    open();
    // 기본값은 PDF+접속표+파트리스트 셋이라 이미 ZIP 이다
    expect(screen.getByText('파일이 2개 이상이면 ZIP 하나로 묶인다.')).toBeTruthy();
    for (const n of ['도면 PDF', '파트리스트 CSV']) {
      fireEvent.click(screen.getByRole('checkbox', { name: n }));
    }
    expect(fileNames()).toHaveLength(1);
    expect(screen.getByText('파일 하나는 그대로 내려받는다.')).toBeTruthy();
  });

  /**
   * 문구가 "길이에 N% 더해 내보낸다" → "파트리스트 발주 길이에만 N% 더한다" 로
   * 바뀐 이유. 옛 문구는 **모든** 산출물의 길이가 늘어나는 것처럼 읽혔다.
   * 실제 규칙은 그 반대다 — 도면 PDF·접속표 CSV 는 언제나 도면 길이 그대로이고
   * 여유율은 발주용 파트리스트에만 붙는다(대화상자가 바로 아래 문단에 적어 둔
   * 원칙이며, export/bundle.ts 의 bodyOf 가 그렇게 구현한다). 어디에 적용되는지
   * 를 문구가 직접 말하지 않으면 사람은 접속표 숫자도 늘었다고 믿는다.
   */
  it('여유율 세그먼트를 바꾸면 안내 문구가 따라온다', () => {
    open();
    expect(screen.getByText('파트리스트 발주 길이에만 5% 더한다')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '0%' }));
    expect(screen.getByText('도면 길이 그대로')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(screen.getByText('파트리스트 발주 길이에만 10% 더한다')).toBeTruthy();
    // 직접 입력
    fireEvent.click(screen.getByRole('button', { name: '직접' }));
    fireEvent.change(screen.getByLabelText('여유율 직접 입력'), { target: { value: '12' } });
    expect(screen.getByText('파트리스트 발주 길이에만 12% 더한다')).toBeTruthy();
  });

  /**
   * 여유율 직접 입력의 범위 검사. 음수는 도면보다 **짧은** 전선을 주문하라는
   * 뜻이 되고, 세 자리 값이나 빈 칸은 오타다. 발주 수량을 직접 늘리는 값이라
   * 잘못된 상태로 넘어가게 두지 않는다.
   */
  it('여유율 직접 입력은 음수·비숫자·과도한 값을 받지 않는다', () => {
    const { onExport } = open();
    fireEvent.click(screen.getByRole('button', { name: '직접' }));
    const input = screen.getByLabelText('여유율 직접 입력');

    fireEvent.change(input, { target: { value: '-5' } });
    expect(screen.getByText('도면 길이 그대로')).toBeTruthy();   // 0 으로 눌린다
    fireEvent.change(input, { target: { value: '9999' } });
    expect(screen.getByText('파트리스트 발주 길이에만 100% 더한다')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByText('도면 길이 그대로')).toBeTruthy();

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect((onExport.mock.calls[0][0] as ExportPlan).marginPct).toBe(7);
  });

  /**
   * 열을 하나도 안 고르면 머리글도 없는 빈 CSV 가 나간다 — 받는 쪽에는
   * "배선이 없는 하네스" 로 읽힌다. 조용히 최소 열을 끼워 넣지 않고 막는다.
   */
  it('접속표 열을 모두 끄면 내보낼 수 없다', () => {
    const { onExport } = open();
    for (const c of ['와이어', '네트', 'FROM', 'TO', '색', '게이지', '길이']) {
      fireEvent.click(screen.getByRole('button', { name: c }));
    }
    const btn = screen.getByRole('button', { name: '내보내기' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('열을 하나도 고르지 않았다');
    fireEvent.click(btn);
    expect(onExport).not.toHaveBeenCalled();

    // 접속표 CSV 자체를 빼면 열은 상관없다 — 막을 이유가 사라진다
    fireEvent.click(screen.getByRole('checkbox', { name: '접속표 CSV' }));
    expect((screen.getByRole('button', { name: '내보내기' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('Esc 와 스크림 클릭으로 닫히고, 내용 클릭으로는 닫히지 않는다', () => {
    const { onCancel } = open();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('ex-scrim'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('건수는 실제 데이터에서 센다', () => {
    const { kit } = open();
    const a = kit.harnesses[0];
    const runs = within(screen.getByRole('checkbox', { name: '접속표 CSV' }));
    expect(runs.getByText(`${buildRunList(a).length}행`)).toBeTruthy();
    const parts = within(screen.getByRole('checkbox', { name: '파트리스트 CSV' }));
    expect(parts.getByText(`${buildPartList(a).length}행`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '세트 전체 (A+B+C)' }));
    const all = kit.harnesses.reduce((n, h) => n + buildRunList(h).length, 0);
    expect(
      within(screen.getByRole('checkbox', { name: '접속표 CSV' })).getByText(`${all}행`),
    ).toBeTruthy();
  });

  it('내보내기를 누르면 고른 그대로의 plan 이 넘어간다', () => {
    const { onExport } = open();
    fireEvent.click(screen.getByRole('button', { name: '하네스 B' }));
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    fireEvent.click(screen.getByRole('button', { name: 'inch' }));
    fireEvent.click(screen.getByRole('button', { name: 'A4' }));
    fireEvent.click(screen.getByRole('button', { name: '신호' }));      // 열 추가
    fireEvent.click(screen.getByRole('button', { name: '색' }));        // 열 제거
    fireEvent.click(screen.getByRole('checkbox', { name: '파트리스트 CSV' }));
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }));

    expect(onExport).toHaveBeenCalledTimes(1);
    const plan = onExport.mock.calls[0][0] as ExportPlan;
    expect(plan.scope).toEqual({ kind: 'harness', harnessId: 'hB' });
    expect(plan.items).toEqual({ pdf: true, runsCsv: true, partsCsv: false, bomCsv: false, json: false });
    expect(plan.marginPct).toBe(10);
    expect(plan.unit).toBe('inch');
    expect(plan.paper).toBe('A4');
    /**
     * 칩 순서가 '네트 · 와이어 …' → '와이어 · 네트 …' 로 바뀐 이유.
     * 이제 고른 열이 **고른 순서 그대로** CSV 열이 된다. 그래서 기본 선택은
     * 오래된 고정 헤더 `wire,net,from,to,color,gauge,length_mm` 와 글자 하나까지
     * 같아야 한다 — 받는 쪽 엑셀 매크로가 그 순서를 참조하고 있고, 옵션을
     * 아무것도 건드리지 않은 사람의 파일이 조용히 바뀌면 안 되기 때문이다.
     * 목록의 단일 출처는 exporters.ts 의 RUN_CSV_COLUMNS 다.
     */
    expect(plan.csvCols).toEqual(['와이어', '네트', 'FROM', 'TO', '신호', '게이지', '길이']);
    // files 에 source 가 붙었다 — 저장하는 쪽이 이름을 다시 만들지 않고 이 목록을
    // 그대로 돌기 위한 고리다(미리보기 이름 ≠ 실제 파일명 사고의 재발 방지).
    expect(plan.files).toEqual([
      { kind: 'PDF', name: 'KIT-2408_B_도면_RevB.pdf', source: { of: 'pdf', harnessId: 'hB' } },
      { kind: 'CSV', name: 'KIT-2408_B_접속표_RevB.csv', source: { of: 'runsCsv', harnessId: 'hB' } },
    ]);
  });

  it('고른 항목이 없으면 내보낼 수 없다', () => {
    const { onExport } = open();
    for (const n of ['도면 PDF', '접속표 CSV', '파트리스트 CSV']) {
      fireEvent.click(screen.getByRole('checkbox', { name: n }));
    }
    expect(screen.getByText('0개')).toBeTruthy();
    const btn = screen.getByRole('button', { name: '내보내기' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onExport).not.toHaveBeenCalled();
  });
});
