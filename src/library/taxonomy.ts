/**
 * 부품 분류 체계 — **하나의 축으로만 나눈다**.
 *
 * 예전 `LibraryPanel.GROUPS` 는 축이 섞여 있었다: 용도(MDB·LAN·USB)와
 * 제조사(연호·Molex)와 형태(범용 하우징·와이어투와이어)가 한 목록에 나란히 있어서
 * "SMH250 터미널을 어디서 찾지" 가 답이 없는 질문이었다 — 연호 SMH250 그룹에도,
 * 연호 터미널 그룹에도 있을 법했다(실제로는 후자였다).
 *
 * 그래서 두 단계로 못 박는다.
 *
 *   1단계 **계열(family)** — 부품이 하네스에서 하는 일. 4개뿐이고 안 늘어난다.
 *   2단계 **시리즈(series)** — 실제로 맞물리는 한 벌. `제조사 · 시리즈 · 피치`.
 *
 * 핵심 규칙 하나: **한 시리즈 안에 하우징·헤더·압착단자가 같이 산다.**
 * 하네스는 양 끝이 있어야 그려지고 단자까지 골라야 발주가 되므로, 역할로 쪼개면
 * 한 벌을 세 군데서 주워 모아야 한다. 역할은 그룹이 아니라 **행 안의 표시**다.
 *
 * 이 파일은 `seed.ts` 의 id 를 읽을 뿐 고치지 않는다. 시드에 새 시리즈를 넣으면
 * 여기에도 한 줄을 더해야 하고, 잊으면 `taxonomy.test.ts` 가 먼저 깨진다.
 */
import type { PartLibraryItem } from '../types';

/* ------------------------------------------------------------------ 계열 */

export type FamilyKey = 'crimp' | 'interface' | 'generic' | 'legacy';

export type FamilyDef = {
  key: FamilyKey;
  label: string;
  /** 그룹 헤더 옆 물음표에 뜨는 한 줄 — "이 칸에 뭐가 들어오나" */
  hint: string;
};

/** 화면에 나오는 순서 = 이 배열 순서. 자주 쓰는 것부터. */
export const FAMILIES: FamilyDef[] = [
  {
    key: 'crimp',
    label: '압착 커넥터 (시리즈)',
    hint: '전선에 단자를 압착해 하우징에 꽂는 계열. 하우징·보드 헤더·압착단자가 한 시리즈 안에 함께 있다.',
  },
  {
    key: 'interface',
    label: '규격 I/O 커넥터',
    hint: '핀 배열이 규격으로 정해진 완제품. 단자를 따로 발주하지 않는다.',
  },
  {
    key: 'generic',
    label: '범용 · 중계',
    hint: '특정 시리즈가 없는 일반 부품. 실제 발주 전에 품번을 정해야 한다.',
  },
  {
    key: 'legacy',
    label: '구 항목 (호환용)',
    hint: '초기 버전에서 만든 품번 없는 항목. 예전 도면을 열기 위해 남겨 둘 뿐, 새 설계에는 위 시리즈를 쓴다.',
  },
];

/* ---------------------------------------------------------------- 시리즈 */

export type SeriesDef = {
  key: string;
  family: FamilyKey;
  /** 제조사. 범용·규격품처럼 제조사가 뜻이 없으면 생략 */
  maker?: string;
  /** 시리즈 이름 — 카탈로그에 적힌 그대로 */
  series: string;
  /** 접촉 피치(mm). 없는 계열은 생략 */
  pitchMm?: number;
  /** 용도 꼬리표 — 행에 칩으로 붙고 검색어로도 잡힌다 */
  tags?: string[];
  /** 그룹을 펼친 채로 시작할지 */
  openByDefault?: boolean;
  /** 이 시리즈에 속하는 부품 id */
  match: (id: string) => boolean;
};

const re = (r: RegExp) => (id: string) => r.test(id);

/**
 * 시리즈 표.
 *
 * 순서는 계열 → 제조사 → 피치. 손으로 정렬하지 않고 `SERIES_ORDERED` 가 정렬한다.
 * `match` 는 **id 만** 본다 — 이름·MPN 은 사람이 고치는 값이라 분류 근거로 쓰면
 * 오타 한 번에 부품이 목록에서 사라진다.
 */
