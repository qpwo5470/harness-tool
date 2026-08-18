import { describe, it, expect } from 'vitest';
import type { HarnessDocument } from '../types';
import {
  buildPartList, toCsv, buildRunList, runListToCsv,
  RUN_CSV_COLUMNS, RUN_CSV_DEFAULT_COLS,
} from './exporters';
import { sampleDoc } from '../fixtures/sampleDoc';

describe('buildPartList', () => {
  it('커넥터/와이어/케이블을 집계한다', () => {
    const rows = buildPartList(sampleDoc);
    const connQty = rows.filter((r) => r.category === '커넥터').reduce((n, r) => n + r.qty, 0);
    expect(connQty).toBe(3); // 커넥터 3개
    expect(rows.some((r) => r.category === '와이어')).toBe(true);
    expect(rows.some((r) => r.category === '케이블')).toBe(true);
  });

  /**
   * 발주하는 것은 **전선 길이**지 구간 길이가 아니다. 구간은 여러 전선이 함께
   * 지나는 다발이라, 사람이 넣은 구간 길이를 자재에 더하면 같은 전선을 구간
   * 수만큼 다시 세게 된다. 접속표도 마찬가지다 — 현장에서 자르는 것은 전선이다.
   * (구간 길이는 작업 지시용 치수이고, 물리 뷰에만 산다.)
   */
  it('입력한 구간 길이는 파트리스트·접속표를 건드리지 않는다 — 이중 계상 금지', () => {
    const parts = buildPartList(sampleDoc);
    const runs = buildRunList(sampleDoc);
    const withSeg: HarnessDocument = {
      ...sampleDoc,
      segmentLengths: { 'con:con-a|con:sp-1': 5000, 'con:sp-1|dev:dev-1': 4000 },
    };
    expect(buildPartList(withSeg)).toEqual(parts);
    expect(buildRunList(withSeg)).toEqual(runs);
  });
});

// ============================================================
// 와이어 총 길이 — 미입력분을 조용히 0 으로 더하지 않는다
// ============================================================

/** 같은 규격·색 와이어 n 본짜리 문서. `lengths[i] === undefined` 면 미입력 */
function wireDoc(lengths: (number | undefined)[], cables?: HarnessDocument['cables']) {
  return {
    ...sampleDoc,
    cables,
    wires: lengths.map((len, i) => ({
      id: `w${i + 1}`,
      from: { type: 'pin' as const, connectorId: 'con-a', pinId: `a${i + 1}` },
      to: { type: 'pin' as const, connectorId: 'sp-1', pinId: 's1' },
      color: { base: 'red' },
      gauge: { system: 'awg' as const, value: 22 },
      lengthMm: len,
      cableId: cables ? 'cb1' : undefined,
    })),
  };
}

const wireRow = (doc: HarnessDocument) =>
  buildPartList(doc).find((r) => r.category === '와이어')!;

