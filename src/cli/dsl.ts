/**
 * 하네스 DSL — 파서와 실행기 (CLI-스펙.md §DSL).
 *
 * 한 줄 한 명령, `#` 주석, 따옴표로 공백 포함 값. 스크립트 전체가 **한 덩어리**다 —
 * 중간 줄에서 실패하면 아무것도 바뀌지 않는다(실행은 복제본에서 하고 끝까지
 * 성공했을 때만 돌려준다).
 *
 * ## 왜 같은 스크립트를 두 번 돌려도 같은가 (멱등)
 * `harness "이름"` 은 있으면 고르고 없으면 만든다. `conn J1 …` 은 J1 이 있으면 고치고
 * 없으면 놓는다. `wire A B` 는 같은 두 끝의 배선이 있으면 그 배선의 속성을 고친다.
 * 에이전트가 스크립트를 고쳐 다시 돌리는 것이 기본 작업 방식이라 그래야 한다.
 *
 * ## 레퍼런스(J1 · SP1 · D1)는 저장되지 않는다
 * 도면 레퍼런스는 문서 순서에서 **유도**된다(canvas/docToFlow.refLabels — 화면·PDF·검증이
 * 같은 함수를 쓴다). 그래서 새 커넥터는 다음 번호(J{n+1})로만 만들 수 있고, 커넥터를
 * 지우면 뒤 번호가 당겨진다 — GUI 와 같다.
 *
 * 도메인 규칙은 다시 만들지 않는다: 부품 → 인스턴스는 library/seed.instantiate,
 * 세트 조작은 store/kit, 러그 판정은 library/taxonomy 를 그대로 부른다.
 */
import type {
  Connector, Device, Endpoint, Gauge, HarnessDocument, KitDocument, Orientation,
  PartLibraryItem, Pin, Vec2, Wire, WireColor,
} from '../types';
import { instantiate, suggestedColor, SEED_PARTS } from '../library/seed';
import { isStandaloneLug } from '../library/taxonomy';
import { emptyDoc } from '../store/persistence';
import { letterAt, withNewHarness, withoutHarness } from '../store/kit';
import { refLabels } from '../canvas/docToFlow';
import { resolvePart, PartLookupError, type PartFilter } from './parts';
import { autoLayout } from './layout';

// ================================================================
// 오류
// ================================================================

export class DslError extends Error {
  line: number;
  constructor(line: number, msg: string) {
    super(line > 0 ? `line ${line}: ${msg}` : msg);
    this.line = line;
  }
}

// ================================================================
// 토큰 · 파서
// ================================================================

export type Token = {
  /** 따옴표를 벗긴 값 (key=value 면 전체 `key=value`) */
  text: string;
  /** 따옴표가 하나라도 있었는가 — 따옴표 친 낱말은 명령·플래그로 읽지 않는다 */
  quoted: boolean;
  /** `key=value` 꼴이면 key(소문자) */
  key?: string;
  value?: string;
};

const KEY_RE = /^[A-Za-z][\w-]*$/;

/** 한 줄 → 토큰. `#` 는 토큰 머리에서만 주석이다(따옴표 안·낱말 중간은 글자). */
export function tokenize(line: string, lineNo = 0): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && /\s/.test(line[i])) i++;
    if (i >= n) break;
    if (line[i] === '#') break;
    let text = '';
    let quoted = false;
    let key: string | undefined;
    let valStart = -1;
    while (i < n && !/\s/.test(line[i])) {
      const ch = line[i];
      if (ch === '"' || ch === "'") {
        quoted = true;
        const q = ch;
        i++;
        let closed = false;
        while (i < n) {
          if (line[i] === '\\' && q === '"' && i + 1 < n) { text += line[i + 1]; i += 2; continue; }
          if (line[i] === q) { closed = true; i++; break; }
          text += line[i++];
        }
        if (!closed) throw new DslError(lineNo, `unclosed quote ${q}`);
        continue;
      }
      if (ch === '=' && key === undefined && !quoted && KEY_RE.test(text)) {
        key = text.toLowerCase();
        text += '=';
        valStart = text.length;
        i++;
        continue;
      }
      text += ch;
      i++;
    }
    const tok: Token = { text, quoted };
    if (key !== undefined) { tok.key = key; tok.value = text.slice(valStart); }
    out.push(tok);
  }
  return out;
}

export type Command = {
  line: number;
  name: string;
  /** 위치 인자 (key=value 가 아닌 것) */
  args: Token[];
  /** key=value (마지막 값이 이긴다) */
  kv: Map<string, string>;
};

export function parseScript(script: string): Command[] {
  const out: Command[] = [];
  script.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const toks = tokenize(raw, line);
    if (!toks.length) return;
    const head = toks[0];
    if (head.quoted || head.key) throw new DslError(line, `expected a command, got "${head.text}"`);
    const args: Token[] = [];
    const kv = new Map<string, string>();
    for (const t of toks.slice(1)) {
      if (t.key !== undefined) kv.set(t.key, t.value ?? '');
      else args.push(t);
    }
    out.push({ line, name: head.text.toLowerCase(), args, kv });
  });
  return out;
}

// ================================================================
// 값 해석
// ================================================================

/** 웹과 같은 색 이름 (canvas/docToFlow NAMED_COLORS) */
export const COLOR_NAMES = new Set([
  'red', 'black', 'white', 'green', 'blue', 'yellow', 'orange', 'brown',
  'purple', 'gray', 'grey', 'pink', 'violet', 'cyan', 'magenta',
]);

