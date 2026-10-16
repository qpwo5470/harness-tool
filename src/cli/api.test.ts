import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyScript, newDoc, validateDoc, pdfBytes, csvFiles, bomText, summarize, summaryText, docJson,
  saveDoc, loadDoc, searchLib, isTrivialSet, autoLayout,
} from './api';
import { run } from './main';
import { overlaps } from './layout';
import { parseDocument } from '../store/persistence';
import { validateHarness } from '../store/validate';

const CUP = `harness "컵하네스 A" no=EW-02 rev=A qty=1
note "10P 스트레이트 1:1."
conn J1 "JST-XH 10P"
conn J2 "JST-XH 10P"
wire J1.1-10 J2.1-10 colors=red,black,white,green,yellow,blue,brown,orange,purple,gray awg22 len=1600
`;

const EW = `set name="이스턴웰스 하네스 세트" rev=A
harness "시럽" no=EW-01 rev=A qty=6 len=800 gauge=awg18
conn J1 "파스톤 110 REC" sleeve
conn J2 "파스톤 110 REC" sleeve
conn J3 "페룰 E1008"
conn J4 "페룰 E1008"
wire J1.1 J3.1 red label=+
wire J2.1 J4.1 black label=-
${CUP}
harness "결제단말기 B" no=EW-05 rev=A qty=1 len=200 gauge=awg22
conn J1 "JST-XH 5P"
conn J2 "Micro-Fit 3.0 10P" unused=3,4,5,6,7
wire J1.1 J2.2 red signal=+34V
wire J1.2 J2.1 black signal=RTN
wire J1.3 J2.10 green signal=M-Rx
wire J1.4 J2.9 white signal=M-Tx
wire J1.5 J2.8 blue signal=COM
`;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); } } };
}

describe('reference 컵하네스 A round-trip', () => {
  const kit = applyScript(newDoc(), CUP).kit;

  it('validates with no errors', () => {
    const rows = validateDoc(kit);
    expect(rows.filter((r) => r.level === 'error')).toEqual([]);
  });

  it('pdfBytes is a PDF', () => {
    const warns: string[] = [];
    const b = pdfBytes(kit, { onWarn: (m) => warns.push(m) });
    expect(new TextDecoder().decode(b.slice(0, 5))).toBe('%PDF-');
    expect(warns.length).toBeLessThanOrEqual(1);
  });

  it('the saved JSON opens through the app loader unchanged (GUI import)', () => {
    for (const fmt of ['v1', 'v2'] as const) {
      const r = parseDocument(docJson(kit, fmt));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      const h = r.kit.harnesses[0];
      expect(h.wires).toHaveLength(10);
      expect(h.connectors.every((c) => c.positions.logical && c.positions.physical)).toBe(true);
      expect(validateHarness(h).filter((i) => i.level === 'error')).toEqual([]);
    }
    expect(isTrivialSet(kit)).toBe(true);
  });

  it('auto layout: no overlapping boxes, two facing columns', () => {
    const h = kit.harnesses[0];
    expect(overlaps(h)).toBe(0);
    const re = autoLayout(h);
    expect(re.connectors.map((c) => c.orientation)).toEqual([180, 0]);
  });
});

describe('EW set (3 harnesses)', () => {
  const kit = applyScript(newDoc({ kit: true, pn: 'EW' }), EW).kit;

  it('builds cleanly and round-trips through the app loader', () => {
    expect(kit.harnesses.map((h) => `${h.letter}:${h.drawingNo}`)).toEqual(['A:EW-01', 'B:EW-02', 'C:EW-05']);
    expect(validateDoc(kit).filter((r) => r.level === 'error')).toEqual([]);
    const r = parseDocument(docJson(kit, 'v2'));
    expect(r.ok && r.warnings).toEqual([]);
    for (const h of kit.harnesses) expect(overlaps(h)).toBe(0);
    // 시럽: 끝단 4개 — REC 둘은 왼쪽, 페룰 둘은 오른쪽
    expect(kit.harnesses[0].connectors.map((c) => c.orientation)).toEqual([180, 180, 0, 0]);
  });

  it('summary / show text shape', () => {
    const s = summarize(kit);
    expect(s.kind).toBe('set');
    expect(s.harnesses.map((h) => h.qty)).toEqual([6, 1, 1]);
    const list = summaryText(s, false).split('\n');
    expect(list[0]).toMatch(/^set EW +이스턴웰스 하네스 세트 +rev A +order 1/);
    expect(list).toHaveLength(4);
    const one = summaryText(summarize(kit, 'C'), true).split('\n');
    expect(one[1]).toMatch(/^C +EW-05 +결제단말기 B/);
    expect(one).toContain('  J2 Micro-Fit 3.0 10P [lib-mf3-43025-10p] 10p rot0 unused=3,4,5,6,7 term=43030');
    expect(one).toContain('  J1.3 J2.10 green AWG22 200mm "M-Rx"');
  });

  it('csv files use the web export names', async () => {
    const files = await csvFiles(kit);
    expect(files.map((f) => f.name)).toEqual([
      'EW_A_접속표_RevA.csv', 'EW_A_파트리스트_RevA.csv',
      'EW_B_접속표_RevA.csv', 'EW_B_파트리스트_RevA.csv',
      'EW_C_접속표_RevA.csv', 'EW_C_파트리스트_RevA.csv',
      'EW_하네스BOM_RevA.csv',
    ]);
    expect(files[0].text.split('\n')[0]).toBe('wire,net,from,to,color,gauge,length_mm');
    expect(files[0].text.split('\n')).toHaveLength(3);
  });

  it('bom text lists the set and part rows', () => {
    const t = bomText(kit).split('\n');
    expect(t[0]).toBe('A EW-01 시럽  6/set × 1 = 6');
    expect(t).toContain('[B] EW-02 컵하네스 A');
    expect(t.some((l) => /^ {2}2 .*파스톤 110 절연슬리브/.test(l))).toBe(true);
  });
});

