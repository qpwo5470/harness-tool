/**
 * 설계 검증 규칙 — 도면 단계에서 잡을 수 있는 실수를 전부 잡는다.
 *
 * 하네스는 잘못 만들면 **현장에서 다시 만들어야 하는** 물건이다. 압착이 끝난 뒤에는
 * 핀 하나를 못 바꾼다. 그래서 발주 버튼을 누르기 전에 문서만 보고 판정할 수 있는 것은
 * 여기서 전부 판정한다.
 *
 * 규칙 세 가지:
 *
 * 1) **순수 함수다.** 스토어·DOM·시간·난수에 손대지 않는다. 문서를 넣으면 언제나 같은
 *    이슈 목록이 나온다. 그래야 테스트가 되고, PDF·발주 화면 어디서 불러도 같은 답이 나온다.
 * 2) **같은 판정을 두 번 만들지 않는다.** "터미널 미지정 몇 핀 / 길이 미입력 몇 본"의
 *    기준은 `statsOf()` 하나뿐이다. 여기서는 그 숫자를 다시 세지 않고, statsOf 가 문제가
 *    있다고 한 경우에만 **어디인지 짚어준다**. 두 곳에서 따로 세면 언젠가 화면끼리 숫자가
 *    갈리고, 그 순간부터 아무도 경고를 믿지 않는다.
 * 3) **detail 에는 "왜 문제인지"를 쓴다.** "규칙 위반"이라고만 적힌 경고는 무시된다.
 *
 * 레벨 기준:
 *  - error  물리적으로 만들 수 없거나, 발주 수량·문서가 틀어지는 것 → 발주를 막는다
 *  - warn   만들 수는 있으나 사람이 의도를 확인해야 하는 것
 *  - info   틀리지 않았지만 알고 있어야 하는 것
 *
 * 성능: 배선 200본 규모에서 전수 비교(O(n²))가 없도록 전부 Map/Set 색인으로 돈다.
 */
import type {
  Connector, Endpoint, Gauge, HarnessDocument, Id, PartLibraryItem, Pin, PinSlot, Wire,
} from '../types';
import { statsOf } from './kit';
import { computeNets, endpointKey } from './netlist';
import { describeEndpoint } from '../export/exporters';
// 도면 레퍼런스(J1 · SP1 · D1)는 캔버스와 같은 규칙을 써야 한다.
// 여기서 따로 매기면 패널이 가리키는 J2 와 도면의 J2 가 달라진다.
import { refLabels } from '../canvas/docToFlow';

export type IssueLevel = 'error' | 'warn' | 'info';

export type Issue = {
  /** 규칙 id (예: 'pin-overflow'). 같은 규칙의 이슈는 id 를 공유한다. */
  id: string;
  level: IssueLevel;
  /** 한 줄 요약 — 목록에 뜬다 */
  title: string;
  /** 왜 문제인지 / 어떻게 고치는지. 한 문장. */
  detail: string;
  /** 클릭 시 선택할 대상 (커넥터·와이어·장치 id) */
  targetId?: string;
  /** 어디서 났는지 사람이 읽는 위치 (예: 'J1 MDB VMC #3') */
  where: string;
};

/** 목록 정렬 순서 — 패널도 이 순서로 묶는다 */
export const LEVEL_ORDER: IssueLevel[] = ['error', 'warn', 'info'];

// ================================================================
// 소도구
// ================================================================

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** 게이지 표기 — 속성 패널과 같은 형식 */
function gaugeLabel(g: Gauge): string {
  return g.system === 'awg' ? `AWG${g.value}` : `${g.value}mm²`;
}

function colorLabel(c: { base: string; stripe?: string }): string {
  return c.stripe ? `${c.base}/${c.stripe}` : c.base;
}