function isColorWord(s: string): boolean {
  const v = s.trim().toLowerCase();
  return COLOR_NAMES.has(v) || /^#[0-9a-f]{3,8}$/.test(v);
}

/** `red` · `red/white` → WireColor. 모르는 색이면 null */
export function parseColor(s: string): WireColor | null {
  const [base, stripe, more] = s.split('/').map((x) => x.trim().toLowerCase());
  if (more !== undefined || !base || !isColorWord(base)) return null;
  if (stripe !== undefined && !isColorWord(stripe)) return null;
  return stripe ? { base, stripe } : { base };
}

/** `awg22` · `AWG22` · `sq0.5` · `0.5sq` · `mm0.5` · `0.5mm2` */
export function parseGauge(s: string): Gauge | null {
  const v = s.trim().toLowerCase();
  let m = /^awg#?(\d+(?:\.\d+)?)$/.exec(v);
  if (m) return { system: 'awg', value: Number(m[1]) };
  m = /^(?:sq|mm2?|mm²)(\d+(?:\.\d+)?)$/.exec(v) ?? /^(\d+(?:\.\d+)?)(?:sq|mm2|mm²)$/.exec(v);
  if (m) return { system: 'mm2', value: Number(m[1]) };
  return null;
}

/** 길이 → mm. `1600` · `1600mm` · `160cm` · `1.6m` */
export function parseLength(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/i.exec(s.trim());
  if (!m) return null;
  const k = (m[2] ?? 'mm').toLowerCase();
  const mm = Number(m[1]) * (k === 'm' ? 1000 : k === 'cm' ? 10 : 1);
  return Math.round(mm * 100) / 100;
}

/** `J1.1-10` → { ref: 'J1', sel: '1-10' } */
function splitEndpoint(s: string): { ref: string; sel?: string } {
  const dot = s.indexOf('.');
  if (dot < 0) return { ref: s.toUpperCase() };
  return { ref: s.slice(0, dot).toUpperCase(), sel: s.slice(dot + 1) };
}

const REF_RE = /^(J|SP|D)(\d+)$/;

function onOff(v: string | undefined, line: number, key: string): boolean {
  const s = (v ?? '').toLowerCase();
  if (['', 'on', 'yes', 'true', '1'].includes(s)) return true;
  if (['off', 'no', 'false', '0', '-'].includes(s)) return false;
  throw new DslError(line, `${key}=${v}: expected on/off`);
}

// ================================================================
// 실행
// ================================================================

export type ApplyOptions = {
  /** 처음 대상 하네스 (`-h` 와 같은 규칙). 생략 시 하네스가 하나면 그것 */
  harness?: string;
  /** 시험용 — 지금 시각 */
  now?: string;
};

export type ApplyResult = {
  kit: KitDocument;
  /** 바뀐 것 개수 — 키 예: `harness+` `conn+` `conn~` `wire+` `wire~` `wire-` `term(auto)` */
  changes: Record<string, number>;
  /** 실행 중 남길 한 줄 알림 (자동 단자 지정 등) */
  notes: string[];
  /** 손댄 하네스 id */
  touched: string[];
};

type Touch = {
  place: Set<string>;
  keepRot: Set<string>;
  autoTerm: Set<string>;
  explicitTerm: Set<string>;
  relayout: boolean;
};

type Defaults = { lengthMm?: number; gauge?: Gauge };

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** `-h` 규칙: 이름 · letter · 도번 · 인덱스(1부터) */
export function findHarness(kit: KitDocument, sel: string): HarnessDocument | undefined {
  const s = sel.trim();
  const hs = kit.harnesses;
  return hs.find((h) => h.name === s)
    ?? hs.find((h) => (h.letter ?? '').toUpperCase() === s.toUpperCase() && s.length <= 2)
    ?? hs.find((h) => (h.drawingNo ?? '') === s && s !== '')
    ?? (/^\d+$/.test(s) ? hs[Number(s) - 1] : undefined)
    ?? hs.find((h) => h.name.toLowerCase() === s.toLowerCase());
}

