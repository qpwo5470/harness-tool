/**
 * 화면에 **실제로 그려진** 핀 번호의 자리를 잰다.
 *
 * 왜 순수 시험(pinNumber.test.ts)만으로 모자라나: 이 저장소가 잡은 결함의 절반이
 * "시험 전부 통과 + 화면만 틀림" 이었다. geometry 가 옳은 상자를 내줘도 nodes.tsx
 * 가 그 값을 CSS 로 옮기다 흘리면 도면만 조용히 틀어진다. 그래서 DOM 에 박힌
 * 인라인 스타일을 그대로 읽어 상자를 다시 만들고, 겹친 쌍을 **센다**.
 *
 * (jsdom 에는 레이아웃이 없다 — getBoundingClientRect 는 전부 0 이라 쓸 수 없다.
 *  대신 자리를 정하는 값이 전부 인라인 스타일이라 그걸 읽는다.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ConnectorNode } from './nodes';
import { connectorLayout } from './geometry';
import type { Connector, Orientation, PartLibraryItem, PinSlot } from '../types';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class { m22 = 1; };
});
afterEach(() => cleanup());

/** 43025-2400 과 같은 모양 — 2행 × 12열, 24회로 */
const LAYOUT: PinSlot[] = Array.from({ length: 24 }, (_, i) => ({
  index: i + 1, label: String(i + 1), offset: { x: i % 12, y: Math.floor(i / 12) },
}));
const MF24: PartLibraryItem = {
  id: 'h-mf24', category: 'housing', name: 'Molex 43025-2400 (24회로)',
  mpn: '43025-2400', pinCount: 24, pinLayout: LAYOUT,
};
const conn = (orientation: Orientation): Connector => ({
  id: 'c1', kind: 'connector', housingId: MF24.id, orientation,
  positions: { logical: { x: 0, y: 0 } },
  pins: LAYOUT.map((s) => ({ id: `p${s.index}`, index: s.index, label: s.label })),
});

function boxes(orientation: Orientation) {
  const { container } = render(
    <ReactFlowProvider>
      <ConnectorNode
        id="c1" type="connector" dragging={false} zIndex={1}
        selectable selected={false} draggable deletable isConnectable
        positionAbsoluteX={0} positionAbsoluteY={0}
        data={{ connector: conn(orientation), housing: MF24, view: 'logical' } as never}
      />
    </ReactFlowProvider>,
  );
  const px = (v: string) => parseFloat(v || '0');
  return [...container.querySelectorAll('.hz-pad')].map((pad) => {
    const p = pad as HTMLElement;
    const s = p.querySelector('span') as HTMLElement;
    return {
      label: s.textContent!,
      // 패드는 하우징 기준 absolute, 번호는 패드 기준 absolute → 더하면 하우징 기준
      x: px(p.style.left) + px(s.style.left),
      y: px(p.style.top) + px(s.style.top),
      w: px(s.style.width),
      h: px(s.style.height),
    };
  });
}

const DIRS: Orientation[] = [0, 90, 180, 270];

describe('24회로 2열 커넥터 — 화면의 핀 번호', () => {
  it.each(DIRS)('%s° — 그려진 번호 상자가 겹친 쌍 = 0', (o) => {
    const bs = boxes(o);
    expect(bs).toHaveLength(24);
    // 번호가 하나도 빠지지 않았는지 먼저 확인한다 (겹침 0 은 "안 그리면" 쉽다)
    expect(new Set(bs.map((b) => b.label)).size).toBe(24);
    expect(bs.every((b) => b.w > 0 && b.h > 0)).toBe(true);

    let pairs = 0;
    for (let i = 0; i < bs.length; i++) {
      for (let k = i + 1; k < bs.length; k++) {
        const a = bs[i], b = bs[k];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) pairs++;
      }
    }
    expect(pairs).toBe(0);
  });

  it.each(DIRS)('%s° — 그려진 자리가 geometry.pinNumberBox 와 한 글자도 안 다르다', (o) => {
    const g = connectorLayout(conn(o), MF24);
    for (const b of boxes(o)) {
      const want = g.pinNumberBox(Number(b.label), b.label);
      expect({ x: b.x, y: b.y, w: b.w, h: b.h }).toEqual(want);
    }
  });
});
