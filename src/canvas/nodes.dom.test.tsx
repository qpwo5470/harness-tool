import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ConnectorNode } from './nodes';
import type { Connector, PartLibraryItem } from '../types';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(){} unobserve(){} disconnect(){} });
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly =
    class { m22 = 1; };
});
afterEach(() => cleanup());

const housing: PartLibraryItem = {
  id: 'h1', category: 'housing', name: '테스트 4P', pinCount: 4,
  pinLayout: [
    { index: 1, label: '1', offset: { x: 0, y: 0 } },
    { index: 2, label: '2', offset: { x: 1, y: 0 } },
    { index: 3, label: '3', offset: { x: 2, y: 0 } },
    { index: 4, label: '4', offset: { x: 3, y: 0 } },
  ],
};
const conn = (orientation: 0 | 90 | 180 | 270): Connector => ({
  id: 'c1', kind: 'connector', housingId: 'h1', orientation,
  positions: {}, pins: housing.pinLayout!.map((s) => ({ id: `p${s.index}`, index: s.index })),
});

const renderNode = (orientation: 0 | 90 | 180 | 270, view: 'logical' | 'physical') =>
  render(
    <ReactFlowProvider>
      <ConnectorNode
        id="c1" type="connector" dragging={false} zIndex={1}
        selectable selected={false} draggable deletable isConnectable
        positionAbsoluteX={0} positionAbsoluteY={0}
        data={{ connector: conn(orientation), housing, view } as never}
      />
    </ReactFlowProvider>,
  );

describe('물리 뷰 방향 회전', () => {
  it('0°는 회전 없음', () => {
    const { container } = renderNode(0, 'physical');
    const el = container.querySelector('div[style*="rotate"]') as HTMLElement;
    expect(el?.style.transform).toContain('rotate(0deg)');
  });

  it('90°가 실제 transform 에 적용된다', () => {
    const { container } = renderNode(90, 'physical');
    const el = container.querySelector('div[style*="rotate"]') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.transform).toContain('rotate(90deg)');
  });

  it('270°도 적용된다', () => {
    const { container } = renderNode(270, 'physical');
    const el = container.querySelector('div[style*="rotate"]') as HTMLElement;
    expect(el.style.transform).toContain('rotate(270deg)');
  });
});

describe('논리 뷰 방향 뱃지', () => {
  it('90°면 뱃지가 보인다', () => {
    const { container } = renderNode(90, 'logical');
    expect(container.textContent).toContain('90°');
  });

  it('0°면 뱃지가 없다', () => {
    const { container } = renderNode(0, 'logical');
    expect(container.textContent).not.toContain('↻');
  });
});

describe('논리 뷰에서 방향이 실제로 반영되는가', () => {
  it('방향에 따라 핸들 위치가 바뀐다', () => {
    const left = renderNode(0, 'logical').container
      .querySelectorAll('.react-flow__handle-left').length;
    cleanup();
    const top = renderNode(90, 'logical').container
      .querySelectorAll('.react-flow__handle-top').length;
    cleanup();
    const right = renderNode(180, 'logical').container
      .querySelectorAll('.react-flow__handle-right').length;
    cleanup();
    const bottom = renderNode(270, 'logical').container
      .querySelectorAll('.react-flow__handle-bottom').length;

    // 핀마다 source/target 핸들이 한 쌍씩 → 4핀 = 8개
    expect(left).toBe(8);   // 0° → 왼쪽
    expect(top).toBe(8);    // 90° → 위쪽
    expect(right).toBe(8);  // 180° → 오른쪽
    expect(bottom).toBe(8); // 270° → 아래쪽
  });

  it('방향 화살표가 표시된다', () => {
    expect(renderNode(0, 'logical').container.textContent).toContain('←');
    cleanup();
    expect(renderNode(90, 'logical').container.textContent).toContain('↑');
    cleanup();
    expect(renderNode(180, 'logical').container.textContent).toContain('→');
    cleanup();
    expect(renderNode(270, 'logical').container.textContent).toContain('↓');
  });

  it('180°에서 핀 순서가 뒤집힌다', () => {
    const normal = renderNode(0, 'logical').container.textContent!;
    cleanup();
    const flipped = renderNode(180, 'logical').container.textContent!;
    // 0°는 1이 먼저, 180°는 4가 먼저 나와야 함
    expect(normal.indexOf('1')).toBeLessThan(normal.lastIndexOf('4'));
    expect(flipped.indexOf('4')).toBeLessThan(flipped.lastIndexOf('1'));
  });
});