export function applyScript(input: KitDocument, script: string, opts: ApplyOptions = {}): ApplyResult {
  const cmds = parseScript(script);
  let kit: KitDocument = structuredClone(input);
  const changes: Record<string, number> = {};
  const notes: string[] = [];
  const touch = new Map<string, Touch>();
  const defaults = new Map<string, Defaults>();
  const bump = (k: string, n = 1) => { if (n) changes[k] = (changes[k] ?? 0) + n; };
  /** 이번 실행에서 새로 만든 하네스 — 그 하네스의 속성 편집은 '~' 로 세지 않는다 */
  const fresh = new Set<string>();

  let curId: string | undefined;
  if (opts.harness) {
    const h = findHarness(kit, opts.harness);
    if (!h) throw new DslError(0, `harness "${opts.harness}" not found`);
    curId = h.id;
  } else if (kit.harnesses.length === 1) {
    curId = kit.harnesses[0].id;
  }

  const T = (id: string): Touch => {
    let t = touch.get(id);
    if (!t) {
      t = { place: new Set(), keepRot: new Set(), autoTerm: new Set(), explicitTerm: new Set(), relayout: false };
      touch.set(id, t);
    }
    return t;
  };

  // ── 현재 하네스 ────────────────────────────────────────────────────
  const cur = (line: number): HarnessDocument => {
    const h = curId ? kit.harnesses.find((x) => x.id === curId) : undefined;
    if (!h) {
      throw new DslError(line, `no harness selected — add a line: harness "name" (have: ${kit.harnesses.map((x) => `"${x.name}"`).join(', ')})`);
    }
    T(h.id);
    return h;
  };

  // ── 레퍼런스 ───────────────────────────────────────────────────────
  type Node = { kind: 'conn'; c: Connector } | { kind: 'dev'; d: Device };
  const nodeByRef = (h: HarnessDocument, ref: string): Node | undefined => {
    const refs = refLabels(h);
    for (const c of h.connectors) if (refs.get(c.id) === ref) return { kind: 'conn', c };
    for (const d of h.devices) if (refs.get(d.id) === ref) return { kind: 'dev', d };
    return undefined;
  };
  const refList = (h: HarnessDocument) => [...refLabels(h).values()].join(',') || 'none';
  const nextRef = (h: HarnessDocument, prefix: string): string => {
    const n = prefix === 'D'
      ? h.devices.length
      : h.connectors.filter((c) => (c.kind === 'splice') === (prefix === 'SP')).length;
    return `${prefix}${n + 1}`;
  };

  const addUsed = (h: HarnessDocument, p: PartLibraryItem) => {
    if (!h.usedParts.some((x) => x.id === p.id)) h.usedParts.push(p);
  };
  const lookup = (line: number, q: string, f: PartFilter, h: HarnessDocument): PartLibraryItem => {
    try {
      return resolvePart(q, f, h.usedParts);
    } catch (e) {
      if (e instanceof PartLookupError) throw new DslError(line, e.message);
      throw e;
    }
  };

  // ── 핀 · 끝점 ──────────────────────────────────────────────────────
  const pinsOf = (line: number, c: Connector, ref: string, sel: string): Pin[] => {
    const find = (tok: string): Pin => {
      const t = tok.trim();
      const p = /^\d+$/.test(t)
        ? c.pins.find((x) => x.index === Number(t)) ?? c.pins.find((x) => x.label === t)
        : c.pins.find((x) => x.label === t)
          ?? c.pins.find((x) => (x.label ?? '').replace(/−/g, '-') === t.replace(/−/g, '-'))
          ?? c.pins.find((x) => (x.label ?? '').toLowerCase() === t.toLowerCase());
      if (!p) {
        const idx = c.pins.map((x) => x.index);
        const labels = c.pins.filter((x) => x.label && x.label !== String(x.index)).map((x) => x.label);
        throw new DslError(line, `${ref} has no pin "${t}" (pins ${Math.min(...idx)}-${Math.max(...idx)}${labels.length ? `, labels ${labels.join(',')}` : ''})`);
      }
      return p;
    };
    const m = /^(\d+)-(\d+)$/.exec(sel.trim());
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      const step = a <= b ? 1 : -1;
      const out: Pin[] = [];
      for (let k = a; k !== b + step; k += step) out.push(find(String(k)));
      return out;
    }
    return sel.split(',').filter((s) => s.trim() !== '').map(find);
  };

  const endpoints = (line: number, h: HarnessDocument, tok: string): Endpoint[] => {
    const { ref, sel } = splitEndpoint(tok);
    const node = nodeByRef(h, ref);
    if (!node) throw new DslError(line, `${ref} not found (have ${refList(h)})`);
    if (node.kind === 'conn') {
      if (sel == null || sel === '') throw new DslError(line, `${tok}: pin missing — write ${ref}.1 or ${ref}.1-${node.c.pins.length}`);
      return pinsOf(line, node.c, ref, sel).map((p) => ({ type: 'pin', connectorId: node.c.id, pinId: p.id }));
    }
    const d = node.d;
    if (sel == null || sel === '') return [{ type: 'device', deviceId: d.id }];
    return sel.split(',').map((t) => {
      const term = t.trim();
      if (d.terminals?.length && !d.terminals.includes(term)) {
        throw new DslError(line, `${ref} has no terminal "${term}" (terminals ${d.terminals.join(',')})`);
      }
      if (!d.terminals?.length) throw new DslError(line, `${ref} has no terminals — device ${ref} "${d.name}" terminals=${term},…`);
      return { type: 'device', deviceId: d.id, terminal: term };
    });
  };

  const sameEp = (a: Endpoint, b: Endpoint) =>
    a.type === 'pin' && b.type === 'pin'
      ? a.connectorId === b.connectorId && a.pinId === b.pinId
      : a.type === 'device' && b.type === 'device'
        ? a.deviceId === b.deviceId && (a.terminal ?? '') === (b.terminal ?? '')
        : false;
  const wireBetween = (h: HarnessDocument, a: Endpoint, b: Endpoint) =>
    h.wires.find((w) => (sameEp(w.from, a) && sameEp(w.to, b)) || (sameEp(w.from, b) && sameEp(w.to, a)));

  // ── 커넥터 놓기/고치기 ─────────────────────────────────────────────
  const swapHousing = (h: HarnessDocument, c: Connector, part: PartLibraryItem): number => {
    const fresh = instantiate(part, c.positions.logical ?? { x: 0, y: 0 });
    const byIndex = new Map(fresh.pins.map((p) => [p.index, p] as const));
    const map = new Map<string, string>();
    for (const p of c.pins) {
      const np = byIndex.get(p.index);
      if (np) map.set(p.id, np.id);
    }
    let dropped = 0;
    h.wires = h.wires.filter((w) => {
      for (const e of [w.from, w.to]) {
        if (e.type === 'pin' && e.connectorId === c.id && !map.has(e.pinId)) { dropped++; return false; }
      }
      return true;
    }).map((w) => {
      const fix = (e: Endpoint): Endpoint => (e.type === 'pin' && e.connectorId === c.id ? { ...e, pinId: map.get(e.pinId)! } : e);
      return { ...w, from: fix(w.from), to: fix(w.to) };
    });
    c.housingId = part.id;
    c.kind = fresh.kind;
    c.pins = fresh.pins;
    if (fresh.bridges) c.bridges = fresh.bridges; else delete c.bridges;
    addUsed(h, part);
    return dropped;
  };

  const setTerminal = (line: number, h: HarnessDocument, c: Connector, q: string, pins?: Pin[]) => {
    const targets = pins ?? c.pins.filter((p) => !(c.unused ?? []).some((u) => String(u) === String(p.index) || String(u) === p.label));
    if (q === '-' || q === '') {
      for (const p of targets) delete p.terminalId;
    } else {
      const part = lookup(line, q, 'terminal', h);
      for (const p of targets) p.terminalId = part.id;
      addUsed(h, part);
    }
    T(h.id).explicitTerm.add(c.id);
  };

  const connOptions = (line: number, h: HarnessDocument, c: Connector, cmd: Command, flags: Token[]) => {
    const t = T(h.id);
    const rot = cmd.kv.get('rot');
    if (rot !== undefined) {
      const r = Number(rot);
      if (![0, 90, 180, 270].includes(r)) throw new DslError(line, `rot=${rot}: expected 0, 90, 180 or 270`);
      c.orientation = r as Orientation;
      t.keepRot.add(c.id);
    }
    const at = cmd.kv.get('at');
    if (at !== undefined) {
      const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(at);
      if (!m) throw new DslError(line, `at=${at}: expected x,y`);
      const v: Vec2 = { x: Number(m[1]), y: Number(m[2]) };
      c.positions = { logical: v, physical: v };
      t.place.delete(c.id);
    }
    const unused = cmd.kv.get('unused');
    if (unused !== undefined) {
      if (unused === '-' || unused === '') delete c.unused;
      else {
        c.unused = unused.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
        for (const u of c.unused) {
          if (!c.pins.some((p) => String(p.index) === String(u) || p.label === String(u))) {
            throw new DslError(line, `unused=${u}: pin not on this part (${c.pins.length} pins)`);
          }
        }
      }
    }
    let sleeve: boolean | undefined;
    if (cmd.kv.has('sleeve')) sleeve = onOff(cmd.kv.get('sleeve'), line, 'sleeve');
    for (const f of flags) {
      const w = f.text.toLowerCase();
      if (w === 'sleeve') sleeve = true;
      else if (w === 'nosleeve') sleeve = false;
      else throw new DslError(line, `unknown word "${f.text}" (options: rot= at= unused= sleeve term= note=)`);
    }
    if (sleeve === true) {
      c.sleeve = true;
      const housing = h.usedParts.find((p) => p.id === c.housingId);
      const sp = housing?.sleevePartId
        ? [...h.usedParts, ...SEED_PARTS].find((p) => p.id === housing.sleevePartId)
        : undefined;
      if (sp) addUsed(h, sp);
      else notes.push(`${refLabels(h).get(c.id)}: part has no matching sleeve item — check will warn`);
    } else if (sleeve === false) delete c.sleeve;
    const term = cmd.kv.get('term');
    if (term !== undefined) setTerminal(line, h, c, term);
    const note = cmd.kv.get('note');
    if (note !== undefined) { if (note === '' || note === '-') delete c.note; else c.note = note; }
  };

  const placeConnector = (cmd: Command, refTok: string, partQ: string | undefined, flags: Token[], wantSplice: boolean) => {
    const h = cur(cmd.line);
    const ref = refTok.toUpperCase();
    const m = REF_RE.exec(ref);
    if (!m || m[1] === 'D') {
      throw new DslError(cmd.line, `bad ref "${refTok}" — connectors are J1, J2 …, splices SP1, SP2 …`);
    }
    const isSp = m[1] === 'SP';
    const existing = nodeByRef(h, ref);
    if (existing && existing.kind === 'conn') {
      const c = existing.c;
      let changed = false;
      if (partQ) {
        const part = wantSplice && /^\d+$/.test(partQ) ? spliceItem(h, Number(partQ)) : lookup(cmd.line, partQ, 'placeable', h);
        if (part.id !== c.housingId) {
          if ((part.category === 'splice') !== isSp) throw new DslError(cmd.line, `${ref}: ${isSp ? 'splice refs need a splice part' : `${part.id} is a splice — use SP refs`}`);
          const dropped = swapHousing(h, c, part);
          changed = true;
          if (dropped) { bump('wire-', dropped); notes.push(`${ref}: ${dropped} wire(s) dropped — pins gone after part change`); }
          T(h.id).autoTerm.add(c.id);
        }
      }
      const before = JSON.stringify(c);
      connOptions(cmd.line, h, c, cmd, flags);
      if (changed || JSON.stringify(c) !== before) bump(isSp ? 'splice~' : 'conn~');
      return;
    }
    const want = nextRef(h, isSp ? 'SP' : 'J');
    if (ref !== want) {
      throw new DslError(cmd.line, `${ref} not found — next new ${isSp ? 'splice' : 'connector'} is ${want} (refs follow declaration order)`);
    }
    if (!partQ) throw new DslError(cmd.line, `${ref}: part missing — e.g. ${isSp ? 'splice SP1 3' : 'conn J1 "JST-XH 4P"'} (find parts: harness lib <words>)`);
    const part = wantSplice && /^\d+$/.test(partQ) ? spliceItem(h, Number(partQ)) : lookup(cmd.line, partQ, 'placeable', h);
    if ((part.category === 'splice') !== isSp) {
      throw new DslError(cmd.line, isSp ? `${ref}: ${part.id} is not a splice` : `${part.id} is a splice — write: splice ${nextRef(h, 'SP')} ${part.pinCount ?? 3}`);
    }
    const c = instantiate(part, { x: 0, y: 0 });
    h.connectors.push(c);
    addUsed(h, part);
    const t = T(h.id);
    t.place.add(c.id);
    t.autoTerm.add(c.id);
    bump(isSp ? 'splice+' : 'conn+');
    connOptions(cmd.line, h, c, cmd, flags);
  };

  /** n 가닥 스플라이스 — 라이브러리에 있으면 그것, 없으면 같은 모양으로 만든다 */
  const spliceItem = (h: HarnessDocument, n: number): PartLibraryItem => {
    const hit = [...h.usedParts, ...SEED_PARTS].find((p) => p.category === 'splice' && p.pinCount === n);
    if (hit) return hit;
    return {
      id: `cli-splice-${n}`, category: 'splice', name: `스플라이스 ${n} (꼬임)`, gender: 'neutral',
      pinCount: n, pinLayout: Array.from({ length: n }, (_, i) => ({ index: i + 1, offset: { x: i, y: 0 } })),
    };
  };

  // ── 명령 ───────────────────────────────────────────────────────────
  for (const cmd of cmds) {
    const { line, args, kv } = cmd;
    const pos = (i: number) => args[i]?.text;
    switch (cmd.name) {
      case 'set': {
        if (args.length) throw new DslError(line, `set: expected key=value (pn= name= rev= order=), got "${args[0].text}"`);
        for (const [k, v] of kv) {
          if (k === 'pn') kit.set.pn = v;
          else if (k === 'name') { kit.set.name = v; kit.name = v; }
          else if (k === 'rev') { if (v === '' || v === '-') delete kit.set.rev; else kit.set.rev = v; }
          else if (k === 'order' || k === 'orderqty' || k === 'sets') {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 1) throw new DslError(line, `${k}=${v}: expected a number ≥ 1`);
            kit.set.orderQty = Math.round(n);
          } else throw new DslError(line, `set: unknown key "${k}" (pn name rev order)`);
          bump('set~');
        }
        break;
      }
      case 'harness': {
        const name = pos(0);
        if (!name) throw new DslError(line, 'harness: name missing — harness "name" [no=] [rev=] [qty=]');
        if (args.length > 1) throw new DslError(line, `harness: unexpected "${args[1].text}" — quote names with spaces`);
        let h = findHarness(kit, name);
        const created = !h;
        if (!h) {
          const lone = kit.harnesses.length === 1 ? kit.harnesses[0] : undefined;
          const pristine = lone && lone.name === '새 하네스' && !lone.connectors.length && !lone.devices.length && !lone.wires.length;
          if (pristine) {
            lone.name = name;
            h = lone;
          } else {
            const now = new Date().toISOString();
            const blank: HarnessDocument = { ...emptyDoc(), id: uid('hrn'), name, createdAt: now, updatedAt: now };
            kit = withNewHarness(kit, blank);
            h = kit.harnesses[kit.harnesses.length - 1];
          }
          bump('harness+');
          fresh.add(h.id);
        }
        curId = h.id;
        T(h.id);
        let edited = false;
        for (const [k, v] of kv) {
          if (k === 'no' || k === 'drawingno') { if (v === '' || v === '-') delete h.drawingNo; else h.drawingNo = v; }
          else if (k === 'rev') { if (v === '' || v === '-') delete h.rev; else h.rev = v; }
          else if (k === 'name') h.name = v;
          else if (k === 'qty' || k === 'perset') {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 1) throw new DslError(line, `qty=${v}: expected a number ≥ 1`);
            const items = kit.set.items;
            const it = items.find((x) => x.harnessId === h!.id);
            if (it) it.perSet = Math.round(n); else items.push({ harnessId: h.id, perSet: Math.round(n) });
          } else if (k === 'len' || k === 'length') {
            const mm = parseLength(v);
            if (mm == null) throw new DslError(line, `len=${v}: expected mm (1600, 1.6m)`);
            defaults.set(h.id, { ...defaults.get(h.id), lengthMm: mm });
            continue;
          } else if (k === 'gauge') {
            const g = parseGauge(v);
            if (!g) throw new DslError(line, `gauge=${v}: expected awg22 or sq0.5`);
            defaults.set(h.id, { ...defaults.get(h.id), gauge: g });
            continue;
          } else if (k === 'note') { if (v === '' || v === '-') delete h.note; else h.note = v; }
          else throw new DslError(line, `harness: unknown key "${k}" (no rev qty name note len gauge)`);
          edited = true;
        }
        if (edited && !created && !fresh.has(h.id)) bump('harness~');
        break;
      }
      case 'note': {
        const h = cur(line);
        const v = args.map((a) => a.text).join(' ');
        const before = h.note;
        if (v === '' || v === '-') delete h.note; else h.note = v;
        if (h.note !== before && !fresh.has(h.id)) bump('harness~');
        break;
      }
      case 'purchased': {
        const h = cur(line);
        const on = onOff(pos(0), line, 'purchased');
        const before = !!h.purchased;
        if (on) h.purchased = true; else delete h.purchased;
        if (on !== before && !fresh.has(h.id)) bump('harness~');
        break;
      }
      case 'conn': {
        if (!pos(0)) throw new DslError(line, 'conn: ref missing — conn J1 "JST-XH 4P"');
        const partTok = args[1];
        const isFlag = partTok && !partTok.quoted && ['sleeve', 'nosleeve'].includes(partTok.text.toLowerCase());
        placeConnector(cmd, pos(0)!, isFlag ? undefined : partTok?.text, args.slice(isFlag ? 1 : 2), false);
        break;
      }
      case 'splice': {
        if (!pos(0)) throw new DslError(line, 'splice: ref missing — splice SP1 3');
        placeConnector(cmd, pos(0)!, pos(1), args.slice(2), true);
        break;
      }
      case 'device': {
        const h = cur(line);
        const ref = (pos(0) ?? '').toUpperCase();
        if (!/^D\d+$/.test(ref)) throw new DslError(line, `device: bad ref "${pos(0) ?? ''}" — device D1 "24V PSU" terminals=+24V,GND`);
        const termsKv = kv.get('terminals');
        const terms = termsKv !== undefined ? termsKv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        const ex = nodeByRef(h, ref);
        let d: Device;
        if (ex && ex.kind === 'dev') {
          d = ex.d;
          if (pos(1)) d.name = pos(1)!;
          if (terms) {
            const gone = h.wires.filter((w) => [w.from, w.to].some((e) => e.type === 'device' && e.deviceId === d.id && e.terminal && !terms.includes(e.terminal)));
            if (gone.length) throw new DslError(line, `${ref}: ${gone.length} wire(s) use terminals not in the new list`);
            d.terminals = terms;
          }
          bump('device~');
        } else {
          const want = nextRef(h, 'D');
          if (ref !== want) throw new DslError(line, `${ref} not found — next new device is ${want}`);
          if (!pos(1)) throw new DslError(line, `${ref}: name missing — device ${ref} "24V PSU" terminals=+24V,GND`);
          d = { id: uid('dev'), name: pos(1)!, positions: {} };
          if (terms) d.terminals = terms;
          h.devices.push(d);
          T(h.id).place.add(d.id);
          bump('device+');
        }
        const at = kv.get('at');
        if (at !== undefined) {
          const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(at);
          if (!m) throw new DslError(line, `at=${at}: expected x,y`);
          const v = { x: Number(m[1]), y: Number(m[2]) };
          d.positions = { logical: v, physical: v };
          T(h.id).place.delete(d.id);
        }
        const note = kv.get('note');
        if (note !== undefined) { if (note === '' || note === '-') delete d.note; else d.note = note; }
        for (const k of kv.keys()) if (!['terminals', 'at', 'note'].includes(k)) throw new DslError(line, `device: unknown key "${k}"`);
        if (args.length > 2) throw new DslError(line, `device: unexpected "${args[2].text}" — quote names with spaces`);
        break;
      }
      case 'wire': {
        const h = cur(line);
        if (args.length < 2) throw new DslError(line, 'wire: two ends needed — wire J1.1 J2.1 red awg22 len=1600');
        const A = endpoints(line, h, args[0].text);
        const B = endpoints(line, h, args[1].text);
        const n = Math.max(A.length, B.length);
        if (A.length !== B.length && A.length !== 1 && B.length !== 1) {
          throw new DslError(line, `wire: ${args[0].text} has ${A.length} pins but ${args[1].text} has ${B.length}`);
        }
        let color: WireColor | undefined;
        let gauge: Gauge | undefined;
        for (const t of args.slice(2)) {
          const c = parseColor(t.text);
          const g = parseGauge(t.text);
          if (c && !color) color = c;
          else if (g && !gauge) gauge = g;
          else throw new DslError(line, `wire: unknown word "${t.text}" (colors: ${[...COLOR_NAMES].slice(0, 6).join(' ')} …, gauge awg22/sq0.5, len=)`);
        }
        let colors: WireColor[] | undefined;
        const cl = kv.get('colors');
        if (cl !== undefined) {
          colors = cl.split(',').map((s) => {
            const c = parseColor(s);
            if (!c) throw new DslError(line, `colors: unknown color "${s}"`);
            return c;
          });
          if (colors.length !== n && colors.length !== 1) throw new DslError(line, `colors: ${colors.length} given for ${n} wires`);
        }
        const stripe = kv.get('stripe');
        if (stripe !== undefined && stripe !== '-' && !isColorWord(stripe)) throw new DslError(line, `stripe=${stripe}: unknown color`);
        const g2 = kv.get('gauge') ?? kv.get('awg');
        if (g2 !== undefined) {
          const g = parseGauge(kv.has('awg') ? `awg${g2}` : g2);
          if (!g) throw new DslError(line, `gauge=${g2}: expected awg22 or sq0.5`);
          gauge = g;
        }
        let len: number | undefined;
        const lv = kv.get('len') ?? kv.get('length');
        if (lv !== undefined) {
          const mm = parseLength(lv);
          if (mm == null) throw new DslError(line, `len=${lv}: expected mm (1600, 1.6m)`);
          len = mm;
        }
        const label = kv.get('label') ?? kv.get('signal');
        for (const k of kv.keys()) {
          if (!['colors', 'stripe', 'gauge', 'awg', 'len', 'length', 'label', 'signal'].includes(k)) throw new DslError(line, `wire: unknown key "${k}"`);
        }
        const def = defaults.get(h.id) ?? {};
        for (let i = 0; i < n; i++) {
          const a = A[A.length === 1 ? 0 : i];
          const b = B[B.length === 1 ? 0 : i];
          let col = colors ? colors[colors.length === 1 ? 0 : i] : color;
          if (col && stripe !== undefined) col = stripe === '-' ? { base: col.base } : { ...col, stripe };
          const ex = wireBetween(h, a, b);
          if (ex) {
            if (col) ex.color = col;
            else if (stripe !== undefined) ex.color = stripe === '-' ? { base: ex.color.base } : { ...ex.color, stripe };
            if (gauge) ex.gauge = gauge;
            if (len !== undefined) ex.lengthMm = len;
            if (label !== undefined) { if (label === '' || label === '-') delete ex.label; else ex.label = label; }
            bump('wire~');
          } else {
            if (!col) {
              const std = stdColorAt(h, a) ?? stdColorAt(h, b);
              if (!std) throw new DslError(line, `wire ${args[0].text} ${args[1].text}: color missing (e.g. red, red/white, colors=red,black,…)`);
              col = parseColor(std) ?? { base: std };
            }
            const w: Wire = {
              id: uid('w'), from: a, to: b, color: col,
              gauge: gauge ?? def.gauge ?? { system: 'awg', value: 22 },
            };
            const L = len ?? def.lengthMm;
            if (L !== undefined) w.lengthMm = L;
            if (label && label !== '-') w.label = label;
            h.wires.push(w);
            bump('wire+');
          }
          for (const e of [a, b]) if (e.type === 'pin') T(h.id).autoTerm.add(e.connectorId);
        }
        break;
      }
      case 'term': {
        const h = cur(line);
        if (args.length !== 2) throw new DslError(line, 'term: term J1 "SXH-001T-P0.6" (or term J1.1-3 <part>, term J1 -)');
        const { ref, sel } = splitEndpoint(args[0].text);
        const node = nodeByRef(h, ref);
        if (!node || node.kind !== 'conn') throw new DslError(line, `${ref} not found (have ${refList(h)})`);
        setTerminal(line, h, node.c, args[1].text, sel ? pinsOf(line, node.c, ref, sel) : undefined);
        bump('term~');
        break;
      }
      case 'layout': {
        const h = cur(line);
        T(h.id).relayout = true;
        bump('layout');
        break;
      }
      case 'del': {
        const what = (pos(0) ?? '').toLowerCase();
        if (what === 'harness') {
          const name = pos(1);
          if (!name) throw new DslError(line, 'del harness "name"');
          const h = findHarness(kit, name);
          if (!h) throw new DslError(line, `harness "${name}" not found`);
          if (kit.harnesses.length <= 1) throw new DslError(line, 'cannot delete the last harness');
          kit = withoutHarness(kit, h.id);
          touch.delete(h.id);
          if (curId === h.id) curId = kit.harnesses.length === 1 ? kit.harnesses[0].id : undefined;
          bump('harness-');
          break;
        }
        const h = cur(line);
        if (what === 'wire') {
          if (args.length < 2) throw new DslError(line, 'del wire J1.1 [J2.1]');
          const A = endpoints(line, h, args[1].text);
          const B = args[2] ? endpoints(line, h, args[2].text) : undefined;
          if (B && A.length !== B.length && A.length !== 1 && B.length !== 1) throw new DslError(line, 'del wire: pin counts differ');
          const before = h.wires.length;
          if (B) {
            const n = Math.max(A.length, B.length);
            for (let i = 0; i < n; i++) {
              const w = wireBetween(h, A[A.length === 1 ? 0 : i], B[B.length === 1 ? 0 : i]);
              if (w) h.wires = h.wires.filter((x) => x !== w);
            }
          } else {
            h.wires = h.wires.filter((w) => !A.some((a) => sameEp(w.from, a) || sameEp(w.to, a)));
          }
          const gone = before - h.wires.length;
          if (!gone) throw new DslError(line, 'del wire: no such wire');
          bump('wire-', gone);
          break;
        }
        if (['conn', 'splice', 'device'].includes(what)) {
          const ref = (pos(1) ?? '').toUpperCase();
          const node = nodeByRef(h, ref);
          if (!node) throw new DslError(line, `${ref || '?'} not found (have ${refList(h)})`);
          const id = node.kind === 'conn' ? node.c.id : node.d.id;
          const before = h.wires.length;
          // store/harnessStore.remove 와 같은 규칙 — 그 끝에 붙은 배선도 함께 지운다
          h.wires = h.wires.filter((w) => ![w.from, w.to].some((e) => (e.type === 'pin' ? e.connectorId : e.deviceId) === id));
          h.connectors = h.connectors.filter((c) => c.id !== id);
          h.devices = h.devices.filter((d) => d.id !== id);
          bump(node.kind === 'conn' ? (node.c.kind === 'splice' ? 'splice-' : 'conn-') : 'device-');
          bump('wire-', before - h.wires.length);
          const after = refLabels(h);
          if ([...after.values()].length) notes.push(`refs renumbered: ${[...after.values()].join(',')}`);
          break;
        }
        throw new DslError(line, `del: expected wire | conn | splice | device | harness, got "${pos(0) ?? ''}"`);
      }
      default:
        throw new DslError(line, `unknown command "${cmd.name}" (set harness note purchased conn splice device wire term layout del)`);
    }
  }

  // ── 마무리: 자동 단자 · 자동 배치 ─────────────────────────────────────
  const now = opts.now ?? new Date().toISOString();
  kit.harnesses = kit.harnesses.map((h) => {
    const t = touch.get(h.id);
    if (!t) return h;
    let out: HarnessDocument = h;
    for (const cid of t.autoTerm) {
      if (t.explicitTerm.has(cid)) continue;
      const c = out.connectors.find((x) => x.id === cid);
      if (!c) continue;
      const r = autoTerminals(out, c);
      if (r.count) {
        bump('term(auto)+', r.count);
        notes.push(`${out.letter ?? ''} ${refLabels(out).get(c.id)}: terminal ${r.part!.mpn ?? r.part!.name} ×${r.count} (auto, from part spec)`.trim());
      }
    }
    const ids = new Set([...out.connectors.map((c) => c.id), ...out.devices.map((d) => d.id)]);
    if (t.relayout) {
      out = autoLayout(out, { keepRotation: t.keepRot });
    } else {
      const place = new Set([...t.place].filter((id) => ids.has(id)));
      if (place.size) out = autoLayout(out, { place, keepRotation: t.keepRot });
    }
    return { ...out, updatedAt: now };
  });
  // 세트 문자(A·B…)가 비어 있으면 채운다 — 도면·발주 문구에서 '?' 로 새지 않게
  kit.harnesses = kit.harnesses.map((h, i) => (h.letter ? h : { ...h, letter: letterAt(i) }));
  if (touch.size || Object.keys(changes).length) kit.updatedAt = now;
  return { kit, changes, notes, touched: [...touch.keys()].filter((id) => kit.harnesses.some((h) => h.id === id)) };
}

