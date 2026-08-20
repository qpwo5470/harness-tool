/**
 * 라이브러리 행 앞에 붙는 **작은 형상 기호**.
 *
 * 목록이 글자만이면 "이게 암놈인지 숫놈인지, 어떻게 생긴 애인지" 를 이름에서
 * 되짚어야 한다. 이름은 제조사마다 규칙이 달라 그게 잘 안 된다
 * (`XHP-10` 은 암, `B10B-XH-A` 는 보드, `43020` 은 수 — 글자만 봐선 모른다).
 *
 * 그래서 세 가지를 한 그림에 담는다.
 *
 *   1. **몸통 모양** = 역할. 래치 달린 상자(전선측) · 보드 위 상자(보드측) ·
 *      압착 날개(단자) · Y 자(스플라이스)
 *   2. **접점 기호** = 성별. 빈 동그라미 ○ 는 암(구멍), 찬 동그라미 ● 는 수(핀),
 *      네모 ▪ 는 보드 헤더의 각핀
 *   3. **접점 배열** = 열 × 행. 2×12 짜리와 1×4 짜리가 한눈에 갈린다
 *
 * 색은 쓰지 않는다 — 이 도구에서 색은 전선 색이라는 뜻이 이미 있어서, 여기에
 * 색을 더하면 도면의 색과 헷갈린다. 형태만으로 구분한다.
 *
 * 순수 표시용이라 상태도 부수효과도 없다.
 */
import type { PartLibraryItem, PinSlot } from '../types';
import { roleOf } from './taxonomy';

/** 한 기호가 그리는 최대 칸 수. 넘으면 마지막 칸을 ⋯ 로 줄인다. */
const MAX_COLS = 6;
const MAX_ROWS = 3;

const W = 34;
const H = 22;

/**
 * 핀 배열 → 열·행. `pinLayout` 이 있으면 그 좌표를, 없으면 핀 수로 한 줄을 만든다.
 * (`PinSlot.offset` 은 정규화된 칸 좌표 — x=열, y=행)
 */
export function symbolGrid(pinCount?: number, layout?: PinSlot[]): { cols: number; rows: number } {
  if (layout?.length) {
    let cols = 0;
    let rows = 0;
    for (const s of layout) {
      cols = Math.max(cols, Math.round(s.offset.x) + 1);
      rows = Math.max(rows, Math.round(s.offset.y) + 1);
    }
    if (cols > 0 && rows > 0) return { cols, rows };
  }
  const n = Math.max(1, pinCount ?? 1);
  return { cols: n, rows: 1 };
}

type Props = { part: PartLibraryItem };

export function PartSymbol({ part }: Props) {
  const role = roleOf(part).key;
  const g = part.gender;

  // 단자·스플라이스는 핀 격자가 뜻이 없다 — 전용 그림을 따로 그린다.
  if (role === 'terminal') return <TerminalGlyph />;
  if (role === 'splice') return <SpliceGlyph />;

  const { cols, rows } = symbolGrid(part.pinCount, part.pinLayout);
  const drawCols = Math.min(cols, MAX_COLS);
  const drawRows = Math.min(rows, MAX_ROWS);
  const truncated = cols > MAX_COLS || rows > MAX_ROWS;

  // 몸통. 보드측은 아래에 기판 선이 깔리므로 그만큼 위로 올린다.
  const boardBar = role === 'board';
  const bx = 2;
  const by = role === 'wire' ? 4 : 2;
  const bw = W - 4;
  const bh = (boardBar ? H - 7 : H - 6) - (role === 'wire' ? 0 : 0);

  const cellW = bw / drawCols;
  const cellH = bh / drawRows;

  const marks: React.ReactNode[] = [];
  for (let r = 0; r < drawRows; r++) {
    for (let c = 0; c < drawCols; c++) {
      const cx = bx + (c + 0.5) * cellW;
      const cy = by + (r + 0.5) * cellH;
      const last = truncated && c === drawCols - 1 && r === drawRows - 1;
      marks.push(<Contact key={`${r}-${c}`} cx={cx} cy={cy} gender={g} ellipsis={last} />);
    }
  }

  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      {/* 전선측 하우징의 래치 — 이 돌기가 "손으로 뽑는 커넥터" 라는 표시 */}
      {role === 'wire' && <path d={`M ${W / 2 - 5} 4 v -2 h 10 v 2`} className="ps-line" />}
      <rect x={bx} y={by} width={bw} height={bh} rx={1.5} className="ps-body" />
      {marks}
      {/* 보드측 — 기판 면과 실장 다리 */}
      {boardBar && (
        <>
          <path d={`M ${bx + 3} ${H - 3.5} h 4 M ${W - bx - 7} ${H - 3.5} h 4`} className="ps-line" />
          <path d={`M 1 ${H - 1.5} h ${W - 2}`} className="ps-board" />
        </>
      )}
    </svg>
  );
}

/** 접점 하나 — 성별이 곧 모양이다 */
function Contact({
  cx, cy, gender, ellipsis,
}: { cx: number; cy: number; gender?: PartLibraryItem['gender']; ellipsis?: boolean }) {
  if (ellipsis) {
    // 잘라낸 자리 — 개수가 더 있다는 표시. 실제 핀 수는 옆의 `NP` 배지가 말한다.
    return <text x={cx} y={cy + 2.5} className="ps-more" textAnchor="middle">⋯</text>;
  }
  switch (gender) {
    case 'receptacle': // 암 = 구멍
      return <circle cx={cx} cy={cy} r={1.9} className="ps-hole" />;
    case 'plug': // 수 = 핀
      return <circle cx={cx} cy={cy} r={1.8} className="ps-pin" />;
    case 'header': // 보드 = 각핀
      return <rect x={cx - 1.6} y={cy - 1.6} width={3.2} height={3.2} className="ps-pin" />;
    case 'neutral':
      return <path d={`M ${cx - 1.8} ${cy} h 3.6`} className="ps-line" />;
    default:
      // 성별 미지정 — 비워 두면 "확인했는데 없다" 로 읽힌다. 물음표로 남긴다.
      return <text x={cx} y={cy + 2.6} className="ps-more" textAnchor="middle">?</text>;
  }
}

/** 압착단자 — 접촉부 + 전선 압착 날개 두 쌍 */
function TerminalGlyph() {
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <path d="M 3 8 h 9 v 6 h -9 z" className="ps-body" />
      <path d="M 12 7.5 l 5 -3 M 12 14.5 l 5 3" className="ps-line" />
      <path d="M 17 6 h 6 v 10 h -6" className="ps-line" />
      <path d="M 23 9 h 8" className="ps-wire" />
    </svg>
  );
}

/** 스플라이스 — 여러 전선이 한 점에서 만난다 */
function SpliceGlyph() {
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <path d="M 3 5 L 17 11 M 3 17 L 17 11 M 31 11 L 17 11" className="ps-wire" />
      <circle cx={17} cy={11} r={3} className="ps-pin" />
    </svg>
  );
}