describe('물리 뷰 1번 핀 표식', () => {
  it('1번 핀 위치 표식이 있다', () => {
    const { container } = renderNode(0, 'physical');
    expect(container.querySelector('[title="1번 핀 위치"]')).toBeTruthy();
  });
});

describe('논리 뷰 하우징 심볼 (핀 패드 격자)', () => {
  const pads = (o: 0 | 90 | 180 | 270) =>
    [...renderNode(o, 'logical').container.querySelectorAll('.hz-pad')] as HTMLElement[];

  /**
   * 예전에는 이 시험이 0°(왼쪽으로 나감)에서도 패드가 **가로로** 늘어서는 걸
   * 못박고 있었다(left 6/36/66/96 · top 한 종류). 그 그림이 바로 결함이었다:
   * 나가는 변(왼쪽)이 38px 밖에 안 되니 핸들 4개가 9.5px, 10P 면 3.8px 간격으로
   * 뭉갠다. 지금은 나가는 변에 핀이 줄지어 서도록 격자를 세워 그린다
   * (canvas/geometry.ts 의 drawGrid) — 그래서 0° 는 세로, 90° 는 가로가 맞다.
   */
  it('배선이 좌우로 나가면(0°) 핀이 세로 열로 선다', () => {
    const ps = pads(0);
    expect(ps).toHaveLength(4);
    expect(ps.map((p) => p.style.top)).toEqual(['6px', '36px', '66px', '96px']);
    expect(new Set(ps.map((p) => p.style.left)).size).toBe(1);
  });

  it('배선이 위아래로 나가면(90°) 핀이 가로 행으로 선다', () => {
    const ps = pads(90);
    expect(ps).toHaveLength(4);
    expect(ps.map((p) => p.style.left)).toEqual(['6px', '36px', '66px', '96px']);
    expect(new Set(ps.map((p) => p.style.top)).size).toBe(1);
  });

  it('0° 4P 의 핸들이 PITCH(30px) 간격으로 벌어진다 (예전엔 9.5px)', () => {
    const tops = [...renderNode(0, 'logical').container.querySelectorAll('.react-flow__handle')]
      .map((h) => parseFloat((h as HTMLElement).style.top));
    const uniq = [...new Set(tops)].sort((a, b) => a - b);
    expect(uniq).toEqual([19, 49, 79, 109]);   // INSET+PAD/2 부터 30px 씩
  });

  it('신호가 배정된 핀과 미배정 핀이 구분된다', () => {
    // 이 픽스처는 signal 이 없으므로 전부 미배정
    expect(pads(0).every((p) => !p.classList.contains('assigned'))).toBe(true);
  });

  it('핀 배치 축과 핸들 방향이 일치한다 (배선이 옆구리로 안 나감)', () => {
    // 90° = 배선이 위로 → 핸들은 전부 top
    const { container } = renderNode(90, 'logical');
    expect(container.querySelectorAll('.react-flow__handle-top').length).toBe(8);
    // 세로 방향에서 좌/우 핸들이 섞여 있으면 안 됨
    expect(container.querySelectorAll('.react-flow__handle-left').length).toBe(0);
    expect(container.querySelectorAll('.react-flow__handle-right').length).toBe(0);
  });

  it('가로 방향에서는 위/아래 핸들이 없다', () => {
    const { container } = renderNode(0, 'logical');
    expect(container.querySelectorAll('.react-flow__handle-left').length).toBe(8);
    expect(container.querySelectorAll('.react-flow__handle-top').length).toBe(0);
    expect(container.querySelectorAll('.react-flow__handle-bottom').length).toBe(0);
  });

  it('래치 돌기가 방향을 그림으로 알려준다', () => {
    const latch = (o: 0 | 90 | 180 | 270) => {
      const el = renderNode(o, 'logical').container.querySelector('.hz-latch') as HTMLElement;
      cleanup();
      return el.style;
    };
    expect(latch(0).left).toBe('-5px');     // 왼쪽으로 결합
    expect(latch(90).top).toBe('-5px');     // 위쪽
    expect(latch(180).right).toBe('-5px');  // 오른쪽
    expect(latch(270).bottom).toBe('-5px'); // 아래쪽
  });
});

describe('물리 뷰 회전 시 핸들 방향', () => {
  it('회전각에 따라 핸들 방향도 함께 돈다', () => {
    // 하우징 박스가 CSS 회전하므로 핸들도 같이 돌아야 배선이 맞는 쪽에서 나옴
    expect(renderNode(0, 'physical').container
      .querySelectorAll('.react-flow__handle-top').length).toBe(8);
    cleanup();
    expect(renderNode(90, 'physical').container
      .querySelectorAll('.react-flow__handle-right').length).toBe(8);
    cleanup();
    expect(renderNode(180, 'physical').container
      .querySelectorAll('.react-flow__handle-bottom').length).toBe(8);
    cleanup();
    expect(renderNode(270, 'physical').container
      .querySelectorAll('.react-flow__handle-left').length).toBe(8);
  });
});

