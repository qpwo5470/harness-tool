import { describe, expect, it } from 'vitest';
import { tokenize, parseScript, parseColor, parseGauge, parseLength, applyScript, DslError, changesLine } from './dsl';
import { newDoc } from './api';
import { resolvePart } from './parts';
import { refLabels } from '../canvas/docToFlow';
import type { HarnessDocument } from '../types';

const C10 = 'red,black,white,green,yellow,blue,brown,orange,purple,gray';

function cup(extra = '') {
  return `harness "컵하네스 A" no=EW-02 rev=A qty=1
note "10P 스트레이트 1:1."
conn J1 "JST-XH 10P"
conn J2 "JST-XH 10P"
wire J1.1-10 J2.1-10 colors=${C10} awg22 len=1600
${extra}`;
}

const pinIndex = (h: HarnessDocument, cid: string, pid: string) =>
  h.connectors.find((c) => c.id === cid)!.pins.find((p) => p.id === pid)!.index;

describe('tokenize / parse', () => {
  it('quotes, key="value with spaces", comments', () => {
    const t = tokenize(`set pn=EW name="이스턴웰스 세트" rev=A   # comment "x"`);
    expect(t.map((x) => x.text)).toEqual(['set', 'pn=EW', 'name=이스턴웰스 세트', 'rev=A']);
    expect(t[2]).toMatchObject({ key: 'name', value: '이스턴웰스 세트', quoted: true });
    expect(tokenize(`conn J1 'JST-XH 10P'`)[2]).toMatchObject({ text: 'JST-XH 10P', quoted: true });
    expect(tokenize('note "a \\"b\\" c"')[1].text).toBe('a "b" c');
    // 낱말 중간의 # 은 글자다
    expect(tokenize('wire J1.1 J2.1 label=A#1')[3].value).toBe('A#1');
  });

  it('unclosed quote is an error with the line number', () => {
    expect(() => parseScript('set pn=EW\nnote "oops')).toThrow(/line 2: unclosed quote/);
  });

  it('parses commands, key=values and blank/comment lines', () => {
    const cmds = parseScript('# head\n\nwire J1.1 J2.1 red awg22 len=1600 # tail\n');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ line: 3, name: 'wire' });
    expect(cmds[0].args.map((a) => a.text)).toEqual(['J1.1', 'J2.1', 'red', 'awg22']);
    expect(cmds[0].kv.get('len')).toBe('1600');
  });

  it('values', () => {
    expect(parseColor('red/white')).toEqual({ base: 'red', stripe: 'white' });
    expect(parseColor('Gray')).toEqual({ base: 'gray' });
    expect(parseColor('mauve')).toBeNull();
    expect(parseGauge('AWG22')).toEqual({ system: 'awg', value: 22 });
    expect(parseGauge('sq0.5')).toEqual({ system: 'mm2', value: 0.5 });
    expect(parseGauge('0.75sq')).toEqual({ system: 'mm2', value: 0.75 });
    expect(parseLength('1.6m')).toBe(1600);
    expect(parseLength('160cm')).toBe(1600);
    expect(parseLength('abc')).toBeNull();
  });
});