export const SERIES: SeriesDef[] = [
  /* --- 압착 커넥터 --- */
  {
    key: 'jst-ph',
    family: 'crimp',
    maker: 'JST',
    series: 'PH',
    pitchMm: 2.0,
    match: re(/^lib-jst-(phr|b-ph|s-ph|sph)/),
  },
  {
    key: 'jst-xh',
    family: 'crimp',
    maker: 'JST',
    series: 'XH',
    pitchMm: 2.5,
    match: re(/^lib-jst-(xhp|b-xh|s-xh|sxh)/),
  },
  {
    key: 'molex-spox',
    family: 'crimp',
    maker: 'Molex',
    series: 'SPOX',
    pitchMm: 2.5,
    match: re(/^lib-spox/),
  },
  {
    key: 'molex-microfit',
    family: 'crimp',
    maker: 'Molex',
    series: 'Micro-Fit 3.0',
    pitchMm: 3.0,
    match: re(/^lib-mf3-/),
  },
  {
    /*
     * MDB(자판기) 부품은 예전에 따로 그룹이었지만 실물은 Mini-Fit Jr 이다
     * (VMC 39-01-2060 = 5557-06R, 주변기기 39-30-1060 = 5569). 용도로 칸을 하나 더
     * 파면 같은 커넥터가 두 군데 살게 되므로, 칸이 아니라 `MDB` 꼬리표로 붙인다.
     * 검색창에 "MDB" 나 "자판기" 를 쳐도 잡힌다(LibraryPanel 검색이 태그를 본다).
     */
    key: 'molex-minifit',
    family: 'crimp',
    maker: 'Molex',
    series: 'Mini-Fit Jr.',
    pitchMm: 4.2,
    tags: ['MDB', '자판기'],
    openByDefault: true,
    match: re(/^lib-(minifit-(5557|5556|5558|terminal)|mdb-)/),
  },
  {
    key: 'yeonho-200',
    family: 'crimp',
    maker: '연호전자',
    series: 'SMH200 · SMW200',
    pitchMm: 2.0,
    match: re(/^lib-yh-(smh200|smaw200|smw200|yst200)/),
  },
  {
    key: 'yeonho-250',
    family: 'crimp',
    maker: '연호전자',
    series: 'SMH250 · SMP250',
    pitchMm: 2.5,
    openByDefault: true,
    match: re(/^lib-yh-(smh250|smp250|smaw250|smw250|yst025|smt025)/),
  },
  {
    key: 'yeonho-396',
    family: 'crimp',
    maker: '연호전자',
    series: 'YH396',
    pitchMm: 3.96,
    match: re(/^lib-yh-(yh396|yt396)/),
  },

  /* --- 규격 I/O --- */
  {
    key: 'rj45',
    family: 'interface',
    series: 'RJ45 8P8C',
    tags: ['LAN', '이더넷'],
    openByDefault: true,
    match: re(/^lib-rj45/),
  },
  {
    key: 'usb',
    family: 'interface',
    series: 'USB',
    tags: ['USB'],
    match: re(/^lib-usb/),
  },

  /* --- 범용 --- */
  {
    key: 'w2w',
    family: 'generic',
    series: '와이어투와이어',
    match: re(/^lib-w2w/),
  },
  {
    key: 'b2w',
    family: 'generic',
    series: '보드투와이어 · 터미널블럭',
    match: re(/^lib-(b2w|terminal-block)/),
  },
  {
    key: 'splice',
    family: 'generic',
    series: '스플라이스',
    openByDefault: true,
    match: re(/^lib-splice/),
  },

  /* --- 구 항목 --- */
  {
    /*
     * 품번도 성별도 없는 초기 항목들. 지우면 이 부품으로 그린 예전 도면의
     * 라이브러리 참조가 끊기므로 남기되, 새 설계에서 집어 들지 않도록 맨 아래
     * 접힌 칸으로 몰아 둔다.
     */
    key: 'legacy',
    family: 'legacy',
    series: '품번 미지정 항목',
    match: re(/^lib-(xh-|ph-|minifit-4p|molex-2x5)/),
  },
];

/**
 * 제조사 순서는 **적어 둔 것**이지 정렬해서 나오는 것이 아니다.
 *
 * `localeCompare('ko')` 로 정렬해 봤더니 한글이 라틴 문자 앞으로 갔다. 그건 로케일
 * 구현이 정한 것이지 우리가 정한 것이 아니고, 브라우저·Node 판이 바뀌면 목록 순서가
 * 말없이 뒤집힌다. 순서는 화면을 훑는 습관이 되는 값이라 그렇게 두면 안 된다.
 */
const MAKER_ORDER = ['JST', 'Molex', '연호전자'];

/** 계열 순 → 제조사 순 → 피치 순. 화면·시험이 모두 이 순서를 쓴다. */
export const SERIES_ORDERED: SeriesDef[] = [...SERIES].sort((a, b) => {
  const fa = FAMILIES.findIndex((f) => f.key === a.family);
  const fb = FAMILIES.findIndex((f) => f.key === b.family);
  if (fa !== fb) return fa - fb;
  // 목록에 없는 제조사는 뒤로 (신규 추가 시 눈에 띄어 MAKER_ORDER 를 고치게 된다)
  const rank = (m?: string) => {
    const i = MAKER_ORDER.indexOf(m ?? '');
    return i < 0 ? MAKER_ORDER.length : i;
  };
  if (rank(a.maker) !== rank(b.maker)) return rank(a.maker) - rank(b.maker);
  return (a.pitchMm ?? 0) - (b.pitchMm ?? 0);
});

/** 부품 → 시리즈. 못 찾으면 undefined (화면에 '분류 미지정' 칸으로 드러난다) */
export function seriesOf(p: PartLibraryItem): SeriesDef | undefined {
  return SERIES.find((s) => s.match(p.id));
}

/**
 * 그룹 헤더 글자 — `제조사 · 시리즈 · 피치`.
 * 세 조각의 자리가 항상 같아야 눈이 한 열만 훑는다.
 */
