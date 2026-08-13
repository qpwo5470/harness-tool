/**
 * 핀맵 에디터로 만든 커스텀 부품이 실제 배선까지 이어지는지 종단 검증.
 */
import { describe, it, expect } from 'vitest';
import { instantiate, suggestedColor } from './seed';
import { parsePartsCsv } from './partsCsv';
import { computeNets } from '../store/netlist';
import { validateHarness } from '../store/validate';
import { buildRunList, buildPartList } from '../export/exporters';
import { buildDrawing } from '../export/pdfDraw';
import { docToNodes } from '../canvas/docToFlow';
import { connectorLayout, housingSize } from '../canvas/geometry';
import type { PartLibraryItem, HarnessDocument, Wire } from '../types';

/** 핀맵 에디터가 만들어낼 법한 커스텀 부품 */
const customPart: PartLibraryItem = {
  id: 'custom-abc',
  category: 'housing',
  name: '내 전용 4P',
  manufacturer: '사내',
  mpn: 'MY-4P',
  spec: { 피치: '2.5mm' },
  pinCount: 4,
  pinLayout: [
    { index: 1, label: '1', offset: { x: 0, y: 0 }, signal: '+24V', stdColor: 'red' },
    { index: 2, label: '2', offset: { x: 1, y: 0 }, signal: 'GND', stdColor: 'black' },
    { index: 3, label: '3', offset: { x: 0, y: 1 }, signal: 'TX', stdColor: 'yellow' },
    { index: 4, label: '4', offset: { x: 1, y: 1 }, signal: 'RX', stdColor: 'blue' },
  ],
};

describe('커스텀 부품 종단 흐름', () => {
  it('인스턴스가 핀맵대로 생성된다', () => {
    const c = instantiate(customPart, { x: 0, y: 0 });
    expect(c.pins).toHaveLength(4);
    expect(c.housingId).toBe('custom-abc');
    expect(c.pins.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('핀별 규격색이 결선 시 제안된다', () => {
    expect(suggestedColor(customPart, 1)).toBe('red');
    expect(suggestedColor(customPart, 4)).toBe('blue');
  });

  it('2행 배치가 보존된다 (물리 뷰용)', () => {
    const ys = new Set(customPart.pinLayout!.map((s) => s.offset.y));
    expect(ys.size).toBe(2);
  });

  it('커스텀 부품으로 만든 문서가 넷리스트·접속표·파트리스트까지 통과', () => {
    const c = instantiate(customPart, { x: 0, y: 0 });
    const wire: Wire = {
      id: 'w1',
      from: { type: 'pin', connectorId: c.id, pinId: c.pins[0].id },
      to: { type: 'device', deviceId: 'dev-1', terminal: 'VIN' },
      color: { base: 'red' },
      gauge: { system: 'awg', value: 20 },
      lengthMm: 150,
    };
    const doc: HarnessDocument = {
      schemaVersion: 1, id: 'd', name: '커스텀 테스트',
      createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z',
      connectors: [c],
      devices: [{ id: 'dev-1', name: '컨트롤러', terminals: ['VIN'], positions: {} }],
      wires: [wire],
      usedParts: [customPart], // 문서에 스냅샷으로 동봉됨
    };

    // 넷리스트
    const nets = computeNets(doc);
    expect(nets).toHaveLength(1);

    // 접속표: 커스텀 부품 이름이 from 표기에 나와야 함
    const runs = buildRunList(doc);
    expect(runs[0].from).toContain('내 전용 4P');
    expect(runs[0].to).toBe('컨트롤러.VIN');

    // 파트리스트: 커스텀 부품이 집계됨
    const parts = buildPartList(doc);
    expect(parts.some((p) => p.part === '내 전용 4P')).toBe(true);
  });
});

/**
 * CSV 로 가져온 부품이 라이브러리 밖(캔버스·PDF·발주 목록)에서도 사는가.
 * 엑셀 부품표가 실제 통로라 여기서 끊기면 가져오기 자체가 의미가 없다.
 */
describe('CSV 로 가져온 부품 종단 흐름', () => {
  const CSV = [
    '이름,분류,제조사,MPN,피치,열,행,핀수,신호,색,비고,성별',
    '연호 SMH250-06,하우징,YEONHO,SMH250-06,2.5mm,2,,6,+24V|GND|TX|RX|SDA|SCL,red|black|white|green|yellow|blue,자판기용,암',
  ].join('\r\n');

  const imported = () => {
    const { parts, warnings } = parsePartsCsv(`﻿${CSV}`);
    expect(warnings).toEqual([]);
    return parts[0];
  };

  it('열만 적힌 부품표가 2열 3행 하우징으로 들어온다', () => {
    const p = imported();
    expect(p.pinCount).toBe(6);
    expect(p.gender).toBe('receptacle');
    const c = instantiate(p, { x: 0, y: 0 });
    const g = connectorLayout(c, p);
    expect([g.cols, g.rows]).toEqual([2, 3]);
    expect({ w: g.boxW, h: g.boxH }).toEqual(housingSize(2, 3));
  });

  it('캔버스·검증·접속표·파트리스트·PDF 가 모두 이 부품을 그대로 쓴다', () => {
    const part = imported();
    const c = instantiate(part, { x: 40, y: 40 });
    const wire: Wire = {
      id: 'w1',
      from: { type: 'pin', connectorId: c.id, pinId: c.pins[0].id },
      to: { type: 'device', deviceId: 'dev-1', terminal: 'VIN' },
      color: { base: 'red' },
      gauge: { system: 'awg', value: 20 },
      lengthMm: 200,
    };
    const doc: HarnessDocument = {
      schemaVersion: 1, id: 'd-csv', name: 'CSV 가져오기',
      createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T00:00:00Z',
      connectors: [c],
      devices: [{ id: 'dev-1', name: '컨트롤러', terminals: ['VIN'], positions: {} }],
      wires: [wire],
      usedParts: [part],
    };

    // 캔버스 — 노드가 서고 하우징 스냅샷이 붙는다
    const nodes = docToNodes(doc, 'logical');
    expect((nodes[0].data as { housing?: PartLibraryItem }).housing?.name).toBe('연호 SMH250-06');

    /*
     * 검증 — 남는 error 는 "터미널 미지정" 하나뿐이다. 그건 사용자가 아직 압착
     * 단자를 안 고른 것이지 가져온 정의 탓이 아니다. 하우징 스냅샷 없음·핀 수
     * 초과처럼 **정의가 깨졌을 때 나는 error** 는 하나도 없어야 한다.
     */
    expect(validateHarness(doc).filter((i) => i.level === 'error').map((i) => i.id))
      .toEqual(['terminal-missing']);

    // 접속표 · 파트리스트(발주) — CSV 의 성별(암)이 발주 문서까지 따라온다
    expect(buildRunList(doc)[0].from).toContain('연호 SMH250-06');
    const row = buildPartList(doc).find((r) => r.part === '연호 SMH250-06')!;
    expect(row).toMatchObject({ category: '커넥터', qty: 1, detail: '암(리셉터클)' });

    // PDF — 패드 6개가 2열 3행 자리에 그려진다
    const d = buildDrawing(doc);
    expect(d.nodes[0].pads).toHaveLength(6);
    const xs = new Set(d.nodes[0].pads.map((p) => p.x));
    const ys = new Set(d.nodes[0].pads.map((p) => p.y));
    expect([xs.size, ys.size]).toEqual([2, 3]);
    // 규격 색을 넣은 핀은 '지정됨'으로 그려진다
    expect(d.nodes[0].pads.every((p) => p.assigned)).toBe(true);
  });
});