describe('cli (run)', () => {
  it('new → apply → show → check → pdf → csv, errors are one line + exit 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
    const doc = join(dir, 'h.json');
    const script = join(dir, 's.txt');
    writeFileSync(script, CUP);

    let c = capture();
    expect(await run(['new', doc, '--name', '컵'], c.io)).toBe(0);
    expect(c.out).toEqual([`created ${doc} (single harness)`]);
    expect(JSON.parse(readFileSync(doc, 'utf8')).schemaVersion).toBe(1);

    // 이름이 다른 harness 줄 → 세트로 저장된다
    c = capture();
    expect(await run(['apply', doc, script], c.io)).toBe(0);
    expect(c.out[0].split('\n')[0]).toMatch(/^\+1 harness \+2 conn \+10 wire \+20 term\(auto\)/);
    // 검증 요약은 손댄 하네스만
    expect(c.out[0]).toMatch(/\nnote: B J1: terminal SXH-001T-P0\.6 ×10 \(auto, from part spec\)\n/);
    expect(c.out[0]).toMatch(/\ncheck: B 0E 0W 0I$/);
    expect(JSON.parse(readFileSync(doc, 'utf8')).schemaVersion).toBe(2);

    c = capture();
    expect(await run(['show', doc, '--json'], c.io)).toBe(0);
    expect(JSON.parse(c.out[0]).harnesses).toHaveLength(2);

    c = capture();
    expect(await run(['check', doc, '-h', 'B'], c.io)).toBe(0);
    expect(c.out).toEqual(['ok 0E 0W 0I']);

    c = capture();
    expect(await run(['pdf', doc, '-h', '2', '-o', join(dir, 'b.pdf')], c.io)).toBe(0);
    expect(c.out[0]).toMatch(/^wrote .*b\.pdf {2}\d+ pages {2}\d+KB$/);
    expect(readFileSync(join(dir, 'b.pdf')).subarray(0, 4).toString()).toBe('%PDF');

    c = capture();
    expect(await run(['csv', doc, '-o', join(dir, 'csv')], c.io)).toBe(0);
    expect(c.out[0].split('\n').every((p) => existsSync(p))).toBe(true);

    c = capture();
    expect(await run(['show', join(dir, 'nope.json')], c.io)).toBe(1);
    expect(c.err).toEqual([`error: ${join(dir, 'nope.json')}: no such file`]);

    c = capture();
    expect(await run(['apply', doc, '-'], { ...c.io, stdin: async () => 'harness "B2"\nconn J9 x' })).toBe(1);
    expect(c.err[0]).toMatch(/^error: line 2: J9 not found — next new connector is J1/);

    c = capture();
    expect(await run(['lib', 'JST-XH', '10P'], c.io)).toBe(0);
    expect(c.out[0].split('\n')[0]).toBe('lib-jst-xhp-10p · JST-XH 10P · 10P · receptacle · -');
  });

  it('v1 document stays v1 while nothing set-level is used', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
    const doc = join(dir, 'one.json');
    saveDoc(doc, newDoc({ name: '단일' }), { format: 'v1' });
    const k = applyScript(loadDoc(doc), 'conn J1 "JST-XH 2P"\nconn J2 "JST-XH 2P"\nwire J1.1-2 J2.1-2 colors=red,black len=100').kit;
    expect(saveDoc(doc, k)).toBe('v1');
    expect(saveDoc(doc, applyScript(k, 'harness "단일" qty=2').kit)).toBe('v2');
  });

  it('searchLib ranks exact short names first', () => {
    expect(searchLib('JST-XH 5P')[0].id).toBe('lib-jst-xhp-5p');
  });
});
