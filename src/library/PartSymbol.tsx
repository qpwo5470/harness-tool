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

  // 끝단 종류가 명시된 부품은 상자 대신 그 생김새로 그린다(`PartLibraryItem.endKind`).
  // 이름으로 추측하지 않는다 — 표시가 없으면 아래 일반 규칙으로 간다.
  if (part.endKind === 'dsub') return <DsubGlyph gender={g} />;
  if (part.endKind === 'barrel') return <BarrelGlyph />;
  if (part.endKind === 'free') return <FreeEndGlyph count={part.pinCount ?? part.pinLayout?.length ?? 1} />;

  // 단자·스플라이스는 핀 격자가 뜻이 없다 — 전용 그림을 따로 그린다.
  if (role === 'terminal') return <TerminalGlyph id={part.id} />;
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

/**
 * 러그 종류 — 접두사로 가른다(`lib-lug-<종류>-…`).
 *
 * 분류(`taxonomy`)와 **같은 근거(시드 id)** 를 쓴다. 이름이나 spec 으로 가르면
 * 사람이 글자를 고치는 순간 기호와 분류가 조용히 갈린다.
 */
export type LugShape = 'ring' | 'fork' | 'ferrule' | 'faston-rec' | 'faston-tab';

export function lugShapeOf(id: string): LugShape | null {
  if (id.startsWith('lib-lug-ring-')) return 'ring';
  if (id.startsWith('lib-lug-fork-')) return 'fork';
  if (id.startsWith('lib-lug-ferrule-')) return 'ferrule';
  if (id.startsWith('lib-lug-faston-')) return id.endsWith('-rec') ? 'faston-rec' : 'faston-tab';
  return null;
}

/** 전선을 무는 압착 통 — 러그 네 종류가 공유하는 부분. x 15~23 을 쓴다. */
const BARREL = <path d="M 15 6 h 8 v 10 h -8" className="ps-line" />;

/**
 * 러그 한 종의 **머리 + 압착 통** 도형. 34×22 좌표계에 그리되 x 0~24 만 쓴다.
 *
 * 전선 꼬리는 여기 없다. 라이브러리 목록은 꼬리를 덧붙여 "전선에 붙는 물건"임을
 * 말하지만, 캔버스에서는 **진짜 배선이 그 자리에 붙으므로** 그려 넣으면 선이
 * 두 겹이 된다. 그래서 공유하는 것은 도형까지고 꼬리는 부르는 쪽이 정한다.
 */
function lugBody(shape: LugShape) {
  switch (shape) {
    case 'ring':
      return (
        <>
          <circle cx={8} cy={11} r={6} className="ps-body" />
          <circle cx={8} cy={11} r={2.6} className="ps-hole" />
          {BARREL}
        </>
      );
    case 'fork':
      // 한쪽이 트인 U 자 — 볼트를 빼지 않고 옆에서 끼우는 그 모양
      return (
        <>
          <path d="M 2 5.5 h 6 a 5.5 5.5 0 0 1 0 11 h -6 v -3.6 h 5.5 a 1.9 1.9 0 0 0 0 -3.8 h -5.5 z"
            className="ps-body" />
          {BARREL}
        </>
      );
    case 'ferrule':
      /*
       * 페룰 = **속 빈 원통**. 처음에 속이 찬 봉으로 그렸다가 고쳤다.
       * 통(빈 사각) + 왼쪽 끝의 타원 = 들여다보이는 구멍. 이 구멍이 페룰의 정체다.
       */
      return (
        <>
          <path d="M 4 7.5 h 10 v 7 h -10 z" className="ps-body" />
          <ellipse cx={4} cy={11} rx={2} ry={3.5} className="ps-hole" />
          {BARREL}
        </>
      );
    case 'faston-rec':
      // 암 = 탭을 씌우는 통 (빈 상자, 입이 왼쪽으로 열림)
      return (
        <>
          <path d="M 2 6.5 h 12 v 9 h -12 z M 2 9 h 4 M 2 13 h 4" className="ps-body" />
          {BARREL}
        </>
      );
    case 'faston-tab':
      // 수 = 칼날 (찬 판)
      return (
        <>
          <path d="M 2 8.4 h 12 v 5.2 h -12 z" className="ps-pin" />
          {BARREL}
        </>
      );
  }
}