describe('와이어 총 길이', () => {
  it('전부 입력돼 있으면 합만 적는다', () => {
    expect(wireRow(wireDoc([100, 200])).detail).toBe('총 300mm');
  });

  /**
   * 회귀(감사 ④): 예전에는 `w.lengthMm ?? 0` 으로 미입력분을 0 으로 더해
   * `총 300mm · 3본` 이라 찍혔다 — 그 300 은 2본치다. 발주서에서는 이 한 줄이
   * 그대로 수량이 되므로 합계가 몇 본치인지 행에 드러나야 한다.
   */
  it('미입력이 섞이면 몇 본치 합인지와 미입력 본수를 밝힌다', () => {
    const row = wireRow(wireDoc([100, 200, undefined]));
    expect(row.qty).toBe(3);
    expect(row.detail).toBe('총 300mm (2본 기준) · 길이 미입력 1본');
  });

  it('전부 미입력이면 합을 만들지 않는다', () => {
    expect(wireRow(wireDoc([undefined, undefined])).detail).toBe('길이 미입력 2본');
  });

  /**
   * 케이블 심선은 케이블에 딸려 오므로 **전선으로 따로 사지 않는다**
   * (같은 파트리스트의 '케이블' 행에 길이가 이미 잡힌다). 길이를 모르는 것과는
   * 사정이 다르므로 0 으로 뭉개지 않고 본수를 따로 밝힌다.
   */
  it('케이블 심선은 전선 합계에 넣지 않고 본수만 밝힌다', () => {
    const doc = wireDoc([undefined, undefined], [
      { id: 'cb1', name: '2C 전원 케이블', coreCount: 2, lengthMm: 500 },
    ]);
    expect(wireRow(doc).detail).toBe('케이블 심선 2본');
    // 케이블 행에는 그대로 500mm 가 잡힌다 — 이중 계상이 아니다.
    // 기대 문자열이 '500mm' 에서 바뀐 이유: 자켓색·코어수·게이지가 입력만 되고
    // 어떤 산출물에도 나오지 않던 것을 이 행에 실었다(감사 A-8). 길이는 그대로다.
    expect(buildPartList(doc).find((r) => r.category === '케이블')!.detail).toBe('2C · 500mm');
  });

  /**
   * 회귀(감사 A-5): 케이블 심선에 **개별 길이를 넣으면** 그 가닥이 전선 행으로도
   * 발주되고 케이블 행도 남아 같은 두 가닥을 두 번 샀다 (전선 720mm + 케이블
   * 300mm). 심선을 짧게 자르는 것은 재단 지시이지 구매 지시가 아니다 —
   * 무엇을 사는지는 길이 출처가 아니라 **소속**이 정한다.
   */
  it('심선에 개별 길이를 넣어도 전선으로 이중 발주하지 않는다', () => {
    const doc = wireDoc([360, 360], [
      { id: 'cb1', name: '2C 전원 케이블', coreCount: 2, lengthMm: 300 },
    ]);
    const wire = wireRow(doc);
    expect(wire.detail).toBe('케이블 심선 2본');
    expect(wire.drawingLengthMm).toBeUndefined();     // 전선으로 살 길이가 없다
    const cable = buildPartList(doc).find((r) => r.category === '케이블')!;
    expect(cable.drawingLengthMm).toBe(300);          // 케이블만 발주한다
  });

  /**
   * 소속 케이블이 문서에 없으면(깨진 참조) 딸려 올 곳이 없다 —
   * 그 가닥은 전선으로 사야 하므로 합계에 든다.
   */
  it('없는 케이블을 가리키는 배선은 전선으로 친다', () => {
    const doc = wireDoc([100, 200]);                   // cables 없음 + cableId 없음
    const broken = {
      ...doc,
      wires: doc.wires.map((w) => ({ ...w, cableId: 'cb-사라진케이블' })),
    };
    expect(wireRow(broken).detail).toBe('총 300mm');
  });
});

describe('접속표 길이', () => {
  it('케이블 심선의 재단 길이는 케이블에서 온다 — 빈 칸으로 두지 않는다', () => {
    // sampleDoc: w2 · w3 는 cbl-1(300mm) 소속이고 개별 길이가 없다
    const rows = buildRunList(sampleDoc);
    const w2 = rows.find((r) => r.wireId === 'w2')!;
    expect(w2.lengthMm).toBe('300');
    expect(w2.lengthSource).toBe('cable');
    expect(rows.find((r) => r.wireId === 'w1')!.lengthSource).toBe('wire');
  });
});

describe('toCsv', () => {
  it('헤더 + 행을 만든다', () => {
    const csv = toCsv(buildPartList(sampleDoc));
    expect(csv.split('\n')[0]).toBe('category,part,qty,detail');
    expect(csv.split('\n').length).toBeGreaterThan(1);
  });
});

