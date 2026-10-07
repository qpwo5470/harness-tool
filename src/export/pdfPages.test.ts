import { describe, it, expect } from 'vitest';
import type { HarnessDocument } from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import {
  COLOR_NOTE, collectDatasheets, colorLabel, endsText, noteText, padNet, withLibraryFacts, wrapText,
} from './pdfPages';

describe('pdfPages — 종이 표기', () => {
  it('NET 코드는 두 자리로 (N1 → N01), 두 자리 이상은 그대로', () => {
    expect(padNet('N1')).toBe('N01');
    expect(padNet('N12')).toBe('N12');
    expect(padNet('GND')).toBe('GND');
  });

  it('색은 약호 + 한글 이름, 줄무늬는 짧은 이름, 모르는 색은 원문 그대로', () => {
    expect(colorLabel('red')).toBe('R 빨강');
    expect(colorLabel('blue')).toBe('L 파랑');
    expect(colorLabel('white', 'orange')).toBe('W/O 흰/주황');
    expect(colorLabel('#123456')).toContain('#123456');
  });

  it('비고에는 색상 문구가 언제나 붙는다', () => {
    expect(noteText(sampleDoc)).toBe(COLOR_NOTE);
    expect(noteText({ ...sampleDoc, note: '2본 1조.' })).toBe(`2본 1조. ${COLOR_NOTE}`);
  });

  it('wrapText 는 폭 안에서 줄을 나누고 글자를 버리지 않는다', () => {
    const s = `아주 긴 비고 문장입니다 ${COLOR_NOTE}`;
    const lines = wrapText(s, 80, 8.5);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(s);
  });

  it('끝단 구성은 논리 뷰 좌우로 갈라 A ↔ B 로 적는다', () => {
    const t = endsText(sampleDoc);
    expect(t).toContain(' ↔ ');
  });
});

describe('pdfPages — 라이브러리 사실 채우기', () => {
  function docWith(id: string, mpn: string, extra: Record<string, unknown> = {}): HarnessDocument {
    return {
      ...sampleDoc,
      connectors: [{ ...sampleDoc.connectors[0], housingId: id }],
      usedParts: [{ id, category: 'housing', name: 'snap', mpn, ...extra }],
    };
  }

  it('같은 id · 같은 MPN 이고 비어 있을 때만 layout · view · datasheet 를 채운다', () => {
    const d = withLibraryFacts(docWith('lib-jst-xhp-10p', 'XHP-10'));
    const p = d.usedParts[0];
    expect(p.layout).toEqual([[10, 9, 8, 7, 6, 5, 4, 3, 2, 1]]);
    expect(p.view).toBeTruthy();
    expect(p.datasheet?.src).toBe('datasheets/xh.png');
    expect(collectDatasheets([d]).map((e) => e.ds.src)).toEqual(['datasheets/xh.png']);
  });

  it('MPN 이 다르면 손대지 않고, 스냅샷에 적힌 값은 덮지 않는다', () => {
    expect(withLibraryFacts(docWith('lib-jst-xhp-10p', 'XHP-9')).usedParts[0].layout).toBeUndefined();
    const own = withLibraryFacts(docWith('lib-jst-xhp-10p', 'XHP-10', { view: '내 뷰' })).usedParts[0];
    expect(own.view).toBe('내 뷰');
    expect(own.layout).toBeUndefined(); // layout·view 는 한 쌍으로만 옮긴다
  });

  it('구매품은 부록 대상이 아니다', () => {
    const d = withLibraryFacts(docWith('lib-jst-xhp-10p', 'XHP-10'));
    expect(collectDatasheets([{ ...d, purchased: true }])).toEqual([]);
  });
});
