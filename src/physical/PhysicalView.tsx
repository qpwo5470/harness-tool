/**
 * 물리 뷰 — 제조 도면 (Claude Design 2차 §3).
 *
 * 논리 뷰가 "어느 핀이 어디로 가는가"를 정의한다면, 물리 뷰는 **어떻게 만드는가**를
 * 그린다. 구간(S1..), 분기점, 치수, 자재. 커넥터를 핀 배열 모양으로 보여주는
 * 화면이 아니라 작업자가 들고 자를 대는 도면이다.
 *
 * 구간은 저장하지 않고 `segments.ts` 에서 파생한다(그쪽 주석 참고).
 *
 * 이 컴포넌트가 그리는 것 = 캔버스(1fr) + 구간표·자재 요약(440px).
 * 좌측 라이브러리 패널과 상단바는 App 셸이 붙인다.
 *
 * 숫자 원칙:
 * - **티크 달린 정식 치수선은 실치수에만 쓴다.** 구간 길이는 그 구간이 전 경로인
 *   배선에서 유도되거나(segments.ts), **사람이 직접 입력한** 값이다. 둘 다 없으면
 *   치수선을 그리지 않고 표에는 `—` 와 그 이유를 적는다. 근거 없는 숫자를
 *   치수선으로 그리면 그대로 잘린다.
 * - 입력값도 실치수이므로 도면에는 유도값과 똑같이 그린다. 대신 **구간표와 호버
 *   카드에서 `입력값` 이라고 밝힌다** — 어디서 온 숫자인지는 작업자가 아니라
 *   도면을 고치는 사람이 알아야 하는 정보다.
 * - 표에서 유도값에는 아무 표시도 붙이지 않는다. 모든 줄에 `배선 기준` 을 달면
 *   정작 눈에 띄어야 할 `입력값` 이 묻힌다(도면 표는 조용해야 한다).
 * - 도면 전폭 치수선은 **전장이 확정될 때만** 그린다. 확정되지 않으면 최장 배선
 *   한 본을 "최장 배선"이라는 이름으로 적는다 — "전장" 이라 부르지 않는다.
 * - 길이가 없으면 `—`. 지어내지 않는다.
 * - 외경은 √본수 × 심선 외경의 **추정값**이라고 화면에 밝힌다.
 * - 보호재는 문서에 데이터가 없으므로 전부 `미지정`.
 */
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { HarnessDocument } from '../types';
import {
  buildPhysicalModel, cableRuns, formatMm, formatRange, materialRows,
  segmentLengthNoteText, spanNoteText,
  type PhysNode, type PhysicalModel, type Segment,
} from './segments';
// 자켓색 해석은 논리 뷰·PDF 와 **같은 함수**를 쓴다 — 같은 케이블이 화면마다
// 다른 색으로 보이면 안 되고, 미지정을 어떻게 그릴지도 한 곳에서만 정한다.
import { jacketPaint } from '../canvas/docToFlow';
import './physical.css';

// ================================================================
// 작도 상수 — 도면 좌표계(px). radius 0, 각진 모서리 유지.
// ================================================================

const CARD_W = 118;     // 끝단 커넥터 카드 폭 (스펙 고정값)
const CARD_H = 58;
const COL = 190;        // 트리 깊이 한 칸
const ROW = 118;        // 잎 하나가 차지하는 세로 칸
const X0 = 158;         // 루트 접속점 x (= 왼쪽 여백 40 + 카드 폭 118)
const TOP = 108;        // 위쪽 여백 — 전장 치수 한 줄이 들어간다
const SPAN_Y = 44;      // 전장 치수선 y
const DIM_OFF = 44;     // 수평 구간 치수선 오프셋
const DIM_SIDE = 34;    // 수직 구간 치수선 오프셋
const TICK = 10;        // 치수선 양 끝 티크
const BREAK = 22;       // 같은 분기점에서 같은 방향으로 나가는 지선 간격

export type Pt = { x: number; y: number; depth: number };

