/**
 * 세트 개요 화면 — Claude Design 2차 §4.
 *
 * 문서 하나에 하네스가 여러 종 들어가고, 발주 단위는 그 하네스들을 묶은 **세트**다.
 * 이 화면만이 전체를 합산해 보여준다(캔버스·접속표·파트는 선택된 하네스 하나만 다룬다).
 *
 * 원칙:
 * - **총수량은 저장하지 않는다.** 언제나 `perSet × orderQty` 로 파생한다(store/kit.ts).
 * - UI 강조는 스틸(--accent) 하나. 미완성·경고도 빨강을 쓰지 않는다 — 빨강은 전선 색이다.
 * - 도면 요소(썸네일 하우징·패드)는 radius 0. 전선 색만 실제 색으로 칠한다.
 */
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import type {
  Endpoint, HarnessDocument, HarnessSet, Id, KitDocument,
} from '../types';
import {
  blockersOf, letterAt, perSetOf, statsOf, totalHarnesses, totalOf,
} from '../store/kit';
import { strokeColor } from '../canvas/docToFlow';
import './set.css';

// ================================================================
// 미니 스케마틱 — 실제 도면을 축소해 그린다
//   하우징 사각 + 핀 패드 9px + 직교 배선. 커넥터의 논리 좌표와 배선을
//   그대로 반영하므로 하네스마다 다른 그림이 나온다.
// ================================================================

const TW = 320;          // 썸네일 viewBox 폭
const TH = 112;          // 썸네일 높이 (스펙 고정값)
const MARGIN = 6;
const PAD = 9;           // 핀 패드 한 변
const PITCH = 13;        // 패드 피치
const INSET = 4;         // 하우징 안쪽 여백
const MAX_COLS = 8;
const MAX_ROWS = 3;
const MAX_WIRES = 14;    // 이보다 많으면 읽히지 않는다 — 앞에서부터 그린다

type MiniNode = {
  id: Id;
  cols: number;
  rows: number;
  w: number;
  h: number;
  x: number;
  y: number;
  dashed: boolean;
  /** 핀 id(커넥터) 또는 단자명(장치) — 배선 끝점을 패드 자리로 옮길 때 쓴다 */
  slots: string[];
};

