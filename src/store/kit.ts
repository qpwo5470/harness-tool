/**
 * 세트(KitDocument) 순수 함수 — 마이그레이션 · 파생값 · 완성도 점검.
 *
 * 원칙 하나: **총수량은 저장하지 않는다.** 언제나 `perSet × orderQty` 로 파생한다.
 * 수동 입력 총수량을 두는 순간 화면 숫자와 발주 숫자가 갈라지고, 그 시점부터
 * 아무도 화면을 믿지 않는다.
 */
import type {
  AnyDocument, HarnessDocument, HarnessSet, KitDocument, Id,
} from '../types';
import { lengthResolver, tallyLengths } from './wireLength';

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** 세트 문자 A, B, C … Z, AA … */
export function letterAt(i: number): string {
  let n = i, out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function isKit(d: AnyDocument): d is KitDocument {
  return (d as KitDocument).schemaVersion === 2;
}

/**
 * v1(하네스 하나) → v2(세트) 마이그레이션.
 * 하네스 1종 · 세트 1개로 올린다. 기존 사용자가 파일을 열었을 때
 * 아무것도 잃지 않고 세트 화면이 자연스럽게 비어 보여야 한다.
 */
export function toKit(d: AnyDocument): KitDocument {
  if (isKit(d)) return d;
  const h: HarnessDocument = { ...d, letter: d.letter ?? 'A' };
  return {
    schemaVersion: 2,
    id: newId('kit'),
    name: d.name || '하네스 세트',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    harnesses: [h],
    set: {
      id: newId('set'),
      pn: '',
      name: d.name || '하네스 세트',
      rev: d.rev,
      items: [{ harnessId: d.id, perSet: 1 }],
      orderQty: 1,
    },
  };
}

/** 세트에서 하네스 하나 찾기 */
export function harnessOf(kit: KitDocument, id: Id): HarnessDocument | undefined {
  return kit.harnesses.find((h) => h.id === id);
}

/** 세트당 수량 */
export function perSetOf(set: HarnessSet, harnessId: Id): number {
  return set.items.find((i) => i.harnessId === harnessId)?.perSet ?? 0;
}

/** 총수량 = 세트당 × 주문 세트 수. **파생값이며 저장하지 않는다.** */
export function totalOf(set: HarnessSet, harnessId: Id): number {
  return perSetOf(set, harnessId) * set.orderQty;
}

/** 세트 전체 하네스 개수 */
export function totalHarnesses(set: HarnessSet): number {
  return set.items.reduce((n, i) => n + i.perSet, 0) * set.orderQty;
}

/** 하네스 요약 — 카드·목록에 쓰는 파생 스펙 */
export type HarnessStats = {
  ends: string;
  wireCount: number;
  /**
   * 길이를 **아는** 배선의 합(mm). 케이블 심선은 케이블 길이를 따른다
   * (`store/wireLength.ts`). 모르는 배선은 0 으로 더하지 않고 빼 둔다 —
   * 0 을 더하면 짧은 하네스처럼 보인다.
   */
  wireLengthMm: number;
  /** wireLengthMm 이 몇 본치인지 — 합계가 불완전함을 밝히기 위해 */
  countedLength: number;
  /** 길이를 알 수 없는 배선 수 (배선에도 없고 소속 케이블에도 없다) */
  missingLength: number;
  /** 케이블 길이를 따르는 배선 수 */
  cableLength: number;
  /** 터미널이 지정되지 않은, 배선된 핀 수 */
  missingTerminal: number;
};

export function statsOf(h: HarnessDocument): HarnessStats {
  // 배선된 핀만 센다 — 안 쓰는 핀에 단자를 요구하면 잘못된 경고가 된다.
  const usedPins = new Set<string>();
  for (const w of h.wires) {
    for (const e of [w.from, w.to]) {
      if (e.type === 'pin') usedPins.add(`${e.connectorId}:${e.pinId}`);
    }
  }
  let missingTerminal = 0;
  for (const c of h.connectors) {
    if (c.kind === 'splice') continue;   // 꼬임 접속은 단자가 없다
    for (const p of c.pins) {
      if (usedPins.has(`${c.id}:${p.id}`) && !p.terminalId) missingTerminal++;
    }
  }
  const ends = h.connectors
    .filter((c) => c.kind !== 'splice')
    .map((c) => h.usedParts.find((p) => p.id === c.housingId)?.name ?? c.kind)
    .join(' ↔ ') || '끝단 없음';

  // 길이 판단은 공용 해석기 하나만 쓴다 — 물리 뷰·자재표·검증과 같은 함수다
  const len = tallyLengths(h.wires, lengthResolver(h));

  return {
    ends,
    wireCount: h.wires.length,
    wireLengthMm: len.totalMm,
    countedLength: len.counted,
    missingLength: len.missing,
    cableLength: len.fromCable,
    missingTerminal,
  };
}

/** 발주를 막는 항목 — 세트 패널·파트 탭에서 맨 위에 세운다 */
export type Blocker = {
  harnessId: Id;
  /** 클릭 시 이동할 대상 (커넥터/와이어 id) */
  targetId?: Id;
  label: string;
  where: string;
};

export function blockersOf(kit: KitDocument): Blocker[] {
  const out: Blocker[] = [];
  for (const h of kit.harnesses) {
    const s = statsOf(h);
    const L = h.letter ?? '?';
    if (s.missingTerminal > 0) {
      // 어느 커넥터인지까지 짚어준다 — "어딘가 잘못됐다"는 경고는 쓸모가 없다
      const usedPins = new Set<string>();
      for (const w of h.wires) {
        for (const e of [w.from, w.to]) {
          if (e.type === 'pin') usedPins.add(`${e.connectorId}:${e.pinId}`);
        }
      }
      const c = h.connectors.find(
        (x) => x.kind !== 'splice'
          && x.pins.some((p) => usedPins.has(`${x.id}:${p.id}`) && !p.terminalId),
      );
      out.push({
        harnessId: h.id,
        targetId: c?.id,
        label: `터미널 미지정 ${s.missingTerminal}핀`,
        where: c ? `${L} · ${h.usedParts.find((p) => p.id === c.housingId)?.name ?? '커넥터'}` : L,
      });
    }
    if (s.missingLength > 0) {
      // 케이블 길이를 따르는 심선은 재단 길이가 정해져 있으므로 발주를 막지 않는다.
      // 여기서 막던 예전 코드는 검증(info 등급)과 판정이 어긋나 있었다.
      const lengthOf = lengthResolver(h);
      const w = h.wires.find((x) => lengthOf(x).mm == null);
      out.push({
        harnessId: h.id,
        targetId: w?.id,
        label: `길이 미입력 ${s.missingLength}본`,
        where: L,
      });
    }
  }
  return out;
}

/**
 * 발주 문구 — 그대로 복사해 보낼 수 있는 문장.
 * 위탁 제작 시 메일에 붙이는 용도라 사람이 읽는 형식이어야 한다.
 */
export function orderText(kit: KitDocument): string {
  const lines: string[] = [];
  const pn = kit.set.pn ? ` (${kit.set.pn})` : '';
  lines.push(`${kit.set.name}${pn} — ${kit.set.orderQty}세트`);
  for (const h of kit.harnesses) {
    const per = perSetOf(kit.set, h.id);
    if (!per) continue;
    const no = h.drawingNo ?? '품번 미지정';
    lines.push(`${h.letter ?? '?'}. ${no} ${h.name}  세트당 ${per}개 → ${per * kit.set.orderQty}개`);
  }
  lines.push(`합계 하네스 ${totalHarnesses(kit.set)}개 · 도면 PDF ${kit.harnesses.length}매 첨부`);
  return lines.join('\n');
}

/** 빈 하네스 하나를 세트에 추가한 새 kit 을 만든다 */
export function withNewHarness(kit: KitDocument, h: HarnessDocument): KitDocument {
  const letter = letterAt(kit.harnesses.length);
  return {
    ...kit,
    harnesses: [...kit.harnesses, { ...h, letter }],
    set: { ...kit.set, items: [...kit.set.items, { harnessId: h.id, perSet: 1 }] },
  };
}

/** 하네스 제거 (세트 구성에서도 빠진다). 마지막 하나는 지울 수 없다. */
export function withoutHarness(kit: KitDocument, id: Id): KitDocument {
  if (kit.harnesses.length <= 1) return kit;
  const rest = kit.harnesses.filter((h) => h.id !== id);
  return {
    ...kit,
    // 남은 하네스의 문자를 다시 매긴다 — A, C 처럼 구멍이 나면 도면에서 헷갈린다
    harnesses: rest.map((h, i) => ({ ...h, letter: letterAt(i) })),
    set: { ...kit.set, items: kit.set.items.filter((i) => i.harnessId !== id) },
  };
}
