/**
 * 부품 정의 변경 → 도면 반영 계획 (순수 함수).
 *
 * 왜 필요한가 — 실제로 겪은 결함:
 * 핀맵 에디터에서 이미 쓰고 있는 부품을 고쳐 저장해도 도면은 **하나도 바뀌지
 * 않았다**. 저장은 `addUsedPart` 로 들어가는데, 그 액션은 계약상 "같은 id 가 있으면
 * 무시" 라서(types/index.ts) 옛 정의가 문서 스냅샷(usedParts)에 그대로 남았다.
 * 이름을 바꿔도 도면 이름표는 옛 이름, 6P 를 2P 로 줄여도 도면은 6P — 사용자에게
 * 아무 표시도 없었다.
 *
 * 여기서는 "무엇을 바꿔야 하는가"만 계산한다. 실제 반영(스토어 호출)과 안내(토스트)는
 * LibraryPanel 이 한다 — 실행취소 단계 수를 세어야 하기 때문이다.
 *
 * 원칙:
 *  - **배선을 말없이 지우지 않는다.** 핀이 줄어도 배선이 물린 핀은 남긴다.
 *    (검증 탭이 `핀 수 초과` 로 잡고, 사용자가 옮기거나 지울지 정한다)
 *  - 배선이 없는 초과 핀은 조용히 정리한다 — 남겨 봐야 빈 자리다.
 *  - 핀이 늘면 늘어난 자리를 새 핀으로 채운다. 안 채우면 도면 격자에 구멍이 남는다.
 *  - 인스턴스에서 손으로 고친 표기(label)는 지키고, 정의를 따라가던 표기만 갱신한다.
 */
import type { Connector, HarnessDocument, Id, PartLibraryItem, Pin } from '../types';
import { layoutCells } from '../canvas/geometry';

export type ConnectorPatch = {
  connectorId: Id;
  pins: Pin[];
  /** 정의에서 사라졌는데 배선이 물려 있어 그대로 남긴 핀 */
  strandedPins: Pin[];
  /** 정의에서 사라져 지운 핀 (배선 없음) */
  droppedPins: Pin[];
  /** 정의가 늘어 새로 만든 핀 */
  addedPins: Pin[];
};

export type PartSyncPlan = {
  /** 문서 스냅샷(usedParts)의 정의를 바꿔야 하는가 */
  usedPartChanged: boolean;
  /** 핀을 손봐야 하는 커넥터들 */
  connectors: ConnectorPatch[];
  /** 정의 밖에 남은 핀에 물린 배선 수 (합계) */
  strandedWires: number;
  /** 스토어 액션 호출 횟수 = 실행취소 단계 수 */
  steps: number;
};

let pinSeq = 0;
function newPinId(): string {
  return `pin-${Date.now().toString(36)}-${pinSeq++}`;
}

/** 라이브러리 정의가 정하는 핀 번호 목록 (배치가 없으면 pinCount 로 1..n) */
function definedSlots(part: PartLibraryItem): { index: number; label?: string }[] {
  const cells = layoutCells(part.pinLayout);
  if (cells) {
    return cells
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((s) => ({ index: s.index, label: s.label }));
  }
  const n = Math.max(0, part.pinCount ?? 0);
  return Array.from({ length: n }, (_, i) => ({ index: i + 1, label: String(i + 1) }));
}

/** 이 핀에 배선이 물려 있는가 */
function isWired(doc: HarnessDocument, connectorId: Id, pinId: Id): boolean {
  return doc.wires.some((w) =>
    [w.from, w.to].some((e) => e.type === 'pin' && e.connectorId === connectorId && e.pinId === pinId),
  );
}

function samePart(a: PartLibraryItem | undefined, b: PartLibraryItem): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 편집한 부품 정의를 문서에 맞추는 계획을 세운다.
 * 바꿀 것이 없으면 `steps === 0` 이다 (그때는 토스트도 띄우지 않는다).
 */
