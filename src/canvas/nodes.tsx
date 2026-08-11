/**
 * Agent A 소유 — 커스텀 노드 (핀 레벨 핸들).
 * - ConnectorNode: 논리 뷰=핀 세로 목록 / 물리 뷰=하우징 pinLayout 좌표 + 방향 회전
 * - DeviceNode: 장치 블록 + 단자별 핸들
 */
import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Connector, Device, PartLibraryItem, ViewMode } from '../types';

export type ConnectorNodeData = {
  connector: Connector;
  housing?: PartLibraryItem;
  view: ViewMode;
};
export type DeviceNodeData = { device: Device };

const PIN = 12; // 핀 간격/크기 기준(px)

export function ConnectorNode({ data }: NodeProps) {
  const { connector, housing, view } = data as unknown as ConnectorNodeData;
  const isSplice = connector.kind === 'splice';
  const border = isSplice ? '#d97706' : '#3b82f6';
  const bg = isSplice ? '#fef3c7' : '#eff6ff';

  if (view === 'physical' && housing?.pinLayout?.length) {
    // 물리 뷰: 하우징 좌표대로 핀 배치 + orientation 회전.
    // 하우징 박스가 CSS로 회전하므로 핸들 방향도 같이 돌려야
    // 배선이 실제 핀이 향한 쪽에서 나온다.
    const ori = connector.orientation;
    const handlePos =
      ori === 0 ? Position.Top
      : ori === 90 ? Position.Right
      : ori === 180 ? Position.Bottom
      : Position.Left;
    const xs = housing.pinLayout.map((s) => s.offset.x);
    const ys = housing.pinLayout.map((s) => s.offset.y);
    const w = (Math.max(...xs) + 1) * (PIN + 8);
    const h = (Math.max(...ys) + 1) * (PIN + 8);
    return (
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          border: `1.5px solid ${border}`,
          borderRadius: 6,
          background: bg,
          transform: `rotate(${connector.orientation}deg)`,
          transformOrigin: 'center center',
          // 회전해도 레이아웃이 밀리지 않도록 자기 박스 안에서만 회전
          boxSizing: 'border-box',
        }}
        title={`${connector.kind} · ${housing.name} · ${connector.orientation}°`}
      >
        {/* 1번 핀 쪽 표식 — 커넥터가 어느 방향을 보는지 알려줌 */}
        <div
          style={{
            position: 'absolute', left: 0, top: 0, width: 0, height: 0,
            borderTop: `8px solid ${border}`,
            borderRight: '8px solid transparent',
            borderTopLeftRadius: 4,
          }}
          title="1번 핀 위치"
        />
        {connector.pins.map((pin) => {
          const slot = housing.pinLayout!.find((s) => s.index === pin.index);
          const left = (slot?.offset.x ?? 0) * (PIN + 8) + 4;
          const top = (slot?.offset.y ?? 0) * (PIN + 8) + 4;
          return (
            <div key={pin.id} style={{ position: 'absolute', left, top }}>
              {/* 한 핀은 배선의 출발점이자 도착점이 될 수 있어야 한다.
                  source/target 을 같은 자리에 겹쳐 둬야 엣지가
                  실제 핀 위치에서 그려진다(없으면 노드 중심으로 폴백). */}
              <Handle
                id={pin.id}
                type="target"
                position={handlePos}
                style={{
                  position: 'absolute',
                  left: 0, top: 0,
                  width: PIN, height: PIN,
                  background: 'transparent',
                  border: 'none',
                  transform: 'none',
                  zIndex: 1,
                }}
              />
              <Handle
                id={pin.id}
                type="source"
                position={handlePos}
                style={{
                  position: 'relative',
                  width: PIN,
                  height: PIN,
                  background: '#fff',
                  border: `1.5px solid ${border}`,
                  transform: 'none',
                  zIndex: 2,
                }}
              />
              <div
                style={{ fontSize: 8, textAlign: 'center', lineHeight: 1 }}
                title={slot?.signal ?? ''}
              >
                {pin.label ?? slot?.label ?? pin.index}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 논리 뷰
  // 방향(orientation) = 배선이 나가는 쪽.
  //  0°/180°  → 핀을 세로로 쌓고 배선은 좌/우로 (가로형)
  //  90°/270° → 핀을 가로로 늘어놓고 배선은 위/아래로 (세로형)
  //
  // 두 가지가 핵심:
  //  (1) 핸들은 각 핀 셀이 아니라 "노드 가장자리"에 절대 위치로 둔다.
  //      셀에 붙이면 배선이 도형 중간에서 시작하는 것처럼 보인다.
  //  (2) 배선이 나가는 변에는 헤더를 두지 않는다.
  //      위로 나가는데 헤더가 위에 있으면 선이 글자를 뚫고 나온다.
  const o = connector.orientation;
  const isVertical = o === 90 || o === 270;
  const handleSide =
    o === 0 ? Position.Left
    : o === 90 ? Position.Top
    : o === 180 ? Position.Right
    : Position.Bottom;
  const orderedPins = o === 180 || o === 270
    ? [...connector.pins].reverse()
    : connector.pins;

  const arrow = o === 0 ? '←' : o === 90 ? '↑' : o === 180 ? '→' : '↓';
  const dirWord = o === 0 ? '왼쪽' : o === 90 ? '위쪽' : o === 180 ? '오른쪽' : '아래쪽';

  const PIN_CELL = 30;   // 세로형에서 핀 한 칸 폭
  const PIN_ROW = 20;    // 가로형에서 핀 한 줄 높이
  const EDGE = 14;       // 배선이 나가는 변에 확보할 여백

  // 헤더(부품명 + 방향). 배선이 나가는 반대쪽에 배치한다.
  const header = (
    <div
      style={{
        padding: '4px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        // 배선이 나가는 변 쪽에 테두리를 그리지 않음
        // 헤더가 아래로 가는 90°에서는 위쪽에 구분선을 그린다
        [o === 90 ? 'borderTop' : 'borderBottom']: `1px solid ${border}`,
      }}
      title={`${housing?.name ?? connector.kind} · 방향 ${o}° (배선 ${dirWord})`}
    >
      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11 }}>
        {isSplice ? '⑂ ' : ''}
        {housing?.name ?? connector.kind}
      </div>
      <div style={{ fontSize: 9, color: border, fontWeight: 700 }}>
        {arrow} {o}° {dirWord}
      </div>
    </div>
  );

  // 핀 영역. 핸들은 여기 셀이 아니라 노드 가장자리에 따로 깐다.
  const pinArea = (
    <div
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'row' : 'column',
        // 배선이 나가는 변에 핸들 자리를 비워둔다
        paddingTop: o === 90 ? EDGE : 0,
        paddingBottom: o === 270 ? EDGE : 0,
        paddingLeft: o === 0 ? EDGE : 0,
        paddingRight: o === 180 ? EDGE : 0,
      }}
    >
      {orderedPins.map((pin) => {
        const sig = housing?.pinLayout?.find((sl) => sl.index === pin.index)?.signal;
        return (
          <div
            key={pin.id}
            style={{
              display: 'flex',
              flexDirection: isVertical ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              width: isVertical ? PIN_CELL : undefined,
              height: isVertical ? undefined : PIN_ROW,
              padding: isVertical ? '2px 0' : '0 8px',
              fontSize: 10,
            }}
            title={sig ? `${pin.label ?? pin.index} · ${sig}` : `핀 ${pin.label ?? pin.index}`}
          >
            <span style={{ fontWeight: 600 }}>{pin.label ?? pin.index}</span>
            {sig && (
              <span
                style={{
                  color: '#6b7280',
                  fontSize: 8,
                  maxWidth: isVertical ? PIN_CELL - 4 : 90,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {sig}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  /** 핀 i 의 핸들을 노드 가장자리 정확한 위치에 배치 */
  const handleStyle = (i: number): CSSProperties => {
    const n = orderedPins.length;
    // 핀 셀 중앙에 오도록 비율 계산
    const ratio = `${((i + 0.5) / n) * 100}%`;
    const common: CSSProperties = {
      background: border,
      width: 7,
      height: 7,
      border: '1.5px solid #fff',
    };
    if (o === 90) return { ...common, top: 0, left: ratio, transform: 'translate(-50%, -50%)' };
    if (o === 270) return { ...common, bottom: 0, left: ratio, transform: 'translate(-50%, 50%)' };
    if (o === 0) return { ...common, left: 0, top: ratio, transform: 'translate(-50%, -50%)' };
    return { ...common, right: 0, top: ratio, transform: 'translate(50%, -50%)' };
  };

  return (
    <div
      style={{
        position: 'relative',
        border: `1.5px solid ${border}`,
        borderRadius: 6,
        background: bg,
        minWidth: isVertical ? orderedPins.length * PIN_CELL : 110,
      }}
    >
      {/* 배선이 위(90°)로 나가면 헤더를 아래에 둬야 선이 글자를 지나지 않는다.
          반대로 아래(270°)로 나가면 헤더가 위에 있어야 한다. */}
      {o === 90 ? (
        <>
          {pinArea}
          {header}
        </>
      ) : (
        <>
          {header}
          {pinArea}
        </>
      )}

      {/* 핸들: 노드 가장자리에 고정 — 배선이 도형 변에서 시작한다 */}
      {orderedPins.map((pin, i) => (
        <div key={`h-${pin.id}`}>
          <Handle
            id={pin.id}
            type="target"
            position={handleSide}
            style={{ ...handleStyle(i), opacity: 0 }}
          />
          <Handle
            id={pin.id}
            type="source"
            position={handleSide}
            style={handleStyle(i)}
          />
        </div>
      ))}
    </div>
  );
}

export function DeviceNode({ data }: NodeProps) {
  const { device } = data as unknown as DeviceNodeData;
  const terminals = device.terminals ?? [];
  return (
    <div
      style={{
        minWidth: 110,
        border: '1.5px dashed #6b7280',
        borderRadius: 6,
        background: '#f9fafb',
        fontSize: 11,
      }}
    >
      <div style={{ padding: '4px 8px', fontWeight: 600 }}>📦 {device.name}</div>
      {/* 단자 없을 때도 연결 가능한 기본 핸들 */}
      <Handle id="__node" type="target" position={Position.Left} style={{ background: '#6b7280', opacity: 0 }} />
      <Handle id="__node" type="source" position={Position.Left} style={{ background: '#6b7280' }} />
      {terminals.map((t) => (
        <div key={t} style={{ position: 'relative', padding: '2px 10px' }}>
          <Handle id={t} type="target" position={Position.Right} style={{ background: '#6b7280', opacity: 0 }} />
          <Handle id={t} type="source" position={Position.Right} style={{ background: '#6b7280' }} />
          {t}
        </div>
      ))}
    </div>
  );
}

export const nodeTypes = { connector: ConnectorNode, device: DeviceNode };