export type SegPath = {
  code: string;
  /** 다발 선 path */
  d: string;
  /** 치수선 — **실치수가 확정된 구간만**. 대표값·추정값에는 그리지 않는다 */
  dim: { line: string; ticks: string; lx: number; ly: number; text: string } | null;
};

export type Layout = {
  pos: Map<string, Pt>;
  paths: SegPath[];
  width: number;
  height: number;
};

/**
 * 트리 배치 — 왼쪽 끝단(루트)에서 오른쪽으로 뻗는 제조 도면 형태.
 * 깊이 → x, 잎 순서 → y, 가지 노드는 자식들의 가운데.
 */
export function layoutTree(model: PhysicalModel): Layout {
  const kids = new Map<string, string[]>();
  for (const s of model.segments) {
    const list = kids.get(s.from) ?? [];
    list.push(s.to);
    kids.set(s.from, list);
  }

  const pos = new Map<string, Pt>();
  let slot = 0;

  const place = (id: string, depth: number): number => {
    const cs = kids.get(id) ?? [];
    if (!cs.length) {
      const y = TOP + slot * ROW;
      slot += 1;
      pos.set(id, { x: X0 + depth * COL, y, depth });
      return y;
    }
    const ys = cs.map((c) => place(c, depth + 1));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    pos.set(id, { x: X0 + depth * COL, y, depth });
    return y;
  };

  for (const root of model.roots) {
    place(root, 0);
    slot += 1; // 컴포넌트 사이 한 칸 띄운다
  }

  // 같은 분기점에서 같은 방향으로 나가는 지선은 진출 x 를 어긋나게 한다
  const breakX = new Map<string, number>();
  for (const [parent, cs] of kids) {
    const p = pos.get(parent);
    if (!p) continue;
    const sorted = [...cs].sort((a, b) => (pos.get(a)?.y ?? 0) - (pos.get(b)?.y ?? 0));
    let up = 0;
    let down = 0;
    for (const c of sorted) {
      const q = pos.get(c);
      if (!q) continue;
      if (q.y === p.y) breakX.set(c, p.x);
      else if (q.y < p.y) breakX.set(c, p.x + BREAK * up++);
      else breakX.set(c, p.x + BREAK * down++);
    }
  }

  const paths: SegPath[] = model.segments.map((s) => {
    const p = pos.get(s.from);
    const q = pos.get(s.to);
    if (!p || !q) return { code: s.code, d: '', dim: null };
    const bx = breakX.get(s.to) ?? p.x;
    const d =
      p.y === q.y
        ? `M ${p.x} ${p.y} H ${q.x}`
        : `M ${p.x} ${p.y} H ${bx} V ${q.y} H ${q.x}`;

    let dim: SegPath['dim'] = null;
    if (s.lengthMm != null) {
      const text = `${formatMm(s.lengthMm)}`;
      if (p.y === q.y) {
        const y = p.y - DIM_OFF;
        dim = {
          line: `M ${p.x} ${y} H ${q.x}`,
          ticks: `M ${p.x} ${y - TICK / 2} V ${y + TICK / 2} M ${q.x} ${y - TICK / 2} V ${y + TICK / 2}`,
          lx: (p.x + q.x) / 2,
          ly: y,
          text,
        };
      } else {
        const x = bx - DIM_SIDE;
        dim = {
          line: `M ${x} ${p.y} V ${q.y}`,
          ticks: `M ${x - TICK / 2} ${p.y} H ${x + TICK / 2} M ${x - TICK / 2} ${q.y} H ${x + TICK / 2}`,
          lx: x,
          ly: (p.y + q.y) / 2,
          text,
        };
      }
    }
    return { code: s.code, d, dim };
  });

  let maxX = X0;
  let maxY = TOP;
  for (const p of pos.values()) {
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    pos,
    paths,
    width: maxX + CARD_W + 48,
    height: maxY + CARD_H + 96,
  };
}

