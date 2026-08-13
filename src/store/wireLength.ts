/**
 * 배선 길이 해석 — **이 파일 하나에서만** 정한다.
 *
 * ## 왜 공용 함수인가
 * 심선(Wire)이 케이블(`cableId`)에 속하면 그 심선은 케이블 길이로 재단된다.
 * 그건 이 툴이 이미 공표한 규칙이다 — `types.ts` 의 `Wire.lengthMm` 주석,
 * 속성 패널의 "길이는 케이블을 따릅니다", 검증의 `length-missing` info 등급.
 *
 * 문제는 그 규칙을 화면마다 따로 구현하고 있었다는 것이다. 검증은 케이블을 봤고
 * 물리 뷰·`statsOf`·자재표는 `w.lengthMm` 만 봤다. 그래서 같은 문서를 놓고
 * 한 화면에 "케이블 500mm" 와 "전선 0mm · 길이 미입력 2본" 이 같이 떴다.
 * 숫자가 화면마다 갈리는 순간 아무도 도면을 믿지 않는다.
 *
 * ## 규칙
 * - 재단 길이 = `w.lengthMm ?? cable.lengthMm`.
 * - **모르는 값은 `null` 이다. 0 이 아니다.** 0 은 합계에 조용히 섞여 들어가
 *   "짧은 하네스" 처럼 보이게 만들고, 발주서에서는 "0mm 로 자르라"는 지시가 된다.
 * - 어디서 온 길이인지(`source`)를 같이 돌려준다. 발주 수량처럼 출처가
 *   중요한 곳(케이블 심선은 전선으로 사지 않는다)에서 구분해야 하기 때문이다.
 */
import type { Cable, HarnessDocument, Wire } from '../types';

/** 길이의 출처 — 배선에 직접 입력 / 소속 케이블 / 알 수 없음 */
export type LengthSource = 'wire' | 'cable' | 'none';

export type WireLength = {
  /** 재단 길이(mm). 모르면 null */
  mm: number | null;
  source: LengthSource;
  /** source === 'cable' 일 때 그 케이블 */
  cable?: Cable;
};

export type LengthResolver = (w: Wire) => WireLength;

const UNKNOWN: WireLength = { mm: null, source: 'none' };

/**
 * 문서 하나에 묶인 길이 해석기를 만든다.
 * 케이블 색인을 한 번만 만들므로 배선 수가 많아도 O(n) 이다.
 */
export function lengthResolver(doc: Pick<HarnessDocument, 'cables'>): LengthResolver {
  const cableById = new Map((doc.cables ?? []).map((c) => [c.id, c] as const));
  return (w: Wire): WireLength => {
    if (typeof w.lengthMm === 'number') return { mm: w.lengthMm, source: 'wire' };
    const cable = w.cableId ? cableById.get(w.cableId) : undefined;
    if (cable && typeof cable.lengthMm === 'number') {
      return { mm: cable.lengthMm, source: 'cable', cable };
    }
    // 케이블에 속했지만 케이블 길이도 비어 있으면 여전히 모르는 값이다
    return cable ? { mm: null, source: 'none', cable } : UNKNOWN;
  };
}

/** 한 본만 볼 때의 편의 함수 */
export function resolveWireLength(doc: Pick<HarnessDocument, 'cables'>, w: Wire): WireLength {
  return lengthResolver(doc)(w);
}

export type LengthTally = {
  /** 길이를 아는 배선의 합(mm) */
  totalMm: number;
  /** 길이를 아는 배선 수 — 합계가 몇 본치인지 밝히기 위해 */
  counted: number;
  /** 길이를 알 수 없는 배선 수 */
  missing: number;
  /** 케이블 길이를 따르는 배선 수 (counted 의 부분집합) */
  fromCable: number;
};

/** 배선 묶음의 길이 집계 — "합계가 몇 본치인가"를 같이 돌려준다 */
export function tallyLengths(wires: Wire[], lengthOf: LengthResolver): LengthTally {
  let totalMm = 0;
  let counted = 0;
  let missing = 0;
  let fromCable = 0;
  for (const w of wires) {
    const { mm, source } = lengthOf(w);
    if (mm == null) {
      missing += 1;
      continue;
    }
    totalMm += mm;
    counted += 1;
    if (source === 'cable') fromCable += 1;
  }
  return { totalMm, counted, missing, fromCable };
}
