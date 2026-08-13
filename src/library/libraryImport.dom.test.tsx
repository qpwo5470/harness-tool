/**
 * 부품 CSV 가져오기 — 사용자에게 무엇을 알리는가.
 *
 * 재현 결함: 안내 문구가 `건너뛴 행 ${warnings.length}건` 이라 **경고 수**를
 * 건너뛴 행 수로 말했다. "분류를 몰라 하우징으로 처리"(등록은 됨) 같은 보정까지
 * 건너뛴 행으로 세어, 다 들어온 파일도 "건너뛴 행 3건" 이라 적혔다.
 * 그리고 같은 CSV 를 두 번 넣으면 id 가 새로 발급돼 라이브러리가 두 벌이 되는데
 * 아무 말도 없었다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react';
import { LibraryPanel } from './LibraryPanel';
import { loadCustomParts, saveCustomParts } from './customParts';
import { currentToast, hideToast } from '../ui/Toast';

beforeEach(() => {
  const bag = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
  });
  hideToast();
});
afterEach(() => cleanup());

const H = '이름,분류,제조사,MPN,피치,열,행,핀수,신호,색,비고,성별';

/** 숨은 file input 에 CSV 파일을 떨어뜨린다 */
async function importCsv(text: string, filename = '부품표.csv') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], filename, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  return screen.getByRole('status').textContent ?? '';
}

describe('CSV 가져오기 안내', () => {
  it('깨끗한 파일은 등록 건수만 말한다', async () => {
    render(<LibraryPanel />);
    const note = await importCsv(`${H}\nA,하우징,,,,2,1,2,,,\nB,하우징,,,,4,1,4,,,`);
    expect(note).toContain('부품 2종을 등록했습니다.');
    expect(note).not.toContain('건너뛴 행');
    expect(loadCustomParts()).toHaveLength(2);
    // 라이브러리 패널을 보고 있지 않아도 결과가 눈에 들어오게 토스트도 띄운다
    expect(currentToast()?.message).toContain('부품 2종을 등록했습니다.');
  });

  it('버린 행과 고쳐 읽은 값을 섞어 세지 않는다', async () => {
    render(<LibraryPanel />);
    const note = await importCsv(
      `${H}\n,하우징,,,,2,1,2,,,\n미지,우주선,,,,2,1,2,,,\n정상,하우징,,,,2,1,2,,,`,
    );
    expect(note).toContain('부품 2종을 등록했습니다.');
    expect(note).toContain('건너뛴 행 1건');      // 이름이 빈 2행 하나
    expect(note).toContain('확인할 값 1건');      // 분류를 몰라 하우징으로 본 3행
    expect(note).toContain('2행: 이름이 비어 건너뜀');
  });

  it('같은 MPN 이 이미 라이브러리에 있으면 두 벌이 된다고 알린다', async () => {
    saveCustomParts([
      { id: 'custom-old', category: 'housing', name: '먼저 등록', mpn: 'SMH250-04', pinCount: 4 },
    ]);
    render(<LibraryPanel />);
    const note = await importCsv(`${H}\n나중 등록,하우징,YH,SMH250-04,,4,1,4,,,`);
    expect(note).toContain('이미 있는 MPN 1건(SMH250-04)');
  });

  it('핀 수를 알 수 없는 행은 등록하되 사유를 보여 준다', async () => {
    render(<LibraryPanel />);
    const note = await importCsv('이름,분류,핀수\n핀수없음,하우징');
    expect(note).toContain('부품 1종을 등록했습니다.');
    expect(note).toContain('핀 수(열·행·핀수)가 없어');
  });

  it('부품이 하나도 안 나오면 사유만 남기고 라이브러리를 건드리지 않는다', async () => {
    render(<LibraryPanel />);
    const note = await importCsv('분류,제조사\n하우징,YEONHO');
    expect(note).toContain('등록된 부품이 없습니다.');
    expect(loadCustomParts()).toEqual([]);
  });
});
