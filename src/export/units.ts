/**
 * 치수 단위 · 전선 여유율 — **숫자를 바꾸는 곳은 여기 하나뿐이다.**
 *
 * ## 왜 이 파일이 생겼나
 * 내보내기 대화상자는 여유율·치수 단위를 고르게 해 놓고 산출물은 언제나 도면
 * mm 값을 그대로 뱉었다. 고를 수는 있는데 결과가 안 바뀌는 스위치였다.
 * 이제 변환·반올림·범위 검사를 이 파일에 모아 두고, 접속표 CSV·파트리스트
 * CSV·도면 PDF 가 **같은 함수**를 쓴다. 화면마다 다른 자리수로 반올림해
 * 숫자가 갈리는 일이 없다.
 *
 * ## 여유율은 어디에 적용되는가 (README §6 원칙)
 * - **도면 PDF · 접속표 CSV = 도면 길이 그대로.** 제작자가 자르는 치수가 아니라
 *   설계 치수다. 여기에 여유율을 곱하면 현장이 도면보다 긴 전선을 자른다.
 * - **파트리스트 CSV(발주용)만 여유율을 곱한다.** 전선은 여유를 두고 산다.
 * 그래서 이 파일은 곱셈 함수(`withMargin`)를 제공만 하고, 어디에 쓸지는
 * `bundle.ts` 가 정한다 — 그쪽 한 곳만 읽으면 적용 범위가 다 보인다.
 */

/** 내보내기 치수 단위 */
export type LengthUnit = 'mm' | 'inch';

/** 국제 인치 정의 — 1 in = 25.4 mm (정확값) */
export const MM_PER_INCH = 25.4;

/**
 * 반올림 자리수.
 *
 * - **mm 는 소수 2자리.** 도면 길이는 정수 mm 지만 여유율을 곱하면 정수가
 *   아니게 된다(101 × 1.05 = 106.05). 0.01mm 는 전선 재단 정밀도보다 두 자리
 *   아래라 버릴 정보가 없고, 동시에 부동소수 잡음(800 × 1.05 =
 *   840.0000000000001)을 없앤다.
 * - **inch 는 소수 3자리.** 0.001in = 0.0254mm 라 mm 2자리와 정밀도가 맞는다.
 *   2자리(0.01in = 0.254mm)로 줄이면 800mm 가 31.5in 로 적히고 되돌리면
 *   800.1mm 가 되어 도면값과 어긋난다. 3자리면 31.496in → 799.998mm 로
 *   0.01mm 안에 들어온다.
 */
const DECIMALS: Record<LengthUnit, number> = { mm: 2, inch: 3 };

/**
 * CSV 열 이름 접미. 기존 헤더가 `length_mm` 이었으므로 인치는 `length_in` 이다
 * — 이 툴이 이미 쓰던 관례를 잇는다. 값만 바뀌고 이름이 그대로면 800mm 와
 * 31.496in 을 구분할 수 없다.
 */
export function unitSuffix(unit: LengthUnit): string {
  return unit === 'inch' ? 'in' : 'mm';
}

/** 사람이 읽는 단위 약호 (PDF 열 제목 · 비고 문구용) */
export function unitLabel(unit: LengthUnit): string {
  return unitSuffix(unit);
}

/** mm 값을 고른 단위의 수치로 (반올림까지 끝낸 값) */
export function convertLength(mm: number, unit: LengthUnit): number {
  const v = unit === 'inch' ? mm / MM_PER_INCH : mm;
  const p = 10 ** DECIMALS[unit];
  return Math.round(v * p) / p;
}

/**
 * mm 값 → 표시 문자열. 딱 떨어지는 값에 `.00` 을 붙이지 않는다
 * (도면의 `800` 이 `800.00` 으로 바뀌면 사람은 무언가 계산된 값이라 읽는다).
 */
export function formatLength(mm: number, unit: LengthUnit): string {
  return String(convertLength(mm, unit));
}

/**
 * 여유율 상한. 100% 는 도면 길이의 두 배다 — 그보다 큰 값은 여유가 아니라
 * 오타이므로 받아 주지 않는다.
 */
export const MAX_MARGIN_PCT = 100;

/**
 * 대화상자 입력 정규화 — 비숫자·음수·과도한 값을 눌러 담는다.
 * 사람이 타이핑하는 동안에는 중간 상태가 잠깐 이상할 수 있으므로 여기서는
 * 던지지 않고 범위 안으로 끌어온다.
 */
export function clampMarginPct(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_MARGIN_PCT, n));
}

/**
 * 발주 숫자를 만들기 직전의 검사 — 여기까지 잘못된 값이 오면 **조용히 고치지
 * 않고 멈춘다.** 여유율은 발주 수량을 직접 늘리는 값이라, 몰래 0 으로 눌러
 * 담으면 "여유를 넣었다고 믿었는데 안 들어간" 발주서가 나간다.
 */
export function assertMarginPct(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`전선 여유율이 숫자가 아닙니다 — ${String(v)}`);
  if (n < 0) throw new Error(`전선 여유율은 음수일 수 없습니다 — ${n}%`);
  if (n > MAX_MARGIN_PCT) {
    throw new Error(`전선 여유율이 너무 큽니다 — ${n}% (최대 ${MAX_MARGIN_PCT}%)`);
  }
  return n;
}

/**
 * 도면 길이(mm) → 발주 길이(mm). 반올림은 표시 단계(`formatLength`)에서 한다
 * — 여기서 미리 자르면 인치로 바꿀 때 두 번 반올림되어 값이 밀린다.
 */
export function withMargin(mm: number, pct: number): number {
  return mm * (1 + pct / 100);
}
