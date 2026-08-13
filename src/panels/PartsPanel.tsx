/**
 * 파트 탭 — Claude Design 2차 §9 "발주로 나가는 마지막 화면".
 *
 * 문서 하나에 하네스가 여러 종 들어가고, 발주 단위는 그 하네스들을 묶은 **세트**다.
 * 그래서 이 탭은 두 가지 모드를 가진다.
 *
 *  (1) 파트 단위   — 부품을 직접 사서 압착할 때. 품목별 수량.
 *                   집계 범위(하네스 하나 / 세트 전체)를 셀렉트로 고르고,
 *                   상태바가 언제나 그 범위를 밝힌다. 범위 없는 숫자는 두지 않는다.
 *  (2) 하네스 단위 — 완성 하네스를 살 때. 발주 단위는 하네스가 아니라 세트다.
 *                   세트 구성 · 발주 문구 · 제작 사양서.
 *
 * 규칙:
 *  - **총수량은 저장하지 않는다.** 언제나 `perSet × orderQty` 로 파생한다(store/kit.ts).
 *  - 집계는 기존 `buildPartList()` 를 그대로 쓴다. 여기서 새로 세지 않는다.
 *    범위가 세트면 하네스별 결과에 `perSet × orderQty` 를 곱해 합칠 뿐이다.
 *  - 색은 tokens.css 변수만. 하드코딩 hex 는 전선 색(데이터에서 온다)뿐이다.
 *  - UI 강조는 스틸(--accent) 하나. 빨강은 전선 색이라 경고에도 쓰지 않는다.
 */
import { useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { HarnessDocument, Id, KitDocument } from '../types';
import {
  blockersOf, harnessOf, orderText, perSetOf, statsOf, totalHarnesses, totalOf,
} from '../store/kit';
import type { PartRow } from '../export/exporters';
import { buildPartList, buildRunList, describeEndpoint, toCsv } from '../export/exporters';
import { lengthResolver } from '../store/wireLength';
import { colorAbbr, refLabels, strokeColor } from '../canvas/docToFlow';
import './parts.css';

// ================================================================
// 집계 범위
// ================================================================

export type PartsScope = { kind: 'harness'; harnessId: string } | { kind: 'set' };

// ================================================================
// 표시용 소도구
// ================================================================

/** 자릿수 구분 — toLocaleString 은 환경마다 갈리므로 직접 찍는다 */
function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 규격 12색의 한글 이름. 색값이 아니라 "이름"이라 토큰 규칙과 무관하다. */
const KO_COLOR: Record<string, string> = {
  red: '적', black: '흑', white: '백', green: '녹', blue: '청', yellow: '황',
  orange: '등', brown: '갈', gray: '회', pink: '분', violet: '자', clear: '투',
};

function koColor(v: string): string {
  return KO_COLOR[v.trim().toLowerCase()] ?? v.trim();
}

/** 전선 색 스와치 — 캔버스와 같은 보정(strokeColor)을 써서 도면과 색이 어긋나지 않게 */
function wireSwatch(base: string, stripe?: string): CSSProperties {
  const b = strokeColor(base);
  if (!stripe) return { background: b };
  return { background: `repeating-linear-gradient(45deg, ${strokeColor(stripe)} 0 2px, ${b} 2px 5px)` };
}

/** 와이어 표시 번호 W1, W2 … (도면·접속표와 같은 순서) */
function wireLabels(doc: HarnessDocument): Map<Id, string> {
  return new Map(doc.wires.map((w, i) => [w.id, `W${i + 1}`]));
}

function saveCsv(name: string, text: string) {
  // jsdom 에는 createObjectURL 이 없다 — 있을 때만 내려받는다
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function copyText(text: string) {
  // jsdom 에 clipboard 가 없으므로 optional chaining 으로 둔다
  void navigator.clipboard?.writeText(text);
}

// ================================================================
// 그룹 — 5개. 헤더 우측에 집계 규칙을 적는다.
// 규칙이 보이면 숫자를 의심하지 않고, 틀렸을 때 어디를 고칠지도 안다.
// ================================================================

type GroupKey = 'housing' | 'terminal' | 'wire' | 'protect' | 'device';

const GROUPS: { key: GroupKey; label: string; rule: string }[] = [
  { key: 'housing', label: '하우징 · 커넥터', rule: '커넥터 인스턴스 수 기준' },
  { key: 'terminal', label: '터미널 · 압착', rule: '배선된 핀 수 기준' },
  { key: 'wire', label: '전선', rule: '색 · 게이지별 길이 합' },
  { key: 'protect', label: '보호재 · 부자재', rule: '케이블 자켓 기준' },
  { key: 'device', label: '장치 · 발주 제외', rule: '참고 — 발주 대상 아님' },
];

/** buildPartList 의 category → 그룹 */
const GROUP_OF: Record<string, GroupKey> = {
  '커넥터': 'housing',
  '터미널': 'terminal',
  '와이어': 'wire',
  '케이블': 'protect',
};

type AggRow = {
  key: string;
  group: GroupKey;
  name: string;
  sub: string;
  qty: number;
  unit: string;
  wire?: { base: string; stripe?: string };
  dim?: boolean;
};

/** 집계에 들어가는 하네스 하나 — mult 는 `perSet × orderQty`(하네스 범위면 1) */
type ScopePart = { doc: HarnessDocument; letter: string; mult: number };

/**
 * 사용처(J1 · W1 W2) — 화면 표시용 라벨일 뿐 수량과 무관하다.
 * 키는 buildPartList 와 같은 방식으로 만든다.
 */
function usageOf(doc: HarnessDocument): Map<string, string[]> {
  const refs = refLabels(doc);
  const wl = wireLabels(doc);
  const out = new Map<string, string[]>();
  const push = (k: string, v: string) => {
    const a = out.get(k) ?? [];
    if (v && !a.includes(v)) a.push(v);
    out.set(k, a);
  };
  for (const c of doc.connectors) {
    const name = doc.usedParts.find((p) => p.id === c.housingId)?.name ?? c.housingId;
    push(`housing|${name}`, refs.get(c.id) ?? '');
  }
  for (const w of doc.wires) {
    const color = w.color.stripe ? `${w.color.base}/${w.color.stripe}` : w.color.base;
    push(`wire|${w.gauge.system.toUpperCase()}${w.gauge.value} · ${color}`, wl.get(w.id) ?? '');
  }
  return out;
}

/** `총 1680mm` 에서 길이만 꺼낸다 — 길이 합산의 출처는 buildPartList 하나뿐이다 */
function lenOfDetail(detail?: string): number {
  const m = /(\d+)\s*mm/.exec(detail ?? '');
  return m ? Number(m[1]) : 0;
}

/** 전선 행 이름: `적/백 R/W · AWG22` */
function wireRowName(part: string): { name: string; color?: { base: string; stripe?: string } } {
  const [gauge, colorStr] = part.split(' · ');
  if (!colorStr) return { name: part };
  const [base, stripe] = colorStr.split('/');
  const ko = stripe ? `${koColor(base)}/${koColor(stripe)}` : koColor(base);
  return {
    name: `${ko} ${colorAbbr(base, stripe)} · ${gauge}`,
    color: { base, stripe },
  };
}

/**
 * 범위 안의 하네스들을 합산한다.
 * 수량은 전부 buildPartList 가 센 값이고, 여기서는 `× mult` 후 같은 품목끼리 더할 뿐이다.
 */
function aggregate(parts: ScopePart[], withLetter: boolean): AggRow[] {
  type Acc = { row: AggRow; count: number; len: number; refs: string[] };
  const map = new Map<string, Acc>();

  const take = (key: string, seed: () => AggRow): Acc => {
    let a = map.get(key);
    if (!a) {
      a = { row: seed(), count: 0, len: 0, refs: [] };
      map.set(key, a);
    }
    return a;
  };

  for (const { doc, letter, mult } of parts) {
    const usage = usageOf(doc);
    const refs = refLabels(doc);

    for (const r of buildPartList(doc)) {
      const group = GROUP_OF[r.category] ?? 'protect';
      const key = `${group}|${r.part}`;
      const w = group === 'wire' ? wireRowName(r.part) : null;
      const acc = take(key, () => ({
        key,
        group,
        name: w ? w.name : r.part,
        sub: '',
        qty: 0,
        unit: 'ea',
        wire: w?.color,
      }));
      acc.count += r.qty * mult;
      acc.len += lenOfDetail(r.detail) * mult;
      for (const u of usage.get(key) ?? []) acc.refs.push(withLetter ? `${letter} ${u}` : u);
      // 하우징의 detail 은 결합 성별(암/수/보드)이다 — 발주 화면에서 보여야 한다
      if (group === 'housing' && r.detail) acc.refs.push(r.detail);
      if (group === 'terminal' && r.detail) acc.refs.push(r.detail);
      if (group === 'protect' && r.detail) acc.refs.push(withLetter ? `${letter} ${r.detail}` : r.detail);
    }

    // 장치는 발주 대상이 아니라 buildPartList 에 없다. 참고용으로만 세운다.
    for (const d of doc.devices) {
      const key = `device|${d.name}`;
      const acc = take(key, () => ({
        key, group: 'device', name: d.name, sub: '', qty: 0, unit: 'ea', dim: true,
      }));
      acc.count += mult;
      acc.refs.push(
        `${withLetter ? `${letter} ` : ''}${refs.get(d.id) ?? 'D?'} · 단자 ${d.terminals?.length ?? 0}`,
      );
    }
  }

  const out: AggRow[] = [];
  for (const { row, count, len, refs } of map.values()) {
    // 전선은 길이 합이 발주 단위다. 길이가 하나도 없으면 본수로 떨어뜨린다.
    if (row.group === 'wire' && len > 0) {
      row.qty = len;
      row.unit = 'mm';
      refs.push(`${fmt(count)}본`);
    } else if (row.group === 'wire') {
      row.qty = count;
      row.unit = '본';
    } else {
      row.qty = count;
      row.unit = 'ea';
      if (len > 0) refs.push(`${fmt(len)}mm`);
    }
    const uniq = refs.filter((v, i) => v && refs.indexOf(v) === i);
    row.sub = uniq.slice(0, 8).join(' ') + (uniq.length > 8 ? ' …' : '');
    out.push(row);
  }
  const order = GROUPS.map((g) => g.key);
  out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return out;
}

// ================================================================
// 제작 사양서 (위탁 시 첨부) — 하네스 1종당 1장
// ================================================================

type SpecRow = { ref: string; text: string; qty: string; dim?: boolean };
type SpecGroup = { label: string; summary: string; rows: SpecRow[] };

function specGroupsOf(doc: HarnessDocument): SpecGroup[] {
  const refs = refLabels(doc);
  const wl = wireLabels(doc);
  const st = statsOf(doc);
  const parts = buildPartList(doc);
  const terms = parts.filter((p) => p.category === '터미널');
  const termPins = terms.reduce((n, p) => n + p.qty, 0);
  const conns = doc.connectors.filter((c) => c.kind !== 'splice');
  const splices = doc.connectors.filter((c) => c.kind === 'splice');

  const ends: SpecRow[] = [
    ...conns.map((c) => {
      const h = doc.usedParts.find((p) => p.id === c.housingId);
      return {
        ref: refs.get(c.id) ?? '',
        text: `${h?.name ?? c.housingId}${h?.mpn ? ` · ${h.mpn}` : ''}`,
        qty: `${c.pins.length}핀`,
      };
    }),
    ...splices.map((c) => ({
      ref: refs.get(c.id) ?? '',
      text: `${doc.usedParts.find((p) => p.id === c.housingId)?.name ?? '스플라이스'} — 꼬임 접속`,
      qty: `${c.pins.length}가닥`,
    })),
    ...doc.devices.map((d) => ({
      ref: refs.get(d.id) ?? '',
      text: `${d.name} 단자 (탈장착)`,
      qty: `${d.terminals?.length ?? 0}단자`,
      dim: true,
    })),
  ];

  // 길이는 공용 해석기로만 읽는다 — 케이블 심선은 케이블 길이를 따른다
  const lengthOf = lengthResolver(doc);
  const dims: SpecRow[] = [
    {
      ref: '',
      // 합계가 몇 본치인지 밝힌다 — 미입력분을 0 으로 더한 합은 짧아 보인다
      text: st.missingLength > 0
        ? `전선 총장 (길이를 아는 ${st.countedLength}본 합)`
        : '전선 총장 (도면 길이 합)',
      qty: `${fmt(st.wireLengthMm)}mm`,
    },
    ...doc.wires.map((w) => {
      const len = lengthOf(w);
      return {
        ref: wl.get(w.id) ?? '',
        text: `${describeEndpoint(doc, w.from)} → ${describeEndpoint(doc, w.to)}`
          + (len.source === 'cable' ? ' · 케이블 길이' : ''),
        qty: len.mm != null ? `${fmt(len.mm)}mm` : '미입력',
        dim: len.mm == null,
      };
    }),
  ];

  const work: SpecRow[] = [
    {
      ref: '01',
      text: `압착 규격 — ${terms.length ? terms.map((t) => t.part).join(' · ') : '터미널 미지정'}`,
      qty: `${termPins}개소`,
      dim: !terms.length,
    },
    {
      ref: '02',
      text: '스플라이스 꼬임 접속 + 열수축 튜브 마감',
      qty: splices.length ? `${splices.length}개소` : '해당 없음',
      dim: !splices.length,
    },
    {
      ref: '03',
      text: '슬리브 · 테이프 보호 구간',
      qty: '물리 뷰 구간 확정 후',
      dim: true,
    },
    { ref: '04', text: '양 끝단 열수축 라벨 — 도번 · Rev 표기', qty: `${conns.length}개소` },
    { ref: '05', text: '도통 · 오결선 검사 전수', qty: '100%' },
  ];

  const attach: SpecRow[] = [
    { ref: '', text: '도면 PDF (논리 · 물리 2매)', qty: '포함' },
    { ref: '', text: `접속표 CSV (${buildRunList(doc).length}본)`, qty: '포함' },
    { ref: '', text: `파트리스트 CSV (${parts.length}품목)`, qty: '포함' },
  ];

  return [
    { label: '끝단 구성', summary: `커넥터 ${conns.length} · 장치 ${doc.devices.length}`, rows: ends },
    { label: '치수', summary: '도면 길이 그대로 · 여유율 없음', rows: dims },
    { label: '작업 지시', summary: '위탁 기준', rows: work },
    { label: '첨부', summary: '발주서 동봉', rows: attach },
  ];
}

// ================================================================
// 패널
// ================================================================

export function PartsPanel(props: {
  kit: KitDocument;
  activeHarnessId: string;
  scope: PartsScope;
  onChangeScope: (s: PartsScope) => void;
  onGoToBlocker: (harnessId: string, targetId?: string) => void;
  onChangeOrderQty: (qty: number) => void;
  onChangePerSet: (harnessId: string, perSet: number) => void;
  onOpenHarness: (harnessId: string) => void;
}): JSX.Element {
  const {
    kit, activeHarnessId, scope, onChangeScope, onGoToBlocker,
    onChangeOrderQty, onChangePerSet, onOpenHarness,
  } = props;

  const [unit, setUnit] = useState<'part' | 'harness'>('part');
  const [orderOnly, setOrderOnly] = useState(true);
  const [openId, setOpenId] = useState<Id | null>(null);
  const [specId, setSpecId] = useState<Id | null>(null);

  const set = kit.set;
  const scoped = scope.kind === 'harness'
    ? harnessOf(kit, scope.harnessId) ?? kit.harnesses[0]
    : undefined;

  // --- 집계 범위에 들어가는 하네스들 --------------------------------
  const scopeParts: ScopePart[] = useMemo(() => {
    if (scope.kind === 'set') {
      return kit.harnesses
        .map((h) => ({
          doc: h,
          letter: h.letter ?? '?',
          mult: perSetOf(set, h.id) * set.orderQty,
        }))
        .filter((p) => p.mult > 0);
    }
    const h = harnessOf(kit, scope.harnessId) ?? kit.harnesses[0];
    return h ? [{ doc: h, letter: h.letter ?? '?', mult: 1 }] : [];
  }, [kit, set, scope]);

  const rows = useMemo(
    () => aggregate(scopeParts, scope.kind === 'set'),
    [scopeParts, scope.kind],
  );
  const visible = orderOnly ? rows.filter((r) => r.group !== 'device') : rows;

  // --- 범위 표기 — 어떤 숫자든 범위 없이 두지 않는다 ------------------
  const setLetters = kit.harnesses
    .filter((h) => perSetOf(set, h.id) > 0)
    .map((h) => h.letter ?? '?');
  const scopeLabel = scope.kind === 'set'
    ? `세트 전체 (${setLetters.join('+') || '구성 없음'})`
    : `하네스 ${scoped?.letter ?? '?'}`;
  const basisLabel = scope.kind === 'set' ? `${set.orderQty}세트 기준` : '1개 기준';
  const wireMm = rows.filter((r) => r.unit === 'mm' && r.group === 'wire')
    .reduce((n, r) => n + r.qty, 0);

  const blockers = useMemo(() => {
    const all = blockersOf(kit);
    return scope.kind === 'set' ? all : all.filter((b) => b.harnessId === scoped?.id);
  }, [kit, scope.kind, scoped?.id]);

  // --- 내보내기 -----------------------------------------------------
  const csvRows: PartRow[] = visible.map((r) => ({
    category: GROUPS.find((g) => g.key === r.group)?.label ?? '',
    part: r.name,
    qty: r.qty,
    detail: [r.unit, r.sub].filter(Boolean).join(' · '),
  }));
  const partCsv = toCsv(csvRows);

  const setCsv = toCsv(
    kit.harnesses.map((h) => ({
      category: `하네스 ${h.letter ?? '?'}`,
      part: `${h.drawingNo ?? '품번 미지정'} ${h.name}`,
      qty: totalOf(set, h.id),
      detail: `세트당 ${perSetOf(set, h.id)}개 × ${set.orderQty}세트`,
    })),
  );

  const scopeValue = scope.kind === 'set'
    ? 'set'
    : `h:${scoped?.id ?? scope.harnessId}`;

  const perSetSum = set.items.reduce((n, i) => n + i.perSet, 0);
  const specDoc = specId ? harnessOf(kit, specId) : undefined;

  function toggleOpen(id: Id) {
    setOpenId((v) => (v === id ? null : id));
  }
  function rowKey(e: KeyboardEvent<HTMLDivElement>, id: Id) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleOpen(id);
    }
  }

  return (
    <div className="pt">
      {/* ── 상단: 발주 단위 세그먼트 + 범위 + 내보내기 ─────────────── */}
      <div className="pt-head">
        <div className="pt-seg" role="group" aria-label="발주 단위">
          <button
            type="button"
            className={unit === 'part' ? 'on' : ''}
            aria-pressed={unit === 'part'}
            onClick={() => setUnit('part')}
          >
            파트 단위
          </button>
          <button
            type="button"
            className={unit === 'harness' ? 'on' : ''}
            aria-pressed={unit === 'harness'}
            onClick={() => setUnit('harness')}
          >
            하네스 단위
          </button>
        </div>

        {unit === 'part' ? (
          <>
            <div className="pt-field">
              <span className="pt-flabel">집계 범위</span>
              <select
                className="pt-scope"
                aria-label="집계 범위"
                value={scopeValue}
                onChange={(e) => {
                  const v = e.target.value;
                  onChangeScope(v === 'set' ? { kind: 'set' } : { kind: 'harness', harnessId: v.slice(2) });
                }}
              >
                {kit.harnesses.map((h) => (
                  <option key={h.id} value={`h:${h.id}`}>
                    하네스 {h.letter ?? '?'} · {h.drawingNo ?? h.name}
                  </option>
                ))}
                <option value="set">
                  세트 전체 ({setLetters.join('+') || '구성 없음'}) × {set.orderQty}세트
                </option>
              </select>
            </div>

            <div className="pt-field">
              <div className="pt-seg sm" role="group" aria-label="집계 대상">
                <button
                  type="button"
                  className={orderOnly ? 'on' : ''}
                  aria-pressed={orderOnly}
                  onClick={() => setOrderOnly(true)}
                >
                  발주 대상
                </button>
                <button
                  type="button"
                  className={!orderOnly ? 'on' : ''}
                  aria-pressed={!orderOnly}
                  onClick={() => setOrderOnly(false)}
                >
                  전체
                </button>
              </div>
              <span className="pt-grow" />
              <button
                type="button"
                className="pt-mini"
                onClick={() => saveCsv(`${kit.name || 'kit'}-파트리스트.csv`, partCsv)}
              >
                CSV
              </button>
              <button type="button" className="pt-mini" onClick={() => copyText(partCsv)}>복사</button>
            </div>

            {scope.kind === 'harness' && scoped && scoped.id !== activeHarnessId && (
              <p className="pt-note">
                도면은 다른 하네스를 열고 있습니다 — 이 목록은 하네스 {scoped.letter ?? '?'} 기준입니다
              </p>
            )}
          </>
        ) : (
          <div className="pt-field">
            <span className="pt-flabel wide">
              세트 단위 발주 · 하네스 {kit.harnesses.length}종
            </span>
            <span className="pt-grow" />
            <button
              type="button"
              className="pt-mini"
              onClick={() => saveCsv(`${kit.name || 'kit'}-세트구성.csv`, setCsv)}
            >
              CSV
            </button>
            <button type="button" className="pt-mini" onClick={() => copyText(setCsv)}>복사</button>
          </div>
        )}
      </div>

      {/* ── 파트 단위 ───────────────────────────────────────────── */}
      {unit === 'part' && (
        <>
          {blockers.length > 0 && (
            <div className="pt-blockers" aria-label="발주를 막는 항목">
              {blockers.map((b, i) => (
                <button
                  type="button"
                  className="pt-blocker"
                  key={`${b.harnessId}-${i}`}
                  onClick={() => onGoToBlocker(b.harnessId, b.targetId)}
                >
                  <span className="pt-blocker-text">{b.label}</span>
                  <span className="pt-blocker-where num">{b.where}</span>
                  <span className="pt-chev">›</span>
                </button>
              ))}
            </div>
          )}

          <div className="pt-list">
            {GROUPS.map((g) => {
              if (g.key === 'device' && orderOnly) return null;
              const gr = visible.filter((r) => r.group === g.key);
              return (
                <div className="pt-group" key={g.key}>
                  <div className="pt-group-head">
                    <span className="pt-group-label">{g.label}</span>
                    <span className="pt-grow" />
                    <span className="pt-group-rule">{g.rule}</span>
                  </div>
                  {gr.length === 0 && (
                    <div className="pt-row empty">
                      <span className="pt-row-main">
                        <span className="pt-row-name">집계된 항목 없음</span>
                        <span className="pt-row-sub">{scopeLabel} 기준</span>
                      </span>
                    </div>
                  )}
                  {gr.map((r) => (
                    <div className={`pt-row${r.dim ? ' dim' : ''}`} key={r.key}>
                      <span
                        className={`pt-sw${r.wire ? ' wire' : ''}`}
                        style={r.wire ? wireSwatch(r.wire.base, r.wire.stripe) : undefined}
                        aria-hidden
                      />
                      <span className="pt-row-main">
                        <span className="pt-row-name">{r.name}</span>
                        <span className="pt-row-sub">{r.sub}</span>
                      </span>
                      <span className="pt-row-qty">
                        <span className="pt-qty num">{fmt(r.qty)}</span>
                        <span className="pt-unit num">{r.unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="pt-status num" role="status">
            <span>
              {scopeLabel} · 품목 {fmt(visible.length)} · 전선 {fmt(wireMm)}mm
            </span>
            <span className="pt-grow" />
            <span className="pt-basis">{basisLabel}</span>
          </div>
        </>
      )}

      {/* ── 하네스 단위 ─────────────────────────────────────────── */}
      {unit === 'harness' && (
        <>
          <div className="pt-setcard">
            <div className="pt-setcard-head">
              <span className="pt-badge">SET</span>
              <span className="pt-set-name">{set.name}</span>
              <span className="pt-grow" />
              <span className="pt-pn num">{set.pn || '품번 미지정'}</span>
            </div>
            <div className="pt-setcard-row">
              <span className="pt-set-k">주문</span>
              <span className="pt-step">
                <button
                  type="button"
                  aria-label="주문 세트 수 감소"
                  onClick={() => onChangeOrderQty(Math.max(1, set.orderQty - 1))}
                >
                  −
                </button>
                <input
                  className="num"
                  aria-label="주문 세트 수"
                  inputMode="numeric"
                  value={String(set.orderQty)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ''));
                    onChangeOrderQty(Math.min(999, Math.max(1, n || 1)));
                  }}
                />
                <button
                  type="button"
                  aria-label="주문 세트 수 증가"
                  onClick={() => onChangeOrderQty(Math.min(999, set.orderQty + 1))}
                >
                  +
                </button>
              </span>
              <span className="pt-set-k">세트</span>
              <span className="pt-grow" />
              <span className="pt-set-total">
                하네스 <b className="num">{totalHarnesses(set)}</b>개
              </span>
            </div>
          </div>

          <div className="pt-list">
            <div className="pt-group-head">
              <span className="pt-group-label">세트 구성</span>
              <span className="pt-grow" />
              <span className="pt-group-rule">세트당 × 주문 세트 수</span>
            </div>

            {kit.harnesses.map((h) => {
              const per = perSetOf(set, h.id);
              const total = totalOf(set, h.id);
              const st = statsOf(h);
              const open = openId === h.id;
              return (
                <div className={`pt-item${open ? ' open' : ''}`} key={h.id}>
                  <div
                    className={`pt-item-head${h.id === activeHarnessId ? ' cur' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleOpen(h.id)}
                    onKeyDown={(e) => rowKey(e, h.id)}
                  >
                    <span className="pt-letter num">{h.letter ?? '?'}</span>
                    <span className="pt-item-main">
                      <span className="pt-item-name">{h.name}</span>
                      <span className="pt-item-sub num">
                        {h.drawingNo ?? '품번 미지정'} · {st.ends}
                      </span>
                    </span>
                    <span className="pt-item-qty">
                      <span className="pt-qty num">{fmt(total)}개</span>
                      <span className="pt-per num">세트당 ×{per}</span>
                    </span>
                    <span className="pt-caret">{open ? '▾' : '▸'}</span>
                  </div>

                  {open && (
                    <div className="pt-item-detail">
                      <div className="pt-kv">
                        {/* 길이 합은 전장(끝단↔끝단)이 아니다 — 이름을 사실대로 쓴다 */}
                        <span className="pt-k">전선 총장</span>
                        <span className="pt-v num">
                          {fmt(st.wireLengthMm)}mm — 전선 길이 합
                          {st.missingLength > 0 ? ` (${st.countedLength}본 기준)` : ' (도면 그대로)'}
                        </span>
                      </div>
                      <div className="pt-kv">
                        <span className="pt-k">전선</span>
                        <span className="pt-v num">
                          {st.wireCount}본
                          {st.missingLength > 0 ? ` · 길이 미입력 ${st.missingLength}본` : ''}
                        </span>
                      </div>
                      <div className="pt-kv">
                        <span className="pt-k">끝단</span>
                        <span className="pt-v">{st.ends}</span>
                      </div>
                      <div className="pt-kv">
                        <span className="pt-k">세트당</span>
                        <span className="pt-v">
                          <span className="pt-step sm">
                            <button
                              type="button"
                              aria-label={`하네스 ${h.letter ?? '?'} 세트당 수량 감소`}
                              onClick={() => onChangePerSet(h.id, Math.max(0, per - 1))}
                            >
                              −
                            </button>
                            <span className="pt-step-val num">{per}</span>
                            <button
                              type="button"
                              aria-label={`하네스 ${h.letter ?? '?'} 세트당 수량 증가`}
                              onClick={() => onChangePerSet(h.id, per + 1)}
                            >
                              +
                            </button>
                          </span>
                          <span className="num">
                            개 × {set.orderQty}세트 = <b>{fmt(total)}</b>개
                          </span>
                        </span>
                      </div>
                      <div className="pt-item-btns">
                        <button type="button" className="pt-mini" onClick={() => onOpenHarness(h.id)}>
                          도면 열기
                        </button>
                        <button
                          type="button"
                          className="pt-mini"
                          onClick={() => setSpecId((v) => (v === h.id ? null : h.id))}
                        >
                          제작 사양서
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="pt-group-head">
              <span className="pt-group-label">발주 문구</span>
              <span className="pt-grow" />
              <span className="pt-group-rule">그대로 붙여 넣으면 된다</span>
            </div>
            <div className="pt-ordertext-wrap">
              <div className="pt-ordertext">{orderText(kit)}</div>
              <button
                type="button"
                className="pt-primary"
                onClick={() => copyText(orderText(kit))}
              >
                발주 문구 복사
              </button>
            </div>

            {specDoc && (
              <>
                <div className="pt-group-head">
                  <span className="pt-group-label">제작 사양서</span>
                  <span className="pt-grow" />
                  <button type="button" className="pt-linkbtn" onClick={() => setSpecId(null)}>닫기</button>
                </div>
                <div className="pt-spec">
                  <div className="pt-spec-head">
                    <span className="pt-badge">ASSY</span>
                    <span className="pt-pn num strong">{specDoc.drawingNo ?? '품번 미지정'}</span>
                    <span className="pt-spec-name">{specDoc.name}</span>
                    <span className="pt-grow" />
                    <span className="pt-pn num">{specDoc.rev ? `Rev.${specDoc.rev}` : 'Rev —'}</span>
                  </div>
                  {specGroupsOf(specDoc).map((g) => (
                    <div key={g.label}>
                      <div className="pt-group-head">
                        <span className="pt-group-label">{g.label}</span>
                        <span className="pt-grow" />
                        <span className="pt-group-rule">{g.summary}</span>
                      </div>
                      {g.rows.map((r, i) => (
                        <div className={`pt-spec-row${r.dim ? ' dim' : ''}`} key={`${g.label}-${i}`}>
                          <span className="pt-spec-ref num">{r.ref}</span>
                          <span className="pt-spec-text">{r.text}</span>
                          <span className="pt-spec-qty num">{r.qty}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="pt-status num" role="status">
            <span>
              하네스 {kit.harnesses.length}종 · 세트당 {perSetSum}개 · 총 {totalHarnesses(set)}개
            </span>
            <span className="pt-grow" />
            <span className="pt-basis">{set.orderQty}세트 · 도면 PDF 동봉</span>
          </div>
        </>
      )}
    </div>
  );
}
