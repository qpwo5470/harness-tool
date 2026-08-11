/**
 * Agent B 소유 — 하우징 핀맵 에디터.
 *
 * 하우징 하나를 정의한다: 이름/제조사/MPN/스펙 + 핀 배열(행×열) + 핀별 신호명·규격색.
 * 핀 배열은 그리드 위에서 직접 배치하고, 핀을 클릭하면 그 핀의 신호/색을 편집한다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PartLibraryItem, PinSlot, PartCategory } from '../types';
import { newCustomPartId } from './customParts';

const CELL = 34; // 그리드 한 칸 px

type Props = {
  /** 편집할 부품 (없으면 새로 만들기) */
  initial?: PartLibraryItem;
  onSave: (part: PartLibraryItem) => void;
  onCancel: () => void;
};

const CATEGORIES: { value: PartCategory; label: string }[] = [
  { value: 'housing', label: '커넥터 하우징' },
  { value: 'board-to-wire', label: '보드투와이어' },
  { value: 'splice', label: '스플라이스' },
  { value: 'terminal', label: '터미널(핀만)' },
];

/** 행×열 그리드에 순번대로 핀 채우기 */
function fillGrid(cols: number, rows: number, prev: PinSlot[]): PinSlot[] {
  const out: PinSlot[] = [];
  let index = 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // 기존 핀의 신호/색은 index 기준으로 최대한 보존
      const old = prev.find((p) => p.index === index);
      out.push({
        index,
        label: old?.label ?? String(index),
        offset: { x, y },
        signal: old?.signal,
        stdColor: old?.stdColor,
      });
      index++;
    }
  }
  return out;
}

