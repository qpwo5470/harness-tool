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
 *      세로(위/아래)뿐 아니라 **가로**도 마찬가지다: 이름표는 하우징보다 넓어
 *      반드시 한쪽으로 삐져나오는데, 흰 배경이라 그 자리의 배선을 덮는다.
 *      그래서 넘치는 방향을 핸들 반대쪽으로 몰고(labelsAlignRight),
 *      그만큼을 경계 상자에 넣어 라우터가 피하게 한다(geometry.connectorBox).
 *  (5) 노드 폭은 **하우징 폭**으로 고정한다. 라벨이 노드 폭을 늘리면 하우징이
 *      밀려 "노드 좌상단 x == 하우징 x" 전제가 깨진다 — geometry 가 그걸 쓴다.
 */
import type { CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Connector, Device, PartLibraryItem, ViewMode, Orientation } from '../types';
/**
 * 기하 상수·계산은 전부 geometry.ts 한 곳에만 둔다.
 * 배선 계획(docToFlow)이 같은 숫자를 써야 레인 배정이 화면과 어긋나지 않는다.
 */
import {
  PITCH, INSET, PIN_PHYS, PIN_PHYS_PITCH, REF_BLOCK_H, MPN_CAPTION_H,
  DEV_PAD, DEV_ROW_H,
  connectorLayout, connectorRefParts, labelsAlignRight, layoutCells,
  deviceSize, deviceRefParts, deviceCaption,
} from './geometry';

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
  /**
   * 좌표가 쓸 수 없는 슬롯(offset 없음·음수)은 layoutCells 가 걸러 낸다.
   * 걸러낸 결과가 비면 논리 뷰 경로로 내려간다 — geometry.connectorBox·
   * docToFlow 의 판정과 **같은 함수**를 써야 배선 계획이 화면과 어긋나지 않는다.
   */
  const physLayout = layoutCells(housing?.pinLayout);
  if (view === 'physical' && physLayout) {
    const handlePos =
      o === 0 ? Position.Top
      : o === 90 ? Position.Right
      : o === 180 ? Position.Bottom
      : Position.Left;
    const xs = physLayout.map((s) => s.offset.x);
    const ys = physLayout.map((s) => s.offset.y);
    const w = (Math.max(...xs) + 1) * PIN_PHYS_PITCH;
    const h = (Math.max(...ys) + 1) * PIN_PHYS_PITCH;
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
        title={`${connector.kind} · ${housing?.name ?? connector.housingId} · ${o}°`}
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
          const slot = physLayout.find((s) => s.index === pin.index);
          const left = (slot?.offset.x ?? 0) * PIN_PHYS_PITCH + 4;
          const top = (slot?.offset.y ?? 0) * PIN_PHYS_PITCH + 4;
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
  /**
   * 격자·박스 크기·핸들이 변을 따라 놓이는 자리(along)는 geometry.ts 가 계산한다.
   * 배선 계획(docToFlow)이 같은 식을 써야 레인 배정이 화면과 어긋나지 않기 때문이다.
   * 여기서 남은 일은 그 숫자를 CSS 로 옮기는 것뿐이다.
   *
   * **패드 격자는 방향에 따라 세워져서 나온다**(geometry.drawGrid). 배선이 좌우로
   * 나가면(0°/180°) 핀이 세로 열로 서고, 위아래로 나가면(90°/270°) 가로 행으로
   * 선다 — 나가는 변에 핀이 줄지어 있어야 핸들이 PITCH 간격으로 벌어진다.
   * 예전에는 1행 10P 를 왼쪽으로 두면 핸들 10개가 38px 변에 3.8px 간격으로 뭉쳐
   * 어느 핀에서 나온 선인지 눈으로 구분할 수 없었다(20본 밀도 도면에서 확인).
   *
   * 그래서 `cell` 은 **그리는 격자** 좌표다. 저장된 pinLayout.offset(부품 정의
   * 기준)이 필요하면 `geo.defCellOf` 를 써라.
   */
  const geo = connectorLayout(connector, housing);
  const { layout, boxW, boxH, side, orderedPins } = geo;

  // 이름표 글자는 geometry 가 만든다 — 경계 상자의 폭을 그 글자로 재기 때문에
  // 여기서 따로 조립하면 상자와 화면이 조용히 갈린다(PDF 도 같은 함수를 쓴다).
  const refParts = connectorRefParts(connector, housing, refLabel);

  /** 핸들 위치 — 노드 **가장자리**에 절대 위치 (핀 셀에 붙이면 선이 도형 중간에서 시작한다) */
  const handleStyle = (index: number): CSSProperties => {
    const along = geo.along(index);
    const common: CSSProperties = {
      width: 6, height: 6, background: 'var(--accent)',
      border: '1px solid #fff', borderRadius: 0, zIndex: 3,
    };
    if (o === 90) return { ...common, top: 0, left: along, transform: 'translate(-50%, -50%)' };
    if (o === 270) return { ...common, bottom: 0, left: along, transform: 'translate(-50%, 50%)' };
    if (o === 0) return { ...common, left: 0, top: along, transform: 'translate(-50%, -50%)' };
    return { ...common, right: 0, top: along, transform: 'translate(50%, -50%)' };
  };

  // 배선이 위(90°)로 나가면 라벨을 아래에 둔다 — 선이 글자를 뚫지 않게.
  const labelFirst = o !== 90;

  const nodeColor = isSplice ? 'var(--wire-splice, #a16207)' : 'var(--line-strong)';
  const boxColor = selected ? 'var(--accent)' : nodeColor;

  /**
   * 이름표·캡션을 어느 변에 맞출지 — **핸들이 없는 쪽으로 넘치게** 한다.
   * 배선이 오른쪽으로 나가는 커넥터(o=180)는 오른쪽 정렬이라 글자가 왼쪽으로 넘친다.
   * 근거와 다른 방향의 처리는 geometry.labelsAlignRight 에 적어 뒀다.
   */
  const alignRight = labelsAlignRight(o);

  /**
   * 라벨 슬롯 — **폭은 하우징과 똑같이** 두고 글자는 그 안에서 absolute 로 띄운다.
   *
   * 왜 이렇게까지 하나: 이름표는 하우징보다 넓다. 흐름에 그냥 두면 **노드 폭을
   * 이름표가 정하고**, 오른쪽 정렬을 주자고 `align-items: flex-end` 를 걸면
   * 하우징이 오른쪽으로 밀린다. 그러면 geometry 가 전제로 쓰는
   * "노드 좌상단 x == 하우징 x" 가 깨져 핸들·패드 좌표가 통째로 어긋난다.
   * absolute 로 띄우면 글자는 슬롯 밖으로 넘치되 레이아웃 폭은 boxW 로 남는다.
   */
  const labelSlot = (h: number): CSSProperties => ({ position: 'relative', width: boxW, height: h });
  const labelAt: CSSProperties = { position: 'absolute', top: 0, ...(alignRight ? { right: 0 } : { left: 0 }) };

  const refBlock = (
    <div className="hz-label-slot" style={labelSlot(REF_BLOCK_H)}>
      <div
        className="hz-ref"
        style={labelAt}
        title={`${refParts.name} · 방향 ${refParts.dir}`}
      >
        <b className="num">{refParts.ref}</b>
        <span className="hz-ref-name">{refParts.name}</span>
        <span className="hz-ref-dir num">{refParts.dir}</span>
      </div>
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
          const cell = geo.cellOf(pin.index);
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

      {housing?.mpn && (
        <div className="hz-label-slot" style={labelSlot(MPN_CAPTION_H)}>
          <div className="hz-mpn num" style={labelAt}>{housing.mpn}</div>
        </div>
      )}
      {!labelFirst && refBlock}
    </div>
  );
}

