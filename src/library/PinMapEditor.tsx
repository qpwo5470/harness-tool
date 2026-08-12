/**
 * Agent B 소유 — 하우징 핀맵 에디터 (Claude Design 2차 리디자인 §8).
 *
 * 하우징 하나를 정의한다: 분류/이름/제조사/MPN/피치/비고 + 핀 배열(열×행) + 핀별 신호명·규격색.
 *
 * 2차 리디자인에서 바뀐 것 — 3열(좌 폼 / 중 그리드 / 우 핀 속성)을 **2열**로 줄였다.
 * 우측 핀 속성 열이 핀을 클릭하기 전까지 늘 비어 있었기 때문에, 그리드 바로 아래
 * **가로 스트립**으로 붙였다(자리는 항상 유지하고 미선택 시 흐리게). 고르는 곳과
 * 값을 넣는 곳이 붙어 있어야 왕복이 없다.
 *
 * 그리드는 캔버스의 하우징 심볼과 같은 규격(패드 26px · 피치 30px · 래치 돌기 · 등록 마크)으로
 * 그린다 — 여기서 정의한 형상이 도면에 그대로 나온다는 것이 보여야 한다.
 * (규격 출처: canvas/nodes.tsx 의 PAD/PITCH, canvas.css 의 .hz-housing/.hz-pad/.hz-regmark)
 *
 * 스타일은 pinmap.css 에만 있다. 색은 tokens.css 변수만 쓰고,
 * 규격 전선색 12색 팔레트만 예외로 hex 를 직접 갖는다(도면 색이라 토큰이 아니다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartLibraryItem, PinSlot, PartCategory, PartGender } from '../types';
import { newCustomPartId } from './customParts';
import { GENDER_LONG } from './gender';
import './pinmap.css';

/** 캔버스와 동일 규격: 패드 26px + 간격 4px = 피치 30px */
const PAD = 26;
const GAP_X = 4;
const GAP_Y = 3; // 패드 아래 신호명 캡션이 같은 셀에 들어가므로 세로 간격은 3px

const MAX_COLS = 24;
const MAX_ROWS = 8;

type Props = {
  /** 편집할 부품 (없으면 새로 만들기) */
  initial?: PartLibraryItem;
  onSave: (part: PartLibraryItem) => void;
  onCancel: () => void;
};

const CATEGORIES: { value: PartCategory; label: string }[] = [
  { value: 'housing', label: '커넥터 하우징' },
  { value: 'board-to-wire', label: '보드투와이어' },
  { value: 'splice', label: '스플라이스' },
  { value: 'terminal', label: '터미널' },
];

/**
 * 결합 성별 — 미지정('')을 포함한 5택.
 * 발주에서 틀리면 현장에서 못 쓰는 값이라 "모르면 미지정"이 기본값이다.
 */
const GENDER_CHOICES: { value: PartGender | ''; label: string; hint: string }[] = [
  { value: '', label: '미지정', hint: '아직 모른다 — 비워 둔다' },
  { value: 'receptacle', label: '암', hint: GENDER_LONG.receptacle },
  { value: 'plug', label: '수', hint: GENDER_LONG.plug },
  { value: 'header', label: '보드', hint: GENDER_LONG.header },
  { value: 'neutral', label: '없음', hint: GENDER_LONG.neutral },
];

/** 1번 핀이 앉는 모서리 */
type Origin = 'tl' | 'tr' | 'bl' | 'br';
const ORIGINS: { value: Origin; label: string }[] = [
  { value: 'tl', label: '좌상' },
  { value: 'tr', label: '우상' },
  { value: 'bl', label: '좌하' },
  { value: 'br', label: '우하' },
];

/** 핀 번호를 매기는 순서 */
type Order = 'row' | 'snake' | 'col';
const ORDERS: { value: Order; label: string; hint: string }[] = [
  { value: 'row', label: '행 우선', hint: '각 행을 같은 방향으로' },
  { value: 'snake', label: '지그재그', hint: '행마다 방향을 뒤집어서' },
  { value: 'col', label: '열 우선', hint: '각 열을 위에서 아래로' },
];