describe('핸들 source/target 쌍 (엣지가 핀에 정확히 붙는 조건)', () => {
  it('각 핀에 source 와 target 핸들이 모두 있다', () => {
    const { container } = renderNode(90, 'logical');
    const sources = container.querySelectorAll('.react-flow__handle.source');
    const targets = container.querySelectorAll('.react-flow__handle.target');
    expect(sources.length).toBe(4);
    expect(targets.length).toBe(4);
  });

  it('target 핸들도 같은 방향에 붙는다 (선이 반대편으로 새지 않음)', () => {
    const { container } = renderNode(90, 'logical');
    const targets = [...container.querySelectorAll('.react-flow__handle.target')];
    // 90° = 위쪽이므로 모든 target 이 top 이어야 함
    expect(targets.every((t) => t.classList.contains('react-flow__handle-top'))).toBe(true);
  });

  it('물리 뷰도 회전 방향에 맞춰 target 이 따라간다', () => {
    const { container } = renderNode(90, 'physical');
    const targets = [...container.querySelectorAll('.react-flow__handle.target')];
    expect(targets.length).toBe(4);
    expect(targets.every((t) => t.classList.contains('react-flow__handle-right'))).toBe(true);
  });
});

describe('부품명 표시 (잘림 방지)', () => {
  it('긴 부품명이 ellipsis 로 잘리지 않는다', () => {
    const { container } = renderNode(0, 'logical');
    const nameEl = container.querySelector('.hz-ref-name') as HTMLElement;
    expect(nameEl.textContent).toContain('테스트 4P');
    // overflow:hidden + ellipsis 조합이면 잘림 → 없어야 함
    expect(nameEl.style.textOverflow).not.toBe('ellipsis');
    expect(nameEl.style.overflow).not.toBe('hidden');
  });

  it('부품명과 방향이 서로 다른 요소에 있다', () => {
    const { container } = renderNode(90, 'logical');
    const nameEl = container.querySelector('.hz-ref-name')!;
    const dirEl = container.querySelector('.hz-ref-dir')!;
    expect(nameEl.textContent).toContain('테스트 4P');
    expect(dirEl.textContent).toContain('90°');
    expect(nameEl).not.toBe(dirEl);
  });

  it('레퍼런스 라벨은 흰 배경을 깔아 배선이 글자를 관통하지 않게 한다', () => {
    const { container } = renderNode(0, 'logical');
    const ref = container.querySelector('.hz-ref') as HTMLElement;
    expect(ref).toBeTruthy();
    // 배경은 CSS 클래스로 준다 — 클래스가 붙어 있는지만 확인
    expect(ref.className).toContain('hz-ref');
  });
});

