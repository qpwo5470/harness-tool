import { describe, it, expect } from 'vitest';
import { parsePartsCsv, partsToCsv, parseCsvRecords } from './partsCsv';
import { parsePartsFile, parseCustomParts, isCustomPart } from './customParts';
import type { PartLibraryItem } from '../types';

/**
 * 표준 헤더. `성별` 은 맨 뒤에 붙는다 —
 * 아래 데이터 행들은 성별 열이 없는 **기존 부품표** 그대로이고, 그래도 읽혀야 한다.
 */
const H = '이름,분류,제조사,MPN,피치,열,행,핀수,신호,색,비고,성별';

/** id 는 매번 새로 발급되므로 비교에서 뺀다 */
const noId = (p: PartLibraryItem) => {
  const { id, ...rest } = p;
  return rest;
};

describe('CSV 저수준 파서', () => {
  it('따옴표 안의 쉼표는 열을 쪼개지 않는다', () => {
    const rows = parseCsvRecords('"연호, 2.5mm",4\n');
    expect(rows).toEqual([['연호, 2.5mm', '4']]);
  });

  it('이스케이프된 따옴표("")는 따옴표 한 개가 된다', () => {
    const rows = parseCsvRecords('"그는 ""안녕"" 이라 했다",1');
    expect(rows[0][0]).toBe('그는 "안녕" 이라 했다');
  });

  it('따옴표 안 줄바꿈은 값 안에 남는다', () => {
    const rows = parseCsvRecords('a,"1줄\r\n2줄",c\nd,e,f');
    expect(rows).toHaveLength(2);
    expect(rows[0][1]).toBe('1줄\n2줄');
    expect(rows[1]).toEqual(['d', 'e', 'f']);
  });

  it('CRLF · CR · LF 를 모두 줄바꿈으로 본다', () => {
    expect(parseCsvRecords('a\r\nb\rc\nd')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });
});

describe('parsePartsCsv — 기본', () => {
  it('한글 헤더 CSV 를 부품으로 읽는다', () => {
    const csv = `${H}\n연호 SMH250-04,하우징,YEONHO,SMH250-04,2.5mm,4,1,4,+24V|GND|TX|RX,red|black|white|green,샘플`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toEqual([]);
    expect(parts).toHaveLength(1);
    const p = parts[0];
    expect(p.name).toBe('연호 SMH250-04');
    expect(p.category).toBe('housing');
    expect(p.manufacturer).toBe('YEONHO');
    expect(p.mpn).toBe('SMH250-04');
    expect(p.spec).toEqual({ 피치: '2.5mm', 비고: '샘플' });
    expect(p.pinCount).toBe(4);
    expect(p.pinLayout).toHaveLength(4);
    expect(p.pinLayout![0]).toEqual({
      index: 1, label: '1', offset: { x: 0, y: 0 }, signal: '+24V', stdColor: 'red',
    });
    expect(isCustomPart(p.id)).toBe(true);
  });

  it('영문 헤더도 받는다', () => {
    const csv = 'name,category,manufacturer,mpn,pitch,cols,rows,pins,signals,colors,note\n' +
      'Mini-Fit 6P,board-to-wire,Molex,39-01-2060,4.2mm,3,2,6,A|B|C|D|E|F,,VMC';
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toEqual([]);
    expect(parts[0].category).toBe('board-to-wire');
    expect(parts[0].pinCount).toBe(6);
    // 행 우선 배치: 4번 핀은 둘째 줄 첫 칸
    expect(parts[0].pinLayout![3].offset).toEqual({ x: 0, y: 1 });
  });

  it('헤더 순서가 뒤바뀌어도 이름으로 찾는다', () => {
    const csv = '비고,핀수,이름,분류,신호\n메모,2,뒤죽박죽,스플라이스,X|Y';
    const { parts } = parsePartsCsv(csv);
    expect(parts[0].name).toBe('뒤죽박죽');
    expect(parts[0].category).toBe('splice');
    expect(parts[0].pinCount).toBe(2);
    expect(parts[0].pinLayout![1].signal).toBe('Y');
    expect(parts[0].spec).toEqual({ 비고: '메모' });
  });

  it('BOM 이 붙은 엑셀 CSV 도 헤더를 찾는다', () => {
    const csv = `﻿${H}\nBOM테스트,하우징,,,,2,1,2,,,`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe('BOM테스트');
  });

  it('CRLF 줄바꿈 + 따옴표 안 쉼표를 함께 처리한다', () => {
    const csv = `${H}\r\n"연호, 2.5mm",하우징,YEONHO,,,4,1,4,,,\r\n두번째,하우징,,,,2,1,2,,,\r\n`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toEqual([]);
    expect(parts).toHaveLength(2);
    expect(parts[0].name).toBe('연호, 2.5mm');
    expect(parts[0].pinCount).toBe(4);
    expect(parts[1].name).toBe('두번째');
  });
});

describe('parsePartsCsv — 잘못된 입력', () => {
  it('이름이 빈 행만 건너뛰고 나머지는 살린다 (행 번호 포함)', () => {
    const csv = `${H}\n정상A,하우징,,,,2,1,2,,,\n,하우징,,,,2,1,2,,,\n정상B,하우징,,,,2,1,2,,,`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(parts.map((p) => p.name)).toEqual(['정상A', '정상B']);
    expect(warnings).toContain('3행: 이름이 비어 건너뜀');
  });

  it('열·행이 숫자가 아니면 경고 후 핀수로 대체한다', () => {
    const csv = `${H}\n오타,하우징,,,,네개,,6,,,`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings.some((w) => w.startsWith('2행: 열 값 \'네개\''))).toBe(true);
    expect(parts[0].pinCount).toBe(6);
    expect(parts[0].pinLayout![5].offset).toEqual({ x: 5, y: 0 });
  });

  it('열·행이 있으면 핀수보다 열×행이 우선이고 경고가 남는다', () => {
    const csv = `${H}\n불일치,하우징,,,,3,2,8,,,`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(parts[0].pinCount).toBe(6);
    expect(warnings).toContain('2행: 핀수 8 와 열×행 6 이 달라 열×행을 따름');
  });

  it('신호 개수가 핀 수와 다르면 경고 후 있는 만큼만 채운다', () => {
    const csv = `${H}\n부족,하우징,,,,4,1,4,+24V|GND,red,`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toContain('2행: 신호 2개가 핀 4개와 달라 있는 만큼만 채움');
    expect(warnings).toContain('2행: 색 1개가 핀 4개와 달라 있는 만큼만 채움');
    const layout = parts[0].pinLayout!;
    expect(layout).toHaveLength(4);
    expect(layout[1].signal).toBe('GND');
    expect(layout[2].signal).toBeUndefined();
    expect(layout[0].stdColor).toBe('red');
    expect(layout[1].stdColor).toBeUndefined();
  });

  it('모르는 분류는 하우징으로 처리하고 경고를 남긴다', () => {
    const { parts, warnings } = parsePartsCsv(`${H}\n미지,우주선,,,,2,1,2,,,`);
    expect(parts[0].category).toBe('housing');
    expect(warnings).toContain("2행: 분류 '우주선' 를 몰라 하우징으로 처리");
  });

  it('빈 CSV · 헤더만 있는 CSV 는 throw 없이 빈 결과', () => {
    const empty = parsePartsCsv('');
    expect(empty.parts).toEqual([]);
    expect(empty.warnings.length).toBeGreaterThan(0);

    const headerOnly = parsePartsCsv(`${H}\n`);
    expect(headerOnly.parts).toEqual([]);
    expect(headerOnly.warnings).toEqual([]);

    const noName = parsePartsCsv('분류,제조사\n하우징,YEONHO');
    expect(noName.parts).toEqual([]);
    expect(noName.warnings.length).toBeGreaterThan(0);
  });

  it('중간 빈 줄은 조용히 건너뛴다', () => {
    const { parts, warnings } = parsePartsCsv(`${H}\nA,하우징,,,,2,1,2,,,\n\nB,하우징,,,,2,1,2,,,\n`);
    expect(parts).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('발급되는 id 는 행마다 다르다', () => {
    const { parts } = parsePartsCsv(`${H}\nA,하우징,,,,2,1,2,,,\nB,하우징,,,,2,1,2,,,`);
    expect(parts[0].id).not.toBe(parts[1].id);
  });
});

describe('터미널', () => {
  it('터미널은 핀 배열을 만들지 않는다', () => {
    const csv = `${H}\nYST025,터미널,YEONHO,YST025,,,,1,SIG,red,압착`;
    const { parts, warnings } = parsePartsCsv(csv);
    expect(parts[0].category).toBe('terminal');
    expect(parts[0].pinLayout).toBeUndefined();
    expect(parts[0].pinCount).toBeUndefined();
    expect(parts[0].spec).toEqual({ 비고: '압착' });
    expect(warnings).toContain('2행: 터미널이라 핀 배열은 만들지 않음');
  });

  it('핀 정보가 없는 터미널은 경고도 없다', () => {
    const { parts, warnings } = parsePartsCsv(`${H}\nYST200,terminal,YEONHO,YST200,,,,,,,`);
    expect(parts[0].pinLayout).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe('partsToCsv 왕복', () => {
  it('내보낸 CSV 를 되읽으면 같은 부품이 나온다', () => {
    const csv = `${H}
"연호, 2.5mm",하우징,YEONHO,"SMH250-04""A",2.5mm,2,2,4,+24V|GND|TX|RX,red|black|white|green,"줄1
줄2"
Mini-Fit,보드투와이어,Molex,39-01-2060,4.2mm,3,2,6,A|B|C|D|E|F,,VMC 측
YST025,터미널,YEONHO,YST025,,,,,,,크림프`;
    const first = parsePartsCsv(csv);
    expect(first.parts).toHaveLength(3);

    const out = partsToCsv(first.parts);
    const second = parsePartsCsv(out);

    expect(second.warnings).toEqual([]);
    expect(second.parts.map(noId)).toEqual(first.parts.map(noId));
    // id 는 다시 발급된다
    expect(second.parts[0].id).not.toBe(first.parts[0].id);
  });

  it('쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 이스케이프한다', () => {
    const part: PartLibraryItem = {
      id: 'custom-1',
      category: 'housing',
      name: '이름, 쉼표',
      spec: { 비고: '따옴표 " 와\n줄바꿈' },
      pinCount: 2,
      pinLayout: [
        { index: 1, label: '1', offset: { x: 0, y: 0 } },
        { index: 2, label: '2', offset: { x: 1, y: 0 } },
      ],
    };
    const csv = partsToCsv([part]);
    expect(csv).toContain('"이름, 쉼표"');
    expect(csv).toContain('"따옴표 "" 와\n줄바꿈"');
    const back = parsePartsCsv(csv);
    expect(back.parts[0].name).toBe('이름, 쉼표');
    expect(back.parts[0].spec!['비고']).toBe('따옴표 " 와\n줄바꿈');
  });

  it('빈 목록은 헤더만 있는 CSV 가 된다', () => {
    const csv = partsToCsv([]);
    expect(csv).toBe(H);
    expect(parsePartsCsv(csv).parts).toEqual([]);
  });
});

describe('성별(암수) 열', () => {
  it('한글도 영문도 받는다', () => {
    const csv = [
      H,
      '암하우징,하우징,,,,2,1,2,,,,암',
      '수플러그,하우징,,,,2,1,2,,,,수',
      '보드헤더,보드투와이어,,,,2,1,2,,,,보드',
      '성별없음,스플라이스,,,,2,1,2,,,,—',
      'EN-R,하우징,,,,2,1,2,,,,receptacle',
      'EN-P,하우징,,,,2,1,2,,,,PLUG',
      'EN-H,보드투와이어,,,,2,1,2,,,,Header',
      'EN-N,스플라이스,,,,2,1,2,,,,neutral',
    ].join('\n');
    const { parts, warnings } = parsePartsCsv(csv);
    expect(warnings).toEqual([]);
    expect(parts.map((p) => p.gender)).toEqual([
      'receptacle', 'plug', 'header', 'neutral',
      'receptacle', 'plug', 'header', 'neutral',
    ]);
  });

  it('성별 열이 없는 기존 CSV 도 그대로 읽힌다 (미지정)', () => {
    const old = '이름,분류,제조사,MPN,피치,열,행,핀수,신호,색,비고\n예전부품,하우징,YEONHO,SMH250-04,2.5mm,4,1,4,,,메모';
    const { parts, warnings } = parsePartsCsv(old);
    expect(warnings).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe('예전부품');
    expect(parts[0].pinCount).toBe(4);
    expect(parts[0].gender).toBeUndefined();
  });

  it('빈 칸(미지정)과 —(성별 없음)은 다른 뜻이다', () => {
    const { parts } = parsePartsCsv(`${H}\n빈칸,하우징,,,,2,1,2,,,,\n대시,스플라이스,,,,2,1,2,,,,—`);
    expect(parts[0].gender).toBeUndefined();
    expect(parts[1].gender).toBe('neutral');
  });

  it('모르는 값은 경고를 남기고 비운다 — 틀린 암수를 발주하지 않는다', () => {
    const { parts, warnings } = parsePartsCsv(`${H}\n오타,하우징,,,,2,1,2,,,,양성`);
    expect(parts[0].gender).toBeUndefined();
    expect(warnings).toContain("2행: 성별 '양성' 를 몰라 비움");
  });

  it('내보낼 때는 한글로 나가고 되읽으면 같은 값이 된다', () => {
    const parts: PartLibraryItem[] = [
      { id: 'custom-1', category: 'housing', name: '암', gender: 'receptacle', pinCount: 2,
        pinLayout: [
          { index: 1, label: '1', offset: { x: 0, y: 0 } },
          { index: 2, label: '2', offset: { x: 1, y: 0 } },
        ] },
      { id: 'custom-2', category: 'terminal', name: '단자', gender: 'neutral' },
      { id: 'custom-3', category: 'housing', name: '미지정', pinCount: 1,
        pinLayout: [{ index: 1, label: '1', offset: { x: 0, y: 0 } }] },
    ];
    const csv = partsToCsv(parts);
    expect(csv.split('\n')[0].endsWith(',성별')).toBe(true);
    expect(csv.split('\n')[1].endsWith(',암')).toBe(true);
    expect(csv.split('\n')[2].endsWith(',—')).toBe(true);
    expect(csv.split('\n')[3].endsWith(',')).toBe(true); // 미지정은 빈 칸

    const back = parsePartsCsv(csv);
    expect(back.warnings).toEqual([]);
    expect(back.parts.map((p) => p.gender)).toEqual(['receptacle', 'neutral', undefined]);
  });
});

describe('parsePartsFile — JSON/CSV 판별', () => {
  const jsonPart: PartLibraryItem = {
    id: 'custom-json', category: 'housing', name: 'JSON 부품', pinCount: 1,
    pinLayout: [{ index: 1, label: '1', offset: { x: 0, y: 0 } }],
  };

  it('.json 은 기존 JSON 경로를 쓴다', () => {
    const json = JSON.stringify({ kind: 'harness-custom-parts', version: 1, parts: [jsonPart] });
    const r = parsePartsFile(json, 'backup.json');
    expect(r.parts).toEqual(parseCustomParts(json));
    expect(r.warnings).toEqual([]);
    expect(r.parts[0].id).toBe('custom-json');
  });

  it('.csv 는 CSV 로 읽는다', () => {
    const r = parsePartsFile(`${H}\nCSV부품,하우징,,,,2,1,2,,,`, '부품표.CSV');
    expect(r.parts[0].name).toBe('CSV부품');
  });

  it('파일명이 없으면 내용으로 판별한다', () => {
    expect(parsePartsFile(JSON.stringify([jsonPart])).parts[0].name).toBe('JSON 부품');
    expect(parsePartsFile(`${H}\n내용판별,하우징,,,,2,1,2,,,`).parts[0].name).toBe('내용판별');
  });

  it('망가진 JSON 은 기존 동작대로 빈 목록', () => {
    expect(parsePartsFile('{{{', 'x.json')).toEqual({ parts: [], warnings: [] });
  });
});
