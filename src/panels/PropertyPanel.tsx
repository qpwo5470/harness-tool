/**
 * Agent C 소유 — 속성 패널 (Wave 1).
 * 선택된 요소 종류에 따라 편집기 제공:
 * - 와이어: 색(base/stripe), 게이지(system/value), 길이
 * - 커넥터: 방향(orientation), 메모
 * - 장치: 이름, 단자 목록
 */
import { useHarnessStore } from '../store/harnessStore';
import type { Orientation, Cable, PartLibraryItem } from '../types';
import { SEED_PARTS } from '../library/seed';
import { loadCustomParts } from '../library/customParts';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prop-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PropertyPanel() {
  const selection = useHarnessStore((s) => s.selection);
  const doc = useHarnessStore((s) => s.doc);
  const updateWire = useHarnessStore((s) => s.updateWire);
  const updateConnector = useHarnessStore((s) => s.updateConnector);
  const updateDevice = useHarnessStore((s) => s.updateDevice);
  const addCable = useHarnessStore((s) => s.addCable);
  const addUsedPart = useHarnessStore((s) => s.addUsedPart);
  const updateCable = useHarnessStore((s) => s.updateCable);
  const remove = useHarnessStore((s) => s.remove);

  const wire = doc.wires.find((w) => w.id === selection);
  const conn = doc.connectors.find((c) => c.id === selection);
  const dev = doc.devices.find((d) => d.id === selection);
  const cable = wire?.cableId ? doc.cables?.find((c) => c.id === wire.cableId) : undefined;

  // 선택 가능한 터미널(크림프핀) 목록 — 시드 + 내가 만든 부품
  const terminals: PartLibraryItem[] = [
    ...loadCustomParts().filter((p) => p.category === 'terminal'),
    ...SEED_PARTS.filter((p) => p.category === 'terminal'),
  ];

  if (!selection || (!wire && !conn && !dev)) {
    return (
      <aside className="panel">
        <h3>속성</h3>
        <p className="muted">
          캔버스에서 요소를 클릭하세요.<br /><br />
          <b>배선</b>을 클릭하면 색·게이지·길이가 선 위에 표시되고,
          같은 네트(스플라이스 너머까지)가 함께 강조됩니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <h3>속성</h3>

      {wire && (
        <>
          <div className="prop-kind">와이어</div>
          <Row label="색(기본)">
            <input value={wire.color.base}
              onChange={(e) => updateWire(wire.id, { color: { ...wire.color, base: e.target.value } })} />
          </Row>
          <Row label="색(줄무늬)">
            <input value={wire.color.stripe ?? ''} placeholder="없음"
              onChange={(e) => updateWire(wire.id, { color: { ...wire.color, stripe: e.target.value || undefined } })} />
          </Row>
          <Row label="게이지 단위">
            <select value={wire.gauge.system}
              onChange={(e) => updateWire(wire.id, { gauge: { ...wire.gauge, system: e.target.value as 'awg' | 'mm2' } })}>
              <option value="awg">AWG</option>
              <option value="mm2">mm²(SQ)</option>
            </select>
          </Row>
          <Row label="게이지 값">
            <input type="number" value={wire.gauge.value}
              onChange={(e) => updateWire(wire.id, { gauge: { ...wire.gauge, value: Number(e.target.value) } })} />
          </Row>
          <Row label="길이(mm)">
            <input type="number" value={wire.lengthMm ?? ''}
              onChange={(e) => updateWire(wire.id, { lengthMm: e.target.value ? Number(e.target.value) : undefined })} />
          </Row>

          {/* 멀티코어 케이블 소속 — "몇 코어짜리 하네스" 표현 */}
          <Row label="케이블">
            <select
              value={wire.cableId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__new__') {
                  const c: Cable = {
                    id: `cbl-${Date.now().toString(36)}`,
                    name: `케이블 ${(doc.cables?.length ?? 0) + 1}`,
                    coreCount: 2,
                  };
                  addCable(c);
                  updateWire(wire.id, { cableId: c.id });
                } else {
                  updateWire(wire.id, { cableId: v || undefined });
                }
              }}
            >
              <option value="">단선</option>
              {(doc.cables ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id} ({c.coreCount}C)
                </option>
              ))}
              <option value="__new__">+ 새 케이블…</option>
            </select>
          </Row>

          {cable && (
            <>
              <Row label="코어 수">
                <input type="number" min={1} value={cable.coreCount}
                  onChange={(e) => updateCable(cable.id, { coreCount: Math.max(1, Number(e.target.value) || 1) })} />
              </Row>
              <Row label="케이블명">
                <input value={cable.name ?? ''}
                  onChange={(e) => updateCable(cable.id, { name: e.target.value || undefined })} />
              </Row>
              <Row label="자켓색">
                <input value={cable.jacketColor ?? ''}
                  onChange={(e) => updateCable(cable.id, { jacketColor: e.target.value || undefined })} />
              </Row>
              <p className="muted">
                같은 케이블에 속한 심선: {doc.wires.filter((w) => w.cableId === cable.id).length}가닥
              </p>
            </>
          )}
        </>
      )}

      {conn && (
        <>
          <div className="prop-kind">커넥터 · {conn.kind}</div>
          <Row label="방향">
            <select value={conn.orientation}
              onChange={(e) => updateConnector(conn.id, { orientation: Number(e.target.value) as Orientation })}>
              <option value={0}>← 0° (왼쪽)</option>
              <option value={90}>↑ 90° (위쪽)</option>
              <option value={180}>→ 180° (오른쪽)</option>
              <option value={270}>↓ 270° (아래쪽)</option>
            </select>
          </Row>
          <p className="muted">배선이 나가는 방향입니다. 논리 뷰는 핀 위치, 물리 뷰는 하우징이 회전합니다.</p>
          <Row label="메모">
            <input value={conn.note ?? ''}
              onChange={(e) => updateConnector(conn.id, { note: e.target.value || undefined })} />
          </Row>
          {/* 핀별 터미널(크림프핀) 지정 — 파트리스트 발주에 반영됨 */}
          {conn.kind !== 'splice' && (
            <>
              <div className="pin-terminals">
                <div className="lib-cat-title">
                  핀 {conn.pins.length}개 · 터미널 지정
                </div>

                {/* 전체 일괄 지정 */}
                <label className="prop-row">
                  <span>전체</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      updateConnector(conn.id, {
                        pins: conn.pins.map((p) => ({
                          ...p,
                          terminalId: v === '__none__' ? undefined : v,
                        })),
                      });
                      if (v !== '__none__') {
                        const t = terminals.find((x) => x.id === v);
                        if (t) addUsedPart(t);
                      }
                      e.target.value = '';
                    }}
                  >
                    <option value="">일괄 지정…</option>
                    <option value="__none__">지정 없음</option>
                    {terminals.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>

                {/* 핀별 개별 지정 */}
                <div className="pin-term-list">
                  {conn.pins.map((pin) => (
                    <label key={pin.id} className="pin-term-row">
                      <span className="pin-term-num">{pin.label ?? pin.index}</span>
                      <select
                        value={pin.terminalId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value || undefined;
                          updateConnector(conn.id, {
                            pins: conn.pins.map((p) =>
                              p.id === pin.id ? { ...p, terminalId: v } : p,
                            ),
                          });
                          if (v) {
                            const t = terminals.find((x) => x.id === v);
                            if (t) addUsedPart(t);
                          }
                        }}
                      >
                        <option value="">—</option>
                        {terminals.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.mpn ?? t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="muted">
                  지정한 터미널은 파트리스트에 배선된 핀 수만큼 집계됩니다.
                </p>
              </div>
            </>
          )}
          {conn.kind === 'splice' && (
            <p className="muted">스플라이스는 압착단자가 필요 없습니다 (핀 {conn.pins.length}개)</p>
          )}
        </>
      )}

      {dev && (
        <>
          <div className="prop-kind">장치</div>
          <Row label="이름">
            <input value={dev.name} onChange={(e) => updateDevice(dev.id, { name: e.target.value })} />
          </Row>
          <Row label="단자(쉼표)">
            <input value={(dev.terminals ?? []).join(', ')}
              onChange={(e) => updateDevice(dev.id, {
                terminals: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
              })} />
          </Row>
        </>
      )}

      <button className="danger" onClick={() => remove(selection)}>삭제</button>
    </aside>
  );
}
