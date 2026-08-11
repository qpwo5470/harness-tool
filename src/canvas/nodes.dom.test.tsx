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

describe('세로 방향(90/270°) 레이아웃', () => {
  /** 핀 라벨들을 담는 컨테이너 (핸들은 이제 노드 가장자리에 별도 배치됨) */
  const pinArea = (o: 0 | 90 | 180 | 270) => {
    const { container } = renderNode(o, 'logical');
    // flex-direction 이 지정된 핀 영역을 찾는다 (헤더는 column 고정이라 제외)
    const areas = [...container.querySelectorAll('div')].filter(
      (d) => d.style.display === 'flex' && (d.style.paddingTop || d.style.paddingLeft
        || d.style.paddingBottom || d.style.paddingRight),
    );
    return areas.find((a) => a.querySelector('span')) as HTMLElement;
  };

  it('가로 방향(0/180°)은 핀이 세로로 쌓인다', () => {
    expect(pinArea(0).style.flexDirection).toBe('column');
    cleanup();
    expect(pinArea(180).style.flexDirection).toBe('column');
  });

  it('세로 방향(90/270°)은 핀이 가로로 늘어선다', () => {
    expect(pinArea(90).style.flexDirection).toBe('row');
    cleanup();
    expect(pinArea(270).style.flexDirection).toBe('row');
  });

  it('핀 배치 축과 핸들 방향이 일치한다 (배선이 옆구리로 안 나감)', () => {
    // 90°: 핀은 가로(row) + 핸들은 위(top)
    const { container } = renderNode(90, 'logical');
    const area = container.querySelector('div[style*="flex-direction: row"]') as HTMLElement;
    expect(area).toBeTruthy();
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
    const nameEl = [...container.querySelectorAll('div')]
      .find((d) => d.textContent === '테스트 4P')!;
    expect(nameEl).toBeTruthy();
    // overflow:hidden + ellipsis 조합이면 잘림 → 없어야 함
    expect(nameEl.style.textOverflow).not.toBe('ellipsis');
    expect(nameEl.style.overflow).not.toBe('hidden');
  });

  it('부품명과 방향이 서로 다른 줄에 있다', () => {
    const { container } = renderNode(90, 'logical');
    const nameEl = [...container.querySelectorAll('div')]
      .find((d) => d.textContent === '테스트 4P')!;
    const dirEl = [...container.querySelectorAll('div')]
      .find((d) => d.textContent?.includes('90°') && d.textContent?.includes('위쪽'))!;
    expect(nameEl).toBeTruthy();
    expect(dirEl).toBeTruthy();
    expect(nameEl).not.toBe(dirEl); // 같은 요소가 아님 = 줄 분리됨
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

  it('왼쪽(0°) 핸들은 노드 좌측 변(left:0)에 붙는다', () => {
    const { container } = renderNode(0, 'logical');
    const handles = [...container.querySelectorAll('.react-flow__handle')] as HTMLElement[];
    expect(handles.every((h) => h.style.left === '0px' || h.style.left === '0')).toBe(true);
    const tops = new Set(handles.map((h) => h.style.top));
    expect(tops.size).toBe(4);
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

  it('90°(위로 나감)는 헤더가 핀 아래에 오지 않고, 상단에 핸들 여백이 확보된다', () => {
    const { container } = renderNode(90, 'logical');
    const area = [...container.querySelectorAll('div')].find(
      (d) => d.style.paddingTop && d.style.paddingTop !== '0px',
    );
    expect(area).toBeTruthy(); // 배선 나가는 변에 여백 있음
  });

  it('부품명이 항상 완전히 렌더된다', () => {
    for (const o of [0, 90, 180, 270] as const) {
      const { container } = renderNode(o, 'logical');
      expect(container.textContent).toContain('테스트 4P');
      cleanup();
    }
  });
});
