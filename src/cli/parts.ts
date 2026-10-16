/**
 * CLI 부품 찾기 — `harness lib` 검색과 DSL `conn J1 "JST-XH 10P"` 의 이름 풀이.
 *
 * 부품 데이터는 라이브러리(SEED_PARTS)와 문서 스냅샷(usedParts — 사용자 부품 포함)
 * 둘에서 온다. 판정(놓을 수 있는가 · 러그인가)은 taxonomy 의 함수를 그대로 쓴다.
 */
import type { PartLibraryItem } from '../types';
import { SEED_PARTS } from '../library/seed';
import { displayName, isCanvasPlaceable, searchTagsOf } from '../library/taxonomy';

export type PartFilter = 'placeable' | 'terminal' | 'any';

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.()·/,]+/g, '');
const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** 옛 항목(신규 설계는 다른 id 를 쓰라고 적힌 것) — 후보가 겹칠 때 뒤로 민다 */
export function isLegacyPart(p: PartLibraryItem): boolean {
  return !!p.spec?.['대체'] || /\(구 항목\)/.test(p.name);
}

/** 짧은 이름 — 도면이 쓰는 이름. 없으면 목록 표시명 */
export function shortOf(p: PartLibraryItem): string {
  return p.shortName ?? displayName(p);
}

function pool(extra: PartLibraryItem[] = []): PartLibraryItem[] {
  const seen = new Set<string>();
  const out: PartLibraryItem[] = [];
  for (const p of [...extra, ...SEED_PARTS]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function passes(p: PartLibraryItem, f: PartFilter): boolean {
  if (f === 'placeable') return isCanvasPlaceable(p);
  if (f === 'terminal') return p.category === 'terminal';
  return true;
}

function haystack(p: PartLibraryItem): string {
  return norm([p.id, p.name, p.shortName ?? '', p.mpn ?? '', p.manufacturer ?? '', ...searchTagsOf(p)].join(' '));
}

/**
 * 한 줄 요약: id · 짧은이름 · 핀수 · 성별 · 끝단종류.
 * `full` 이면 짧은이름 대신 이름 — 같은 짧은이름이 여럿일 때(솔더컵/압착 D-SUB 등) 구분용.
 */
export function partLine(p: PartLibraryItem, full = false): string {
  const pins = p.pinCount != null ? `${p.pinCount}P` : '-';
  return [p.id, full ? p.name : shortOf(p), pins, p.gender ?? '-', p.endKind ?? '-'].join(' · ');
}

/** 목록 안에서 짧은이름이 겹치는 것은 이름으로 적는다 */
export function partLines(ps: PartLibraryItem[]): string[] {
  const n = new Map<string, number>();
  for (const p of ps) n.set(shortOf(p), (n.get(shortOf(p)) ?? 0) + 1);
  return ps.map((p) => partLine(p, (n.get(shortOf(p)) ?? 0) > 1));
}

export class PartLookupError extends Error {
  candidates: PartLibraryItem[];
  constructor(msg: string, candidates: PartLibraryItem[]) {
    super(msg);
    this.candidates = candidates;
  }
}

/**
 * 이름 풀이. 단계마다 좁히고, 한 단계에서 여럿이 걸리면 옛 항목을 빼 본 뒤에도
 * 여럿이면 **모호하다고 멈춘다**(후보 5개를 한 줄로). 추측해서 고르지 않는다.
 *   1) id 일치  2) 짧은이름·이름·MPN 완전 일치  3) 기호 무시 일치  4) 낱말 전부 포함
 */
export function resolvePart(q: string, filter: PartFilter = 'placeable', extra: PartLibraryItem[] = []): PartLibraryItem {
  const all = pool(extra).filter((p) => passes(p, filter));
  const query = q.trim();
  if (!query) throw new PartLookupError('part name is empty', []);
  const byId = all.find((p) => p.id === query);
  if (byId) return byId;

  const lq = lower(query);
  const nq = norm(query);
  const tokens = query.split(/\s+/).map(norm).filter(Boolean);
  const stages: ((p: PartLibraryItem) => boolean)[] = [
    (p) => [p.shortName, p.name, p.mpn, displayName(p)].some((v) => v != null && lower(v) === lq),
    (p) => [p.shortName, p.name, p.mpn, displayName(p)].some((v) => v != null && norm(v) === nq),
    (p) => { const h = haystack(p); return tokens.every((t) => h.includes(t)); },
  ];
  for (const st of stages) {
    let hit = all.filter(st);
    if (hit.length > 1) {
      const modern = hit.filter((p) => !isLegacyPart(p));
      if (modern.length >= 1) hit = modern;
    }
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) {
      throw new PartLookupError(
        `ambiguous part "${query}" (${hit.length}): ${hit.slice(0, 5).map((p) => `${p.id} (${shortOf(p)})`).join(', ')}${hit.length > 5 ? ', …' : ''}`,
        hit,
      );
    }
  }
  const kind = filter === 'terminal' ? 'terminal' : 'part';
  throw new PartLookupError(`no ${kind} matches "${query}" — try: harness lib ${query.split(/\s+/)[0]}`, []);
}

/** 라이브러리 검색 — 낱말 전부 포함. 완전 일치·짧은이름 일치를 앞에 세운다. */
export function searchLib(query = '', extra: PartLibraryItem[] = []): PartLibraryItem[] {
  const all = pool(extra);
  const tokens = query.split(/\s+/).map(norm).filter(Boolean);
  if (!tokens.length) return all;
  const nq = norm(query);
  const hits = all.filter((p) => { const h = haystack(p); return tokens.every((t) => h.includes(t)); });
  const score = (p: PartLibraryItem) => {
    if (p.id === query.trim()) return 0;
    if ([p.shortName, p.name, p.mpn].some((v) => v != null && norm(v) === nq)) return 1;
    if (norm(shortOf(p)).includes(nq)) return 2;
    return 3;
  };
  return hits
    .map((p, i) => ({ p, i, s: score(p) + (isLegacyPart(p) ? 0.5 : 0) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}
