/**
 * 배선 hover 상세 카드.
 *
 * 왜 표에 다 펼치지 않고 hover 카드인가:
 * 배선 한 가닥의 전체 속성(네트·핀·신호·단자·게이지·길이)을 접속표에 다 펼치면
 * 열이 늘어나 폭이 모자란다. 도면에서 선을 짚었을 때만 부르는 편이
 * "지금 보고 있는 그 선"의 정보를 준다.
 */
import { useHoverStore } from '../store/hoverStore';
import { strokeColor } from './docToFlow';
import { computeNets } from '../store/netlist';
import { resolveWireLength } from '../store/wireLength';
import type { HarnessDocument, Wire, Endpoint } from '../types';

const W = 268;

function Swatch({ base, stripe }: { base: string; stripe?: string }) {
  const b = strokeColor(base);
  const style = stripe
    ? { background: `repeating-linear-gradient(45deg, ${b} 0 2px, ${strokeColor(stripe)} 2px 5px)` }
    : { background: b };
  return <i className="hz-card-swatch" style={style} aria-hidden />;
}

export function WireCard({
  wire, doc, refs, abbr,
}: {
  wire: Wire;
  doc: HarnessDocument;
  refs: Map<string, string>;
  abbr: string;
}) {
  const x = useHoverStore((s) => s.x);
  const y = useHoverStore((s) => s.y);

  const net = computeNets(doc).find((n) => n.wireIds.includes(wire.id));

  const describe = (e: Endpoint) => {
    if (e.type === 'device') {
      const d = doc.devices.find((x) => x.id === e.deviceId);
      return {
        ref: refs.get(e.deviceId) ?? '',
        name: d?.name ?? e.deviceId,
        pin: e.terminal ?? '',
        detail: '장치 단자',
      };
    }
    const c = doc.connectors.find((x) => x.id === e.connectorId);
    const pin = c?.pins.find((p) => p.id === e.pinId);
    const housing = doc.usedParts.find((p) => p.id === c?.housingId);
    const slot = housing?.pinLayout?.find((s) => s.index === pin?.index);
    const term = pin?.terminalId
      ? doc.usedParts.find((p) => p.id === pin.terminalId)
      : undefined;
    return {
      ref: refs.get(e.connectorId) ?? '',
      name: housing?.name ?? c?.kind ?? e.connectorId,
      pin: String(pin?.label ?? pin?.index ?? '?'),
      detail: [slot?.signal, term ? `단자 ${term.mpn ?? term.name}` : null]
        .filter(Boolean).join(' · ') || '신호 미지정',
    };
  };

  const from = describe(wire.from);
  const to = describe(wire.to);
  const len = resolveWireLength(doc, wire);

  // 커서 오른쪽이 기본. 오른쪽 공간이 부족하면 왼쪽으로 뒤집는다.
  const flip = x > 380;
  const left = flip ? x - (W + 14) : x + 16;
  const top = Math.max(8, y - 40);

  return (
    <div className="hz-card" style={{ left, top, width: W }}>
      <header>
        <b className="num">{net?.code ?? '—'}</b>
        <span className="hz-card-wire num">{wire.id.slice(-4)}</span>
        <span className="spacer" />
        <Swatch base={wire.color.base} stripe={wire.color.stripe} />
        <b className="num">{abbr}</b>
      </header>
      <div className="hz-card-body">
        {([['FROM', from], ['TO', to]] as const).map(([label, ep]) => (
          <div key={label} className="hz-card-ep">
            <span className="hz-card-label num">{label}</span>
            <div>
              <div>
                <b className="num">{ep.ref}</b> {ep.name}
                <b className="num hz-card-pin"> #{ep.pin}</b>
              </div>
              <div className="hz-card-detail">{ep.detail}</div>
            </div>
          </div>
        ))}
        <div className="hz-card-grid">
          <div>
            <span className="hz-card-label num">색</span>
            <b>{wire.color.base}{wire.color.stripe ? `/${wire.color.stripe}` : ''}</b>
          </div>
          <div>
            <span className="hz-card-label num">게이지</span>
            <b className="num">{wire.gauge.system.toUpperCase()}{wire.gauge.value}</b>
          </div>
          <div>
            {/* 케이블 심선은 케이블 길이로 재단된다 — 여기서만 '—' 로 두면
                물리 뷰·자재표와 숫자가 갈린다. 대신 출처를 밝힌다. */}
            <span className="hz-card-label num">{len.source === 'cable' ? '길이(케이블)' : '길이'}</span>
            <b className="num">{len.mm != null ? `${len.mm}mm` : '—'}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