export type MiniSchematic = {
  boxes: { key: string; x: number; y: number; w: number; h: number; dashed: boolean }[];
  pads: { key: string; x: number; y: number }[];
  wires: { key: string; d: string; stroke: string }[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;
const boxW = (cols: number) => cols * PITCH - (PITCH - PAD) + INSET * 2;
const boxH = (rows: number) => rows * PITCH - (PITCH - PAD) + INSET * 2;

/** 하우징 격자 크기 — pinLayout 이 있으면 실제 배치를, 없으면 핀 수로 추정한다 */
function gridOf(h: HarnessDocument, housingId: Id, pinCount: number): { cols: number; rows: number } {
  const layout = h.usedParts.find((p) => p.id === housingId)?.pinLayout;
  if (layout && layout.length) {
    const cols = Math.max(...layout.map((s) => s.offset.x)) + 1;
    const rows = Math.max(...layout.map((s) => s.offset.y)) + 1;
    return {
      cols: clamp(Math.round(cols) || 1, 1, MAX_COLS),
      rows: clamp(Math.round(rows) || 1, 1, MAX_ROWS),
    };
  }
  const cols = clamp(pinCount || 1, 1, 4);
  return { cols, rows: clamp(Math.ceil((pinCount || 1) / cols), 1, MAX_ROWS) };
}

/** 하네스 하나를 320×112 썸네일로 축소한다 */
export function miniSchematic(h: HarnessDocument): MiniSchematic {
  const nodes: MiniNode[] = [];

  h.connectors.forEach((c, i) => {
    const { cols, rows } = gridOf(h, c.housingId, c.pins.length);
    nodes.push({
      id: c.id,
      cols,
      rows,
      w: boxW(cols),
      h: boxH(rows),
      x: c.positions.logical?.x ?? c.positions.physical?.x ?? i * 140,
      y: c.positions.logical?.y ?? c.positions.physical?.y ?? i * 70,
      dashed: false,
      slots: c.pins.map((p) => p.id),
    });
  });

  h.devices.forEach((d, i) => {
    const terms = d.terminals && d.terminals.length ? d.terminals : ['__node'];
    const cols = clamp(terms.length, 1, 4);
    nodes.push({
      id: d.id,
      cols,
      rows: 1,
      w: boxW(cols),
      h: boxH(1),
      x: d.positions.logical?.x ?? d.positions.physical?.x ?? (h.connectors.length + i) * 140,
      y: d.positions.logical?.y ?? d.positions.physical?.y ?? (h.connectors.length + i) * 70,
      dashed: true,        // 장치는 점선 — 캔버스와 같은 규칙
      slots: terms,
    });
  });

  if (!nodes.length) return { boxes: [], pads: [], wires: [] };

  // --- 실제 좌표를 썸네일 안으로 정규화 ---
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const wMax = Math.max(...nodes.map((n) => n.w));
  const hMax = Math.max(...nodes.map((n) => n.h));
  const availX = Math.max(0, TW - MARGIN * 2 - wMax);
  const availY = Math.max(0, TH - MARGIN * 2 - hMax);
  // 가로·세로에 같은 배율을 쓴다 — 축척이 어긋나면 축소도면이 아니라 다른 그림이 된다.
  const fits: number[] = [];
  if (maxX > minX) fits.push(availX / (maxX - minX));
  if (maxY > minY) fits.push(availY / (maxY - minY));
  const s = fits.length ? Math.min(...fits) : 0;
  const offX = (TW - ((maxX - minX) * s + wMax)) / 2;
  const offY = (TH - ((maxY - minY) * s + hMax)) / 2;

  const placed = nodes.map((n) => ({
    ...n,
    x: offX + (n.x - minX) * s,
    y: offY + (n.y - minY) * s,
  }));
  const at = new Map(placed.map((n) => [n.id, n]));

  const boxes = placed.map((n) => ({
    key: n.id, x: r1(n.x), y: r1(n.y), w: n.w, h: n.h, dashed: n.dashed,
  }));

  const pads: MiniSchematic['pads'] = [];
  for (const n of placed) {
    const shown = Math.min(n.slots.length, n.cols * n.rows);
    for (let i = 0; i < shown; i++) {
      pads.push({
        key: `${n.id}:${i}`,
        x: r1(n.x + INSET + (i % n.cols) * PITCH),
        y: r1(n.y + INSET + Math.floor(i / n.cols) * PITCH),
      });
    }
  }

  /** 배선 끝점 → 패드 중심 */
  const center = (e: Endpoint): { x: number; y: number } | null => {
    const id = e.type === 'pin' ? e.connectorId : e.deviceId;
    const n = at.get(id);
    if (!n) return null;
    const key = e.type === 'pin' ? e.pinId : (e.terminal ?? '__node');
    const idx = clamp(Math.max(0, n.slots.indexOf(key)), 0, Math.max(0, n.cols * n.rows - 1));
    return {
      x: n.x + INSET + (idx % n.cols) * PITCH + PAD / 2,
      y: n.y + INSET + Math.floor(idx / n.cols) * PITCH + PAD / 2,
    };
  };

  const wires: MiniSchematic['wires'] = [];
  h.wires.slice(0, MAX_WIRES).forEach((w, i) => {
    const a = center(w.from);
    const b = center(w.to);
    if (!a || !b) return;
    // 직교(맨해튼) 라우팅. 중간 수직 구간을 배선마다 조금씩 밀어 겹침을 줄인다.
    const d = Math.abs(a.x - b.x) < 1
      ? `M ${r1(a.x)} ${r1(a.y)} V ${r1(b.y)}`
      : `M ${r1(a.x)} ${r1(a.y)} H ${r1((a.x + b.x) / 2 + ((i % 3) - 1) * 5)} `
        + `V ${r1(b.y)} H ${r1(b.x)}`;
    wires.push({ key: w.id, d, stroke: strokeColor(w.color.base) });
  });

  return { boxes, pads, wires };
}

// ================================================================
// 파생 표기
// ================================================================

const num = (n: number) => n.toLocaleString('en-US');

/** 전장 — 가장 긴 배선 한 본. 물리 뷰 구간이 아직 없으므로 최장 경로의 근사값이다. */
function overallMm(h: HarnessDocument): number {
  return h.wires.reduce((m, w) => Math.max(m, w.lengthMm ?? 0), 0);
}

/** 카드 푸터의 미완성 배지 — 빨강 없이 스틸로만 표기한다 */
function issueOf(h: HarnessDocument): { text: string; done: boolean } {
  const s = statsOf(h);
  if (s.missingTerminal > 0) return { text: `터미널 미지정 ${s.missingTerminal}핀`, done: false };
  if (s.missingLength > 0) return { text: `길이 미입력 ${s.missingLength}본`, done: false };
  return { text: '완료', done: true };
}

// ================================================================
// 작은 컴포넌트
// ================================================================

function Stepper(props: {
  value: number;
  label: string;
  big?: boolean;
  onChange: (n: number) => void;
}): JSX.Element {
  const { value, label, big, onChange } = props;
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className={big ? 'so-stepper big' : 'so-stepper'}>
      <button
        type="button"
        aria-label={`${label} 줄이기`}
        onClick={stop(() => onChange(Math.max(1, value - 1)))}
      >
        −
      </button>
      <span className="num" aria-label={label}>{value}</span>
      <button
        type="button"
        aria-label={`${label} 늘리기`}
        onClick={stop(() => onChange(Math.min(999, value + 1)))}
      >
        +
      </button>
    </div>
  );
}

function Thumb({ h }: { h: HarnessDocument }): JSX.Element {
  const mini = useMemo(() => miniSchematic(h), [h]);
  return (
    <div className="so-thumb">
      {mini.boxes.length ? (
        <svg
          className="so-thumb-svg"
          viewBox={`0 0 ${TW} ${TH}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${h.name} 미니 도면`}
        >
          {/* 배선 → 하우징 → 패드 순으로 겹친다(캔버스와 같은 순서) */}
          {mini.wires.map((w) => (
            <path key={w.key} d={w.d} fill="none" strokeWidth={1.4} style={{ stroke: w.stroke }} />
          ))}
          {mini.boxes.map((b) => (
            <rect
              key={b.key}
              className={b.dashed ? 'so-box dash' : 'so-box'}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
            />
          ))}
          {mini.pads.map((p) => (
            <rect key={p.key} className="so-pad" x={p.x} y={p.y} width={PAD} height={PAD} />
          ))}
        </svg>
      ) : (
        <span className="so-thumb-empty">커넥터가 아직 없습니다</span>
      )}
      <span className="so-thumb-pn num">{h.drawingNo || '품번 미지정'}</span>
    </div>
  );
}

// ================================================================
// 본체
// ================================================================

export function SetOverview(props: {
  kit: KitDocument;
  activeHarnessId: string;
  onSelectHarness: (id: string) => void;
  onChangePerSet: (harnessId: string, perSet: number) => void;
  onChangeOrderQty: (qty: number) => void;
  onChangeSet: (patch: Partial<HarnessSet>) => void;
  onAddHarness: (mode: 'blank' | 'duplicate' | 'import') => void;
  onRemoveHarness: (id: string) => void;
  onGoToBlocker: (harnessId: string, targetId?: string) => void;
  onCopyOrderText: () => void;
  onExportSetPdf: () => void;
}): JSX.Element {
  const {
    kit, activeHarnessId, onSelectHarness, onChangePerSet, onChangeOrderQty, onChangeSet,
    onAddHarness, onRemoveHarness, onGoToBlocker, onCopyOrderText, onExportSetPdf,
  } = props;
  const [menu, setMenu] = useState<Id | null>(null);

  const set = kit.set;
  const blockers = useMemo(() => blockersOf(kit), [kit]);
  const perSetTotal = kit.harnesses.reduce((n, h) => n + perSetOf(set, h.id), 0);
  const wireTotal = kit.harnesses.reduce((n, h) => n + h.wires.length, 0);
  const last = kit.harnesses.length <= 1;   // 마지막 하나는 지울 수 없다

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="so">
      {/* ---------------- 좌: 하네스 카드 3열 ---------------- */}
      <main className="so-main">
        <div className="so-head">
          <h2 className="so-title">세트 개요</h2>
          <span className="so-head-sub">
            이 문서의 하네스 <span className="num">{kit.harnesses.length}</span>종 ·
            {' '}세트당 <span className="num">{perSetTotal}</span>개
          </span>
        </div>

        <div className="so-grid">
          {kit.harnesses.map((h, i) => {
            const L = h.letter ?? letterAt(i);
            const st = statsOf(h);
            const issue = issueOf(h);
            const per = perSetOf(set, h.id);
            const sel = h.id === activeHarnessId;
            const long = overallMm(h);
            return (
              <article
                key={h.id}
                className={sel ? 'so-card on' : 'so-card'}
                role="button"
                tabIndex={0}
                aria-current={sel ? 'true' : undefined}
                aria-label={`하네스 ${L} ${h.name}`}
                onClick={() => onSelectHarness(h.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectHarness(h.id);
                  }
                }}
              >
                <div className="so-card-head">
                  <span className="so-letter num">{L}</span>
                  <span className="so-card-name">{h.name}</span>
                  <button
                    type="button"
                    className="so-more"
                    aria-label={`하네스 ${L} 메뉴`}
                    aria-expanded={menu === h.id}
                    onClick={stop(() => setMenu(menu === h.id ? null : h.id))}
                  >
                    ⋯
                  </button>
                  {menu === h.id && (
                    <>
                      <div className="so-scrim" onClick={stop(() => setMenu(null))} />
                      <div className="so-menu">
                        <button
                          type="button"
                          disabled={last}
                          onClick={stop(() => {
                            setMenu(null);
                            onRemoveHarness(h.id);
                          })}
                        >
                          하네스 삭제
                        </button>
                        {last && <p className="so-menu-hint">마지막 하네스는 지울 수 없습니다</p>}
                      </div>
                    </>
                  )}
                </div>

                <Thumb h={h} />

                <div className="so-spec">
                  <div className="so-spec-row">
                    <span className="so-spec-k">끝단</span>
                    <span className="so-spec-v">{st.ends}</span>
                  </div>
                  <div className="so-spec-row">
                    <span className="so-spec-k">전선</span>
                    <span className="so-spec-v num">
                      {st.wireCount}본 · {num(st.wireLengthMm)}mm
                    </span>
                  </div>
                  <div className="so-spec-row">
                    <span className="so-spec-k">전장</span>
                    <span className="so-spec-v num">{long ? `${num(long)}mm` : '—'}</span>
                  </div>
                </div>

                <div className="so-card-foot">
                  <span className="so-foot-k">세트당</span>
                  <Stepper
                    value={per}
                    label={`하네스 ${L} 세트당 수량`}
                    onChange={(n) => onChangePerSet(h.id, n)}
                  />
                  <div className="so-grow" />
                  <span className={issue.done ? 'so-issue done' : 'so-issue'}>{issue.text}</span>
                </div>
              </article>
            );
          })}

          {/* 마지막 칸 — 하네스 추가 */}
          <div className="so-add">
            <div className="so-add-title">이 세트에 하네스 추가</div>
            <div className="so-add-btns">
              <button type="button" className="so-add-btn primary" onClick={() => onAddHarness('blank')}>
                빈 하네스 만들기
              </button>
              <button type="button" className="so-add-btn" onClick={() => onAddHarness('duplicate')}>
                기존 하네스 복제
              </button>
              <button type="button" className="so-add-btn" onClick={() => onAddHarness('import')}>
                JSON 가져오기
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ---------------- 우: 세트 패널 440px ---------------- */}
      <aside className="so-side">
        <div className="so-tabs">
          <button type="button" className="on" aria-current="true">세트</button>
          <button type="button" className="off" disabled>접속표</button>
          <button type="button" className="off" disabled>
            파트 <span className="so-tag num">SET</span>
          </button>
        </div>

        <div className="so-side-body">
          {/* 세트 카드 */}
          <div className="so-set-card">
            <div className="so-set-row">
              <span className="so-badge num">SET</span>
              <input
                className="so-pn num"
                value={set.pn}
                placeholder="세트 품번"
                aria-label="세트 품번"
                onChange={(e) => onChangeSet({ pn: e.target.value })}
              />
              <span className="so-rev num">{set.rev ? `Rev.${set.rev}` : 'Rev.—'}</span>
            </div>
            <div className="so-set-row">
              <span className="so-set-k">주문</span>
              <Stepper big value={set.orderQty} label="주문 세트 수" onChange={onChangeOrderQty} />
              <span className="so-set-unit num">세트</span>
              <div className="so-grow" />
              <span className="so-set-total">
                하네스 <b className="num">{totalHarnesses(set)}</b>개
              </span>
            </div>
            <div className="so-set-row">
              <span className="so-set-k">세트명</span>
              <input
                className="so-name"
                value={set.name}
                placeholder="세트 이름"
                aria-label="세트 이름"
                onChange={(e) => onChangeSet({ name: e.target.value })}
              />
            </div>
          </div>

          {/* 세트 구성 — 총수량은 perSet × orderQty 파생 */}
          <section className="so-sec">
            <div className="so-sec-head">
              <span className="so-sec-label">세트 구성</span>
              <span className="so-rule" />
            </div>
            <div className="so-rows">
              {kit.harnesses.map((h, i) => {
                const L = h.letter ?? letterAt(i);
                return (
                  <div className="so-row" key={h.id} aria-label={`세트 구성 ${L}`}>
                    <span className="so-row-letter num">{L}</span>
                    <span className="so-row-name">
                      {h.drawingNo ? `${h.drawingNo} ${h.name}` : h.name}
                    </span>
                    <span className="so-row-per num">×{perSetOf(set, h.id)}</span>
                    <span className="so-row-total num">{totalOf(set, h.id)}개</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 발주 전 확인 */}
          <section className="so-sec">
            <div className="so-sec-head">
              <span className="so-sec-label">발주 전 확인</span>
              <span className="so-rule" />
            </div>
            <div className="so-rows">
              {blockers.length === 0 ? (
                <p className="so-clean">발주를 막는 항목이 없습니다</p>
              ) : (
                blockers.map((b, i) => (
                  <button
                    type="button"
                    className="so-blocker"
                    key={`${b.harnessId}:${b.targetId ?? ''}:${i}`}
                    onClick={() => onGoToBlocker(b.harnessId, b.targetId)}
                  >
                    <span className="so-blocker-text">{b.label}</span>
                    <span className="so-blocker-where num">{b.where}</span>
                    <span className="so-chev" aria-hidden="true">›</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <div className="so-grow" />

          <div className="so-side-foot">
            <button type="button" className="so-foot-btn" onClick={onExportSetPdf}>
              세트 PDF 묶음
            </button>
            <button type="button" className="so-foot-btn primary" onClick={onCopyOrderText}>
              발주 문구 복사
            </button>
          </div>
        </div>

        <div className="so-status">
          <span className="num">하네스 {kit.harnesses.length}종 · 배선 {wireTotal}본</span>
          <div className="so-grow" />
          <span className="so-status-hint">세트 기준</span>
        </div>
      </aside>
    </div>
  );
}
