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

  it('파일이 3개를 넘으면 ZIP 안내로 바뀐다', () => {
    open();
    expect(screen.getByText('파일을 개별로 내려받는다.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '문서 JSON' }));
    expect(screen.getByText('파일이 3개를 넘으면 ZIP 하나로 묶인다.')).toBeTruthy();
  });

  it('여유율 세그먼트를 바꾸면 안내 문구가 따라온다', () => {
    open();
    expect(screen.getByText('길이에 5% 더해 내보낸다')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '0%' }));
    expect(screen.getByText('도면 길이 그대로')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(screen.getByText('길이에 10% 더해 내보낸다')).toBeTruthy();
    // 직접 입력
    fireEvent.click(screen.getByRole('button', { name: '직접' }));
    fireEvent.change(screen.getByLabelText('여유율 직접 입력'), { target: { value: '12' } });
    expect(screen.getByText('길이에 12% 더해 내보낸다')).toBeTruthy();
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
    expect(plan.csvCols).toEqual(['네트', '와이어', 'FROM', 'TO', '신호', '게이지', '길이']);
    expect(plan.files).toEqual([
      { kind: 'PDF', name: 'KIT-2408_B_도면_RevB.pdf' },
      { kind: 'CSV', name: 'KIT-2408_B_접속표_RevB.csv' },
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