// ================================================================
// 컴포넌트
// ================================================================

type HoverSource = 'canvas' | 'table';

export function PhysicalView(props: {
  doc: HarnessDocument;
  selection: string | null;
  onSelect: (id: string | null) => void;
  /**
   * 구간 길이 입력 통로. `mm` 이 null 이면 그 구간의 입력값을 지운다(= 유도값으로 복귀).
   *
   * 이 콜백이 없으면 길이 칸은 **읽기만** 한다. 눌러도 아무 일이 없는 입력칸은
   * 거짓말이므로, 스토어를 물리지 않은 화면(미리보기·시험)에서는 아예 그리지 않는다.
   */
  onSegmentLength?: (key: string, mm: number | null) => void;
}): JSX.Element {
  const { doc, selection, onSelect, onSegmentLength } = props;

  const model = useMemo(() => buildPhysicalModel(doc), [doc]);
  const layout = useMemo(() => layoutTree(model), [model]);
  const materials = useMemo(() => materialRows(doc), [doc]);

  const [tab, setTab] = useState<'seg' | 'mat'>('seg');
  const [hot, setHot] = useState<string | null>(null);
  const [hotSrc, setHotSrc] = useState<HoverSource | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const segByCode = useMemo(
    () => new Map(model.segments.map((s) => [s.code, s] as const)),
    [model],
  );
  /**
   * 케이블 자켓 — 심선 2본 이상이 함께 지나는 구간에만 두른다.
   * 논리 뷰와 같은 뜻이고(canvas/wirePlan), 여기서는 구간 트리 위에 그려진다.
   */
  const jackets = useMemo(() => cableRuns(doc, model).filter((c) => c.segCodes.length > 0), [doc, model]);
  const pathByCode = useMemo(
    () => new Map(layout.paths.map((p) => [p.code, p] as const)),
    [layout],
  );
  /** 구간 코드 → 그 구간을 자켓째 지나는 케이블 이름들 (호버 카드용) */
  const cablesAt = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of jackets) {
      for (const code of c.segCodes) m.set(code, [...(m.get(code) ?? []), c.name]);
    }
    return m;
  }, [jackets]);
  /** 선택이 배선이면 그 배선이 지나는 구간을 고정 강조한다 */
  const selSegs = useMemo(() => {
    const out = new Set<string>();
    if (!selection) return out;
    for (const s of model.segments) if (s.wireIds.includes(selection)) out.add(s.code);
    return out;
  }, [model, selection]);

  const enter = (code: string, src: HoverSource) => {
    setHot(code);
    setHotSrc(src);
  };
  const leave = () => {
    setHot(null);
    setHotSrc(null);
  };

  /** 커서는 강조 중일 때만 갱신한다 (비강조 시 리렌더 방지) */
  const track = (e: MouseEvent) => {
    const r = canvasRef.current?.getBoundingClientRect();
    setCursor({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
  };

  const hotSeg = hot ? (segByCode.get(hot) ?? null) : null;
  const empty = model.segments.length === 0;

  return (
    <div className="pv">
      {/* ---------------- 캔버스: 제조 도면 ---------------- */}
      <div
        className="pv-canvas"
        ref={canvasRef}
        onMouseLeave={leave}
        onClick={() => onSelect(null)}
        data-testid="pv-canvas"
      >
        <div className="pv-sheet" style={{ width: layout.width, height: layout.height }}>
          <div className="pv-frame" aria-hidden />

          {empty ? (
            <p className="pv-empty">
              배선이 없습니다 — 핀과 핀을 이으면 구간이 생깁니다.
            </p>
          ) : (
            <>
              {/* 전장 치수 한 줄 */}
              <svg className="pv-svg" width={layout.width} height={layout.height} aria-hidden>
                {/* 전폭 치수선은 전장이 확정됐을 때만 — 최장 배선 한 본은 전장이 아니다 */}
                {model.span && (
                  <g className="pv-dim" data-testid="pv-span-dim">
                    <path d={`M 48 ${SPAN_Y} H ${layout.width - 48}`} />
                    <path
                      d={`M 48 ${SPAN_Y - TICK / 2} V ${SPAN_Y + TICK / 2} M ${layout.width - 48} ${SPAN_Y - TICK / 2} V ${SPAN_Y + TICK / 2}`}
                    />
                  </g>
                )}
                {/* 구간 치수선 */}
                {layout.paths.map((p) =>
                  p.dim ? (
                    <g className="pv-dim" key={`dim-${p.code}`}>
                      <path d={p.dim.line} />
                      <path d={p.dim.ticks} />
                    </g>
                  ) : null,
                )}
                {/*
                  케이블 자켓 — **다발 아래에** 자켓색 슬리브를 덧그린다.
                  심선 2본 이상이 함께 지나는 구간에만 두르므로, 슬리브가 끊기는
                  자리가 곧 브레이크아웃이다(논리 뷰의 자켓 사각형과 같은 규칙).
                */}
                {jackets.map((c) => {
                  const paint = jacketPaint(c.jacketColor);
                  return c.segCodes.map((code) => {
                    const p = pathByCode.get(code);
                    const s = segByCode.get(code);
                    if (!p || !s) return null;
                    return (
                      <path
                        key={`jk-${c.cableId}-${code}`}
                        data-testid={`pv-jacket-${c.cableId}-${code}`}
                        className={`pv-jacket${paint.dashed ? ' is-unspec' : ''}${selection === c.cableId ? ' is-sel' : ''}`}
                        d={p.d}
                        stroke={paint.color}
                        strokeWidth={Math.max(4, s.count) + 10}
                      >
                        <title>{`${c.name}${paint.dashed ? ' · 자켓색 미지정' : ''}`}</title>
                      </path>
                    );
                  });
                })}
                {/* 다발 — 굵기 = 본수 */}
                {layout.paths.map((p) => {
                  const s = segByCode.get(p.code);
                  if (!s) return null;
                  const strong = hot === p.code || selSegs.has(p.code);
                  return (
                    <path
                      key={`seg-${p.code}`}
                      data-testid={`pv-seg-${p.code}`}
                      className={`pv-bundle${strong ? ' is-hot' : ''}${hot && !strong ? ' is-dim' : ''}`}
                      d={p.d}
                      strokeWidth={Math.max(4, s.count) + (strong ? 2 : 0)}
                    />
                  );
                })}
                {/* 분기점 마커 — 13×13 정사각형 45° 회전 */}
                {model.nodes
                  .filter((n) => n.kind === 'branch')
                  .map((n) => {
                    const p = layout.pos.get(n.id);
                    if (!p) return null;
                    return (
                      <rect
                        key={`br-${n.id}`}
                        className={`pv-branch${n.branchKind === 'splice' ? ' is-filled' : ''}`}
                        x={p.x - 6.5}
                        y={p.y - 6.5}
                        width={13}
                        height={13}
                        transform={`rotate(45 ${p.x} ${p.y})`}
                      />
                    );
                  })}
              </svg>

              {/* 히트 선 (두께 14px) */}
              <svg className="pv-hit" width={layout.width} height={layout.height}>
                {layout.paths.map((p) => (
                  <path
                    key={`hit-${p.code}`}
                    d={p.d}
                    data-testid={`pv-hit-${p.code}`}
                    onMouseEnter={() => enter(p.code, 'canvas')}
                    onMouseMove={track}
                    onMouseLeave={leave}
                  />
                ))}
              </svg>

              {/* 치수 값 라벨 (흰 배경) */}
              {layout.paths.map((p) =>
                p.dim ? (
                  <span
                    className="pv-dimval num"
                    key={`dv-${p.code}`}
                    style={{ left: p.dim.lx, top: p.dim.ly }}
                  >
                    {p.dim.text}
                  </span>
                ) : null,
              )}
              {/* 전장 — 끝단↔끝단 경로 합이 확정될 때만 "전장"이라 쓴다 */}
              {model.span && (
                <span className="pv-dimval num" style={{ left: layout.width / 2, top: SPAN_Y }}>
                  {`전장 ${formatMm(model.span.lengthMm)}mm · ${model.span.fromRef} → ${model.span.toRef}`}
                  {model.span.pathCodes.length > 1 && ` (${model.span.pathCodes.join(' + ')})`}
                  {/* 무엇을 더한 값인지 밝힌다 — 구간 기준에는 사람이 넣은 값이 섞여 있다 */}
                  {model.span.basis === 'segment' && ' · 구간 길이 기준'}
                </span>
              )}
              {!model.span && model.longest && (
                <span className="pv-dimval is-empty" style={{ left: layout.width / 2, top: SPAN_Y }}>
                  {`최장 배선 ${formatMm(model.longest.lengthMm)}mm · ${model.longest.code} ${model.longest.fromRef} → ${model.longest.toRef}`}
                  {model.spanNote && ` — ${spanNoteText(model.spanNote)}`}
                </span>
              )}
              {!model.span && !model.longest && (
                <span className="pv-dimval is-empty" style={{ left: layout.width / 2, top: SPAN_Y }}>
                  전장 미입력 — 배선 길이를 넣으면 치수가 잡힙니다
                </span>
              )}

              {/* 분기점 라벨 */}
              {model.nodes
                .filter((n) => n.kind === 'branch')
                .map((n) => {
                  const p = layout.pos.get(n.id);
                  if (!p) return null;
                  return (
                    <span className="pv-brlabel" key={`brl-${n.id}`} style={{ left: p.x, top: p.y + 12 }}>
                      <b className="num">{n.ref}</b>
                      <span>· {n.name}</span>
                    </span>
                  );
                })}

              {/* 끝단 커넥터 카드 */}
              {model.nodes
                .filter((n) => n.kind === 'terminal')
                .map((n) => {
                  const p = layout.pos.get(n.id);
                  if (!p) return null;
                  const left = p.depth === 0 ? p.x - CARD_W : p.x;
                  return (
                    <TerminalCard
                      key={n.id}
                      node={n}
                      left={left}
                      top={p.y - CARD_H / 2}
                      selected={!!n.docId && n.docId === selection}
                      onSelect={onSelect}
                    />
                  );
                })}
            </>
          )}

          {/* 제목블록 */}
          <div className="pv-title">
            <div className="pv-title-row">
              <span>{doc.name} · 물리</span>
              <span className="num">{doc.drawingNo ?? '—'}</span>
            </div>
            <div className="pv-title-row is-sub">
              <span>치수 mm · 공차 ±5</span>
              <span className="num">{doc.rev ? `Rev.${doc.rev.replace(/^Rev\.?/i, '')}` : '—'}</span>
            </div>
          </div>
        </div>

        {/* 구간 호버 카드 — 표에서 올릴 때는 띄우지 않는다(커서가 캔버스 밖) */}
        {hotSeg && hotSrc === 'canvas' && (
          <SegmentCard
            seg={hotSeg}
            model={model}
            cables={cablesAt.get(hotSeg.code) ?? []}
            x={cursor.x}
            y={cursor.y}
          />
        )}
      </div>

      {/* ---------------- 우측: 구간표 · 자재 요약 ---------------- */}
      <aside className="pv-side">
        <div className="pv-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'seg'}
            className={tab === 'seg' ? 'is-on' : ''}
            onClick={() => setTab('seg')}
          >
            구간 <b className="num">{model.segments.length}</b>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mat'}
            className={tab === 'mat' ? 'is-on' : ''}
            onClick={() => setTab('mat')}
          >
            자재 <b className="num">{materials.length}</b>
          </button>
        </div>

        <div className="pv-scroll">
          {tab === 'seg' && (
            <>
              <table className="pv-table">
                <thead>
                  <tr>
                    <th className="c-seg">SEG</th>
                    <th>경로 · 보호재</th>
                    <th className="c-len">길이</th>
                    <th className="c-cnt">본수</th>
                  </tr>
                </thead>
                <tbody>
                  {model.segments.map((s) => (
                    <tr
                      key={s.code}
                      className={hot === s.code || selSegs.has(s.code) ? 'is-hot' : ''}
                      onMouseEnter={() => enter(s.code, 'table')}
                      onMouseLeave={leave}
                    >
                      <td className="c-seg num">{s.code}</td>
                      <td>
                        <div className="pv-path">
                          {s.fromRef} → {s.toRef}
                        </div>
                        <div className="pv-prot">보호재 미지정</div>
                      </td>
                      <td className="c-len num">
                        <LengthCell
                          seg={s}
                          onCommit={
                            onSegmentLength && ((mm) => onSegmentLength(s.key, mm))
                          }
                        />
                      </td>
                      <td className="c-cnt num">{s.count}본</td>
                    </tr>
                  ))}
                  {!model.segments.length && (
                    <tr>
                      <td colSpan={4} className="pv-none">
                        배선을 이으면 구간이 한 줄씩 채워집니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {/* 구간 길이가 어떤 근거로 나오는지 표 밑에 한 줄로 밝힌다 */}
              <p className="pv-note">
                구간 길이는 그 구간이 전 경로인 배선에서만 나옵니다 — 더 멀리 가는 배선의
                전장은 이 구간의 길이가 아니므로 근거가 없으면 <b>—</b> 로 둡니다.
                {onSegmentLength && (
                  <>
                    {' '}길이 칸에 직접 넣고 <b className="num">Enter</b> 를 누르면 그 값이
                    치수가 되고 <b>입력값</b> 으로 표시됩니다. 지우면 다시 배선에서 나온 값으로
                    돌아갑니다.
                  </>
                )}
              </p>
              <MaterialList rows={materials} />
            </>
          )}
          {tab === 'mat' && <MaterialList rows={materials} full />}
        </div>

        <div className="pv-status">
          <span>
            구간 <b className="num">{model.segments.length}</b> · 전선{' '}
            {/* 아는 길이가 하나도 없으면 0mm 가 아니라 — 다. 0 은 "0mm 로 자르라"로 읽힌다 */}
            <b className="num">
              {model.countedLength > 0 ? `${formatMm(model.totalWireMm)}mm` : '—'}
            </b>
            {/* 합계가 몇 본치인지 밝힌다 — 미입력분을 0 으로 더한 합은 짧아 보인다 */}
            {model.missingLength > 0 && model.countedLength > 0 && (
              <span className="num"> ({model.countedLength}본 기준)</span>
            )}
            {model.cableLength > 0 && (
              <span className="num"> · 케이블 기준 {model.cableLength}본</span>
            )}
            {model.missingLength > 0 && (
              <span className="pv-warn"> · 길이 미입력 {model.missingLength}본</span>
            )}
          </span>
          <span className="pv-hint">
            {hot ? `${hot} 강조 중` : '구간에 올리면 상세 · 표 동기 강조'}
          </span>
        </div>
      </aside>
    </div>
  );
}

// ================================================================
// 조각들
// ================================================================

function TerminalCard(props: {
  node: PhysNode;
  left: number;
  top: number;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const { node, left, top, selected, onSelect } = props;
  return (
    <button
      type="button"
      className={`pv-card${selected ? ' is-sel' : ''}${node.dashed ? ' is-dev' : ''}`}
      style={{ left, top, width: CARD_W }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.docId ?? null);
      }}
    >
      <span className="pv-card-h">
        <b className="num">{node.ref}</b>
        {node.pinCount != null && (
          <i className="pv-pins num">
            {node.pinCount}
            {node.dashed ? 'T' : 'P'}
          </i>
        )}
      </span>
      <span className="pv-card-b">
        <span className="pv-card-name">{node.name}</span>
        <span className="pv-card-mpn num">{node.mpn ?? (node.dashed ? '장치' : '—')}</span>
      </span>
    </button>
  );
}

/**
 * 구간표 길이 칸.
 *
 * `onCommit` 이 있으면 입력칸, 없으면 읽기 전용 표시다.
 * 입력은 **Enter · 포커스 이탈에서 한 번만** 반영한다 — 타이핑마다 문서를 고치면
 * 실행취소 스택이 글자 수만큼 쌓여 되돌릴 수 없다(속성 패널 길이 일괄 입력과 같은 방식).
 * 비우고 확정하면 입력값을 지운다 → 다시 배선에서 나온 값(없으면 미상)이 된다.
 */
function LengthCell(props: {
  seg: Segment;
  onCommit?: (mm: number | null) => void;
}): JSX.Element {
  const { seg, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const entered = seg.lengthSource === 'entered' ? seg.lengthMm : null;

  /** 입력값이 있는 줄에만 표를 남긴다 — 유도값에 매번 꼬리를 달면 이 표시가 묻힌다 */
  const mark = entered != null && (
    <i className="pv-lennote is-in">
      입력값
      {/* 유도값과 어긋나면 그 자리에서 알린다. 고치지는 않는다 — 검증도 같은 말을 한다 */}
      {seg.derivedMm != null && seg.derivedMm !== entered && (
        <b className="num"> · 배선 {formatMm(seg.derivedMm)}mm</b>
      )}
    </i>
  );

  if (!onCommit) {
    return (
      <>
        {seg.lengthMm != null ? `${formatMm(seg.lengthMm)}mm` : '—'}
        {/* 왜 — 인지 밝힌다. 빈 칸은 "아직 안 적었다"로 읽히지만
            여기 대부분은 "이 데이터로는 알 수 없다"이다 */}
        {seg.lengthMm == null && (
          <i className="pv-lennote">{segmentLengthNoteText(seg.lengthNote ?? 'none')}</i>
        )}
        {mark}
      </>
    );
  }

  const commit = () => {
    if (draft == null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw) {
      onCommit(null);        // 지우면 유도값/미상으로 되돌린다
      return;
    }
    const v = Number(raw);
    // 못 읽는 값·0 이하는 받지 않는다. 0mm 구간은 만들 수 없고, 그 숫자가 도면에
    // 오르면 "0mm 로 자르라"는 지시가 된다. 조용히 초안만 버려 원래 값이 남는다.
    if (!Number.isFinite(v) || v <= 0) return;
    onCommit(v);
  };

  return (
    <>
      <input
        className={`pv-leninput num${entered != null ? ' is-in' : ''}`}
        aria-label={`${seg.code} 구간 길이 (mm)`}
        // 입력값이 없으면 유도값을 흐린 글씨로 비쳐 둔다 — 지금 도면에 그려진
        // 숫자가 무엇인지 보이면서도, 그 자리가 비어 있다는 것도 같이 보인다.
        placeholder={seg.derivedMm != null ? formatMm(seg.derivedMm) : '—'}
        value={draft ?? (entered != null ? String(entered) : '')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);   // 고치던 것을 되돌린다
        }}
      />
      <span className="pv-lenunit num">mm</span>
      {seg.lengthMm == null && (
        <i className="pv-lennote">{segmentLengthNoteText(seg.lengthNote ?? 'none')}</i>
      )}
      {mark}
    </>
  );
}

/** 구간 호버 카드 — 폭 250px, 논리 뷰 배선 카드와 같은 골격 */
function SegmentCard(props: {
  seg: Segment;
  model: PhysicalModel;
  /** 이 구간을 자켓째 지나는 케이블 이름들 */
  cables: string[];
  x: number;
  y: number;
}) {
  const { seg, model, cables, x, y } = props;
  const left = x > 380 ? x - 266 : x + 16;
  const top = Math.min(Math.max(y - 40, 8), 700);
  const wires = seg.wireIds.map((id) => model.wireCodes.get(id) ?? id);
  return (
    <div className="pv-hover" style={{ left, top }} data-testid="pv-hover">
      <div className="pv-hover-h">
        <b className="num">{seg.code}</b>
        <span>
          {seg.fromRef} → {seg.toRef}
        </span>
      </div>
      <div className="pv-hover-b">
        <div className="pv-grid3">
          <div>
            {/* 같은 자리에서 값과 출처를 함께 읽히게 한다 — 숫자만 보면 어디서 온
                값인지 알 수 없고, 도면을 고칠 때 그게 제일 먼저 필요한 정보다 */}
            <i>
              {seg.lengthMm == null
                ? '길이 미상'
                : seg.lengthSource === 'entered'
                  ? '길이 · 입력값'
                  : '길이'}
            </i>
            <b className="num">{seg.lengthMm != null ? `${formatMm(seg.lengthMm)}mm` : '—'}</b>
          </div>
          <div>
            <i>본수</i>
            <b className="num">{seg.count}본</b>
          </div>
          <div>
            <i>외경 추정</i>
            <b className="num">{seg.odMm != null ? `Ø${seg.odMm}` : '—'}</b>
          </div>
        </div>
        {/* 실치수를 못 내면 그 이유와, 판단 근거가 된 배선 전장 범위를 같이 보여준다.
            범위는 참고값이지 구간 치수가 아니라는 것을 문구로 못 박는다. */}
        {seg.lengthMm == null && (
          <p className="pv-note">
            {segmentLengthNoteText(seg.lengthNote ?? 'none')}
            {seg.wireRangeMm && ` · 지나는 배선 전장 ${formatRange(seg.wireRangeMm)} (구간 치수 아님)`}
            {seg.missingLength > 0 && ` · 길이 미입력 ${seg.missingLength}본`}
          </p>
        )}
        {/* 입력값이 유도값을 덮었으면 덮었다고 쓴다. 어느 쪽이 맞는지는 사람만 안다 */}
        {seg.lengthSource === 'entered' && seg.derivedMm != null && seg.derivedMm !== seg.lengthMm && (
          <p className="pv-note">
            {`이 구간이 전 경로인 배선은 ${formatMm(seg.derivedMm)}mm 입니다 — 입력값과 다릅니다. 어느 쪽이 맞는지 확인하세요.`}
          </p>
        )}
        {seg.lengthSource === 'entered' && seg.derivedMm == null && (
          <p className="pv-note">
            {`배선에서 유도할 근거는 없습니다 (${segmentLengthNoteText(seg.lengthNote ?? 'none')}) — 직접 넣은 값입니다.`}
          </p>
        )}
        {/* 이 구간이 자켓 안을 지나면 그 사실을 밝힌다 — 외경·보호재 판단이 달라진다 */}
        {cables.length > 0 && (
          <p className="pv-wires">
            <i>케이블 자켓</i> <span>{cables.join(' · ')}</span>
          </p>
        )}
        <p className="pv-note">보호재 미지정 · 외경은 √본수 × 심선 외경 추정값</p>
        <p className="pv-wires">
          <i>포함 배선</i> <span className="num">{wires.join(' ')}</span>
        </p>
      </div>
    </div>
  );
}

function MaterialList(props: { rows: ReturnType<typeof materialRows>; full?: boolean }) {
  const { rows, full } = props;
  return (
    <section className={`pv-mat${full ? ' is-full' : ''}`}>
      <h3 className="label-caps">자재 요약</h3>
      {rows.map((r) => (
        <div className="pv-mat-row" key={r.key}>
          <span className="pv-mat-name">{r.name}</span>
          <span className="pv-mat-spec num">{r.spec}</span>
          <span className="pv-mat-qty num">{r.qty}</span>
        </div>
      ))}
      {!rows.length && <p className="pv-none">집계할 자재가 없습니다.</p>}
      <p className="pv-note">보호재(슬리브·테이프)는 아직 지정된 데이터가 없어 빠져 있습니다.</p>
    </section>
  );
}
