import { describe, it, expect } from 'vitest';
import type { HarnessDocument } from '../types';
import { sampleDoc } from '../fixtures/sampleDoc';
import {
  COLOR_NOTE, collectDatasheets, colorLabel, coverRows, endsText, lengthCell, noteText, padNet,
  paperName, paperPartRows, withLibraryFacts, wrapText,
} from './pdfPages';
import { toKit } from '../store/kit';

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

describe('pdfPages — 짧은 이름(shortName) · 길이 칸', () => {
  const shortDoc = (shortName: string): HarnessDocument => ({
    ...sampleDoc,
    usedParts: sampleDoc.usedParts.map((p) => (p.id === 'lib-xh-4p' ? { ...p, shortName } : p)),
  });

  it('부품표 커넥터 줄은 shortName 이 있으면 그것으로 (도면집 `J1 JST-XH 10P` 형식)', () => {
    for (const grouped of [false, true]) {
      const names = paperPartRows(shortDoc('JST-XH 4P'), 'mm', grouped).map((r) => String(r[0]));
      expect(names.some((n) => /^J\d.* JST-XH 4P$/.test(n))).toBe(true);
      // 커넥터 줄만 본다 — 단자 미지정 줄(`… 용 터미널`)은 파트리스트 집계의 이름을 따른다
      expect(names.some((n) => /^J\d+ JST XH 2\.5 4P$/.test(n))).toBe(false);
    }
  });

  it('shortName 이 없거나 공백뿐이면 라이브러리 이름 그대로 (지어내지 않는다)', () => {
    for (const d of [sampleDoc, shortDoc('   ')]) {
      const names = paperPartRows(d, 'mm').map((r) => String(r[0]));
      expect(names.some((n) => n.endsWith(' JST XH 2.5 4P'))).toBe(true);
    }
    expect(paperName(undefined, 'lib-x')).toBe('lib-x');
  });

  it('끝단 구성(표지)도 shortName 을 쓴다', () => {
    expect(endsText(shortDoc('JST-XH 4P'))).toContain('JST-XH 4P');
    const kit = toKit(shortDoc('JST-XH 4P'));
    expect(String(coverRows(kit, 'mm')[0][2])).toContain('JST-XH 4P');
  });

  it('스냅샷에 적힌 shortName 은 라이브러리 보충이 덮지 않는다', () => {
    const d: HarnessDocument = {
      ...sampleDoc,
      connectors: [{ ...sampleDoc.connectors[0], housingId: 'lib-jst-xhp-10p' }],
      usedParts: [{ id: 'lib-jst-xhp-10p', category: 'housing', name: 'snap', mpn: 'XHP-10', shortName: '내 이름' }],
    };
    expect(withLibraryFacts(d).usedParts[0].shortName).toBe('내 이름');
  });

  it('길이 칸 — 하나면 그 값, 여럿이면 범위, 일부만 알면 그 사실을 밝힌다, 모르면 미상', () => {
    const w0 = sampleDoc.wires[0];
    const only = (lens: (number | undefined)[]): HarnessDocument => ({
      ...sampleDoc,
      cables: [],
      wires: lens.map((mm, i) => ({ ...w0, id: `w${i}`, cableId: undefined, lengthMm: mm })),
    });
    expect(lengthCell(only([1600, 1600]), 'mm')).toBe('1600');
    expect(lengthCell(only([200, 1800]), 'mm')).toBe('200~1800');
    expect(lengthCell(only([200, undefined]), 'mm')).toBe('200 (일부 미상)');
    expect(lengthCell(only([undefined]), 'mm')).toBe('미상');
  });
});