/**
 * **캔버스용 러그 기호.** 라이브러리 목록과 같은 도형을 쓴다.
 *
 * 도면에서 러그는 하우징이 아니다. 핀 격자 상자로 그리면 1핀짜리 작은 커넥터로
 * 보이고, 링인지 페룰인지 파스톤인지는 이름을 읽어야만 알 수 있다. 그런데 그
 * 구분은 이미 라이브러리 기호가 하고 있으므로 **같은 도형을 캔버스에서도** 쓴다
 * (근거가 하나여야 목록과 도면이 갈리지 않는다).
 *
 * 꼬리(전선)를 뺀 x 0~24 만 보여 준다 — 배선은 노드 가장자리 핸들에서 진짜로
 * 나가므로, 그림에 또 그리면 선이 두 겹이 된다.
 */
export function LugGlyph({ shape, width, height }: { shape: LugShape; width: number; height: number }) {
  return (
    <svg
      className="part-symbol lug-glyph"
      viewBox="0 0 24 22"
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
    >
      {lugBody(shape)}
    </svg>
  );
}

/**
 * 압착단자.
 *
 * 하우징 컨택트와 러그는 생김새가 아예 다르고, 러그끼리도 링·Y·핀·파스톤이
 * 손에 쥐면 한눈에 갈린다. 목록에서도 갈려야 한다 — 이 기호가 하는 일이 그거다.
 */
function TerminalGlyph({ id }: { id: string }) {
  const shape = lugShapeOf(id);
  if (shape) {
    return (
      <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
        {lugBody(shape)}
        {/* 목록에서는 꼬리를 붙인다 — "전선 끝에 압착하는 물건" 임을 한 그림에서 말한다 */}
        <path d="M 23 11 h 9" className="ps-wire" />
      </svg>
    );
  }
  // 하우징 컨택트 — 접촉부 + 전선 압착 날개
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <path d="M 3 8 h 9 v 6 h -9 z" className="ps-body" />
      <path d="M 12 7.5 l 5 -3 M 12 14.5 l 5 3" className="ps-line" />
      <path d="M 17 6 h 6 v 10 h -6" className="ps-line" />
      <path d="M 23 9 h 8" className="ps-wire" />
    </svg>
  );
}

/**
 * D-SUB — 사다리꼴 D 쉘(넓은 쪽 위) 안에 윗행 5 · 아랫행 4.
 * 접점 모양은 다른 하우징과 같은 규칙이다(○ 암 · ● 수).
 */
function DsubGlyph({ gender }: { gender?: PartLibraryItem['gender'] }) {
  const top = [7, 12, 17, 22, 27];
  const bottom = [9.5, 14.5, 19.5, 24.5];
  const dot = (cx: number, cy: number) =>
    gender === 'plug'
      ? <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.5} className="ps-pin" />
      : <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.6} className="ps-hole" />;
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <path d="M 2 4 h 30 l -3.5 14 h -23 z" className="ps-body" />
      {top.map((x) => dot(x, 8.5))}
      {bottom.map((x) => dot(x, 13.5))}
    </svg>
  );
}

/**
 * DC 배럴잭 — 정면에서 본 동심원: 몸통 · 플러그가 들어가는 구멍 · 센터 핀.
 * 오른쪽 두 가닥이 센터(+) · 슬리브(−) 두 극이다.
 */
function BarrelGlyph() {
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      <circle cx={10} cy={11} r={7.5} className="ps-body" />
      <circle cx={10} cy={11} r={3.6} className="ps-hole" />
      <circle cx={10} cy={11} r={1.2} className="ps-pin" />
      <path d="M 17.5 8.5 h 14 M 17.5 13.5 h 14" className="ps-wire" />
    </svg>
  );
}

/**
 * 납처리 전선단 — 커넥터가 없다. 피복 낀 전선(굵은 선) 끝에 벗긴 심선(가는 선)과
 * 납 방울(찬 점). 가닥 수는 최대 4 까지만 그린다 — 실제 수는 옆의 `NP` 배지가 말한다.
 */
function FreeEndGlyph({ count }: { count: number }) {
  const n = Math.max(1, Math.min(4, count));
  const ys = Array.from({ length: n }, (_, i) => (n === 1 ? 11 : 4.5 + (i * 13) / (n - 1)));
  return (
    <svg className="part-symbol" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden focusable="false">
      {ys.map((y) => (
        <g key={y}>
          <path d={`M 32 ${y} H 14`} className="ps-wire" />
          <path d={`M 14 ${y} H 6`} className="ps-line" />
          <circle cx={5} cy={y} r={1.6} className="ps-pin" />
        </g>
      ))}
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