export function planPartSync(doc: HarnessDocument, part: PartLibraryItem): PartSyncPlan {
  const prev = doc.usedParts.find((p) => p.id === part.id);
  const usedPartChanged = prev !== undefined && !samePart(prev, part);

  const slots = definedSlots(part);
  const byIndex = new Map(slots.map((s) => [s.index, s]));
  const prevSlots = prev ? new Map(definedSlots(prev).map((s) => [s.index, s])) : new Map();

  const connectors: ConnectorPatch[] = [];
  let strandedWires = 0;

  for (const c of doc.connectors as Connector[]) {
    if (c.housingId !== part.id) continue;

    const kept: Pin[] = [];
    const stranded: Pin[] = [];
    const dropped: Pin[] = [];

    for (const p of c.pins) {
      const slot = byIndex.get(p.index);
      if (slot) {
        /*
         * 표기(label) 처리 — 계약상 `Pin.label` 이 없으면 라이브러리 PinSlot.label 을 쓴다.
         * 그러니 비어 있는 표기는 **건드리지 않는다**(그대로 새 정의를 따라간다).
         * 값이 있고 그게 옛 정의와 같았다면 정의를 따르던 것이므로 새 표기로 옮기고,
         * 사용자가 손으로 고친 표기는 지킨다.
         */
        const followedDefinition =
          p.label !== undefined && p.label === prevSlots.get(p.index)?.label;
        kept.push(
          followedDefinition && slot.label !== undefined && slot.label !== p.label
            ? { ...p, label: slot.label }
            : p,
        );
        continue;
      }
      if (isWired(doc, c.id, p.id)) {
        stranded.push(p);
        kept.push(p);
      } else {
        dropped.push(p);
      }
    }

    // 늘어난 자리 채우기
    const have = new Set(kept.map((p) => p.index));
    const added: Pin[] = slots
      .filter((s) => !have.has(s.index))
      .map((s) => ({ id: newPinId(), index: s.index, label: s.label }));

    const pins = [...kept, ...added].sort((a, b) => a.index - b.index);
    if (!dropped.length && !added.length && pins.every((p, i) => p === c.pins[i])) continue;

    strandedWires += stranded.reduce(
      (n, p) =>
        n +
        doc.wires.filter((w) =>
          [w.from, w.to].some((e) => e.type === 'pin' && e.connectorId === c.id && e.pinId === p.id),
        ).length,
      0,
    );

    connectors.push({
      connectorId: c.id,
      pins,
      strandedPins: stranded,
      droppedPins: dropped,
      addedPins: added,
    });
  }

  return {
    usedPartChanged,
    connectors,
    strandedWires,
    steps: (usedPartChanged ? 1 : 0) + connectors.length,
  };
}

/**
 * 사용자에게 보여 줄 한 줄. 바뀐 게 없으면 null (토스트를 띄우지 않는다).
 * 말투는 기존 토스트("배선 3본을 일괄 지정했습니다")에 맞춘다.
 */
export function partSyncMessage(part: PartLibraryItem, plan: PartSyncPlan): string | null {
  if (!plan.steps) return null;
  const bits: string[] = [];
  const dropped = plan.connectors.reduce((n, c) => n + c.droppedPins.length, 0);
  const added = plan.connectors.reduce((n, c) => n + c.addedPins.length, 0);
  if (added) bits.push(`핀 ${added}개 추가`);
  if (dropped) bits.push(`빈 핀 ${dropped}개 정리`);
  if (plan.strandedWires) {
    bits.push(`배선 ${plan.strandedWires}본이 없어진 핀에 남음 — 검증 탭을 보세요`);
  }
  const head = `'${part.name}' 정의를 커넥터 ${plan.connectors.length}개에 반영했습니다`;
  if (!plan.connectors.length) return `'${part.name}' 정의를 도면에 반영했습니다`;
  return bits.length ? `${head} · ${bits.join(' · ')}` : head;
}
