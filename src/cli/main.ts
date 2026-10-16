/**
 * `harness` 명령 — argv → api.ts. 출력은 짧은 텍스트(한 줄 한 항목), `--json` 이면 JSON.
 * 오류는 `error: …` 한 줄 + 종료 코드 1.
 *
 * 이 파일이 번들의 진입점이다. `import { … } from './harness.mjs'` 로 불러오면 아래
 * API 만 내보내고 CLI 는 돌지 않는다(직접 실행할 때만 run()).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadDoc, saveDoc, newDoc, applyScript, summarize, summaryText, validateDoc, checkText,
  pdfBytes, csvFiles, bomText, bomRows, searchLib, partLine, changesLine, pickHarnesses,
  docJson,
} from './api';
import { validateHarness } from '../store/validate';

export * from './api';

export const VERSION = typeof __HARNESS_CLI_VERSION__ !== 'undefined' && __HARNESS_CLI_VERSION__ ? __HARNESS_CLI_VERSION__ : 'dev';

const HELP: Record<string, string> = {
  '': `harness ${VERSION} — wire-harness documents from the shell
usage: harness <command> [args] [--json]
  lib [words…] [--all]                  find parts: id · short name · pins · gender · end kind
  new <doc.json> [--name N] [--kit] [--pn PN] [--force]
  apply <doc.json> <script.txt | -> [-h H] [--dry-run]   run DSL, save, print changes + check
  show <doc.json> [-h H]                harness list / connectors / wires
  check <doc.json> [-h H]               'E|W|I code where: message'; exit 1 on errors
  pdf <doc.json> [-o out.pdf] [-h H] [--layout onepage|sheets] [--paper A3|A4]
  csv <doc.json> [-o dir] [-h H]        run list + part list CSV (+ set BOM)
  bom <doc.json> [-h H]                 part list text
  help <command>                        details (help dsl for the script language)
-h H: harness name, letter, drawing no. or 1-based index. Omit for the whole set.`,
  dsl: `DSL — one command per line, # comments, "quotes" for spaces
  set pn=EW name="이스턴웰스 세트" rev=A order=1
  harness "컵하네스 A" no=EW-02 rev=A qty=1 [len=1600] [gauge=awg22]   select or create
  note "10P 스트레이트 1:1."      purchased [off]
  conn J1 "JST-XH 10P" [rot=0|90|180|270] [at=x,y] [unused=3,4] [sleeve] [term=<part>|-] [note=..]
  splice SP1 3                    device D1 "24V PSU" terminals=+24V,GND [at=x,y]
  wire J1.1 J2.1 red awg22 len=1600 [stripe=white] [label=..] [signal=..]
  wire J1.1-10 J2.1-10 colors=red,black,white,green,yellow,blue,brown,orange,purple,gray awg22 len=1600
  wire D1.+24V J1.1 red/white sq0.5      term J1 SXH-001T-P0.6 | term J1.1-3 -
  layout                          re-place every node of the current harness
  del wire J1.1 [J2.1] | del conn J1 | del splice SP1 | del device D1 | del harness "name"
refs are derived (J1.. in declaration order, SP1.., D1..): a new connector must take the next free ref.
Re-running a script updates in place (same refs / same wire ends), it does not duplicate.
Unplaced nodes are auto-placed: left column rot=180, right column rot=0, by wiring.
Terminals: if a housing's spec names exactly one library contact that fits the wire AWG, it is set (auto).`,
  lib: 'harness lib [words…] [--all] [--json]\n  all words must match id/name/short name/MPN/maker/series. Without --all at most 40 lines.',
  new: 'harness new <doc.json> [--name N] [--kit] [--pn PN] [--force]\n  without --kit: one harness (saved as v1); with --kit/--pn: a set (v2).',
  apply: 'harness apply <doc.json> <script.txt | -> [-h H] [--dry-run] [--json]\n  whole script or nothing. prints: changes, notes, check summary per touched harness. see: harness help dsl',
  show: 'harness show <doc.json> [-h H] [--json]',
  check: 'harness check <doc.json> [-h H] [--json]\n  one line per issue: E|W|I code [harness] where: title. exit 1 when any E.',
  pdf: 'harness pdf <doc.json> [-o out.pdf] [-h H] [--layout onepage|sheets] [--paper A3|A4]\n  Korean text needs @napi-rs/canvas (npm i -g @napi-rs/canvas, or HARNESS_CANVAS=<dir>).',
  csv: 'harness csv <doc.json> [-o dir] [-h H] [--json]\n  same files and names as the web export dialog.',
  bom: 'harness bom <doc.json> [-h H] [--json]',
};

type Args = { pos: string[]; opt: Map<string, string | true> };

const VALUE_OPTS = new Set(['-h', '--harness', '-o', '--out', '--layout', '--paper', '--name', '--pn']);

export function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const opt = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') { pos.push(a); continue; }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      if (a.startsWith('--') && eq > 0) { opt.set(a.slice(0, eq), a.slice(eq + 1)); continue; }
      if (VALUE_OPTS.has(a)) {
        const v = argv[i + 1];
        if (v == null) throw new Error(`${a} needs a value`);
        opt.set(a === '--harness' ? '-h' : a === '--out' ? '-o' : a, v);
        i++;
        continue;
      }
      opt.set(a, true);
      continue;
    }
    pos.push(a);
  }
  return { pos, opt };
}

const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += String(c); });
    process.stdin.on('end', () => resolve(s));
  });
}

function pageCount(bytes: Uint8Array): number {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** CLI 본체. 출력 줄을 out/err 로 내고 종료 코드를 돌려준다(시험이 그대로 부른다). */
export async function run(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void; stdin?: () => Promise<string> } = {
    out: (s) => { process.stdout.write(`${s}\n`); },
    err: (s) => { process.stderr.write(`${s}\n`); },
  },
): Promise<number> {
  try {
    const { pos, opt } = parseArgs(argv);
    const cmd = pos.shift() ?? 'help';
    const json = opt.has('--json');
    const H = str(opt.get('-h'));
    const emit = (v: unknown, text: string) => io.out(json ? JSON.stringify(v, null, 2) : text);
    const need = (n: number, what: string) => { if (pos.length < n) throw new Error(`${cmd}: ${what} missing — see: harness help ${cmd}`); };

    if (opt.has('--help') || cmd === 'help') {
      const topic = cmd === 'help' ? pos[0] ?? '' : cmd;
      io.out(HELP[topic] ?? HELP['']);
      return 0;
    }
    if (cmd === 'version' || opt.has('--version')) { io.out(VERSION); return 0; }

    switch (cmd) {
      case 'lib': {
        const kitPath = str(opt.get('--doc'));
        const hits = searchLib(pos.join(' '), kitPath ? loadDoc(kitPath) : undefined);
        const all = opt.has('--all') || json;
        const shown = all ? hits : hits.slice(0, 40);
        if (json) {
          emit(shown.map((p) => ({
            id: p.id, short: p.shortName ?? null, name: p.name, mpn: p.mpn ?? null, pins: p.pinCount ?? null,
            gender: p.gender ?? null, endKind: p.endKind ?? null, category: p.category,
          })), '');
        } else {
          const lines = shown.map(partLine);
          if (hits.length > shown.length) lines.push(`… ${hits.length - shown.length} more (--all)`);
          io.out(lines.length ? lines.join('\n') : 'no parts match');
        }
        return 0;
      }
      case 'new': {
        need(1, 'doc.json');
        const path = pos[0];
        if (existsSync(path) && !opt.has('--force')) throw new Error(`${path} exists (use --force to overwrite)`);
        const kit = newDoc({ name: str(opt.get('--name')), kit: opt.has('--kit'), pn: str(opt.get('--pn')) });
        const fmt = opt.has('--kit') || opt.has('--pn') ? 'v2' : 'v1';
        writeFileSync(path, docJson(kit, fmt));
        emit({ path, format: fmt }, `created ${path} (${fmt === 'v2' ? 'set' : 'single harness'})`);
        return 0;
      }
      case 'apply': {
        need(2, 'doc.json and script');
        const [path, src] = pos;
        const kit = loadDoc(path);
        const script = src === '-' ? await (io.stdin ?? readStdin)() : readFileSync(src, 'utf8');
        const r = applyScript(kit, script, { harness: H });
        const fmt = opt.has('--dry-run') ? '-' : saveDoc(path, r.kit);
        const checks = r.touched.map((id) => {
          const h = r.kit.harnesses.find((x) => x.id === id)!;
          const is = validateHarness(h);
          return {
            harness: h.letter ?? '', name: h.name,
            error: is.filter((i) => i.level === 'error').length,
            warn: is.filter((i) => i.level === 'warn').length,
            info: is.filter((i) => i.level === 'info').length,
          };
        });
        const lines = [changesLine(r.changes) + (fmt === '-' ? ' (dry run, not saved)' : '')];
        for (const n of r.notes) lines.push(`note: ${n}`);
        lines.push(`check: ${checks.length ? checks.map((c) => `${c.harness} ${c.error}E ${c.warn}W ${c.info}I`).join(' · ') : '-'}`);
        emit({ changes: r.changes, notes: r.notes, check: checks, saved: fmt !== '-' }, lines.join('\n'));
        return 0;
      }
      case 'show': {
        need(1, 'doc.json');
        const kit = loadDoc(pos[0]);
        const sum = summarize(kit, H);
        emit(sum, summaryText(sum, !!H || kit.harnesses.length === 1));
        return 0;
      }
      case 'check': {
        need(1, 'doc.json');
        const kit = loadDoc(pos[0]);
        const rows = validateDoc(kit, H);
        const errors = rows.filter((r) => r.level === 'error').length;
        const multi = !H && kit.harnesses.length > 1;
        const tail = `${errors}E ${rows.filter((r) => r.level === 'warn').length}W ${rows.filter((r) => r.level === 'info').length}I`;
        emit({ ok: errors === 0, issues: rows }, rows.length ? `${checkText(rows, multi)}\n${tail}` : `ok ${tail}`);
        return errors ? 1 : 0;
      }
      case 'pdf': {
        need(1, 'doc.json');
        const path = pos[0];
        const kit = loadDoc(path);
        const layout = str(opt.get('--layout')) ?? 'onepage';
        if (layout !== 'onepage' && layout !== 'sheets') throw new Error(`--layout ${layout}: expected onepage or sheets`);
        const paper = str(opt.get('--paper'))?.toUpperCase();
        if (paper && paper !== 'A3' && paper !== 'A4') throw new Error(`--paper ${paper}: expected A3 or A4`);
        const warns: string[] = [];
        const bytes = pdfBytes(kit, { harness: H, layout, paper: paper as 'A3' | 'A4' | undefined, onWarn: (m) => warns.push(m) });
        for (const w of warns) io.err(w);
        const stem = basename(path, extname(path));
        const h = H ? pickHarnesses(kit, H)[0] : undefined;
        const out = str(opt.get('-o')) ?? join(dirname(path), `${stem}${h ? `-${h.letter ?? 'h'}` : ''}.pdf`);
        writeFileSync(out, bytes);
        const pages = pageCount(bytes);
        emit({ path: out, pages, bytes: bytes.length, warnings: warns }, `wrote ${out}  ${pages} pages  ${Math.round(bytes.length / 1024)}KB`);
        return 0;
      }
      case 'csv': {
        need(1, 'doc.json');
        const kit = loadDoc(pos[0]);
        const dir = str(opt.get('-o')) ?? dirname(pos[0]);
        mkdirSync(dir, { recursive: true });
        const files = await csvFiles(kit, { harness: H });
        const written = files.map((f) => {
          const p = join(dir, f.name);
          // 웹 내보내기와 같은 바이트 그대로 (BOM 을 붙이지 않는다)
          writeFileSync(p, f.text);
          return p;
        });
        emit({ files: written }, written.join('\n'));
        return 0;
      }
      case 'bom': {
        need(1, 'doc.json');
        const kit = loadDoc(pos[0]);
        emit(bomRows(kit, H), bomText(kit, H));
        return 0;
      }
      default:
        throw new Error(`unknown command "${cmd}" — see: harness help`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    io.err(`error: ${msg.replace(/\s*\n\s*/g, ' ')}`);
    return 1;
  }
}

/** 직접 실행됐는가 (import 로 불렸으면 아님). 심볼릭 링크(npm bin)를 풀어 비교한다. */
function isMain(): boolean {
  try {
    const me = realpathSync(fileURLToPath(import.meta.url));
    const argv1 = process.argv[1];
    return !!argv1 && realpathSync(argv1) === me;
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
