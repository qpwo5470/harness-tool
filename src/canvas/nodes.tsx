/**
 * Agent A 소유 — 커스텀 노드 (핀 레벨 핸들).
 *
 * 도면형 리디자인(Claude Design):
 * 커넥터를 추상 블록이 아니라 **하우징 심볼**로 그린다.
 *   [레퍼런스 라벨] / [핀 패드 격자 + 래치 돌기] / [MPN 캡션]
 *
 * 기존 구현에서 반드시 지켜야 하는 불변식(인수인계 8장 — 실제로 겪은 버그):
 *  (1) 핸들은 핀 셀이 아니라 **노드 가장자리**에 절대 위치로 둔다.
 *      셀에 붙이면 배선이 도형 중간에서 시작하는 것처럼 보인다.
 *  (2) 각 핀에 source/target 핸들이 **모두** 있어야 한다.
 *      source 만 있으면 엣지가 노드 중심으로 폴백해 선이 엉뚱한 데서 나온다.
 *  (3) 핀 배치 축과 핸들 방향은 **함께** 바뀌어야 한다.
 *  (4) 배선이 나가는 변에는 글자를 두지 않는다. 선이 글자를 뚫고 지나간다.
 */
import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Connector, Device, PartLibraryItem, ViewMode, Orientation } from '../types';

export type ConnectorNodeData = {
  connector: Connector;
  housing?: PartLibraryItem;
  view: ViewMode;
  /** 도면 레퍼런스 (J1, SP1, D1 …) */
  ref?: string;
  /** 이 노드에 물린, 현재 강조 중인 핀 id 들 */
  hotPins?: string[];
};
export type DeviceNodeData = { device: Device; ref?: string; hotPins?: string[] };

/** 패드 26px + 간격 4px = 30px 피치 (Claude Design 스펙) */
export const PAD = 26;
export const PITCH = 30;
const INSET = 6; // 하우징 박스 안쪽 여백

const PIN_PHYS = 12; // 물리 뷰 핀 크기

/** 배선이 나가는 변 → React Flow Position */
export function handleSideOf(o: Orientation): Position {
  return o === 0 ? Position.Left
    : o === 90 ? Position.Top
    : o === 180 ? Position.Right
    : Position.Bottom;
}

/** 하우징 pinLayout 에서 격자 크기를 역산. 없으면 1행으로 편다. */
function gridOf(connector: Connector, housing?: PartLibraryItem) {
  const layout = housing?.pinLayout;
  if (layout?.length) {
    const cols = Math.max(...layout.map((s) => s.offset.x)) + 1;
    const rows = Math.max(...layout.map((s) => s.offset.y)) + 1;
    return { cols, rows, layout };
  }
  return { cols: connector.pins.length || 1, rows: 1, layout: undefined };
}

/**
 * 래치 돌기 — 하우징 바깥으로 튀어나온 사각형.
 * 위치가 결합 방향을 나타낸다. 글이 아니라 그림으로 방향을 읽게 하는 장치.
 */
function Latch({ o, color }: { o: Orientation; color: string }) {
  const T = 4;   // 두께
  const L = 18;  // 길이
  const base: CSSProperties = { position: 'absolute', background: color };
  const style: CSSProperties =
    o === 0 ? { ...base, width: T, height: L, left: -(T + 1), top: '50%', transform: 'translateY(-50%)' }
    : o === 90 ? { ...base, width: L, height: T, top: -(T + 1), left: '50%', transform: 'translateX(-50%)' }
    : o === 180 ? { ...base, width: T, height: L, right: -(T + 1), top: '50%', transform: 'translateY(-50%)' }
    : { ...base, width: L, height: T, bottom: -(T + 1), left: '50%', transform: 'translateX(-50%)' };
  return <div className="hz-latch" style={style} title="래치(결합) 방향" />;
}

