/**
 * 속성 패널 — Claude Design 2차 리디자인 §7 "속성 탭" 재구현.
 *
 * 네 가지 상태를 모두 담는다.
 *  (A) 와이어   — 요약 카드 / 규격 12색 칩 + 직접 입력 / 게이지·길이 / 케이블 소속
 *  (B) 커넥터   — 요약 / 방향 하우징 심볼 4카드 / 메모 / 핀 패드 격자 + 일괄 터미널 지정
 *  (B-2) 스플라이스 — 터미널 영역을 "압착단자가 필요 없습니다" 안내로 대체
 *  (C) 장치     — 이름 / 단자 행 목록(배선된 단자는 삭제 불가)
 *  (D) 미선택   — 도면 드로잉 + 문서 요약
 *  (E) 다중 선택 — §11. 공통 속성만 편집. 단일 전용 항목은 감춘다.
 *
 * 규칙:
 *  - 색은 tokens.css 의 CSS 변수만 쓴다. 하드코딩 hex 는 "전선 색" 팔레트뿐이다.
 *  - UI 강조는 스틸(--accent) 하나. 빨강은 전선 색이므로 삭제 버튼(--danger)에만 쓴다.
 *  - 스토어 API 는 기존 시그니처를 그대로 쓴다.
 */
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useHarnessStore } from '../store/harnessStore';
import { useSelectionStore } from '../store/selectionStore';
import { showToast, undoSteps } from '../ui/Toast';
import type {
  Cable,
  Connector,
  Device,
  Endpoint,
  HarnessDocument,
  Orientation,
  PartLibraryItem,
  Wire,
} from '../types';
import { SEED_PARTS } from '../library/seed';
import { loadCustomParts } from '../library/customParts';
import { GENDER_LABEL, GENDER_LONG } from '../library/gender';
import { refLabels, colorAbbr, strokeColor } from '../canvas/docToFlow';
// 핀 격자 해석은 캔버스와 같은 출처를 쓴다 (기하는 geometry.ts 한 곳)
import { PAD, layoutCells } from '../canvas/geometry';
import { computeNets } from '../store/netlist';
import { lengthResolver, tallyLengths } from '../store/wireLength';
import './property.css';

// ============================================================
// 규격 전선색 12 — 캔버스·속성탭·핀맵이 같은 표를 쓴다.
// 여기 hex 는 "실제 전선 색"이라 토큰 규칙의 유일한 예외다.
// ============================================================
type ColorSpec = { key: string; code: string; ko: string; css: string; light?: boolean };

const STD_COLORS: ColorSpec[] = [
  { key: 'red', code: 'R', ko: '적', css: '#cc1f1f' },
  { key: 'black', code: 'B', ko: '흑', css: '#1d1f20' },
  { key: 'white', code: 'W', ko: '백', css: '#ffffff', light: true },
  { key: 'green', code: 'G', ko: '녹', css: '#1e7a34' },
  { key: 'blue', code: 'L', ko: '청', css: '#1f3fcc' },
  { key: 'yellow', code: 'Y', ko: '황', css: '#e8c32b', light: true },
  { key: 'orange', code: 'O', ko: '등', css: '#e08a2b', light: true },
  { key: 'brown', code: 'Br', ko: '갈', css: '#7a4a1e' },
  { key: 'gray', code: 'Gy', ko: '회', css: '#8c8c90' },
  { key: 'pink', code: 'Pk', ko: '분', css: '#e2a0b4', light: true },
  { key: 'violet', code: 'V', ko: '자', css: '#7b5ea7' },
  { key: 'clear', code: 'Cl', ko: '투', css: '#f5f5f8', light: true },
];

const JACKET_KEYS = ['black', 'gray', 'white', 'orange'];

function findColor(v?: string): ColorSpec | undefined {
  const k = (v ?? '').trim().toLowerCase();
  if (!k) return undefined;
  return STD_COLORS.find((c) => c.key === k);
}

/** 전선 색 스와치 배경 (2톤은 45° 줄무늬) */
function swatchStyle(base: string, stripe?: string): CSSProperties {
  const b = findColor(base)?.css ?? strokeColor(base);
  if (!stripe) return { background: b };
  const s = findColor(stripe)?.css ?? strokeColor(stripe);
  return { background: `repeating-linear-gradient(45deg, ${s} 0 2px, ${b} 2px 5px)` };
}

// ── 게이지 환산 (현장에서 쓰는 공칭 단면적) ──────────────────
const AWG_TABLE: [awg: number, mm2: number][] = [
  [10, 5.5], [12, 3.5], [14, 2.0], [16, 1.25], [18, 0.75],
  [20, 0.5], [22, 0.34], [24, 0.2], [26, 0.14], [28, 0.08], [30, 0.05],
];

function awgToMm2(v: number): number | undefined {
  return AWG_TABLE.find(([a]) => a === v)?.[1];
}
function mm2ToAwg(v: number): number {
  let best = AWG_TABLE[0];
  let d = Infinity;
  for (const p of AWG_TABLE) {
    const dd = Math.abs(p[1] - v);
    if (dd < d) { d = dd; best = p; }
  }
  return best[0];
}

// ============================================================
// 공통 조각
// ============================================================
function Section({
  label, note, action, children, grow,
}: {
  label: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <section className={grow ? 'pp-sec grow' : 'pp-sec'}>
      <div className="pp-sec-head">
        <span className="pp-sec-label">{label}</span>
        {note ? <span className="pp-sec-note">{note}</span> : null}
        <span className="pp-rule" />
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pp-field">
      <span className="pp-flabel">{label}</span>
      {children}
    </div>
  );
}

/**
 * 규격 색 칩. 단일 편집(A)과 다중 편집(E)이 같은 칩을 쓴다 —
 * 두 화면에서 색을 고르는 손동작이 달라지면 안 된다.
 */