describe('배선 시작점 — 도형 변에서 시작하는가', () => {
  it('위쪽(90°) 핸들은 노드 상단 변(top:0)에 붙는다', () => {
    const { container } = renderNode(90, 'logical');
    const handles = [...container.querySelectorAll('.react-flow__handle')] as HTMLElement[];
    // 모든 핸들이 top:0 (도형 맨 위 변)
    expect(handles.every((h) => h.style.top === '0px' || h.style.top === '0')).toBe(true);
    // 좌우로는 핀 위치에 맞게 퍼져 있어야 함 (한 점에 몰리면 안 됨)
    const lefts = new Set(handles.map((h) => h.style.left));
    expect(lefts.size).toBe(4); // 4핀 = 서로 다른 4개 위치
  });

  it('아래쪽(270°) 핸들은 노드 하단 변(bottom:0)에 붙는다', () => {
    const { container } = renderNode(270, 'logical');
    const handles = [...container.querySelectorAll('.react-flow__handle')] as HTMLElement[];
    expect(handles.every((h) => h.style.bottom === '0px' || h.style.bottom === '0')).toBe(true);
  });

  it('왼쪽(0°) 핸들은 노드 좌측 변(left:0)에 붙고, 핀마다 다른 높이에 있다', () => {
    const { container } = renderNode(0, 'logical');
    const handles = [...container.querySelectorAll('.react-flow__handle')] as HTMLElement[];
    expect(handles.every((h) => h.style.left === '0px' || h.style.left === '0')).toBe(true);
    /**
     * 4P 1행 커넥터가 왼쪽으로 나가는 경우 — 패드 좌표를 그대로 쓰면 핸들이
     * 한 점에 겹쳐 원하는 핀을 고를 수 없다. 실제로 라이브에서 왼쪽 끝을
     * 끌었더니 4번 핀이 잡혔다. 겹치면 핀 순서로 변을 따라 편다.
     */
    const tops = new Set(handles.map((h) => h.style.top));
    expect(tops.size).toBe(4);
  });

  it('격자가 몇 행이든 핀마다 핸들이 따로 있다 (겹치면 고를 수 없다)', () => {
    // 2행 2열 하우징 — 0°(왼쪽)이면 핸들 top 이 두 종류여야 한다
    const h2: PartLibraryItem = {
      id: 'h2', category: 'housing', name: '2x2', pinCount: 4,
      pinLayout: [
        { index: 1, label: '1', offset: { x: 0, y: 0 } },
        { index: 2, label: '2', offset: { x: 1, y: 0 } },
        { index: 3, label: '3', offset: { x: 0, y: 1 } },
        { index: 4, label: '4', offset: { x: 1, y: 1 } },
      ],
    };
    const c2: Connector = {
      id: 'c2', kind: 'connector', housingId: 'h2', orientation: 0,
      positions: {}, pins: h2.pinLayout!.map((s) => ({ id: `q${s.index}`, index: s.index })),
    };
    const { container } = render(
      <ReactFlowProvider>
        <ConnectorNode
          id="c2" type="connector" dragging={false} zIndex={1}
          selectable selected={false} draggable deletable isConnectable
          positionAbsoluteX={0} positionAbsoluteY={0}
          data={{ connector: c2, housing: h2, view: 'logical' } as never}
        />
      </ReactFlowProvider>,
    );
    const handles = [...container.querySelectorAll('.react-flow__handle')] as HTMLElement[];
    /**
     * 2행 2열은 어느 쪽으로 세워도 한 자리에 두 핀이 겹친다(깊이 2).
     * 행에 맞춰 그대로 놓으면 도면상 정직하지만 두 핀이 한 점에 포개져 고를 수가
     * 없다 — 실제로 왼쪽 끝을 끌었더니 엉뚱한 핀이 잡혔다. 그래서 겹치는 핀은
     * 제 패드 폭(PAD) 안에서 안쪽 순서만큼 나눠 앉힌다(geometry.connectorLayout).
     * 자리(30px 격자)는 지키면서 4핀 모두 다른 높이가 된다.
     */
    expect(new Set(handles.map((h) => h.style.top)).size).toBe(4);
  });
});

describe('텍스트 가림 — 배선이 글자를 지나지 않는가', () => {
  // 텍스트 순서로 판정: 배선이 나가는 변 쪽에 헤더가 없어야 한다
  it('위(90°)로 배선이 나가면 헤더가 핀 아래로 내려간다', () => {
    const { container } = renderNode(90, 'logical');
    const t = container.textContent!;
    // 핀 번호(1)가 부품명보다 먼저 = 핀이 위, 헤더가 아래
    expect(t.indexOf('1')).toBeLessThan(t.indexOf('테스트 4P'));
  });

  it('아래(270°)로 배선이 나가면 헤더가 위에 남는다', () => {
    const { container } = renderNode(270, 'logical');
    const t = container.textContent!;
    expect(t.indexOf('테스트 4P')).toBeLessThan(t.indexOf('4'));
  });

  it('90°(위로 나감)는 레퍼런스 라벨이 하우징보다 뒤에 온다', () => {
    const { container } = renderNode(90, 'logical');
    const kids = [...container.querySelector('.hz-node-logical')!.children];
    const housingIdx = kids.findIndex((k) => k.classList.contains('hz-housing'));
    const refIdx = kids.findIndex((k) => k.classList.contains('hz-ref'));
    expect(housingIdx).toBeLessThan(refIdx); // 하우징이 먼저 = 라벨이 아래
  });

  it('0°(옆으로 나감)는 레퍼런스 라벨이 하우징보다 앞에 온다', () => {
    const { container } = renderNode(0, 'logical');
    const kids = [...container.querySelector('.hz-node-logical')!.children];
    const housingIdx = kids.findIndex((k) => k.classList.contains('hz-housing'));
    const refIdx = kids.findIndex((k) => k.classList.contains('hz-ref'));
    expect(refIdx).toBeLessThan(housingIdx);
  });

  it('부품명이 항상 완전히 렌더된다', () => {
    for (const o of [0, 90, 180, 270] as const) {
      const { container } = renderNode(o, 'logical');
      expect(container.textContent).toContain('테스트 4P');
      cleanup();
    }
  });
});