describe('buildRunList', () => {
  it('와이어별 from-to 와 네트 라벨을 만든다', () => {
    const rows = buildRunList(sampleDoc);
    expect(rows).toHaveLength(3);
    const w1 = rows.find((r) => r.wireId === 'w1')!;
    expect(w1.from).toContain('#'); // 커넥터#핀 형식
    expect(w1.color).toBe('red/white');
    expect(w1.gauge).toBe('AWG22');
    expect(w1.net).toContain('Raspberry Pi'); // 스플라이스 통해 한 네트
  });

  it('접속표 CSV 헤더가 맞다', () => {
    const csv = runListToCsv(buildRunList(sampleDoc));
    expect(csv.split('\n')[0]).toBe('wire,net,from,to,color,gauge,length_mm');
  });
});

// ============================================================
// 내보내기 옵션 — 고른 것이 실제로 산출물을 바꾸는가
//
// 이 절이 통째로 회귀 시험이다. 대화상자는 여유율·치수 단위·CSV 열을 고르게
// 해 놓고 산출물은 언제나 도면 mm · 고정 7열을 뱉었다. 고를 수는 있는데 결과가
// 안 바뀌는 스위치였다. 아래 시험들은 **파일 내용**을 직접 읽는다.
// ============================================================

/** 길이 300mm 짜리 와이어 한 본 (계산이 눈에 보이는 최소 문서) */
const oneWireDoc = (mm: number) => ({
  ...sampleDoc,
  cables: undefined,
  wires: [{
    id: 'w1',
    from: { type: 'pin' as const, connectorId: 'con-a', pinId: 'a1' },
    to: { type: 'pin' as const, connectorId: 'con-b2w', pinId: 'p1' },
    color: { base: 'red' },
    gauge: { system: 'awg' as const, value: 22 },
    lengthMm: mm,
  }],
});

/** CSV 를 머리글 배열 + 행별 열 맵으로 푼다 */
function parseCsv(csv: string): { head: string[]; rows: Record<string, string>[] } {
  const [h, ...body] = csv.split('\n');
  const head = h.split(',');
  return {
    head,
    rows: body.map((line) =>
      Object.fromEntries(line.split(',').map((v, i) => [head[i], v]))),
  };
}

const wireRowOf = (csv: string) =>
  parseCsv(csv).rows.find((r) => r.category === '와이어')!;