describe('part lookup', () => {
  it('short name → the current (non-legacy) part', () => {
    expect(resolvePart('JST-XH 10P').id).toBe('lib-jst-xhp-10p');
    // 옛 항목(lib-xh-4p)과 짧은 이름이 같다 — 품번 있는 새 항목이 이긴다
    expect(resolvePart('JST-XH 4P').id).toBe('lib-jst-xhp-4p');
    expect(resolvePart('lib-mf3-43025-10p').id).toBe('lib-mf3-43025-10p');
    expect(resolvePart('Micro-Fit 3.0 10P').id).toBe('lib-mf3-43025-10p');
  });

  it('ambiguous lookup lists up to 5 candidates in one line', () => {
    let msg = '';
    try { resolvePart('XH'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/^ambiguous part "XH" \(\d+\): /);
    expect(msg.split(', ').length).toBeLessThanOrEqual(6);
    expect(msg).not.toContain('\n');
  });
});

describe('apply — single harness document', () => {
  it('builds 컵하네스 A: ranges, colors list, refs, auto terminal, layout', () => {
    // 빈 새 문서('새 하네스')는 첫 harness 줄이 그 자리를 이어받는다
    const r = applyScript(newDoc(), cup());
    expect(r.kit.harnesses).toHaveLength(1);
    // 이름이 있는 문서에 다른 이름의 harness 줄이 오면 세트에 하나 더 생긴다
    expect(applyScript(newDoc({ name: '컵' }), cup()).kit.harnesses.map((x) => x.name)).toEqual(['컵', '컵하네스 A']);
    const cupH = r.kit.harnesses[0];
    expect(cupH.drawingNo).toBe('EW-02');
    expect(cupH.wires).toHaveLength(10);
    expect(cupH.wires.map((w) => w.color.base).join(',')).toBe(C10);
    expect(cupH.wires.every((w) => w.lengthMm === 1600 && w.gauge.value === 22)).toBe(true);
    const refs = refLabels(cupH);
    expect([...refs.values()]).toEqual(['J1', 'J2']);
    // 자동 배치: 왼쪽 J1 은 180°(오른쪽을 봄), 오른쪽 J2 는 0°
    const [j1, j2] = cupH.connectors;
    expect(j1.orientation).toBe(180);
    expect(j2.orientation).toBe(0);
    expect(j1.positions.logical!.x).toBeLessThan(j2.positions.logical!.x);
    // 하우징 스펙의 컨택트 중 AWG22 에 맞는 것은 SXH-001T 하나뿐 → 자동 지정
    expect(cupH.connectors.flatMap((c) => c.pins).every((p) => p.terminalId === 'lib-jst-sxh-001t')).toBe(true);
    expect(changesLine(r.changes)).toMatch(/\+2 conn \+10 wire \+20 term\(auto\)/);
  });

  it('commands without a harness line go to the only harness', () => {
    const r = applyScript(newDoc({ name: 'X' }), 'conn J1 "JST-XH 2P"\nconn J2 "JST-XH 2P"\nwire J1.1-2 J2.2-1 red/white awg26 len=300');
    const h = r.kit.harnesses[0];
    expect(r.kit.harnesses).toHaveLength(1);
    expect(h.wires).toHaveLength(2);
    // 역범위: 1→2, 2→1
    const idx = (e: HarnessDocument['wires'][number]['from']) => (e.type === 'pin' ? pinIndex(h, e.connectorId, e.pinId) : -1);
    expect(h.wires.map((w) => [idx(w.from), idx(w.to)])).toEqual([[1, 2], [2, 1]]);
    expect(h.wires[0].color).toEqual({ base: 'red', stripe: 'white' });
    // AWG26 은 SXH-001T(28~22)·SXH-002T(30~26) 둘 다 맞는다 → 모호하므로 비워 둔다
    expect(h.connectors[0].pins.every((p) => !p.terminalId)).toBe(true);
  });

  it('is idempotent — re-running updates in place', () => {
    const a = applyScript(newDoc(), cup());
    const b = applyScript(a.kit, cup().replace('len=1600', 'len=1800'));
    const h = b.kit.harnesses.find((x) => x.name === '컵하네스 A')!;
    expect(h.wires).toHaveLength(10);
    expect(h.connectors).toHaveLength(2);
    expect(h.wires.every((w) => w.lengthMm === 1800)).toBe(true);
    expect(Object.keys(b.changes).some((k) => k.endsWith('+'))).toBe(false);
    expect(b.changes['wire~']).toBe(10);
  });

  it('errors carry the line number and leave the input untouched', () => {
    const base = applyScript(newDoc(), cup()).kit;
    const snap = JSON.stringify(base);
    expect(() => applyScript(base, 'harness "컵하네스 A"\nconn J5 "JST-XH 2P"')).toThrow(/line 2: J5 not found — next new connector is J3/);
    expect(() => applyScript(base, `harness "컵하네스 A"\nwire J1.1-3 J2.1-3 colors=red,black`)).toThrow(/line 2: colors: 2 given for 3 wires/);
    expect(() => applyScript(base, 'harness "컵하네스 A"\nwire J1.11 J2.1 red')).toThrow(/J1 has no pin "11" \(pins 1-10\)/);
    expect(() => applyScript(base, 'frobnicate')).toThrow(DslError);
    expect(JSON.stringify(base)).toBe(snap);
  });

  it('del conn removes its wires and renumbers refs', () => {
    const k = applyScript(newDoc(), 'conn J1 "JST-XH 2P"\nconn J2 "JST-XH 2P"\nconn J3 "JST-XH 2P"\nwire J1.1 J2.1 red\nwire J2.2 J3.2 black').kit;
    const r = applyScript(k, 'del conn J2');
    const h = r.kit.harnesses[0];
    expect(h.connectors).toHaveLength(2);
    expect(h.wires).toHaveLength(0);
    expect([...refLabels(h).values()]).toEqual(['J1', 'J2']);
    expect(r.changes).toMatchObject({ 'conn-': 1, 'wire-': 2 });
  });

  it('del wire by ends, splice, device, unused, sleeve, purchased', () => {
    const r = applyScript(newDoc(), [
      'conn J1 "납처리 전선단 4가닥"',
      'splice SP1 3',
      'conn J2 "DC 배럴잭 암"',
      'device D1 "24V PSU" terminals=+24V,GND',
      'wire J1.1 SP1.1 black awg20 len=900',
      'wire J1.2 SP1.2 black awg20 len=900',
      'wire SP1.3 J2.- black awg20 len=900',
      'wire J1.4 J2.+ red awg20 len=900',
      'wire D1.+24V J1.3 red/white sq0.5 len=100',
      'del wire D1.+24V J1.3',
    ].join('\n'));
    const h = r.kit.harnesses[0];
    expect(h.connectors.map((c) => c.kind)).toEqual(['connector', 'splice', 'connector']);
    expect(h.wires).toHaveLength(4);
    expect(h.devices[0].terminals).toEqual(['+24V', 'GND']);
    // 납처리·배럴잭은 단자가 없다 — 자동 지정하지 않는다
    expect(h.connectors.flatMap((c) => c.pins).every((p) => !p.terminalId)).toBe(true);
    const r2 = applyScript(r.kit, 'conn J1 unused=3\nconn J2 note=센터+\npurchased');
    expect(r2.kit.harnesses[0].connectors[0].unused).toEqual([3]);
    expect(r2.kit.harnesses[0].purchased).toBe(true);
  });
});

describe('apply — kit document', () => {
  it('set props, several harnesses, qty → perSet, sleeve adds the sleeve part', () => {
    const r = applyScript(newDoc({ kit: true, pn: 'EW' }), [
      'set name="이스턴웰스 세트" rev=A',
      'harness "시럽" no=EW-01 qty=6 len=800 gauge=awg18',
      'conn J1 "파스톤 110 REC" sleeve',
      'conn J2 "페룰 E1008"',
      'wire J1.1 J2.1 red',
      cup(),
    ].join('\n'));
    const k = r.kit;
    expect(k.set).toMatchObject({ pn: 'EW', name: '이스턴웰스 세트', rev: 'A' });
    expect(k.harnesses.map((h) => [h.letter, h.name])).toEqual([['A', '시럽'], ['B', '컵하네스 A']]);
    const syrup = k.harnesses[0];
    expect(k.set.items.find((i) => i.harnessId === syrup.id)!.perSet).toBe(6);
    expect(syrup.wires[0]).toMatchObject({ lengthMm: 800, gauge: { system: 'awg', value: 18 } });
    expect(syrup.connectors[0].sleeve).toBe(true);
    expect(syrup.usedParts.some((p) => p.id === 'lib-lug-faston-110-sleeve')).toBe(true);
    expect(() => applyScript(k, 'conn J1 "JST-XH 2P"')).toThrow(/no harness selected/);
    expect(applyScript(k, 'conn J3 "JST-XH 2P"', { harness: 'B' }).kit.harnesses[1].connectors).toHaveLength(3);
  });
});
