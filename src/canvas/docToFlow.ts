/**
 * Agent A 소유 — 문서 → React Flow(커스텀 노드/엣지) 변환.
 */
import type { Node, Edge } from '@xyflow/react';
import type { HarnessDocument, ViewMode, Endpoint } from '../types';
import { computeNets } from '../store/netlist';

function endpointNodeId(e: Endpoint): string {
  return e.type === 'pin' ? e.connectorId : e.deviceId;
}
function endpointHandle(e: Endpoint): string {
  return e.type === 'pin' ? e.pinId : (e.terminal ?? '__node');
}
/**
 * 와이어 색을 화면에 그릴 색으로 변환.
 * - 흰색/아주 밝은 색은 캔버스 배경에 묻히므로 회색 테두리 효과를 위해 보정
 * - 알 수 없는 색 이름은 회색으로 폴백(잘못된 값이 검정으로 보이지 않게)
 */
const NAMED_COLORS = new Set([
  'red','black','white','green','blue','yellow','orange','brown',
  'purple','gray','grey','pink','violet','cyan','magenta',
]);

export function strokeColor(base: string): string {
  const c = base.trim().toLowerCase();
  if (c === 'white') return '#d1d5db';        // 흰 선은 옅은 회색으로 표현
  if (c === 'yellow') return '#eab308';       // 노랑은 배경에 묻히므로 진하게
  if (NAMED_COLORS.has(c)) return c;
  if (/^#[0-9a-f]{3,8}$/i.test(base.trim())) return base.trim();
  return '#6b7280';                            // 알 수 없는 값
}

function pos(
  p: { logical?: { x: number; y: number }; physical?: { x: number; y: number } },
  view: ViewMode,
  fallback: { x: number; y: number },
) {
  return p[view] ?? p.logical ?? p.physical ?? fallback;
}

export function docToNodes(doc: HarnessDocument, view: ViewMode): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  for (const c of doc.connectors) {
    nodes.push({
      id: c.id,
      type: 'connector',
      zIndex: 1,
      position: pos(c.positions, view, { x: 80 + i * 160, y: 80 }),
      data: {
        connector: c,
        housing: doc.usedParts.find((p) => p.id === c.housingId),
        view,
      },
    });
    i++;
  }
  for (const d of doc.devices) {
    nodes.push({
      id: d.id,
      type: 'device',
      zIndex: 1,
      position: pos(d.positions, view, { x: 80 + i * 160, y: 320 }),
      data: { device: d },
    });
    i++;
  }
  return nodes;
}

/** 선택된 요소가 속한 네트의 와이어 id 집합 (하이라이트용) */
export function highlightedWires(doc: HarnessDocument, selection: string | null): Set<string> {
  if (!selection) return new Set();
  const nets = computeNets(doc);
  // 선택이 와이어인 경우
  const byWire = nets.find((n) => n.wireIds.includes(selection));
  if (byWire) return new Set(byWire.wireIds);
  // 선택이 커넥터/장치인 경우: 그 노드에 속한 끝점을 포함하는 네트 전부
  const ids = new Set<string>();
  for (const n of nets) {
    if (n.members.some((m) => m.split(':')[1] === selection)) {
      for (const w of n.wireIds) ids.add(w);
    }
  }
  return ids;
}

/**
 * @param highlight 같은 네트에 속해 강조할 와이어들 (굵게/선명하게)
 * @param labelFor  라벨을 띄울 와이어 id — 딱 하나만.
 *                  네트 전체에 라벨을 달면 스플라이스 근처에서 서로 겹쳐 못 읽는다.
 */
export function docToEdges(
  doc: HarnessDocument,
  highlight: Set<string> = new Set(),
  labelFor: string | null = null,
): Edge[] {
  const dim = highlight.size > 0;
  return doc.wires.map((w) => {
    const stripe = w.color.stripe ? `/${w.color.stripe}` : '';
    const on = highlight.has(w.id);
    const len = w.lengthMm != null ? ` · ${w.lengthMm}mm` : '';
    const spec = `${w.color.base}${stripe} · ${w.gauge.system.toUpperCase()}${w.gauge.value}${len}`;
    return {
      id: w.id,
      source: endpointNodeId(w.from),
      sourceHandle: endpointHandle(w.from),
      target: endpointNodeId(w.to),
      targetHandle: endpointHandle(w.to),
      // 라벨은 선택(하이라이트)했을 때만 표시.
      // 항상 띄우면 선이 짧거나 여러 가닥이 모일 때 서로 겹쳐 잘린다.
      // 색은 선 자체로, 나머지 스펙은 접속표/속성 패널에서 확인한다.
      label: w.id === labelFor ? spec : undefined,
      // 라벨 가독성: 불투명 흰 배경 + 선 색 테두리로 선 위에서도 또렷하게
      labelShowBg: true,
      labelBgPadding: [8, 5] as [number, number],
      labelBgBorderRadius: 5,
      labelBgStyle: {
        fill: '#ffffff',
        fillOpacity: 1,
        stroke: strokeColor(w.color.base),
        strokeWidth: 1.5,
      },
      animated: on,
      // 노드보다 아래에 그려 커넥터 블록을 가로지르지 않게 한다
      zIndex: 0,
      style: {
        stroke: strokeColor(w.color.base),
        strokeWidth: on ? 4 : 2,
        opacity: dim && !on ? 0.25 : 1,
      },
      // 글자는 항상 진한 회색 — 선 색이 노랑/흰색이어도 읽힌다
      labelStyle: { fontSize: 11, fontWeight: 700, fill: '#111827' },
      // 선택하지 않아도 확인할 수 있도록 스펙을 data 로 실어 보낸다(툴팁용)
      data: { spec },
    };
  });
}

/** 하위호환 합본 (테스트/기존 호출부) */
export function docToFlow(doc: HarnessDocument, view: ViewMode): { nodes: Node[]; edges: Edge[] } {
  return { nodes: docToNodes(doc, view), edges: docToEdges(doc) };
}