describe('전선 여유율 — 파트리스트에만 붙고, 붙었으면 밝힌다', () => {
  const doc = oneWireDoc(800);

  it('여유율을 주면 도면 길이·여유율·발주 길이를 열로 나눠 적는다', () => {
    const csv = toCsv(buildPartList(doc), { marginPct: 5 });
    expect(parseCsv(csv).head).toEqual([
      'category', 'part', 'qty', 'detail',
      'drawing_length_mm', 'order_margin_pct', 'order_length_mm',
    ]);
    const row = wireRowOf(csv);
    expect(row.drawing_length_mm).toBe('800');   // 도면값은 그대로 남는다
    expect(row.order_margin_pct).toBe('5');      // 몇 % 인지 행마다 적힌다
    expect(row.order_length_mm).toBe('840');     // 800 × 1.05
  });

  it('여유율 0% 면 발주 길이가 도면 길이와 같다 — 열은 그대로 남는다', () => {
    const row = wireRowOf(toCsv(buildPartList(doc), { marginPct: 0 }));
    expect(row.drawing_length_mm).toBe('800');
    expect(row.order_margin_pct).toBe('0');
    // 열을 지우지 않는 이유: "여유를 안 넣은 발주서" 임을 문서가 스스로 말해야 한다
    expect(row.order_length_mm).toBe('800');
  });

  it('여유율 10% 는 5% 와 다른 파일을 만든다 — 옵션을 바꾸면 내용이 바뀐다', () => {
    const a = toCsv(buildPartList(doc), { marginPct: 5 });
    const b = toCsv(buildPartList(doc), { marginPct: 10 });
    expect(a).not.toBe(b);
    expect(wireRowOf(b).order_length_mm).toBe('880');
  });

  it('정수로 떨어지지 않는 값도 잃지 않는다 — 101 × 1.05 = 106.05', () => {
    expect(wireRowOf(toCsv(buildPartList(oneWireDoc(101)), { marginPct: 5 })).order_length_mm)
      .toBe('106.05');
  });

  /** 이 시험이 원칙을 못 박는다 — 접속표는 현장이 자르는 표다 */
  it('접속표는 여유율과 무관하게 언제나 도면 길이다', () => {
    const runs = buildRunList(doc);
    // runListToCsv 에는 여유율을 받는 자리 자체가 없다(구조로 막았다)
    const csv = runListToCsv(runs);
    expect(parseCsv(csv).rows[0].length_mm).toBe('800');
    expect(runs[0].lengthMm).toBe('800');
  });

  it('길이가 없는 행(커넥터·터미널)은 발주 길이 칸을 비워 둔다', () => {
    const rows = parseCsv(toCsv(buildPartList(doc), { marginPct: 5 })).rows;
    const conn = rows.find((r) => r.category === '커넥터')!;
    // 0 을 적으면 "길이 0 짜리 부품" 으로 읽힌다
    expect(conn.drawing_length_mm).toBe('');
    expect(conn.order_length_mm).toBe('');
  });

  it('여유율을 주지 않으면 옛 4열 그대로다 — 파트 탭 CSV 는 도면 그대로여야 한다', () => {
    expect(toCsv(buildPartList(doc)).split('\n')[0]).toBe('category,part,qty,detail');
  });

  it('음수·비숫자·과도한 여유율은 조용히 고치지 않고 멈춘다', () => {
    const rows = buildPartList(doc);
    expect(() => toCsv(rows, { marginPct: -1 })).toThrow(/음수/);
    expect(() => toCsv(rows, { marginPct: 101 })).toThrow(/너무 큽니다/);
    expect(() => toCsv(rows, { marginPct: Number.NaN })).toThrow(/숫자가 아닙니다/);
  });
});

describe('치수 단위 — 값과 단위 표기가 함께 바뀐다', () => {
  const doc = oneWireDoc(800);

  it('접속표를 inch 로 내면 열 이름과 값이 같이 바뀐다', () => {
    const csv = runListToCsv(buildRunList(doc), { unit: 'inch' });
    const { head, rows } = parseCsv(csv);
    // 값만 바뀌고 이름이 그대로면 800mm 와 31.496in 을 구분할 수 없다
    expect(head).toContain('length_in');
    expect(head).not.toContain('length_mm');
    expect(rows[0].length_in).toBe('31.496');    // 800 / 25.4, 소수 3자리
  });

  it('파트리스트를 inch 로 내면 열 이름·값·비고 문구가 모두 inch 다', () => {
    const csv = toCsv(buildPartList(doc, { unit: 'inch' }), { unit: 'inch', marginPct: 5 });
    const { head } = parseCsv(csv);
    expect(head).toContain('drawing_length_in');
    expect(head).toContain('order_length_in');
    const row = wireRowOf(csv);
    expect(row.drawing_length_in).toBe('31.496');
    expect(row.order_length_in).toBe('33.071');  // 840 / 25.4
    expect(row.detail).toBe('총 31.496in');      // 사람이 읽는 칸에도 단위가 붙는다
  });

  it('mm 가 기본이고, 딱 떨어지는 값에 소수점을 붙이지 않는다', () => {
    expect(parseCsv(runListToCsv(buildRunList(doc))).rows[0].length_mm).toBe('800');
    expect(wireRowOf(toCsv(buildPartList(doc)))!.detail).toBe('총 800mm');
  });
});