function colorChip(c: ColorSpec, on: boolean, onPick: () => void, kind: string) {
  return (
    <button
      key={`${kind}-${c.key}`}
      type="button"
      className={`pp-chip${on ? ' on' : ''}${c.light ? ' light' : ''}`}
      style={{ background: c.css }}
      aria-pressed={on}
      aria-label={`${kind} ${c.ko}(${c.key})`}
      title={`${c.ko} · ${c.key}`}
      onClick={onPick}
    >
      <span className="num">{c.code}</span>
    </button>
  );
}

/** 끝점 한 줄 표기 — `J1 MDB VMC #1` */
function endpointParts(
  doc: HarnessDocument,
  refs: Map<string, string>,
  ep: Endpoint,
): { ref: string; name: string; pin: string } {
  if (ep.type === 'device') {
    const d = doc.devices.find((x) => x.id === ep.deviceId);
    return {
      ref: refs.get(ep.deviceId) ?? 'D?',
      name: d?.name ?? ep.deviceId,
      pin: ep.terminal ? `#${ep.terminal}` : '',
    };
  }
  const c = doc.connectors.find((x) => x.id === ep.connectorId);
  const pin = c?.pins.find((p) => p.id === ep.pinId);
  const housing = doc.usedParts.find((p) => p.id === c?.housingId);
  return {
    ref: refs.get(ep.connectorId) ?? 'J?',
    name: housing?.name ?? c?.kind ?? ep.connectorId,
    pin: `#${pin?.label ?? pin?.index ?? '?'}`,
  };
}

function EndpointSpan({ p }: { p: { ref: string; name: string; pin: string } }) {
  return (
    <span className="pp-ep">
      <b className="num">{p.ref}</b>
      <span className="pp-ep-name">{p.name}</span>
      {p.pin ? <b className="num pp-ep-pin">{p.pin}</b> : null}
    </span>
  );
}

/** 문서 내 와이어 번호 (W1, W2 …) */
function wireCodes(doc: HarnessDocument): Map<string, string> {
  return new Map(doc.wires.map((w, i) => [w.id, `W${i + 1}`]));
}

/**
 * 하우징 pinLayout 으로 열/행 수를 구한다 (없으면 한 줄, 최대 8열).
 *
 * 격자 해석은 캔버스와 **같은 함수**(geometry.layoutCells)로 한다 — 여기서
 * 따로 `s.offset.x` 를 읽던 시절에는 좌표가 없는 슬롯 하나에 속성 패널이 통째로
 * 터졌다. 8열로 접는 규칙만 이 패널 고유의 표시 규칙이라 남긴다.
 */
function gridOf(housing: PartLibraryItem | undefined, pinCount: number) {
  const layout = layoutCells(housing?.pinLayout);
  if (layout) {
    const cols = Math.max(...layout.map((s) => s.offset.x)) + 1;
    const rows = Math.max(...layout.map((s) => s.offset.y)) + 1;
    return { cols: Math.max(1, cols), rows: Math.max(1, rows), layout };
  }
  const cols = Math.max(1, Math.min(pinCount, 8));
  return { cols, rows: Math.ceil(pinCount / cols), layout: undefined };
}