export function PinMapEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '');
  const [mpn, setMpn] = useState(initial?.mpn ?? '');
  const [category, setCategory] = useState<PartCategory>(initial?.category ?? 'housing');
  const [pitch, setPitch] = useState(initial?.spec?.['피치'] ?? '');
  const [note, setNote] = useState(initial?.spec?.['비고'] ?? '');
  const [applyTo, setApplyTo] = useState(initial?.spec?.['적용'] ?? '');

  const isTerminal = category === 'terminal';

  // 초기 그리드 크기: 기존 핀 배치에서 역산
  const initCols = initial?.pinLayout?.length
    ? Math.max(...initial.pinLayout.map((s) => s.offset.x)) + 1
    : 4;
  const initRows = initial?.pinLayout?.length
    ? Math.max(...initial.pinLayout.map((s) => s.offset.y)) + 1
    : 1;

  const [cols, setCols] = useState(initCols);
  const [rows, setRows] = useState(initRows);
  const [pins, setPins] = useState<PinSlot[]>(
    initial?.pinLayout ?? fillGrid(4, 1, []),
  );
  const [selected, setSelected] = useState<number | null>(null);

  // 행/열이 바뀌면 그리드 재생성 (신호/색은 보존)
  useEffect(() => {
    setPins((prev) => fillGrid(cols, rows, prev));
    setSelected(null);
  }, [cols, rows]);

  const selectedPin = useMemo(
    () => pins.find((p) => p.index === selected) ?? null,
    [pins, selected],
  );

  const patchPin = (index: number, patch: Partial<PinSlot>) =>
    setPins((prev) => prev.map((p) => (p.index === index ? { ...p, ...patch } : p)));

  /** 핀 번호 매기기 방향 바꾸기 (좌→우 / 지그재그 / 열 우선) */
  const renumber = (mode: 'row' | 'snake' | 'col') => {
    setPins((prev) => {
      const sorted = [...prev];
      const order: PinSlot[] = [];
      if (mode === 'col') {
        for (let x = 0; x < cols; x++)
          for (let y = 0; y < rows; y++) {
            const p = sorted.find((s) => s.offset.x === x && s.offset.y === y);
            if (p) order.push(p);
          }
      } else {
        for (let y = 0; y < rows; y++) {
          const line = sorted
            .filter((s) => s.offset.y === y)
            .sort((a, b) => a.offset.x - b.offset.x);
          order.push(...(mode === 'snake' && y % 2 === 1 ? line.reverse() : line));
        }
      }
      // 신호/색은 물리 위치를 따라가고, 번호만 새로 부여
      return order.map((p, i) => ({ ...p, index: i + 1, label: String(i + 1) }));
    });
    setSelected(null);
  };

  const canSave = name.trim().length > 0 && (isTerminal || pins.length > 0);

  const save = () => {
    const spec: Record<string, string> = {};
    if (pitch.trim()) spec['피치'] = pitch.trim();
    if (note.trim()) spec['비고'] = note.trim();

    const part: PartLibraryItem = {
      // 복제(빈 id)나 신규는 새 커스텀 id 발급, 기존 커스텀 편집은 id 유지
      id: initial?.id || newCustomPartId(),
      category,
      name: name.trim(),
      manufacturer: manufacturer.trim() || undefined,
      mpn: mpn.trim() || undefined,
      spec: Object.keys(spec).length ? spec : undefined,
      pinCount: pins.length,
      pinLayout: [...pins].sort((a, b) => a.index - b.index),
    };
    onSave(part);
  };

  return (
    <div className="pme-backdrop" onClick={onCancel}>
      <div className="pme" onClick={(e) => e.stopPropagation()}>
        <header className="pme-head">
          <strong>{initial ? '부품 편집' : '새 부품 만들기'}</strong>
          <div className="spacer" />
          <button onClick={onCancel}>취소</button>
          <button className="primary" disabled={!canSave} onClick={save}>
            저장
          </button>
        </header>

        <div className="pme-body">
          {/* 좌: 부품 정보 */}
          <div className="pme-meta">
            <label className="prop-row">
              <span>이름*</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: SMH250-06" />
            </label>
            <label className="prop-row">
              <span>분류</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as PartCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="prop-row">
              <span>제조사</span>
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="YEONHO" />
            </label>
            <label className="prop-row">
              <span>MPN</span>
              <input value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="발주 코드" />
            </label>
            <label className="prop-row">
              <span>피치</span>
              <input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="2.5mm" />
            </label>
            {isTerminal && (
              <label className="prop-row">
                <span>적용 하우징</span>
                <input value={applyTo} onChange={(e) => setApplyTo(e.target.value)}
                  placeholder="SMH250 (2.5mm)" />
              </label>
            )}
            <label className="prop-row">
              <span>비고</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            <div className="pme-sep" />

            {isTerminal ? (
              <p className="muted">
                터미널(크림프핀)은 핀 배열이 없는 낱개 부품입니다.<br />
                커넥터 속성에서 핀별로 지정해 사용하세요.
              </p>
            ) : (
              <>
            <label className="prop-row">
              <span>열(가로)</span>
              <input type="number" min={1} max={24} value={cols}
                onChange={(e) => setCols(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} />
            </label>
            <label className="prop-row">
              <span>행(세로)</span>
              <input type="number" min={1} max={8} value={rows}
                onChange={(e) => setRows(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
            </label>
            <p className="muted">총 {pins.length}핀</p>

            <div className="pme-sep" />
            <div className="lib-cat-title">핀 번호 방향</div>
            <div className="pme-renumber">
              <button onClick={() => renumber('row')} title="각 행 좌→우">행 우선</button>
              <button onClick={() => renumber('snake')} title="지그재그">지그재그</button>
              <button onClick={() => renumber('col')} title="열 우선">열 우선</button>
            </div>
              </>
            )}
          </div>

          {/* 중: 핀 그리드 (터미널은 핀 배열 없음) */}
          <div className="pme-grid-wrap">
            {isTerminal ? (
              <p className="muted" style={{ marginTop: 20 }}>
                터미널은 핀 배치를 정의하지 않습니다.<br />
                이름·MPN·적용 하우징만 입력하면 됩니다.
              </p>
            ) : (
            <>
            <div className="lib-cat-title">핀 배치 — 클릭해서 신호·색 지정</div>
            <div
              className="pme-grid"
              style={{ width: cols * CELL, height: rows * CELL }}
            >
              {pins.map((p) => (
                <button
                  key={p.index}
                  className={`pme-pin ${selected === p.index ? 'on' : ''}`}
                  style={{
                    left: p.offset.x * CELL,
                    top: p.offset.y * CELL,
                    background: p.stdColor ? colorSwatch(p.stdColor) : undefined,
                  }}
                  onClick={() => setSelected(p.index)}
                  title={p.signal ?? ''}
                >
                  <span className="pme-pin-num">{p.label ?? p.index}</span>
                  {p.signal && <span className="pme-pin-sig">{p.signal}</span>}
                </button>
              ))}
            </div>
            </>
            )}
          </div>

          {/* 우: 선택 핀 편집 */}
          <div className="pme-pin-edit">
            <div className="lib-cat-title">핀 속성</div>
            {selectedPin ? (
              <>
                <div className="prop-kind">핀 {selectedPin.index}</div>
                <label className="prop-row">
                  <span>표기</span>
                  <input value={selectedPin.label ?? ''}
                    onChange={(e) => patchPin(selectedPin.index, { label: e.target.value })}
                    placeholder="1, A1 등" />
                </label>
                <label className="prop-row">
                  <span>신호명</span>
                  <input value={selectedPin.signal ?? ''}
                    onChange={(e) => patchPin(selectedPin.index, { signal: e.target.value || undefined })}
                    placeholder="+24V, GND, TX 등" />
                </label>
                <label className="prop-row">
                  <span>규격 색</span>
                  <input value={selectedPin.stdColor ?? ''}
                    onChange={(e) => patchPin(selectedPin.index, { stdColor: e.target.value || undefined })}
                    placeholder="red, white/orange" />
                </label>
                <p className="muted">
                  규격 색을 넣으면 이 핀에서 결선할 때 와이어 색이 자동으로 적용됩니다.
                </p>
              </>
            ) : (
              <p className="muted">핀을 클릭하세요</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "white/orange" 같은 값을 대략적인 배경색으로 (미리보기용) */
function colorSwatch(c: string): string {
  const base = c.split('/')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    red: '#fecaca', black: '#d1d5db', white: '#f9fafb', green: '#bbf7d0',
    blue: '#bfdbfe', yellow: '#fef08a', orange: '#fed7aa', brown: '#d6c0b0',
    purple: '#e9d5ff', gray: '#e5e7eb', grey: '#e5e7eb', pink: '#fbcfe8',
  };
  return map[base] ?? '#f3f4f6';
}
