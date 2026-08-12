/**
 * Agent B 소유 — 부품 라이브러리 패널.
 * 시드 부품 + 사용자 정의 부품(핀맵 에디터로 생성) 목록, 검색, 캔버스 추가.
 */
import { useMemo, useRef, useState } from 'react';
import { useHarnessStore } from '../store/harnessStore';
import { SEED_PARTS, instantiate } from './seed';
import {
  loadCustomParts, upsertCustomPart, deleteCustomPart,
  isCustomPart, exportCustomParts, parsePartsFile, saveCustomParts,
} from './customParts';
import { PinMapEditor } from './PinMapEditor';
import type { PartLibraryItem, Device } from '../types';

/**
 * id 접두사로 실무 그룹핑.
 * openByDefault: 자주 쓰는 그룹만 펼쳐두고 나머지는 접는다.
 */
const GROUPS: { label: string; openByDefault?: boolean; match: (p: PartLibraryItem) => boolean }[] = [
  { label: 'MDB (자판기)', openByDefault: true, match: (p) => p.id.startsWith('lib-mdb') || p.id === 'lib-minifit-terminal' },
  { label: '연호 SMH250 (2.5mm)', openByDefault: true, match: (p) => p.id.startsWith('lib-yh-smh250') },
  { label: '연호 SMH200 (2.0mm)', match: (p) => p.id.startsWith('lib-yh-smh200') },
  { label: '연호 YH396 (3.96mm)', match: (p) => p.id.startsWith('lib-yh-yh396') },
  { label: '연호 웨이퍼 (보드실장)', match: (p) => /^lib-yh-sma?w(250|200)/.test(p.id) },
  { label: '연호 터미널', match: (p) => /^lib-yh-(yst|yt)/.test(p.id) },
  { label: 'LAN', openByDefault: true, match: (p) => p.id.startsWith('lib-rj45') },
  { label: 'USB', match: (p) => p.id.startsWith('lib-usb') },
  { label: '범용 하우징', match: (p) => /^lib-(xh|ph|minifit-4p|molex)/.test(p.id) },
  { label: '와이어투와이어', match: (p) => p.id.startsWith('lib-w2w') },
  { label: '보드투와이어', match: (p) => p.id.startsWith('lib-b2w') || p.id.startsWith('lib-terminal-block') },
  { label: '스플라이스', openByDefault: true, match: (p) => p.id.startsWith('lib-splice') },
];

/**
 * 라이브러리 → 캔버스 드래그 페이로드 (HTML5 DnD, 외부 라이브러리 없음).
 *
 * 커스텀 MIME 을 쓰는 이유: 브라우저는 dragover 단계에서 dataTransfer 의 "값"을
 * 감춘다(보호 모드). types 만 읽을 수 있으므로, 우리 드래그인지 아닌지는
 * 타입 이름으로 판별해야 한다. 값(부품 id)은 drop 에서 꺼낸다.
 */
export const PART_DND_MIME = 'application/x-harness-part';
/** 장치 블록은 라이브러리 항목이 아니라 이 sentinel 로 싣는다 */
export const DEVICE_DND_ID = '__device__';

/** dragstart 공통 — 커스텀 MIME + text/plain(폴백) 둘 다 싣는다 */
export function startPartDrag(e: React.DragEvent, payload: string) {
  e.dataTransfer.setData(PART_DND_MIME, payload);
  // text/plain 이 비어 있으면 드래그 자체를 시작하지 않는 브라우저가 있다
  e.dataTransfer.setData('text/plain', payload);
  e.dataTransfer.effectAllowed = 'copy';
}

let devSeq = 0;