describe('CSV 열 선택 — 고른 열만, 고른 순서대로', () => {
  const doc = oneWireDoc(800);

  /**
   * 기본 선택이 옛 고정 헤더와 글자 하나까지 같아야 한다. 이 헤더는 받는 쪽
   * 엑셀 매크로가 참조하는 인터페이스라, 옵션을 아무것도 건드리지 않은 사람의
   * 파일이 조용히 바뀌면 안 된다.
   */
  it('기본 열은 옛 고정 헤더와 같다', () => {
    expect(runListToCsv(buildRunList(doc), { cols: RUN_CSV_DEFAULT_COLS }))
      .toBe(runListToCsv(buildRunList(doc)));
  });

  it('두 개만 고르면 그 두 열만, 그 순서로 나온다', () => {
    const csv = runListToCsv(buildRunList(doc), { cols: ['TO', '와이어'] });
    expect(csv.split('\n')[0]).toBe('to,wire');
    expect(csv.split('\n')[1].split(',')).toHaveLength(2);
    expect(csv.split('\n')[1].endsWith(',w1')).toBe(true);
  });

  it('대화상자에 있는 열은 전부 CSV 가 안다 — 목록의 출처가 하나다', () => {
    const all = RUN_CSV_COLUMNS.map((c) => c.label);
    const head = runListToCsv(buildRunList(doc), { cols: all }).split('\n')[0];
    expect(head).toBe('wire,net,from,to,signal,color,gauge,length_mm,terminal,note');
  });

  it('신호·단자·비고 열이 실제 값을 싣는다', () => {
    // 규격 신호명이 붙은 하우징 + 스펙 터미널
    const withSpec = {
      ...doc,
      usedParts: doc.usedParts.map((p) =>
        p.id === 'lib-xh-4p'
          ? {
              ...p,
              spec: { ...p.spec, 터미널: 'YST025' },
              pinLayout: [{ index: 1, offset: { x: 0, y: 0 }, signal: '34V' }],
            }
          : p),
    };
    const r = parseCsv(runListToCsv(buildRunList(withSpec), {
      cols: ['신호', '단자', '비고'],
    })).rows[0];
    expect(r.signal).toBe('34V');
    expect(r.terminal).toContain('YST025');
    expect(r.note).toBe('');                     // 라벨도 케이블도 없으면 빈 칸
  });

  it('케이블에서 온 길이는 비고에 출처가 남는다', () => {
    // sampleDoc 의 w2 는 cbl-1(300mm) 을 따른다 — 숫자만으로는 출처를 알 수 없다
    const r = parseCsv(runListToCsv(buildRunList(sampleDoc), { cols: ['와이어', '비고'] }))
      .rows.find((x) => x.wire === 'w2')!;
    expect(r.note).toBe('케이블 기준');
  });

  it('열을 하나도 고르지 않으면 빈 CSV 를 만들지 않고 멈춘다', () => {
    expect(() => runListToCsv(buildRunList(doc), { cols: [] })).toThrow(/열을 하나도/);
  });

  it('CSV 가 모르는 열 이름은 조용히 건너뛰지 않는다', () => {
    expect(() => runListToCsv(buildRunList(doc), { cols: ['없는열'] })).toThrow(/없는 열/);
  });
});

describe('터미널(크림프핀) 집계', () => {
  it('배선된 핀 수만큼 터미널이 집계된다', () => {
    const rows = buildPartList(sampleDoc);
    const terms = rows.filter((r) => r.category === '터미널');
    expect(terms.length).toBeGreaterThan(0);
  });

  it('스플라이스는 압착단자를 세지 않는다', () => {
    const rows = buildPartList(sampleDoc);
    const terms = rows.filter((r) => r.category === '터미널');
    expect(terms.some((t) => t.part.includes('스플라이스'))).toBe(false);
  });

  it('하우징 스펙의 터미널명(YST025 등)을 쓴다', () => {
    const doc = {
      ...sampleDoc,
      usedParts: [
        ...sampleDoc.usedParts.filter((p) => p.id !== 'lib-xh-4p'),
        {
          id: 'lib-xh-4p', category: 'housing' as const, name: '연호 SMH250-04',
          spec: { 터미널: 'YST025' }, pinCount: 4,
        },
      ],
    };
    const terms = buildPartList(doc).filter((r) => r.category === '터미널');
    expect(terms.some((t) => t.part === 'YST025')).toBe(true);
  });
});