export function seriesLabel(s: SeriesDef): string {
  return [s.maker, s.series, s.pitchMm != null ? `${s.pitchMm.toFixed(2)}mm` : null]
    .filter(Boolean)
    .join(' · ');
}

/* ------------------------------------------------------------------ 역할 */

export type RoleKey = 'wire' | 'board' | 'terminal' | 'splice';

export type RoleDef = { key: RoleKey; label: string; long: string };

/**
 * 시리즈 안에서의 역할. 그룹을 나누는 축이 **아니라** 행을 정렬하고 표시하는 축이다.
 */
export const ROLES: Record<RoleKey, RoleDef> = {
  wire: { key: 'wire', label: '전선측', long: '전선측 하우징 — 압착한 단자를 꽂는다' },
  board: { key: 'board', label: '보드측', long: '보드측 헤더 · 웨이퍼 — PCB 에 실장한다' },
  terminal: { key: 'terminal', label: '압착단자', long: '전선에 압착하는 단자 — 도면에는 놓지 않고 발주에만 오른다' },
  splice: { key: 'splice', label: '스플라이스', long: '전선끼리 잇는 중계점' },
};

/**
 * 부품 → 역할.
 *
 * `category` 와 `gender` 둘을 본다. 겹쳐 보이지만 **다른 사실**이라서다.
 *   `category` 는 문서 모델의 종류 — 캔버스에 어떤 노드로 앉는가
 *   `gender`   는 결합 형식 — `header` 는 이 도구에서 곧 "보드 실장" 을 뜻한다
 *     (gender.ts: `header 보드(헤더/웨이퍼)`)
 *
 * 이 시험이 실제로 잡아낸 것: `lib-mdb-periph`(Molex 39-30-1060) 은
 * `category: 'housing'` 인데 `gender: 'header'` 다. 시드 주석에 판매도면
 * 55690002-SD 를 근거로 "Right Angle Header, 보드 실장" 이라고 적혀 있으니
 * **보드측이 맞다**. 그런데 category 만 보면 전선측으로 나온다.
 *
 * category 를 고치지 않는 이유: 그 값은 문서에 저장돼 캔버스 노드 종류와
 * 파트리스트 집계를 가르는 값이라, 라이브러리 목록을 예쁘게 하자고 건드리면
 * 이미 저장된 도면의 뜻이 바뀐다. 표시용 역할은 여기서만 판단한다.
 */
export function roleOf(p: PartLibraryItem): RoleDef {
  if (p.category === 'terminal') return ROLES.terminal;
  if (p.category === 'splice') return ROLES.splice;
  if (p.category === 'board-to-wire' || p.gender === 'header') return ROLES.board;
  return ROLES.wire;
}

const ROLE_ORDER: RoleKey[] = ['wire', 'board', 'terminal', 'splice'];

/**
 * 시리즈 안 정렬 — 역할 → 핀 수 → 이름.
 *
 * 핀 수 오름차순이 중요하다. 24회로짜리가 2회로 위에 오면 카탈로그를 훑는 눈이
 * 매번 되짚어야 한다.
 */
export function compareInSeries(a: PartLibraryItem, b: PartLibraryItem): number {
  const ra = ROLE_ORDER.indexOf(roleOf(a).key);
  const rb = ROLE_ORDER.indexOf(roleOf(b).key);
  if (ra !== rb) return ra - rb;
  const pa = a.pinCount ?? 0;
  const pb = b.pinCount ?? 0;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name, 'ko');
}

/**
 * 목록에 **표시할** 이름 — 그룹 머리글이 이미 말한 제조사를 앞에서 뗀다.
 *
 * `p.name` 은 건드리지 않는다. 그건 발주서·CSV·도면에 그대로 나가는 값이라
 * 어디서 보든 같아야 한다. 여기서 줄이는 건 화면의 260px 안에서 **뒤쪽 정보**
 * (회로 수·형식)를 살리기 위한 것뿐이고, 전체 이름은 툴팁에 그대로 있다.
 *
 * 앞의 제조사 한 낱말만 뗀다. 시리즈 이름까지 떼면 `XHP-4` 와 `PHR-4` 처럼
 * 서로 다른 시리즈가 같은 글자로 보일 수 있어서다.
 */
export function displayName(p: PartLibraryItem): string {
  const s = seriesOf(p);
  const maker = s?.maker;
  if (!maker) return p.name;
  // '연호전자' 는 시드에서 '연호 ' 로 적혀 있다 — 둘 다 받는다
  const heads = maker === '연호전자' ? ['연호전자', '연호'] : [maker];
  for (const h of heads) {
    if (p.name.toLowerCase().startsWith(`${h.toLowerCase()} `)) {
      return p.name.slice(h.length + 1);
    }
  }
  return p.name;
}

/** 검색이 훑을 꼬리표 — 시리즈 이름·제조사·용도 태그 */
export function searchTagsOf(p: PartLibraryItem): string[] {
  const s = seriesOf(p);
  if (!s) return [];
  return [s.series, s.maker ?? '', ...(s.tags ?? []), roleOf(p).label].filter(Boolean);
}