export function LibraryPanel() {
  const addConnector = useHarnessStore((s) => s.addConnector);
  const addUsedPart = useHarnessStore((s) => s.addUsedPart);
  const addDevice = useHarnessStore((s) => s.addDevice);
  const select = useHarnessStore((s) => s.select);

  const [q, setQ] = useState('');
  const [custom, setCustom] = useState<PartLibraryItem[]>(() => loadCustomParts());
  const [editing, setEditing] = useState<PartLibraryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  /**
   * 접힌 그룹. 80종이 한 줄씩 나열되면 스크롤이 너무 길어져
   * 자주 쓰지 않는 그룹은 기본으로 접어둔다.
   * 검색 중에는 접힘을 무시하고 전부 펼친다(결과가 숨으면 안 되므로).
   */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map((g) => [g.label, !g.openByDefault])),
  );
  /** 가져오기 결과 안내 — alert 대신 패널 안에 남겨 건너뛴 행을 읽을 수 있게 */
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (label: string) =>
    setCollapsed((c) => ({ ...c, [label]: !c[label] }));

  const allParts = useMemo(() => [...custom, ...SEED_PARTS], [custom]);
  const searching = q.trim().length > 0;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return allParts;
    return allParts.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        (p.mpn ?? '').toLowerCase().includes(t) ||
        (p.manufacturer ?? '').toLowerCase().includes(t) ||
        (p.pinLayout ?? []).some((s) => (s.signal ?? '').toLowerCase().includes(t)),
    );
  }, [q, allParts]);

  const addPart = (item: PartLibraryItem) => {
    if (item.category === 'terminal') return; // 단자는 캔버스에 놓지 않음
    addUsedPart(item);
    const at = { x: 120 + Math.random() * 200, y: 120 + Math.random() * 160 };
    const conn = instantiate(item, at);
    addConnector(conn);
    select(conn.id);
  };

  const addDeviceBlock = () => {
    const d: Device = {
      id: `dev-${Date.now().toString(36)}-${devSeq++}`,
      name: '새 장치',
      positions: { logical: { x: 160, y: 340 }, physical: { x: 160, y: 340 } },
    };
    addDevice(d);
    select(d.id);
  };

  const handleSave = (part: PartLibraryItem) => {
    setCustom(upsertCustomPart(part));
    addUsedPart(part); // 현재 문서에도 스냅샷으로 반영
    setEditing(null);
    setCreating(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('이 부품을 라이브러리에서 삭제할까요? (이미 배치된 커넥터는 그대로 남습니다)')) return;
    setCustom(deleteCustomPart(id));
  };

  /** 시드 부품을 복제해 커스텀으로 편집 시작 */
  const duplicate = (p: PartLibraryItem) => {
    setEditing({ ...p, id: '', name: `${p.name} 복사본` } as PartLibraryItem);
    setCreating(true);
  };

  const doExport = () => {
    const url = URL.createObjectURL(
      new Blob([exportCustomParts(custom)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = '내부품.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 부품 일괄 등록 — JSON(내보내기 왕복) + CSV(엑셀 부품표) 둘 다 받는다.
   * 실무 부품표는 엑셀로 오므로 CSV 가 실제 통로다.
   *
   * 한 행이 잘못돼도 전체를 버리지 않는다. 파서가 그 행만 건너뛰고
   * 사유를 남기므로, 몇 건이 들어왔고 무엇이 걸렸는지 함께 알린다.
   */
  const doImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      const { parts: incoming, warnings } = parsePartsFile(txt, f.name);
      if (!incoming.length) {
        setImportNote({
          ok: false,
          text: warnings.length
            ? `등록된 부품이 없습니다.\n${warnings.slice(0, 5).join('\n')}`
            : '부품 파일 형식이 아닙니다. (JSON 또는 CSV)',
        });
        return;
      }
      const merged = [...custom];
      for (const p of incoming) {
        const i = merged.findIndex((m) => m.id === p.id);
        if (i >= 0) merged[i] = p;
        else merged.push(p);
      }
      saveCustomParts(merged);
      setCustom(merged);
      setImportNote({
        ok: true,
        text: warnings.length
          ? `부품 ${incoming.length}종을 등록했습니다. 건너뛴 행 ${warnings.length}건:\n${warnings.slice(0, 5).join('\n')}`
          : `부품 ${incoming.length}종을 등록했습니다.`,
      });
    });
    e.target.value = '';
  };

  const renderItem = (p: PartLibraryItem) => {
    // 단자는 캔버스에 놓지 않는다 — 클릭과 마찬가지로 드래그도 막는다.
    const droppable = p.category !== 'terminal';
    return (
      <div
        key={p.id}
        className="lib-row"
        draggable={droppable}
        onDragStart={droppable ? (e) => startPartDrag(e, p.id) : undefined}
      >
        <button
          className="lib-item"
          onClick={() => addPart(p)}
          title={[p.mpn && `MPN ${p.mpn}`, ...Object.entries(p.spec ?? {}).map(([k, v]) => `${k}: ${v}`)]
            .filter(Boolean)
            .join('\n')}
          disabled={p.category === 'terminal'}
        >
          {p.name}
          {p.pinCount ? <span className="pin-badge">{p.pinCount}P</span> : null}
        </button>
        <div className="lib-row-actions">
          {isCustomPart(p.id) ? (
            <>
              <button title="편집" onClick={() => setEditing(p)}>✎</button>
              <button title="삭제" onClick={() => handleDelete(p.id)}>✕</button>
            </>
          ) : (
            <button title="복제해서 편집" onClick={() => duplicate(p)}>⧉</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="panel lib">
      <div className="lib-head">
        <h3>라이브러리</h3>
        <button className="lib-new" onClick={() => { setEditing(null); setCreating(true); }}>
          + 새 부품 만들기
        </button>
      </div>
      <div className="lib-io">
        <button onClick={doExport} disabled={!custom.length}>내보내기</button>
        <button onClick={() => importRef.current?.click()} title="JSON 또는 CSV 부품표">
          가져오기
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json,text/csv,.csv,.txt"
          hidden
          onChange={doImport}
        />
      </div>

      {importNote && (
        <div className={`lib-note${importNote.ok ? '' : ' warn'}`} role="status">
          <span>{importNote.text}</span>
          <button onClick={() => setImportNote(null)} title="닫기">✕</button>
        </div>
      )}

      <input
        className="lib-search"
        placeholder="이름·MPN·신호 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {/* 내 부품 — 항상 맨 위, 접지 않는다 */}
      {(() => {
        const mine = filtered.filter((p) => isCustomPart(p.id));
        if (!mine.length) return null;
        return (
          <div className="lib-cat">
            <div className="lib-cat-title" aria-hidden>
              <span className="caret" />
              <span className="name">내 부품</span>
              <span className="count">{mine.length}</span>
            </div>
            {mine.map(renderItem)}
          </div>
        );
      })()}

      {GROUPS.map((g) => {
        const items = filtered.filter((p) => !isCustomPart(p.id) && g.match(p));
        if (!items.length) return null;
        // 검색 중에는 접힘을 무시한다 — 결과가 숨으면 검색이 무의미하다.
        const open = searching || !collapsed[g.label];
        return (
          <div key={g.label} className="lib-cat">
            <button
              className="lib-cat-title"
              onClick={() => toggle(g.label)}
              aria-expanded={open}
              title={open ? '접기' : '펼치기'}
            >
              <span className="caret">{open ? '▾' : '▸'}</span>
              <span className="name">{g.label}</span>
              <span className="count">{items.length}</span>
            </button>
            {open && items.map(renderItem)}
          </div>
        );
      })}

      <div className="lib-cat">
        <div className="lib-cat-title" aria-hidden>
          <span className="caret" />
          <span className="name">장치</span>
        </div>
        <button
          className="lib-item"
          draggable
          onDragStart={(e) => startPartDrag(e, DEVICE_DND_ID)}
          onClick={addDeviceBlock}
        >
          + 장치 블록
        </button>
      </div>

      {(creating || editing) && (
        <PinMapEditor
          initial={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </aside>
  );
}