export function ConnectorNode({ data, selected }: NodeProps) {
  const { connector, housing, view, ref: refLabel, hotPins } = data as unknown as ConnectorNodeData;
  const isSplice = connector.kind === 'splice';
  const o = connector.orientation;
  const hot = new Set(hotPins ?? []);

  // ── 물리 뷰: 기존 회전 렌더 유지 (제조 도면 뷰는 별도 과제) ──────────────
  if (view === 'physical' && housing?.pinLayout?.length) {
    const handlePos =
      o === 0 ? Position.Top
      : o === 90 ? Position.Right
      : o === 180 ? Position.Bottom
      : Position.Left;
    const xs = housing.pinLayout.map((s) => s.offset.x);
    const ys = housing.pinLayout.map((s) => s.offset.y);
    const w = (Math.max(...xs) + 1) * (PIN_PHYS + 8);
    const h = (Math.max(...ys) + 1) * (PIN_PHYS + 8);
    const border = isSplice ? 'var(--wire-splice, #a16207)' : 'var(--line-strong)';
    return (
      <div
        className="hz-node hz-node-phys"
        style={{
          position: 'relative', width: w, height: h,
          border: `1.5px solid ${border}`, background: '#fff',
          transform: `rotate(${o}deg)`, transformOrigin: 'center center',
          boxSizing: 'border-box',
        }}
        title={`${connector.kind} · ${housing.name} · ${o}°`}
      >
        <div
          className="hz-regmark"
          style={{
            position: 'absolute', left: -1.5, top: -1.5, width: 8, height: 8,
            borderTop: `2px solid ${border}`, borderLeft: `2px solid ${border}`,
          }}
          title="1번 핀 위치"
        />
        {connector.pins.map((pin) => {
          const slot = housing.pinLayout!.find((s) => s.index === pin.index);
          const left = (slot?.offset.x ?? 0) * (PIN_PHYS + 8) + 4;
          const top = (slot?.offset.y ?? 0) * (PIN_PHYS + 8) + 4;
          return (
            <div key={pin.id} style={{ position: 'absolute', left, top }}>
              <Handle
                id={pin.id} type="target" position={handlePos}
                style={{
                  position: 'absolute', left: 0, top: 0,
                  width: PIN_PHYS, height: PIN_PHYS,
                  background: 'transparent', border: 'none', transform: 'none', zIndex: 1,
                }}
              />
              <Handle
                id={pin.id} type="source" position={handlePos}
                style={{
                  position: 'relative', width: PIN_PHYS, height: PIN_PHYS,
                  background: '#fff', border: `1.5px solid ${border}`,
                  transform: 'none', zIndex: 2,
                }}
              />
              <div style={{ fontSize: 8, textAlign: 'center', lineHeight: 1 }} title={slot?.signal ?? ''}>
                {pin.label ?? slot?.label ?? pin.index}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── 논리 뷰: 하우징 심볼 (핀 패드 격자) ──────────────────────────────────
  const { cols, rows, layout } = gridOf(connector, housing);
  const boxW = cols * PITCH + INSET * 2 - (PITCH - PAD);
  const boxH = rows * PITCH + INSET * 2 - (PITCH - PAD);
  const side = handleSideOf(o);

  // 핀 → 격자 좌표. pinLayout 이 없으면 순서대로 1행에 편다.
  const cellOf = (index: number) => {
    const slot = layout?.find((s) => s.index === index);
    if (slot) return slot.offset;
    const i = index - 1;
    return { x: i % cols, y: Math.floor(i / cols) };
  };

  // 180°/270° 는 핀 순서가 뒤집혀 보여야 한다(도면을 반대에서 읽는 경우).
  const flipped = o === 180 || o === 270;
  const orderedPins = flipped ? [...connector.pins].reverse() : connector.pins;

  const arrow = o === 0 ? '←' : o === 90 ? '↑' : o === 180 ? '→' : '↓';
  const dirWord = o === 0 ? '왼쪽' : o === 90 ? '위쪽' : o === 180 ? '오른쪽' : '아래쪽';

  /**
   * 핸들 위치 — 노드 **가장자리**에 절대 위치.
   * 핀 패드의 행/열 중심에 맞춰 배선이 해당 패드에서 나가는 것처럼 보이게 한다.
   */
  const handleStyle = (index: number): CSSProperties => {
    const cell = cellOf(index);
    const cx = INSET + cell.x * PITCH + PAD / 2;
    const cy = INSET + cell.y * PITCH + PAD / 2;
    const common: CSSProperties = {
      width: 6, height: 6, background: 'var(--accent)',
      border: '1px solid #fff', borderRadius: 0, zIndex: 3,
    };
    if (o === 90) return { ...common, top: 0, left: cx, transform: 'translate(-50%, -50%)' };
    if (o === 270) return { ...common, bottom: 0, left: cx, transform: 'translate(-50%, 50%)' };
    if (o === 0) return { ...common, left: 0, top: cy, transform: 'translate(-50%, -50%)' };
    return { ...common, right: 0, top: cy, transform: 'translate(50%, -50%)' };
  };

  // 배선이 위(90°)로 나가면 라벨을 아래에 둔다 — 선이 글자를 뚫지 않게.
  const labelFirst = o !== 90;

  const nodeColor = isSplice ? 'var(--wire-splice, #a16207)' : 'var(--line-strong)';
  const boxColor = selected ? 'var(--accent)' : nodeColor;

  const refBlock = (
    <div className="hz-ref" title={`${housing?.name ?? connector.kind} · 방향 ${o}° (배선 ${dirWord})`}>
      <b className="num">{refLabel ?? (isSplice ? 'SP' : 'J')}</b>
      <span className="hz-ref-name">{isSplice ? '⑂ ' : ''}{housing?.name ?? connector.kind}</span>
      <span className="hz-ref-dir num">{arrow} {o}° {dirWord}</span>
    </div>
  );

  return (
    <div className={`hz-node hz-node-logical${selected ? ' on' : ''}`}>
      {labelFirst && refBlock}

      <div
        className="hz-housing"
        style={{ width: boxW, height: boxH, borderColor: boxColor }}
      >
        <Latch o={o} color={boxColor} />
        {/* 좌상단 등록 마크 = 1번 핀 기준점 */}
        <div
          className="hz-regmark"
          style={{ borderTopColor: boxColor, borderLeftColor: boxColor }}
          title="1번 핀 위치"
        />

        {orderedPins.map((pin) => {
          const cell = cellOf(pin.index);
          const slot = layout?.find((s) => s.index === pin.index);
          const assigned = Boolean(slot?.signal);
          return (
            <div
              key={pin.id}
              className={`hz-pad${assigned ? ' assigned' : ''}${hot.has(pin.id) ? ' hot' : ''}`}
              style={{ left: INSET + cell.x * PITCH, top: INSET + cell.y * PITCH }}
              title={slot?.signal ? `${pin.label ?? pin.index} · ${slot.signal}` : `핀 ${pin.label ?? pin.index}`}
            >
              <span className="num">{pin.label ?? slot?.label ?? pin.index}</span>
            </div>
          );
        })}

        {/* 핸들: 노드 가장자리 고정 — 배선이 도형 변에서 시작한다 */}
        {orderedPins.map((pin) => (
          <div key={`h-${pin.id}`}>
            <Handle id={pin.id} type="target" position={side} style={{ ...handleStyle(pin.index), opacity: 0 }} />
            <Handle id={pin.id} type="source" position={side} style={handleStyle(pin.index)} />
          </div>
        ))}
      </div>

      {housing?.mpn && <div className="hz-mpn num">{housing.mpn}</div>}
      {!labelFirst && refBlock}
    </div>
  );
}

export function DeviceNode({ data, selected }: NodeProps) {
  const { device, ref: refLabel } = data as unknown as DeviceNodeData;
  const terminals = device.terminals ?? [];
  return (
    <div className={`hz-node hz-node-device${selected ? ' on' : ''}`}>
      <div className="hz-ref">
        <b className="num">{refLabel ?? 'D'}</b>
        <span className="hz-ref-name">{device.name}</span>
      </div>
      <div className="hz-housing hz-housing-dev" style={{ padding: 6 }}>
        {/* 단자 없을 때도 연결 가능한 기본 핸들 */}
        <Handle id="__node" type="target" position={Position.Left} style={{ opacity: 0 }} />
        <Handle id="__node" type="source" position={Position.Left} style={{ opacity: 0 }} />
        <div className="hz-dev-terms">
          {terminals.map((t) => (
            <div key={t} className="hz-dev-term">
              <Handle id={t} type="target" position={Position.Right} style={{ opacity: 0 }} />
              <Handle id={t} type="source" position={Position.Right} className="hz-dev-handle" />
              <span className="num">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="hz-mpn">장치 · 단자 {terminals.length}</div>
    </div>
  );
}

export const nodeTypes = { connector: ConnectorNode, device: DeviceNode };
