/**
 * Node 에서 한글 PDF 를 그리기 위한 캔버스 연결.
 *
 * PDF 의 한글은 jsPDF 기본 글꼴에 없어서 `export/pdf.ts rasterText` 가
 * `document.createElement('canvas')` 로 글자를 그림으로 만들어 붙인다. Node 에는
 * document 가 없으므로, `@napi-rs/canvas`(네이티브 · 의존성 없음)가 있으면 그것으로
 * `document.createElement('canvas')` 하나만 흉내 낸다. 도면 코드는 손대지 않는다.
 *
 * 찾는 순서: $HARNESS_CANVAS(패키지 폴더나 node_modules 폴더) → 현재 폴더 →
 * 이 번들 옆 → $NODE_PATH → 전역(npm root -g). 없으면 false — 부르는 쪽이
 * 경고 한 줄을 내고 PDF 는 그대로 만든다(한글 자리만 비거나 깨진다).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

type NapiCanvas = {
  createCanvas(w: number, h: number): unknown;
  GlobalFonts?: { loadSystemFonts?: () => void; families?: unknown[] };
};

let state: 'unknown' | 'ok' | 'missing' = 'unknown';
let how = '';

function tryFrom(base: string): NapiCanvas | null {
  try {
    const req = createRequire(base.endsWith('/') || base.endsWith('.json') || base.endsWith('.mjs') || base.endsWith('.js') || base.endsWith('.ts') ? base : `${base}/`);
    return req('@napi-rs/canvas') as NapiCanvas;
  } catch {
    return null;
  }
}

function candidates(): string[] {
  const out: string[] = [];
  const env = process.env.HARNESS_CANVAS;
  if (env) {
    // 패키지 폴더 자체를 가리켜도, 그 위 node_modules 를 가리켜도 받는다
    out.push(join(env, 'package.json'), join(env, '..', 'x.js'), join(env, 'x.js'));
  }
  out.push(join(process.cwd(), 'x.js'));
  try { out.push(import.meta.url); } catch { /* CJS 로 묶였을 때 */ }
  for (const p of (process.env.NODE_PATH ?? '').split(/[:;]/).filter(Boolean)) out.push(join(p, '..', 'x.js'));
  return out;
}

/** 한글 래스터가 가능한가. 처음 한 번만 찾는다. */
export function ensureKoreanCanvas(): { ok: boolean; how: string } {
  if (state !== 'unknown') return { ok: state === 'ok', how };
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    state = 'ok';
    how = 'dom';
    return { ok: true, how };
  }
  let mod: NapiCanvas | null = null;
  for (const c of candidates()) {
    mod = tryFrom(c);
    if (mod) { how = c; break; }
  }
  if (!mod) {
    try {
      const root = execSync('npm root -g', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (root) { mod = tryFrom(join(root, 'x.js')); if (mod) how = root; }
    } catch { /* npm 이 없어도 된다 */ }
  }
  if (!mod) {
    state = 'missing';
    return { ok: false, how: '' };
  }
  try { mod.GlobalFonts?.loadSystemFonts?.(); } catch { /* 시스템 글꼴 없이도 기본 글꼴로 그린다 */ }
  const m = mod;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`harness cli: document.createElement('${tag}') is not available`);
      return m.createCanvas(1, 1);
    },
  };
  state = 'ok';
  return { ok: true, how };
}

export const CANVAS_HINT =
  'warning: Korean text needs @napi-rs/canvas — install: npm i -g @napi-rs/canvas (or npm i @napi-rs/canvas here, or set HARNESS_CANVAS=<path>); PDF written without Korean glyphs';