describe('파트리스트 — 결합 성별', () => {
  /** 하우징에 성별을 붙인 문서 */
  const withGender = () => ({
    ...sampleDoc,
    usedParts: sampleDoc.usedParts.map((p) =>
      p.id === 'lib-xh-4p'
        ? { ...p, gender: 'receptacle' as const }
        : p.id === 'lib-b2w-2p'
          ? { ...p, gender: 'header' as const }
          : { ...p, gender: 'neutral' as const },
    ),
  });

  it('커넥터 행에 암수가 실린다 — 발주에서 이게 틀리면 안 된다', () => {
    const rows = buildPartList(withGender()).filter((r) => r.category === '커넥터');
    expect(rows.find((r) => r.part === 'JST XH 2.5 4P')!.detail).toBe('암(리셉터클)');
    expect(rows.find((r) => r.part === 'Board-to-Wire 2P')!.detail).toBe('보드(헤더 · 보드 실장)');
  });

  it('성별 없음(스플라이스)·미지정은 detail 을 만들지 않는다', () => {
    const rows = buildPartList(withGender()).filter((r) => r.category === '커넥터');
    expect(rows.find((r) => r.part === '단순 결선(꼬임)')!.detail).toBeUndefined();

    // 원본 픽스처는 성별이 없다 → 전부 미지정
    const plain = buildPartList(sampleDoc).filter((r) => r.category === '커넥터');
    expect(plain.every((r) => r.detail === undefined)).toBe(true);
  });

  it('CSV 로 내보내도 암수가 detail 열에 남는다', () => {
    const csv = toCsv(buildPartList(withGender()));
    expect(csv).toContain('커넥터,JST XH 2.5 4P,1,암(리셉터클)');
  });
});

describe('핀별 터미널 지정 반영', () => {
  const termPart = {
    id: 'lib-yh-yst025', category: 'terminal' as const,
    name: '연호 YST025 터미널 (SMH250용)', mpn: 'YST025',
  };

  it('핀에 지정한 terminalId 가 하우징 스펙보다 우선한다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a'
          ? { ...c, pins: c.pins.map((p) => ({ ...p, terminalId: 'lib-yh-yst025' })) }
          : c,
      ),
      usedParts: [
        ...sampleDoc.usedParts.filter((p) => p.id !== 'lib-xh-4p'),
        { id: 'lib-xh-4p', category: 'housing' as const, name: 'JST XH 4P',
          spec: { 터미널: '다른터미널' }, pinCount: 4 },
        termPart,
      ],
    };
    const terms = buildPartList(doc).filter((r) => r.category === '터미널');
    // con-a의 배선된 핀은 지정한 YST025로 집계되어야 함
    expect(terms.some((t) => t.part.includes('YST025'))).toBe(true);
  });

  it('배선되지 않은 핀의 터미널은 세지 않는다', () => {
    const doc = {
      ...sampleDoc,
      connectors: sampleDoc.connectors.map((c) =>
        c.id === 'con-a'
          ? { ...c, pins: c.pins.map((p) => ({ ...p, terminalId: 'lib-yh-yst025' })) }
          : c,
      ),
      usedParts: [...sampleDoc.usedParts, termPart],
    };
    const terms = buildPartList(doc).filter((r) => r.part.includes('YST025'));
    // con-a는 4핀이지만 실제 배선(w1)은 1개 핀만 사용
    const qty = terms.reduce((n, t) => n + t.qty, 0);
    expect(qty).toBe(1);
  });
});