/**
 * 장치 블록.
 *
 * 커넥터와 달리 **블록 자체를 이름표가 들어갈 만큼 넓힌다**(geometry.deviceSize).
 * 커넥터는 넘치는 폭을 경계 상자에만 더하고 그 방향을 핸들 반대쪽으로 몰지만,
 * 장치는 단자 핸들이 오른쪽 변·기본 핸들(`__node`)이 왼쪽 변이라 **양쪽 다 핸들**이라
 * 그 수가 안 통한다. 블록을 넓히면 핸들이 넓어진 변 위로 함께 옮겨 가므로
 * (deviceAnchor 가 같은 폭을 쓴다) 스텁 불변식이 유지되고, 이름을 자를 일도 없다.
 * 자세한 근거는 geometry.deviceSize 머리말.
 */
export function DeviceNode({ data, selected }: NodeProps) {
  const { device, ref: refLabel } = data as unknown as DeviceNodeData;
  const terminals = device.terminals ?? [];
  // 크기·글자는 전부 geometry 에서 온다 — 라우터가 피하는 상자(deviceBox)와
  // 화면이 같은 숫자를 봐야 이름표 뒤로 배선이 들어가지 않는다.
  const { w: boxW, h: boxH } = deviceSize(device, refLabel);
  const parts = deviceRefParts(device, refLabel);

  /**
   * 이름표·캡션 슬롯 — 커넥터와 같은 수법(폭을 블록과 똑같이 두고 글자는 그 안에서
   * absolute). 글꼴 실측이 어림(estimateTextWidth)보다 조금 넓어도 **노드 폭이 늘지
   * 않아** "노드 좌상단 x == 블록 x" 전제가 유지된다(geometry 가 그걸 쓴다).
   */
  const slot = (h: number): CSSProperties => ({ position: 'relative', width: boxW, height: h });
  const at: CSSProperties = { position: 'absolute', top: 0, left: 0 };

  return (
    <div className={`hz-node hz-node-device${selected ? ' on' : ''}`}>
      <div className="hz-label-slot" style={slot(REF_BLOCK_H)}>
        <div className="hz-ref" style={at} title={device.name}>
          <b className="num">{parts.ref}</b>
          <span className="hz-ref-name">{parts.name}</span>
        </div>
      </div>
      <div
        className="hz-housing hz-housing-dev"
        style={{ width: boxW, height: boxH, padding: DEV_PAD }}
      >
        {/* 단자 없을 때도 연결 가능한 기본 핸들 */}
        <Handle id="__node" type="target" position={Position.Left} style={{ opacity: 0 }} />
        <Handle id="__node" type="source" position={Position.Left} style={{ opacity: 0 }} />
        <div className="hz-dev-terms">
          {/* 줄 높이는 geometry 가 정한다 — 단자 핸들 y(deviceAnchor)와 PDF 의
              글자 베이스라인이 같은 DEV_ROW_H 를 쓴다 */}
          {terminals.map((t) => (
            <div key={t} className="hz-dev-term" style={{ height: DEV_ROW_H }}>
              <Handle id={t} type="target" position={Position.Right} style={{ opacity: 0 }} />
              <Handle id={t} type="source" position={Position.Right} className="hz-dev-handle" />
              <span className="num">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="hz-label-slot" style={slot(MPN_CAPTION_H)}>
        <div className="hz-mpn" style={at}>{deviceCaption(device)}</div>
      </div>
    </div>
  );
}

export const nodeTypes = { connector: ConnectorNode, device: DeviceNode };