/** 규격 전선색 12색 — 도면 색이라 토큰이 아니라 실제 색을 갖는다 */
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

/** "white/orange" 같은 값의 앞쪽 색을 미리보기 색점으로 */
function swatchOf(c?: string): string {
  const base = (c ?? '').split('/')[0].trim().toLowerCase();
  return STD_COLORS.find((s) => s.key === base)?.css ?? 'transparent';
}

// ================================================================
// 번호 매기기 — 1번 핀 위치 × 번호 방향의 조합
// ================================================================

/**
 * 격자 셀을 "번호가 매겨지는 순서"로 늘어놓는다.
 * 1번 핀 위치(origin)가 스캔 시작 모서리를, 방향(order)이 스캔 방식을 정한다.
 */
export function numberingOrder(
  cols: number,
  rows: number,
  origin: Origin,
  order: Order,
): { x: number; y: number }[] {
  const xs = Array.from({ length: cols }, (_, i) => i);
  const ys = Array.from({ length: rows }, (_, i) => i);
  if (origin === 'tr' || origin === 'br') xs.reverse();
  if (origin === 'bl' || origin === 'br') ys.reverse();

  const out: { x: number; y: number }[] = [];
  if (order === 'col') {
    // 열 우선: 한 열을 끝까지 훑고 다음 열로
    for (const x of xs) for (const y of ys) out.push({ x, y });
  } else {
    for (let ri = 0; ri < ys.length; ri++) {
      const line = order === 'snake' && ri % 2 === 1 ? [...xs].reverse() : xs;
      for (const x of line) out.push({ x: x, y: ys[ri] });
    }
  }
  return out;
}

/**
 * 격자를 (재)생성한다.
 * 신호·색은 **물리 위치(offset)** 를 따라가고 번호만 새로 부여된다.
 * 열·행을 줄여 격자 밖으로 나간 핀은 사라진다.
 */
export function buildPins(
  cols: number,
  rows: number,
  origin: Origin,
  order: Order,
  prev: PinSlot[],
): PinSlot[] {
  return numberingOrder(cols, rows, origin, order).map((cell, i) => {
    const old = prev.find((p) => p.offset.x === cell.x && p.offset.y === cell.y);
    return {
      index: i + 1,
      label: String(i + 1),
      offset: { x: cell.x, y: cell.y },
      signal: old?.signal,
      stdColor: old?.stdColor,
    };
  });
}