// ============================================================
// (A) 와이어
// ============================================================
function WireEditor({ doc, wire }: { doc: HarnessDocument; wire: Wire }) {
  const updateWire = useHarnessStore((s) => s.updateWire);
  const addCable = useHarnessStore((s) => s.addCable);
  const updateCable = useHarnessStore((s) => s.updateCable);

  const refs = useMemo(() => refLabels(doc), [doc]);
  const codes = useMemo(() => wireCodes(doc), [doc]);
  const netCode = useMemo(() => {
    const n = computeNets(doc).find((x) => x.wireIds.includes(wire.id));
    return n?.code ?? '—';
  }, [doc, wire.id]);

  const base = wire.color.base;
  const stripe = wire.color.stripe;
  const abbr = colorAbbr(base, stripe);
  const cable = wire.cableId ? doc.cables?.find((c) => c.id === wire.cableId) : undefined;

  const setColor = (patch: { base?: string; stripe?: string | undefined }) =>
    updateWire(wire.id, { color: { base: patch.base ?? base, stripe: 'stripe' in patch ? patch.stripe : stripe } });

  const gaugeAlt =
    wire.gauge.system === 'awg'
      ? (awgToMm2(wire.gauge.value) != null ? `≈ ${awgToMm2(wire.gauge.value)} mm²` : '')
      : `≈ AWG ${mm2ToAwg(wire.gauge.value)}`;

  const switchSystem = (sys: 'awg' | 'mm2') => {
    if (sys === wire.gauge.system) return;
    const v =
      sys === 'mm2'
        ? (awgToMm2(wire.gauge.value) ?? 0.34)
        : mm2ToAwg(wire.gauge.value);
    updateWire(wire.id, { gauge: { system: sys, value: v } });
  };

  const cores = doc.wires.filter((w) => cable && w.cableId === cable.id);

  const chip = colorChip;

  return (
    <>
      <div className="pp-card">
        <div className="pp-card-top">
          <span className="pp-badge num">WIRE</span>
          <span className="pp-ref num">{codes.get(wire.id) ?? 'W?'}</span>
          <span className="pp-net num">NET {netCode}</span>
          <span className="pp-spacer" />
          <i className="pp-swatch-lg" style={swatchStyle(base, stripe)} aria-hidden />
          <span className="num pp-abbr">{abbr}</span>
        </div>
        <div className="pp-card-sub">
          <EndpointSpan p={endpointParts(doc, refs, wire.from)} />
          <span className="pp-arrow">→</span>
          <EndpointSpan p={endpointParts(doc, refs, wire.to)} />
        </div>
      </div>

      <Section label="색">
        <Field label="기본">
          <div className="pp-chips">
            {STD_COLORS.map((c) => chip(c, c.key === base.trim().toLowerCase(), () => setColor({ base: c.key }), '기본색'))}
          </div>
        </Field>
        <Field label="줄무늬">
          <div className="pp-chips">
            <button
              type="button"
              className={`pp-chip none${!stripe ? ' on' : ''}`}
              aria-pressed={!stripe}
              onClick={() => setColor({ stripe: undefined })}
            >
              없음
            </button>
            {STD_COLORS.map((c) =>
              chip(c, c.key === (stripe ?? '').trim().toLowerCase(), () => setColor({ stripe: c.key }), '줄무늬색'),
            )}
          </div>
        </Field>
        <Field label="직접">
          <input
            className="pp-input num"
            aria-label="기본색 직접 입력"
            value={base}
            onChange={(e) => setColor({ base: e.target.value })}
          />
          <span className="pp-slash">/</span>
          <input
            className="pp-input num"
            aria-label="줄무늬색 직접 입력"
            placeholder="없음"
            value={stripe ?? ''}
            onChange={(e) => setColor({ stripe: e.target.value || undefined })}
          />
        </Field>
        <p className="pp-hint indent">
          규격 외 색은 직접 입력합니다. 도면 약호는 <b className="num">{abbr}</b>로 나갑니다.
        </p>
      </Section>

      <Section label="규격">
        <Field label="게이지">
          <div className="pp-seg">
            <button
              type="button"
              className={wire.gauge.system === 'awg' ? 'on' : ''}
              aria-pressed={wire.gauge.system === 'awg'}
              onClick={() => switchSystem('awg')}
            >
              AWG
            </button>
            <button
              type="button"
              className={wire.gauge.system === 'mm2' ? 'on' : ''}
              aria-pressed={wire.gauge.system === 'mm2'}
              onClick={() => switchSystem('mm2')}
            >
              mm²
            </button>
          </div>
          <input
            className="pp-input num w-gauge"
            type="number"
            step={wire.gauge.system === 'mm2' ? 0.01 : 1}
            aria-label="게이지 값"
            value={wire.gauge.value}
            onChange={(e) =>
              updateWire(wire.id, { gauge: { ...wire.gauge, value: Number(e.target.value) } })
            }
          />
          <span className="pp-alt num">{gaugeAlt}</span>
        </Field>
        <Field label="길이">
          <input
            className="pp-input num w-len"
            type="number"
            aria-label="길이"
            value={wire.lengthMm ?? ''}
            onChange={(e) =>
              updateWire(wire.id, { lengthMm: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <span className="pp-unit num">mm</span>
          <span className="pp-spacer" />
          <span className="pp-hint">{cable ? '길이는 케이블을 따릅니다' : '도면 길이 그대로'}</span>
        </Field>
      </Section>

      <Section label="케이블 소속">
        <div className="pp-seg-row">
          <button
            type="button"
            className={`pp-opt${!wire.cableId ? ' on' : ''}`}
            aria-pressed={!wire.cableId}
            onClick={() => updateWire(wire.id, { cableId: undefined })}
          >
            단선
          </button>
          {(doc.cables ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className={`pp-opt grow${wire.cableId === c.id ? ' on' : ''}`}
              aria-pressed={wire.cableId === c.id}
              onClick={() => updateWire(wire.id, { cableId: c.id })}
            >
              {c.name ?? c.id} ({c.coreCount}C)
            </button>
          ))}
          <button
            type="button"
            className="pp-opt"
            onClick={() => {
              const c: Cable = {
                id: `cbl-${Date.now().toString(36)}`,
                name: `케이블 ${(doc.cables?.length ?? 0) + 1}`,
                coreCount: 2,
              };
              addCable(c);
              updateWire(wire.id, { cableId: c.id });
            }}
          >
            + 새 케이블
          </button>
        </div>

        {cable && (
          <div className="pp-cable">
            <Field label="케이블명">
              <input
                className="pp-input grow"
                aria-label="케이블명"
                value={cable.name ?? ''}
                onChange={(e) => updateCable(cable.id, { name: e.target.value || undefined })}
              />
            </Field>
            <Field label="코어 수">
              <div className="pp-stepper">
                <button
                  type="button"
                  aria-label="코어 수 감소"
                  onClick={() => updateCable(cable.id, { coreCount: Math.max(1, cable.coreCount - 1) })}
                >
                  −
                </button>
                <span className="num">{cable.coreCount}</span>
                <button
                  type="button"
                  aria-label="코어 수 증가"
                  onClick={() => updateCable(cable.id, { coreCount: cable.coreCount + 1 })}
                >
                  +
                </button>
              </div>
              <span className="pp-flabel sm">자켓색</span>
              <div className="pp-chips">
                {JACKET_KEYS.map((k) => {
                  const c = findColor(k)!;
                  const on = (cable.jacketColor ?? '').trim().toLowerCase() === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`pp-chip sm${on ? ' on' : ''}${c.light ? ' light' : ''}`}
                      style={{ background: c.css }}
                      aria-pressed={on}
                      aria-label={`자켓색 ${c.ko}(${c.key})`}
                      title={`${c.ko} · ${c.key}`}
                      onClick={() => updateCable(cable.id, { jacketColor: k })}
                    />
                  );
                })}
              </div>
              <input
                className="pp-input num sm grow"
                aria-label="자켓색 직접 입력"
                value={cable.jacketColor ?? ''}
                onChange={(e) => updateCable(cable.id, { jacketColor: e.target.value || undefined })}
              />
            </Field>
            <div className="pp-cores">
              <div className="pp-hint">
                같은 케이블 심선 <b className="num">{cores.length}</b>가닥 · 길이는 케이블을 따릅니다
              </div>
              {cores.map((w) => {
                const f = endpointParts(doc, refs, w.from);
                const t = endpointParts(doc, refs, w.to);
                return (
                  <div key={w.id} className={`pp-core${w.id === wire.id ? ' cur' : ''}`}>
                    <i className="pp-swatch-sm" style={swatchStyle(w.color.base, w.color.stripe)} aria-hidden />
                    <span className="num pp-core-code">{codes.get(w.id)}</span>
                    <span className="pp-core-path">
                      {f.ref} {f.pin} → {t.ref} {t.pin}
                      {w.id === wire.id ? ' (현재)' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

// ============================================================
// (B) 커넥터 / (B-2) 스플라이스
// ============================================================
const DIRS: { o: Orientation; deg: string; label: string }[] = [
  { o: 0, deg: '0°', label: '왼쪽' },
  { o: 90, deg: '90°', label: '위쪽' },
  { o: 180, deg: '180°', label: '오른쪽' },
  { o: 270, deg: '270°', label: '아래쪽' },
];

function ConnectorEditor({ doc, conn }: { doc: HarnessDocument; conn: Connector }) {
  const updateConnector = useHarnessStore((s) => s.updateConnector);
  const addUsedPart = useHarnessStore((s) => s.addUsedPart);

  const [padSel, setPadSel] = useState<string[]>([]);
  const [legendHover, setLegendHover] = useState<string | null>(null);

  const refs = useMemo(() => refLabels(doc), [doc]);
  const housing = doc.usedParts.find((p) => p.id === conn.housingId);
  const isSplice = conn.kind === 'splice';

  // 터미널 후보 — 내가 만든 부품 우선, 그다음 시드
  const terminals: PartLibraryItem[] = useMemo(
    () => [
      ...loadCustomParts().filter((p) => p.category === 'terminal'),
      ...SEED_PARTS.filter((p) => p.category === 'terminal'),
    ],
    [],
  );

  const wireCount = doc.wires.filter((w) =>
    [w.from, w.to].some((e) => e.type === 'pin' && e.connectorId === conn.id),
  ).length;

  const { cols, layout } = gridOf(housing, conn.pins.length);

  /**
   * 핀 → 격자 위치 (pinLayout 이 있으면 그대로, 없으면 행 우선).
   *
   * 하우징 정의에 **없는 핀**(정의가 줄었는데 배선이 물려 있어 남은 핀)도
   * 아래 줄에 이어 그린다. 예전에는 격자에서 통째로 빠져 터미널을 지정할 수도,
   * 남아 있다는 사실을 볼 수도 없었다 — 캔버스와 같은 규칙으로 맞춘다.
   */
  const cells = useMemo(() => {
    const out: { key: string; pinId?: string; label?: string }[] = [];
    if (layout) {
      const rows = Math.max(...layout.map((s) => s.offset.y)) + 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const slot = layout.find((s) => s.offset.x === x && s.offset.y === y);
          const pin = slot ? conn.pins.find((p) => p.index === slot.index) : undefined;
          out.push({ key: `${x}-${y}`, pinId: pin?.id, label: pin ? (pin.label ?? String(pin.index)) : undefined });
        }
      }
      const known = new Set(layout.map((s) => s.index));
      const orphans = conn.pins.filter((p) => !known.has(p.index));
      orphans.forEach((p, i) => {
        out.push({ key: `x-${p.id}`, pinId: p.id, label: p.label ?? String(p.index) });
        // 마지막 줄을 채워 격자 모양을 지킨다
        if (i === orphans.length - 1) {
          const pad = (cols - (orphans.length % cols)) % cols;
          for (let k = 0; k < pad; k++) out.push({ key: `x-pad-${k}` });
        }
      });
      return out;
    }
    for (const p of conn.pins) out.push({ key: p.id, pinId: p.id, label: p.label ?? String(p.index) });
    return out;
  }, [layout, cols, conn.pins]);

  // 터미널 → 태그(A, B, C …). 이 커넥터에서 실제로 쓰인 순서대로 붙인다.
  const tagOf = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    for (const p of conn.pins) {
      if (p.terminalId && !m.has(p.terminalId)) {
        m.set(p.terminalId, String.fromCharCode(65 + i));
        i += 1;
      }
    }
    return m;
  }, [conn.pins]);

  const nameOfTerminal = (id: string) =>
    terminals.find((t) => t.id === id)?.name ??
    doc.usedParts.find((p) => p.id === id)?.name ??
    id;

  const legend = useMemo(() => {
    const rows: { tag: string; name: string; count: number }[] = [];
    for (const [id, tag] of tagOf) {
      rows.push({ tag, name: nameOfTerminal(id), count: conn.pins.filter((p) => p.terminalId === id).length });
    }
    rows.push({ tag: '—', name: '미지정', count: conn.pins.filter((p) => !p.terminalId).length });
    return rows;
  }, [tagOf, conn.pins, terminals, doc.usedParts]);

  const allOn = padSel.length > 0 && padSel.length === conn.pins.length;

  const assign = (value: string) => {
    if (!value || !padSel.length) return;
    const next = value === '__none__' ? undefined : value;
    updateConnector(conn.id, {
      pins: conn.pins.map((p) => (padSel.includes(p.id) ? { ...p, terminalId: next } : p)),
    });
    if (next) {
      const t = terminals.find((x) => x.id === next);
      if (t) addUsedPart(t);
    }
  };

  return (
    <>
      <div className={`pp-card${isSplice ? ' dashed' : ''}`}>
        <div className="pp-card-top">
          <span className="pp-badge num">{isSplice ? 'SPLICE' : 'CONN'}</span>
          <span className="pp-ref num">{refs.get(conn.id) ?? '—'}</span>
          <span className="pp-card-name">{housing?.name ?? conn.kind}</span>
        </div>
        <div className="pp-card-meta num">
          {[housing?.mpn, housing?.spec?.['피치'], `배선 ${wireCount}본`].filter(Boolean).join(' · ')}
        </div>
        {/*
          결합 성별 — 발주에서 암수를 잘못 사면 현장에서 못 쓴다.
          값이 있을 때만 한 줄 세운다(미지정은 줄을 만들지 않는다).
        */}
        {housing?.gender ? (
          <div className="pp-card-meta">
            결합 성별 <b className="num">{GENDER_LABEL[housing.gender]}</b>{' '}
            <span className="pp-gender-long">{GENDER_LONG[housing.gender]}</span>
          </div>
        ) : null}
      </div>

      <Section label="방향" note="배선이 나가는 쪽">
        <div className="pp-dirs">
          {DIRS.map((d) => {
            const on = conn.orientation === d.o;
            return (
              <button
                key={d.o}
                type="button"
                className={`pp-dir${on ? ' on' : ''}`}
                aria-pressed={on}
                aria-label={`방향 ${d.deg} ${d.label}`}
                onClick={() => updateConnector(conn.id, { orientation: d.o })}
              >
                <span className="pp-dir-sym">
                  <span className={`pp-mini latch-${d.o}`}>
                    <span className="pp-mini-grid">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </span>
                  <span className={`pp-exit exit-${d.o}`} />
                </span>
                <span className="pp-dir-deg num">{d.deg}</span>
                <span className="pp-dir-label">{d.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Field label="메모">
        <input
          className="pp-input grow"
          aria-label="메모"
          placeholder="예: 백샐 20mm 여유"
          value={conn.note ?? ''}
          onChange={(e) => updateConnector(conn.id, { note: e.target.value || undefined })}
        />
      </Field>

      {isSplice ? (
        <Section label="터미널" note={`핀 ${conn.pins.length}개`}>
          <div className="pp-pads-card">
            <div className="pp-housing dashed">
              <div className="pp-pad-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${PAD}px)` }}>
                {conn.pins.map((p) => (
                  <span key={p.id} className="pp-pad ghost num">
                    {p.label ?? p.index}
                  </span>
                ))}
              </div>
            </div>
            <div className="pp-splice-msg">
              압착단자가 필요 없습니다
              <span className="pp-splice-sub">
                꼬임 접속이라 파트리스트에 단자가 잡히지 않습니다. 핀 {conn.pins.length}개는 모두 한 네트로 이어져 있습니다.
              </span>
            </div>
          </div>
        </Section>
      ) : (
        <Section
          label="터미널 지정"
          note={`핀 ${conn.pins.length}개`}
          grow
          action={
            <button
              type="button"
              className="pp-mini-btn"
              onClick={() => setPadSel(allOn ? [] : conn.pins.map((p) => p.id))}
            >
              {allOn ? '선택 해제' : '모두 선택'}
            </button>
          }
        >
          <div className="pp-pads-card">
            <div className="pp-housing">
              <div className="pp-pad-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${PAD}px)` }}>
                {cells.map((c) => {
                  if (!c.pinId) return <span key={c.key} className="pp-pad blank" />;
                  const pin = conn.pins.find((p) => p.id === c.pinId)!;
                  const tag = pin.terminalId ? tagOf.get(pin.terminalId) : undefined;
                  const on = padSel.includes(pin.id);
                  const lit =
                    legendHover != null &&
                    ((legendHover === '—' && !tag) || legendHover === tag);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={[
                        'pp-pad',
                        on ? 'on' : '',
                        lit ? 'lit' : '',
                        tag ? 'has' : '',
                      ].filter(Boolean).join(' ')}
                      aria-pressed={on}
                      aria-label={`핀 ${c.label}`}
                      onClick={() =>
                        setPadSel((s) => (s.includes(pin.id) ? s.filter((x) => x !== pin.id) : [...s, pin.id]))
                      }
                    >
                      <span className="num">{c.label}</span>
                      {tag ? <span className="pp-pad-tag num">{tag}</span> : null}
                    </button>
                  );
                })}
              </div>
              <span className="pp-latch" aria-hidden />
              <span className="pp-regmark" aria-hidden />
            </div>
            <div className="pp-pads-cap num">결합면 기준 · 클릭해서 고릅니다</div>
          </div>

          <div className="pp-assign">
            <span className={`pp-assign-label${padSel.length ? '' : ' off'}`}>
              {padSel.length ? `선택 ${padSel.length}핀에 지정` : '핀을 고르면 지정'}
            </span>
            <select
              className="pp-select grow"
              aria-label="터미널 선택"
              value=""
              disabled={!padSel.length}
              onChange={(e) => {
                assign(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">터미널 선택…</option>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.mpn ? `${t.mpn} · ${t.name}` : t.name}
                </option>
              ))}
              <option value="__none__">지정 없음</option>
            </select>
          </div>

          <div className="pp-legend">
            {legend.map((l) => (
              <div
                key={l.tag}
                className={`pp-legend-row${legendHover === l.tag ? ' lit' : ''}`}
                onMouseEnter={() => setLegendHover(l.tag)}
                onMouseLeave={() => setLegendHover(null)}
              >
                <span className={`pp-legend-badge num${l.tag === '—' ? ' off' : ''}`}>
                  {l.tag === '—' ? '' : l.tag}
                </span>
                <span className={`pp-legend-name${l.tag === '—' ? ' off' : ''}`}>{l.name}</span>
                <span className="pp-legend-count num">{l.count}핀</span>
              </div>
            ))}
            <p className="pp-hint">지정한 터미널은 파트리스트에 배선된 핀 수만큼 집계됩니다.</p>
          </div>
        </Section>
      )}
    </>
  );
}

// ============================================================
// (C) 장치
// ============================================================
function DeviceEditor({ doc, dev }: { doc: HarnessDocument; dev: Device }) {
  const updateDevice = useHarnessStore((s) => s.updateDevice);
  const updateWire = useHarnessStore((s) => s.updateWire);

  const refs = useMemo(() => refLabels(doc), [doc]);
  const codes = useMemo(() => wireCodes(doc), [doc]);
  const terms = dev.terminals ?? [];

  const wiresOf = (t: string) =>
    doc.wires.filter((w) =>
      [w.from, w.to].some((e) => e.type === 'device' && e.deviceId === dev.id && e.terminal === t),
    );

  const wiredCount = doc.wires.filter((w) =>
    [w.from, w.to].some((e) => e.type === 'device' && e.deviceId === dev.id),
  ).length;

  /** 단자 이름을 바꾸면 그 단자를 쓰는 배선의 끝점도 따라간다 */
  const renameTerminal = (i: number, name: string) => {
    const old = terms[i];
    const next = terms.slice();
    next[i] = name;
    updateDevice(dev.id, { terminals: next });
    if (!old || old === name) return;
    for (const w of doc.wires) {
      const patch: Partial<Wire> = {};
      if (w.from.type === 'device' && w.from.deviceId === dev.id && w.from.terminal === old) {
        patch.from = { ...w.from, terminal: name };
      }
      if (w.to.type === 'device' && w.to.deviceId === dev.id && w.to.terminal === old) {
        patch.to = { ...w.to, terminal: name };
      }
      if (patch.from || patch.to) updateWire(w.id, patch);
    }
  };

  const addTerminal = () => {
    let n = terms.length + 1;
    while (terms.includes(`T${n}`)) n += 1;
    updateDevice(dev.id, { terminals: [...terms, `T${n}`] });
  };

  return (
    <>
      <div className="pp-card dashed">
        <div className="pp-card-top">
          <span className="pp-badge num soft">DEV</span>
          <span className="pp-ref num">{refs.get(dev.id) ?? 'D?'}</span>
          <span className="pp-card-name">
            단자 {terms.length} · 배선 {wiredCount}본
          </span>
        </div>
      </div>

      <Field label="이름">
        <input
          className="pp-input grow"
          aria-label="장치 이름"
          value={dev.name}
          onChange={(e) => updateDevice(dev.id, { name: e.target.value })}
        />
      </Field>

      <Section label="단자" note="이 이름이 배선의 접속점이 됩니다" grow>
        <div className="pp-terms">
          {terms.map((t, i) => {
            const used = wiresOf(t);
            const usedLabel = used.map((w) => codes.get(w.id)).filter(Boolean).join(' ');
            return (
              <div key={`${i}-${t}`} className="pp-term-row">
                <span className="pp-term-grip" aria-hidden>⠿</span>
                <span className="pp-term-no num">{i + 1}</span>
                <input
                  className="pp-input num grow"
                  aria-label={`단자 ${i + 1} 이름`}
                  value={t}
                  onChange={(e) => renameTerminal(i, e.target.value)}
                />
                <span className="pp-term-use num" title={usedLabel}>
                  {used.length ? `${usedLabel} 배선됨` : ''}
                </span>
                <button
                  type="button"
                  className="pp-term-del"
                  disabled={used.length > 0}
                  aria-label={`단자 ${i + 1} 삭제`}
                  title={used.length ? '배선된 단자는 지울 수 없습니다' : '단자 삭제'}
                  onClick={() => updateDevice(dev.id, { terminals: terms.filter((_, k) => k !== i) })}
                >
                  ×
                </button>
              </div>
            );
          })}
          {terms.length === 0 && <p className="pp-hint">아직 단자가 없습니다.</p>}
          <button type="button" className="pp-add" onClick={addTerminal}>
            + 단자 추가
          </button>
        </div>
      </Section>
    </>
  );
}

// ============================================================
// (D) 미선택 — 빈 상태
// ============================================================
const EMPTY_HINTS: { tag: string; text: string }[] = [
  { tag: 'WIRE', text: '배선 — 색·게이지·길이·케이블 소속' },
  { tag: 'CONN', text: '커넥터 — 방향과 핀별 터미널' },
  { tag: 'DEV', text: '장치 — 이름과 단자 목록' },
];

function EmptyState({ doc }: { doc: HarnessDocument }) {
  const netCount = useMemo(() => computeNets(doc).length, [doc]);

  /** 미완성 = 배선됐지만 터미널이 지정되지 않은 핀 (스플라이스 제외) */
  const pending = useMemo(() => {
    let n = 0;
    for (const w of doc.wires) {
      for (const e of [w.from, w.to]) {
        if (e.type !== 'pin') continue;
        const c = doc.connectors.find((x) => x.id === e.connectorId);
        if (!c || c.kind === 'splice') continue;
        if (!c.pins.find((p) => p.id === e.pinId)?.terminalId) n += 1;
      }
    }
    return n;
  }, [doc]);

  const savedAt = useMemo(() => {
    const d = new Date(doc.updatedAt);
    if (Number.isNaN(d.getTime())) return '—';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [doc.updatedAt]);

  const stats: { k: string; v: number }[] = [
    { k: 'CONN', v: doc.connectors.length },
    { k: 'DEV', v: doc.devices.length },
    { k: 'WIRE', v: doc.wires.length },
    { k: 'NET', v: netCount },
  ];

  return (
    <div className="pp-empty">
      <div className="pp-empty-mid">
        <div className="pp-draw" aria-hidden>
          <div className="pp-draw-box a">
            <div className="pp-draw-grid">
              <i /><i /><i /><i />
            </div>
            <span className="pp-draw-latch" />
          </div>
          <span className="pp-draw-l1" />
          <span className="pp-draw-l2" />
          <span className="pp-draw-l3" />
          <div className="pp-draw-box b">
            <div className="pp-draw-grid two">
              <i /><i />
            </div>
          </div>
        </div>

        <div className="pp-empty-text">
          <div className="pp-empty-title">선택된 항목이 없습니다</div>
          <div className="pp-empty-desc">
            캔버스나 접속표에서 하나를 클릭하면<br />여기에서 값을 바꿀 수 있습니다.
          </div>
        </div>

        <div className="pp-empty-hints">
          {EMPTY_HINTS.map((h) => (
            <div key={h.tag} className="pp-empty-hint">
              <span className="pp-tag num">{h.tag}</span>
              <span className="pp-empty-hint-text">{h.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pp-empty-foot">
        <div className="pp-sec-label">이 문서</div>
        <div className="pp-stats">
          {stats.map((s) => (
            <div key={s.k} className="pp-stat">
              <div className="pp-stat-k num">{s.k}</div>
              <div className="pp-stat-v num">{s.v}</div>
            </div>
          ))}
        </div>
        <div className="pp-empty-status">
          <span className="pp-dot" aria-hidden />
          미완성 {pending} · 마지막 저장 {savedAt}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// (E) 다중 선택 — §11 "선택 모델"
// ============================================================

/** 고른 배선들이 같은 값을 갖는가 */
function allSame<T>(list: Wire[], get: (w: Wire) => T): { same: boolean; value: T } {
  const first = get(list[0]);
  return { same: list.every((w) => Object.is(get(w), first)), value: first };
}

/**
 * 값이 같은 항목은 그대로 편집(`3본 동일`),
 * 다른 항목은 이탤릭 `여러 값`으로 둔다 — 덮어쓸 값을 모른 채 지우지 않게.
 */
function MixTag({ same, n }: { same: boolean; n: number }) {
  return same
    ? <span className="pp-mix same num">{n}본 동일</span>
    : <span className="pp-mix">여러 값</span>;
}

function MultiWireEditor({ doc, wires }: { doc: HarnessDocument; wires: Wire[] }) {
  const updateWire = useHarnessStore((s) => s.updateWire);
  const remove = useHarnessStore((s) => s.remove);
  const setIds = useSelectionStore((s) => s.setIds);
  const escape = useSelectionStore((s) => s.escape);

  const codes = useMemo(() => wireCodes(doc), [doc]);
  const n = wires.length;

  // 자유 입력은 타이핑마다 전체에 쓰면 실행취소 스택이 글자 수만큼 쌓인다.
  // 초안을 들고 있다가 blur · Enter 에서 한 번만 반영한다.
  const [gaugeDraft, setGaugeDraft] = useState<string | null>(null);
  const [lenDraft, setLenDraft] = useState<string | null>(null);

  const baseC = allSame(wires, (w) => w.color.base.trim().toLowerCase());
  const stripeC = allSame(wires, (w) => (w.color.stripe ?? '').trim().toLowerCase());
  const sysC = allSame(wires, (w) => w.gauge.system);
  const valC = allSame(wires, (w) => w.gauge.value);
  const lenC = allSame(wires, (w) => w.lengthMm);
  // 합계는 공용 해석기로 낸다 — 케이블 심선도 케이블 길이를 따르고,
  // 모르는 값은 0 으로 더하지 않고 "몇 본치 합"인지 옆에 밝힌다.
  const sumLen = tallyLengths(wires, lengthResolver(doc));

  /** 일괄 지정 — 파괴적 동작이므로 되돌릴 길을 토스트로 남긴다 */
  const applyAll = (patch: (w: Wire) => Partial<Wire>) => {
    for (const w of wires) updateWire(w.id, patch(w));
    showToast(`배선 ${n}본을 일괄 지정했습니다`, undoSteps(n));
  };

  const commitGauge = () => {
    if (gaugeDraft == null) return;
    const v = Number(gaugeDraft);
    setGaugeDraft(null);
    if (!gaugeDraft.trim() || Number.isNaN(v)) return;
    applyAll((w) => ({ gauge: { ...w.gauge, value: v } }));
  };

  const commitLen = () => {
    if (lenDraft == null) return;
    const raw = lenDraft.trim();
    setLenDraft(null);
    if (!raw) return;
    const v = Number(raw);
    if (Number.isNaN(v)) return;
    applyAll(() => ({ lengthMm: v }));
  };

  /** 고른 배선이 속한 네트를 통째로 고른다 — 한 네트를 한꺼번에 손보는 흐름 */
  const selectSameNet = () => {
    const nets = computeNets(doc);
    const out = new Set<string>();
    for (const w of wires) {
      const net = nets.find((x) => x.wireIds.includes(w.id));
      for (const id of net?.wireIds ?? [w.id]) out.add(id);
    }
    setIds([...out]);
  };

  /** 확인 대화상자를 두지 않는다(§11). 대신 6초짜리 검은 토스트로 되돌린다. */
  const removeAll = () => {
    const ids = wires.map((w) => w.id);
    for (const id of ids) remove(id);
    setIds([]);
    showToast(`배선 ${n}본을 삭제했습니다`, undoSteps(ids.length));
  };

  return (
    <aside className="pp">
      <div className="pp-body">
        <div className="pp-card pp-multi">
          <div className="pp-card-top">
            <span className="pp-badge num">MULTI</span>
            <span className="pp-multi-count">{`배선 ${n}본 선택`}</span>
            <span className="pp-spacer" />
            <button type="button" className="pp-mini-btn" onClick={() => escape()}>
              해제 ESC
            </button>
          </div>
          <div className="pp-multi-chips">
            {wires.map((w) => (
              <span key={w.id} className="pp-wchip num">{codes.get(w.id) ?? 'W?'}</span>
            ))}
          </div>
        </div>

        <Section label="색">
          <Field label="기본">
            {/* 12칩은 폭을 다 쓰므로 표식을 앞에 둔다 — 뒤에 두면 칩이 한 줄 더 접힌다 */}
            <MixTag same={baseC.same} n={n} />
            <div className={`pp-chips${baseC.same ? '' : ' mixed'}`}>
              {STD_COLORS.map((c) =>
                colorChip(
                  c,
                  baseC.same && c.key === baseC.value,
                  () => applyAll((w) => ({ color: { base: c.key, stripe: w.color.stripe } })),
                  '기본색',
                ),
              )}
            </div>
          </Field>
          <Field label="줄무늬">
            <MixTag same={stripeC.same} n={n} />
            <div className={`pp-chips${stripeC.same ? '' : ' mixed'}`}>
              <button
                type="button"
                className={`pp-chip none${stripeC.same && !stripeC.value ? ' on' : ''}`}
                aria-pressed={stripeC.same && !stripeC.value}
                onClick={() => applyAll((w) => ({ color: { base: w.color.base, stripe: undefined } }))}
              >
                없음
              </button>
              {STD_COLORS.map((c) =>
                colorChip(
                  c,
                  stripeC.same && c.key === stripeC.value,
                  () => applyAll((w) => ({ color: { base: w.color.base, stripe: c.key } })),
                  '줄무늬색',
                ),
              )}
            </div>
          </Field>
          <p className="pp-hint indent">칩을 고르면 선택한 {n}본 전체에 적용됩니다.</p>
        </Section>

        <Section label="규격">
          <Field label="게이지">
            <div className="pp-seg">
              {(['awg', 'mm2'] as const).map((sys) => (
                <button
                  key={sys}
                  type="button"
                  className={sysC.same && sysC.value === sys ? 'on' : ''}
                  aria-pressed={sysC.same && sysC.value === sys}
                  onClick={() =>
                    applyAll((w) => ({
                      gauge: {
                        system: sys,
                        value:
                          w.gauge.system === sys
                            ? w.gauge.value
                            : sys === 'mm2'
                              ? (awgToMm2(w.gauge.value) ?? 0.34)
                              : mm2ToAwg(w.gauge.value),
                      },
                    }))
                  }
                >
                  {sys === 'awg' ? 'AWG' : 'mm²'}
                </button>
              ))}
            </div>
            <input
              className={`pp-input num w-gauge${valC.same ? '' : ' mixed'}`}
              aria-label="게이지 값 일괄"
              placeholder={valC.same ? '' : '여러 값'}
              value={gaugeDraft ?? (valC.same ? String(valC.value) : '')}
              onChange={(e) => setGaugeDraft(e.target.value)}
              onBlur={commitGauge}
              onKeyDown={(e) => { if (e.key === 'Enter') commitGauge(); }}
            />
            <MixTag same={valC.same} n={n} />
          </Field>
          <Field label="길이">
            <input
              className={`pp-input num w-len${lenC.same ? '' : ' mixed'}`}
              aria-label="길이 일괄"
              placeholder={lenC.same ? '' : '여러 값'}
              value={lenDraft ?? (lenC.same ? (lenC.value ?? '') : '')}
              onChange={(e) => setLenDraft(e.target.value)}
              onBlur={commitLen}
              onKeyDown={(e) => { if (e.key === 'Enter') commitLen(); }}
            />
            <span className="pp-unit num">mm</span>
            <span className="pp-multi-sum num">
              합 {sumLen.totalMm}mm
              {sumLen.missing > 0 && ` (${sumLen.counted}본 기준)`}
            </span>
            <span className="pp-spacer" />
            <MixTag same={lenC.same} n={n} />
          </Field>
          <p className="pp-hint indent">
            값을 넣고 <b className="num">Enter</b> 를 누르면 {n}본 전체에 들어갑니다.
            케이블 소속과 FROM · TO 는 배선마다 달라 다중에서는 다루지 않습니다.
          </p>
        </Section>
      </div>

      <div className="pp-foot">
        <button type="button" className="pp-mini-btn" onClick={selectSameNet}>
          같은 네트 선택
        </button>
        <span className="pp-spacer" />
        <button type="button" className="pp-danger" onClick={removeAll}>
          {n}본 삭제
        </button>
      </div>
    </aside>
  );
}

// ============================================================
// 패널 본체
// ============================================================
export function PropertyPanel() {
  const selection = useHarnessStore((s) => s.selection);
  const doc = useHarnessStore((s) => s.doc);
  const remove = useHarnessStore((s) => s.remove);
  const ids = useSelectionStore((s) => s.ids);

  /**
   * 다중 모드는 **배선 2본 이상**일 때만이다.
   * 커넥터·장치가 섞여 있으면 공통 속성이 성립하지 않으므로 배선만 걸러낸다.
   */
  const multiWires = useMemo(() => {
    if (ids.length < 2) return [];
    return ids
      .map((id) => doc.wires.find((w) => w.id === id))
      .filter((w): w is Wire => !!w);
  }, [ids, doc.wires]);

  if (multiWires.length > 1) {
    return <MultiWireEditor doc={doc} wires={multiWires} />;
  }

  const wire = doc.wires.find((w) => w.id === selection);
  const conn = doc.connectors.find((c) => c.id === selection);
  const dev = doc.devices.find((d) => d.id === selection);

  if (!selection || (!wire && !conn && !dev)) {
    return (
      <aside className="pp">
        <EmptyState doc={doc} />
      </aside>
    );
  }

  const kindLabel = wire ? '배선' : conn ? (conn.kind === 'splice' ? '스플라이스' : '커넥터') : '장치';

  return (
    <aside className="pp">
      <div className="pp-body">
        {wire && <WireEditor doc={doc} wire={wire} />}
        {conn && <ConnectorEditor key={conn.id} doc={doc} conn={conn} />}
        {dev && <DeviceEditor doc={doc} dev={dev} />}
      </div>
      <div className="pp-foot">
        <span className="pp-foot-hint num">변경 즉시 반영 · ⌘Z 실행취소</span>
        <span className="pp-spacer" />
        <button type="button" className="pp-danger" onClick={() => remove(selection)}>
          {kindLabel} 삭제
        </button>
      </div>
    </aside>
  );
}