function stdColorAt(h: HarnessDocument, e: Endpoint): string | undefined {
  if (e.type !== 'pin') return undefined;
  const c = h.connectors.find((x) => x.id === e.connectorId);
  const pin = c?.pins.find((p) => p.id === e.pinId);
  const part = h.usedParts.find((p) => p.id === c?.housingId);
  return pin ? suggestedColor(part, pin.index) : undefined;
}

// ================================================================
// 자동 단자 — 하우징 스펙이 적은 단자 중 이 배선 굵기에 맞는 것이 **하나뿐**일 때만
// ================================================================

function awgRange(p: PartLibraryItem): [number, number] | undefined {
  const text = Object.values(p.spec ?? {}).join(' ');
  const m = /AWG\s*#?\s*(\d+)\s*[~-]\s*#?\s*(\d+)/i.exec(text);
  if (!m) return undefined;
  const a = Number(m[1]), b = Number(m[2]);
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * 배선된 핀 중 단자가 비어 있는 핀에 단자를 채운다.
 *
 * 근거는 **하우징 부품의 스펙(`터미널`)에 적힌 품번**뿐이다. 그 품번이 라이브러리
 * 단자에 있고, 배선 게이지(AWG)가 그 단자의 적용전선 범위 안에 드는 후보가
 * 정확히 하나일 때만 지정한다. 둘 이상이거나 없으면 비워 둔다 — 검증이
 * `terminal-missing` 으로 알리고, 사람이 `term J1 <품번>` 으로 고른다.
 * 러그·스플라이스·납땜 끝단은 단자가 없으므로 건너뛴다(store/kit.statsOf 와 같은 판정).
 */
export function autoTerminals(h: HarnessDocument, c: Connector): { count: number; part?: PartLibraryItem } {
  if (c.kind === 'splice') return { count: 0 };
  const housing = h.usedParts.find((p) => p.id === c.housingId);
  if (!housing || isStandaloneLug(housing)) return { count: 0 };
  if (housing.endKind === 'free' || housing.endKind === 'barrel') return { count: 0 };
  if (/납땜/.test(housing.spec?.['결선방식'] ?? '')) return { count: 0 };
  const spec = housing.spec?.['터미널'];
  if (!spec) return { count: 0 };
  const tokens = spec.split(/[·,/—]|또는/)
    .map((s) => /^[A-Za-z0-9][A-Za-z0-9.\-]*/.exec(s.trim())?.[0])
    .filter((s): s is string => !!s && /\d/.test(s));
  const pool = [...h.usedParts, ...SEED_PARTS].filter((p) => p.category === 'terminal' && !isStandaloneLug(p));
  const cands: PartLibraryItem[] = [];
  for (const t of tokens) {
    const hit = pool.find((p) => (p.mpn ?? '').toLowerCase() === t.toLowerCase());
    if (hit && !cands.includes(hit)) cands.push(hit);
  }
  if (!cands.length) return { count: 0 };
  let count = 0;
  let used: PartLibraryItem | undefined;
  for (const p of c.pins) {
    if (p.terminalId) continue;
    const ws = h.wires.filter((w) => [w.from, w.to].some((e) => e.type === 'pin' && e.connectorId === c.id && e.pinId === p.id));
    if (!ws.length) continue;
    const fits = cands.filter((t) => {
      const r = awgRange(t);
      if (!r) return true;
      return ws.every((w) => w.gauge.system !== 'awg' || (w.gauge.value >= r[0] && w.gauge.value <= r[1]));
    });
    if (fits.length !== 1) continue;
    p.terminalId = fits[0].id;
    if (!h.usedParts.some((x) => x.id === fits[0].id)) h.usedParts.push(fits[0]);
    used = fits[0];
    count++;
  }
  return { count, part: used };
}

/** 바뀐 것 한 줄 — `+1 harness +2 conn +10 wire +20 term(auto)` */
export function changesLine(ch: Record<string, number>): string {
  const order = ['harness', 'conn', 'splice', 'device', 'wire', 'term', 'term(auto)', 'set', 'layout'];
  const parts: string[] = [];
  const keys = Object.keys(ch).sort((a, b) => {
    const base = (k: string) => k.replace(/[+~-]$/, '');
    return order.indexOf(base(a)) - order.indexOf(base(b));
  });
  for (const k of keys) {
    const m = /^(.*?)([+~-])$/.exec(k);
    if (m) parts.push(`${m[2]}${ch[k]} ${m[1]}`);
    else parts.push(`${ch[k]} ${k}`);
  }
  return parts.length ? parts.join(' ') : 'no changes';
}