export function PinMapEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '');
  const [mpn, setMpn] = useState(initial?.mpn ?? '');
  const [category, setCategory] = useState<PartCategory>(initial?.category ?? 'housing');
  const [gender, setGender] = useState<PartGender | ''>(initial?.gender ?? '');
  const [pitch, setPitch] = useState(initial?.spec?.['피치'] ?? '');
  const [note, setNote] = useState(initial?.spec?.['비고'] ?? '');
  const [applyTo, setApplyTo] = useState(initial?.spec?.['적용'] ?? '');
  const [applyDraft, setApplyDraft] = useState('');
  const [crimpRange, setCrimpRange] = useState(initial?.spec?.['압착 범위'] ?? '');
  const [tool, setTool] = useState(initial?.spec?.['공구'] ?? '');

  const isTerminal = category === 'terminal';

  // 초기 그리드 크기: 기존 핀 배치에서 역산
  const initCols = initial?.pinLayout?.length
    ? Math.max(...initial.pinLayout.map((s) => s.offset.x)) + 1
    : 4;
  const initRows = initial?.pinLayout?.length
    ? Math.max(...initial.pinLayout.map((s) => s.offset.y)) + 1
    : 1;

  const [cols, setCols] = useState(initCols);
  const [rows, setRows] = useState(initRows);
  const [origin, setOrigin] = useState<Origin>('tl');
  const [order, setOrder] = useState<Order>('row');
  const [pins, setPins] = useState<PinSlot[]>(
    initial?.pinLayout?.length ? initial.pinLayout : buildPins(4, 1, 'tl', 'row', []),
  );
  /** 선택은 **물리 셀** 로 들고 있는다 — 번호를 다시 매겨도 고른 패드가 그대로 남는다 */
  const [selCell, setSelCell] = useState<{ x: number; y: number } | null>(null);

  /**
   * 열·행·1번 핀·번호 방향 중 하나라도 바뀌면 격자를 다시 만든다.
   * 첫 렌더는 건너뛴다 — 편집으로 들어온 기존 부품의 번호·표기를 보존해야 한다.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setPins((prev) => buildPins(cols, rows, origin, order, prev));
  }, [cols, rows, origin, order]);

  const selectedPin = useMemo(
    () => (selCell ? pins.find((p) => p.offset.x === selCell.x && p.offset.y === selCell.y) ?? null : null),
    [pins, selCell],
  );

  const patchPin = (cell: { x: number; y: number }, patch: Partial<PinSlot>) =>
    setPins((prev) =>
      prev.map((p) => (p.offset.x === cell.x && p.offset.y === cell.y ? { ...p, ...patch } : p)),
    );

  const bump = (which: 'cols' | 'rows', delta: number) => {
    if (which === 'cols') setCols((v) => Math.max(1, Math.min(MAX_COLS, v + delta)));
    else setRows((v) => Math.max(1, Math.min(MAX_ROWS, v + delta)));
    setSelCell(null);
  };

  const originLabel = ORIGINS.find((o) => o.value === origin)!.label;
  const originNote = `1번 핀 ${originLabel} · 래치 상면 · 결합면 기준`;

  const canSave = name.trim().length > 0;

  const applyChips = applyTo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const setApplyChips = (list: string[]) => setApplyTo(list.join(', '));
  const addApplyChip = (v: string) => {
    const t = v.trim();
    if (!t || applyChips.includes(t)) return;
    setApplyChips([...applyChips, t]);
  };

  const save = () => {
    const spec: Record<string, string> = {};
    if (pitch.trim()) spec['피치'] = pitch.trim();
    if (note.trim()) spec['비고'] = note.trim();
    if (isTerminal) {
      if (applyTo.trim()) spec['적용'] = applyTo.trim();
      if (crimpRange.trim()) spec['압착 범위'] = crimpRange.trim();
      if (tool.trim()) spec['공구'] = tool.trim();
    }

    const part: PartLibraryItem = {
      // 복제(빈 id)나 신규는 새 커스텀 id 발급, 기존 커스텀 편집은 id 유지
      id: initial?.id || newCustomPartId(),
      category,
      name: name.trim(),
      manufacturer: manufacturer.trim() || undefined,
      mpn: mpn.trim() || undefined,
      spec: Object.keys(spec).length ? spec : undefined,
      pinCount: pins.length,
      pinLayout: [...pins].sort((a, b) => a.index - b.index),
    };
    // 미지정이면 필드 자체를 만들지 않는다 — 빈 값과 "성별 없음"은 다른 뜻이다
    if (gender) part.gender = gender;
    onSave(part);
  };

  const title = initial ? '부품 편집' : '새 부품 만들기';

  // ── 좌: 분류 ────────────────────────────────────────────────
  const catButtons = (
    <div className="pm-group">
      <div className="label-caps">분류</div>
      <div className="pm-cats" role="radiogroup" aria-label="분류 선택">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            className={`pm-cat${category === c.value ? ' on' : ''}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {/*
        네이티브 select 폴백 — 시각 컨트롤은 위 2×2 버튼이다.
        값 동기화용으로만 남겨 두었고(스크린 리더는 위 radiogroup 을 읽는다),
        기존 DOM 테스트가 이 select 로 분류를 바꾼다.
      */}
      <select
        className="pm-sr"
        aria-hidden
        tabIndex={-1}
        value={category}
        onChange={(e) => setCategory(e.target.value as PartCategory)}
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </div>
  );

  // ── 좌: 결합 성별 ──────────────────────────────────────────
  const genderButtons = (
    <div className="pm-group">
      <div className="label-caps">결합 성별</div>
      <div className="pm-genders" role="radiogroup" aria-label="결합 성별 선택">
        {GENDER_CHOICES.map((g) => (
          <button
            key={g.value || 'none'}
            type="button"
            role="radio"
            aria-checked={gender === g.value}
            className={`pm-cat${gender === g.value ? ' on' : ''}`}
            title={g.hint}
            onClick={() => setGender(g.value)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="pm-hint">
        발주에서 암수를 잘못 사면 현장에서 못 씁니다. 모르면 미지정으로 두세요.
      </p>
    </div>
  );

  // ── 좌: 핀 배열 (하우징 계열) ───────────────────────────────
  const stepper = (which: 'cols' | 'rows', value: number) => (
    <div className="pm-step">
      <button type="button" aria-label={which === 'cols' ? '열 줄이기' : '행 줄이기'} onClick={() => bump(which, -1)}>−</button>
      <span className="pm-step-val num">{value}</span>
      <button type="button" aria-label={which === 'cols' ? '열 늘리기' : '행 늘리기'} onClick={() => bump(which, +1)}>+</button>
    </div>
  );

  const arrangeBlock = (
    <div className="pm-block">
      <div className="pm-block-head">
        <span className="label-caps">핀 배열</span>
        <span className="pm-total num">{pins.length}핀</span>
      </div>

      <div className="pm-row">
        <span className="pm-lab">열 <em>가로</em></span>
        {stepper('cols', cols)}
        <span className="pm-lab pm-lab-2">행 <em>세로</em></span>
        {stepper('rows', rows)}
      </div>

      <div className="pm-row">
        <span className="pm-lab">1번 핀</span>
        <div className="pm-origins" role="radiogroup" aria-label="1번 핀 위치">
          {ORIGINS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={origin === o.value}
              className={`pm-origin${origin === o.value ? ' on' : ''}`}
              onClick={() => setOrigin(o.value)}
              title={`1번 핀을 ${o.label} 모서리에 둔다`}
            >
              <span className={`pm-origin-box ${o.value}`} aria-hidden>
                <i className="pm-origin-dot" />
              </span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pm-sublabel">핀 번호 방향</div>
      <div className="pm-orders" role="radiogroup" aria-label="핀 번호 방향">
        {ORDERS.map((o) => {
          // 실제 번호가 찍힌 4×2 미니 격자 — 현재 1번 핀 위치까지 반영한다
          const seq = numberingOrder(4, 2, origin, o.value);
          const cells: number[] = Array(8).fill(0);
          seq.forEach((c, i) => { cells[c.y * 4 + c.x] = i + 1; });
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={order === o.value}
              className={`pm-order${order === o.value ? ' on' : ''}`}
              onClick={() => setOrder(o.value)}
              title={o.hint}
            >
              <span className="pm-mini" aria-hidden>
                {cells.map((n, i) => (
                  <i key={i} className={`pm-mini-cell num${n === 1 ? ' one' : ''}`}>{n}</i>
                ))}
              </span>
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const terminalFormBlock = (
    <div className="pm-block">
      <div className="pm-row">
        <span className="pm-lab">압착 범위</span>
        <input
          className="pm-in num"
          value={crimpRange}
          onChange={(e) => setCrimpRange(e.target.value)}
          placeholder="AWG 22–26"
        />
      </div>
      <div className="pm-row">
        <span className="pm-lab">공구</span>
        <input
          className="pm-in num"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          placeholder="예: YRF-880"
        />
      </div>
      <p className="pm-hint">
        터미널은 낱개 부품이라 핀 배치를 정의하지 않습니다.
        커넥터 속성의 터미널 지정 목록에 이 이름으로 나타납니다.
      </p>
    </div>
  );

  // ── 우: 하우징 심볼 ─────────────────────────────────────────
  const symbol = (
    <div className="pm-stage">
      <div className="pm-frame" aria-hidden />
      <div className="pm-sym">
        <div className="pm-ref">
          <b className="num">J?</b>
          <span>{name.trim() || '—'}</span>
        </div>
        <div className="pm-housing">
          <div
            className="pm-pins"
            style={{
              gridTemplateColumns: `repeat(${cols}, ${PAD}px)`,
              columnGap: GAP_X,
              rowGap: GAP_Y,
            }}
          >
            {pins.map((p) => {
              const on = selCell?.x === p.offset.x && selCell?.y === p.offset.y;
              const dot = swatchOf(p.stdColor);
              return (
                <div
                  key={`${p.offset.x},${p.offset.y}`}
                  className="pm-cell"
                  style={{ gridColumn: p.offset.x + 1, gridRow: p.offset.y + 1 }}
                >
                  <button
                    type="button"
                    className={`pm-pad${p.signal ? ' assigned' : ''}${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={
                      `핀 ${p.index} · ${p.offset.x + 1}열 ${p.offset.y + 1}행` +
                      (p.signal ? ` · ${p.signal}` : '')
                    }
                    onClick={() => setSelCell({ x: p.offset.x, y: p.offset.y })}
                  >
                    <span className="num">{p.label ?? p.index}</span>
                    {p.stdColor && (
                      <i className="pm-dot" style={{ background: dot }} aria-hidden />
                    )}
                  </button>
                  <span className="pm-cap num" title={p.signal ?? ''}>{p.signal ?? ''}</span>
                </div>
              );
            })}
          </div>
          <span className="pm-latch" aria-hidden title="래치(결합) 방향" />
          <span className="pm-regmark" aria-hidden title="1번 핀 기준점" />
        </div>
        <div className="pm-note num">{originNote}</div>
      </div>
    </div>
  );

  // ── 우: 핀 속성 가로 스트립 (미선택이어도 자리는 유지) ──────
  const cellInfo = selectedPin
    ? `${selectedPin.offset.x + 1}열 ${selectedPin.offset.y + 1}행 · ${cols}×${rows}`
    : '패드를 클릭하세요';

  const strip = (
    <div className={`pm-strip${selectedPin ? '' : ' off'}`}>
      <div className="pm-strip-side">
        <div className="label-caps">핀 속성</div>
        <div className="pm-strip-title num">{selectedPin ? `핀 ${selectedPin.index}` : '—'}</div>
        <div className="pm-strip-sub">{cellInfo}</div>
      </div>
      <div className="pm-strip-fields">
        <div className="pm-strip-row">
          <span className="pm-lab-sm">표기</span>
          <input
            className="pm-in-sm num"
            aria-label="핀 표기"
            disabled={!selectedPin}
            value={selectedPin?.label ?? ''}
            onChange={(e) => selCell && patchPin(selCell, { label: e.target.value })}
            placeholder="1, A1"
          />
          <span className="pm-lab-sm pm-lab-2">신호명</span>
          <input
            className="pm-in-sm grow"
            aria-label="신호명"
            disabled={!selectedPin}
            value={selectedPin?.signal ?? ''}
            onChange={(e) => selCell && patchPin(selCell, { signal: e.target.value || undefined })}
            placeholder="+24V · GND · TX"
          />
        </div>
        <div className="pm-strip-row">
          <span className="pm-lab-sm">규격 색</span>
          <div className="pm-chips">
            {STD_COLORS.map((c) => {
              const on = (selectedPin?.stdColor ?? '').trim().toLowerCase() === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`pm-chip${on ? ' on' : ''}${c.light ? ' light' : ''}`}
                  style={{ background: c.css }}
                  aria-pressed={on}
                  aria-label={`규격 색 ${c.ko}`}
                  title={`${c.ko} ${c.key}`}
                  disabled={!selectedPin}
                  onClick={() => selCell && patchPin(selCell, { stdColor: c.key })}
                >
                  <span className="num">{c.code}</span>
                </button>
              );
            })}
          </div>
          <input
            className="pm-in-sm num pm-color-free"
            aria-label="규격 색 직접 입력"
            disabled={!selectedPin}
            value={selectedPin?.stdColor ?? ''}
            onChange={(e) => selCell && patchPin(selCell, { stdColor: e.target.value || undefined })}
            placeholder="직접 입력"
          />
        </div>
        <div className="pm-hint">
          규격 색을 넣으면 이 핀에서 결선할 때 와이어 색이 자동으로 제안됩니다.
        </div>
      </div>
    </div>
  );

  // ── 우: 터미널 (압착 단면 도해 + 적용 하우징) ───────────────
  const terminalRight = (
    <>
      <div className="pm-right-head">
        <span className="label-caps">터미널</span>
        <span className="pm-right-sub">핀 배치를 정의하지 않습니다 — 적용 하우징으로 연결합니다</span>
      </div>
      <div className="pm-stage">
        <div className="pm-frame" aria-hidden />
        <div className="pm-sym">
          <div className="pm-crimp" aria-hidden>
            <span className="pm-crimp-ins" />
            <span className="pm-crimp-core" />
            <span className="pm-crimp-tip" />
          </div>
          <div className="pm-crimp-labels num">
            <span className="pm-crimp-l1">피복</span>
            <span className="pm-crimp-l2">심선</span>
            <span className="pm-crimp-l3">접촉부</span>
          </div>
          <div className="pm-note num">압착 단면 · 참고 도해</div>
        </div>
      </div>
      <div className="pm-strip pm-strip-apply">
        <div className="pm-apply">
          <div className="label-caps">적용 하우징</div>
          <div className="pm-apply-row">
            {applyChips.map((a) => (
              <span key={a} className="pm-apply-chip">
                {a}
                <button
                  type="button"
                  aria-label={`${a} 제거`}
                  onClick={() => setApplyChips(applyChips.filter((v) => v !== a))}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="pm-in-sm grow"
              aria-label="적용 하우징"
              value={applyDraft}
              placeholder="SMH250 (2.5mm)"
              onChange={(e) => setApplyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addApplyChip(applyDraft);
                  setApplyDraft('');
                }
              }}
              onBlur={() => {
                if (applyDraft.trim()) {
                  addApplyChip(applyDraft);
                  setApplyDraft('');
                }
              }}
            />
          </div>
          <div className="pm-hint">지정한 하우징의 커넥터 속성에서 이 터미널이 후보로 먼저 뜹니다.</div>
        </div>
      </div>
    </>
  );

  return (
    <div className="pm-backdrop" onClick={onCancel}>
      <div
        className="pm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pm-head">
          <span className="pm-title">{title}</span>
          <span className="pm-head-sub num">라이브러리 · 사용자 추가</span>
          <div className="pm-spacer" />
          <span className={`pm-req${canSave ? ' ok' : ''}`}>
            {canSave ? '저장할 수 있습니다' : '이름을 입력해야 저장됩니다'}
          </span>
          <button type="button" className="pm-btn" onClick={onCancel}>취소</button>
          <button type="button" className="pm-btn primary" disabled={!canSave} onClick={save}>저장</button>
        </header>

        <div className="pm-body">
          {/* 좌 340px — 무엇을 만드는지 */}
          <div className="pm-left">
            {catButtons}
            {genderButtons}

            <div className="pm-fields">
              <div className="pm-row">
                <span className="pm-lab">이름 <b>*</b></span>
                <input
                  className="pm-in"
                  aria-label="이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: SMH250-06"
                />
              </div>
              <div className="pm-row">
                <span className="pm-lab">제조사</span>
                <input
                  className="pm-in"
                  aria-label="제조사"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="YEONHO"
                />
              </div>
              <div className="pm-row">
                <span className="pm-lab">MPN</span>
                <input
                  className="pm-in num"
                  aria-label="MPN"
                  value={mpn}
                  onChange={(e) => setMpn(e.target.value)}
                  placeholder="발주 코드"
                />
              </div>
              <div className="pm-row">
                <span className="pm-lab">피치</span>
                <input
                  className="pm-in num pm-in-narrow"
                  aria-label="피치"
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  placeholder="2.5mm"
                />
              </div>
              <div className="pm-row top">
                <span className="pm-lab">비고</span>
                <textarea
                  className="pm-ta"
                  aria-label="비고"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="결합 상대물 · 정격 등"
                />
              </div>
            </div>

            {isTerminal ? terminalFormBlock : arrangeBlock}
          </div>

          {/* 우 — 어떻게 생겼는지 */}
          <div className="pm-right">
            {isTerminal ? (
              terminalRight
            ) : (
              <>
                <div className="pm-right-head">
                  <span className="label-caps">핀 배치</span>
                  <span className="pm-right-sub">패드를 클릭해 신호·색을 넣는다</span>
                  <div className="pm-spacer" />
                  <span className="pm-right-note num">{originNote}</span>
                </div>
                {symbol}
                {strip}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