/** 색 이름 비교용 정규화 — 'White/Orange ' 와 'white/orange' 는 같은 색이다 */
function normColor(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 같은 단위 안에서 "가장 얇은" 게이지.
 * AWG 는 숫자가 클수록 얇고, mm² 는 작을수록 얇다. 단위가 섞이면 판단하지 않는다
 * (환산은 속성 패널의 몫이고, 여기서 어림 환산을 하면 경고가 거짓말을 한다).
 */
function thinnest(gs: Gauge[]): Gauge | undefined {
  const sys = gs[0]?.system;
  if (!sys || gs.some((g) => g.system !== sys)) return undefined;
  return gs.reduce((a, b) => {
    if (sys === 'awg') return b.value > a.value ? b : a;
    return b.value < a.value ? b : a;
  });
}

// ================================================================
// 검증
// ================================================================

export function validateHarness(doc: HarnessDocument): Issue[] {
  const out: Issue[] = [];

  // ---- 색인 ------------------------------------------------------
  const partById = new Map<Id, PartLibraryItem>(doc.usedParts.map((p) => [p.id, p]));
  const connById = new Map<Id, Connector>(doc.connectors.map((c) => [c.id, c]));
  const refs = refLabels(doc);
  const wireNo = new Map<Id, string>(doc.wires.map((w, i) => [w.id, `W${i + 1}`]));
  const wireById = new Map<Id, Wire>(doc.wires.map((w) => [w.id, w]));

  /** `${connectorId}:${pinId}` → Pin */
  const pinOf = new Map<string, Pin>();
  for (const c of doc.connectors) for (const p of c.pins) pinOf.set(`${c.id}:${p.id}`, p);

  /** `${housingId}:${index}` → PinSlot (규격 색·신호명) */
  const slotOf = new Map<string, PinSlot>();
  for (const part of doc.usedParts) {
    for (const s of part.pinLayout ?? []) slotOf.set(`${part.id}:${s.index}`, s);
  }

  /** `${connectorId}:${pinId}` → 그 핀에 붙은 와이어들 */
  const wiresAtPin = new Map<string, Wire[]>();
  /** 배선이 하나라도 붙은 커넥터·장치 id */
  const wired = new Set<Id>();
  /** 커넥터별로 붙은 가닥 수 (스플라이스 결선 수 판정용) */
  const strandsAt = new Map<Id, number>();

  for (const w of doc.wires) {
    for (const e of [w.from, w.to]) {
      if (e.type === 'pin') {
        push(wiresAtPin, `${e.connectorId}:${e.pinId}`, w);
        wired.add(e.connectorId);
        strandsAt.set(e.connectorId, (strandsAt.get(e.connectorId) ?? 0) + 1);
      } else {
        wired.add(e.deviceId);
      }
    }
  }

  // ---- 위치 문구 -------------------------------------------------
  const housingName = (c: Connector) => partById.get(c.housingId)?.name ?? c.housingId;
  const whereConn = (c: Connector) => `${refs.get(c.id) ?? '?'} ${housingName(c)}`;
  const whereEnd = (e: Endpoint) => {
    const ref = refs.get(e.type === 'pin' ? e.connectorId : e.deviceId) ?? '?';
    return `${ref} ${describeEndpoint(doc, e)}`;
  };
  const shortEnd = (e: Endpoint) => {
    if (e.type === 'device') {
      return `${refs.get(e.deviceId) ?? 'D?'}${e.terminal ? `.${e.terminal}` : ''}`;
    }
    const p = pinOf.get(`${e.connectorId}:${e.pinId}`);
    return `${refs.get(e.connectorId) ?? 'J?'}#${p?.label ?? p?.index ?? '?'}`;
  };
  const whereWire = (w: Wire) =>
    `${wireNo.get(w.id) ?? 'W?'} ${shortEnd(w.from)}→${shortEnd(w.to)}`;

  // ================================================================
  // 11. 하우징 스냅샷 없음 — 먼저 본다. 하우징을 모르면 핀 범위도 규격 색도 못 따진다.
  // ================================================================
  for (const c of doc.connectors) {
    if (partById.has(c.housingId)) continue;
    out.push({
      id: 'housing-missing',
      level: 'error',
      title: `하우징 스냅샷 없음 — ${c.housingId}`,
      detail: '문서에 부품 정보가 같이 저장되지 않아, 다른 사람이 이 파일을 열면 핀 수·규격·품번이 비어 도면이 재현되지 않는다.',
      targetId: c.id,
      where: `${refs.get(c.id) ?? '?'} ${c.kind}`,
    });
  }

  // ================================================================
  // 1. 핀 수 초과 — 하우징에 없는 자리에 배선했다
  // ================================================================
  for (const c of doc.connectors) {
    const housing = partById.get(c.housingId);
    if (!housing) continue;                     // 위에서 이미 error 로 잡았다
    const layout = housing.pinLayout;
    const max = housing.pinCount ?? layout?.length;
    if (layout == null && max == null) continue; // 핀 수를 모르는 부품은 판정하지 않는다

    const valid = layout
      ? new Set(layout.map((s) => s.index))
      : new Set(Array.from({ length: max ?? 0 }, (_, i) => i + 1));

    const over = c.pins.filter(
      (p) => wiresAtPin.has(`${c.id}:${p.id}`) && !valid.has(p.index),
    );
    if (over.length === 0) continue;

    out.push({
      id: 'pin-overflow',
      level: 'error',
      title: `핀 수 초과 — ${over.map((p) => `#${p.label ?? p.index}`).join(' ')}`,
      detail: `${housing.name} 은 ${max ?? valid.size}핀이라 그 자리가 물리적으로 없다 — 배선을 하우징 안의 핀으로 옮기거나 핀 수가 더 많은 하우징으로 바꿔야 한다.`,
      targetId: c.id,
      where: whereConn(c),
    });
  }

  // ================================================================
  // 2. 한 핀에 여러 배선 — 의도적일 수 있으므로 warn
  //    스플라이스는 원래 여러 가닥이 모이는 자리라 제외한다(규칙 6이 따로 본다).
  // ================================================================
  for (const c of doc.connectors) {
    if (c.kind === 'splice') continue;
    for (const p of c.pins) {
      const ws = wiresAtPin.get(`${c.id}:${p.id}`);
      if (!ws || ws.length < 2) continue;
      out.push({
        id: 'pin-multi-wire',
        level: 'warn',
        title: `한 핀에 ${ws.length}가닥 — #${p.label ?? p.index}`,
        detail: `핀 하나에는 보통 단자 하나만 압착한다 — ${ws.length}가닥을 겹압착할 생각이 아니라면 스플라이스로 모으거나 다른 핀으로 나눠야 한다.`,
        targetId: c.id,
        where: whereConn(c),
      });
    }
  }

  // ================================================================
  // 3. 터미널 미지정 (statsOf 가 센 값을 그대로 쓴다 — 여기서 다시 세지 않는다)
  // ================================================================
  const stats = statsOf(doc);
  if (stats.missingTerminal > 0) {
    for (const c of doc.connectors) {
      if (c.kind === 'splice') continue;         // 꼬임 접속은 단자가 없다
      const bare = c.pins.filter(
        (p) => wiresAtPin.has(`${c.id}:${p.id}`) && !p.terminalId,
      );
      if (bare.length === 0) continue;
      out.push({
        id: 'terminal-missing',
        level: 'error',
        title: `터미널 미지정 ${bare.length}핀 — ${bare.map((p) => `#${p.label ?? p.index}`).join(' ')}`,
        detail: '압착 단자는 하우징과 따로 사는 부품이라, 지정하지 않으면 파트리스트에서 빠지고 현장에 하우징만 도착한다.',
        targetId: c.id,
        where: whereConn(c),
      });
    }
  }

  // ================================================================
  // 4. 길이 미입력
  //    케이블에 속한 심선은 케이블 길이를 따르므로(types.ts) 만들 수는 있다 → info.
  //    총 건수는 statsOf().missingLength 와 언제나 같다.
  // ================================================================
  if (stats.missingLength > 0) {
    const cableById = new Map((doc.cables ?? []).map((c) => [c.id, c]));
    for (const w of doc.wires) {
      if (w.lengthMm != null) continue;
      const cable = w.cableId ? cableById.get(w.cableId) : undefined;
      if (cable?.lengthMm != null) {
        out.push({
          id: 'length-missing',
          level: 'info',
          title: '길이 미입력 — 케이블 길이를 따름',
          detail: `${cable.name ?? '케이블'} 의 ${cable.lengthMm}mm 로 재단되므로 개별 입력은 필요 없다 — 다른 길이로 잘라야 한다면 이 심선에 길이를 직접 넣어야 한다.`,
          targetId: w.id,
          where: whereWire(w),
        });
        continue;
      }
      out.push({
        id: 'length-missing',
        level: 'error',
        title: '길이 미입력',
        detail: '길이가 없으면 전선을 재단할 수도, 견적을 낼 수도 없다 — 도면의 길이가 그대로 발주 수량이 된다.',
        targetId: w.id,
        where: whereWire(w),
      });
    }
  }

  // ================================================================
  // 5. 떠 있는 커넥터 / 장치
  //    커넥터는 배선 없이도 파트리스트에 실려 발주된다 → warn.
  //    장치는 발주 대상이 아니라 참고 블록이다 → info.
  // ================================================================
  for (const c of doc.connectors) {
    if (wired.has(c.id)) continue;
    out.push({
      id: 'floating',
      level: 'warn',
      title: `배선 없음 — ${housingName(c)}`,
      detail: '배선이 하나도 붙지 않았는데 파트리스트에는 수량으로 잡힌다 — 쓰지 않을 커넥터라면 지우고, 쓸 것이라면 배선을 이어야 한다.',
      targetId: c.id,
      where: whereConn(c),
    });
  }
  for (const d of doc.devices) {
    if (wired.has(d.id)) continue;
    out.push({
      id: 'floating',
      level: 'info',
      title: `배선 없음 — ${d.name}`,
      detail: '어떤 배선도 이 장치에 닿지 않아 도면에서 아무 역할을 하지 않는다 — 참고 표기가 아니라면 연결하거나 지우는 편이 낫다.',
      targetId: d.id,
      where: `${refs.get(d.id) ?? 'D?'} ${d.name}`,
    });
  }

  // ================================================================
  // 6. 스플라이스 결선 부족 — 3가닥부터 "모으는" 의미가 생긴다
  // ================================================================
  for (const c of doc.connectors) {
    if (c.kind !== 'splice') continue;
    const n = strandsAt.get(c.id) ?? 0;
    if (n === 0 || n >= 3) continue;             // 0가닥은 위의 '배선 없음'이 잡는다
    out.push({
      id: 'splice-underused',
      level: n === 1 ? 'warn' : 'info',
      title: `스플라이스 ${n}가닥`,
      detail: n === 1
        ? '한 가닥만 물린 스플라이스는 끝이 열려 있다 — 나머지 가닥을 잇거나 스플라이스를 지워야 한다.'
        : '두 가닥이면 갈래가 없는 단순 연장이라, 스플라이스 대신 전선을 통으로 뽑거나 중간결선 커넥터를 쓰는 편이 접점이 하나 줄어 안전하다.',
      targetId: c.id,
      where: whereConn(c),
    });
  }

  // ================================================================
  // 7. 규격 색 불일치 — RJ45 T568B 처럼 색이 곧 규격인 커넥터에서 중요하다
  // ================================================================
  for (const w of doc.wires) {
    const actual = normColor(colorLabel(w.color));
    for (const e of [w.from, w.to]) {
      if (e.type !== 'pin') continue;
      const c = connById.get(e.connectorId);
      if (!c) continue;
      const p = pinOf.get(`${c.id}:${e.pinId}`);
      if (!p) continue;
      const slot = slotOf.get(`${c.housingId}:${p.index}`);
      const std = slot?.stdColor;
      if (!std || normColor(std) === actual) continue;
      out.push({
        id: 'std-color-mismatch',
        level: 'warn',
        title: `규격 색 불일치 — ${colorLabel(w.color)} (규격 ${std})`,
        detail: `${slot?.signal ? `${slot.signal} 은 ` : ''}규격상 ${std} 이다 — 색이 다르면 나중에 이 하네스를 고치는 사람이 도면 없이 핀을 짚을 수 없고, 규격품과 섞였을 때 오결선이 난다.`,
        targetId: w.id,
        where: whereEnd(e),
      });
    }
  }

  // ================================================================
  // 8. 자기 자신에 연결 — 같은 커넥터의 핀끼리. 스플라이스는 정상이라 제외.
  //    루프백·점퍼로 일부러 하는 경우가 있어 error 가 아니라 warn 이다.
  // ================================================================
  for (const w of doc.wires) {
    if (w.from.type !== 'pin' || w.to.type !== 'pin') continue;
    if (w.from.connectorId !== w.to.connectorId) continue;
    if (connById.get(w.from.connectorId)?.kind === 'splice') continue;
    out.push({
      id: 'self-loop',
      level: 'warn',
      title: '같은 커넥터의 핀끼리 연결',
      detail: '한 커넥터 안에서 되돌아오는 배선은 루프백·점퍼가 아니라면 대개 반대편 커넥터를 잘못 고른 것이다 — 의도한 점퍼라면 그대로 두면 된다.',
      targetId: w.id,
      where: whereWire(w),
    });
  }

  // ================================================================
  // 9. 중복 배선 — 완전히 같은 두 끝점
  // ================================================================
  const byPair = new Map<string, Wire[]>();
  for (const w of doc.wires) {
    const [a, b] = [endpointKey(w.from), endpointKey(w.to)].sort();
    push(byPair, `${a}|${b}`, w);
  }
  for (const ws of byPair.values()) {
    if (ws.length < 2) continue;
    const dup = ws.slice(1);
    out.push({
      id: 'duplicate-wire',
      level: 'error',
      title: `중복 배선 ${ws.length}본 — ${ws.map((w) => wireNo.get(w.id)).join(' ')}`,
      detail: '같은 두 끝점을 잇는 배선이 여러 개면 파트리스트의 전선 길이와 압착 개소가 그만큼 부풀고, 현장에서는 한 핀에 몇 가닥을 넣어야 하는지 알 수 없다.',
      targetId: dup[0].id,
      where: whereWire(ws[0]),
    });
  }

  // ================================================================
  // 10. 게이지 불일치 — 같은 네트인데 굵기가 다르다
  // ================================================================
  for (const net of computeNets(doc)) {
    const gs = net.wireIds
      .map((id) => wireById.get(id)?.gauge)
      .filter((g): g is Gauge => g != null);
    const uniq = [...new Map(gs.map((g) => [gaugeLabel(g), g])).values()];
    if (uniq.length < 2) continue;
    const thin = thinnest(uniq);
    out.push({
      id: 'gauge-mismatch',
      level: 'warn',
      title: `네트 ${net.code} 게이지 혼재 — ${uniq.map(gaugeLabel).join(' · ')}`,
      detail: thin
        ? `전기적으로 한 줄인데 굵기가 다르면 허용 전류는 가장 얇은 ${gaugeLabel(thin)} 에 맞춰 잡히고, 굵은 쪽만 보고 정격을 판단하면 얇은 구간이 먼저 탄다.`
        : '한 네트 안에 AWG 와 mm² 가 섞여 있어 어느 쪽이 얇은지 도면만으로는 알 수 없다 — 단위를 하나로 통일해야 한다.',
      targetId: net.wireIds[0],
      where: `${net.code} ${net.label}`,
    });
  }

  return sortIssues(out);
}

/** error → warn → info. 같은 레벨 안에서는 문서 순서를 유지한다(안정 정렬). */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );
}
