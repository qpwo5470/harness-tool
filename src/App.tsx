/**
 * 앱 셸 (리드 · 통합).
 * 라이브러리 / 캔버스 / 우측 탭(속성·접속표·파트리스트) + 문서 액션.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHarnessStore } from './store/harnessStore';
import { emptyDoc, clearSaved } from './store/persistence';
import { HarnessCanvas } from './canvas/HarnessCanvas';
import { strokeColor } from './canvas/docToFlow';
import { LibraryPanel } from './library/LibraryPanel';
import { PropertyPanel } from './panels/PropertyPanel';
import { buildPartList, toCsv, buildRunList, runListToCsv } from './export/exporters';
import './App.css';

type Tab = 'prop' | 'runs' | 'parts';

function saveBlob(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 전선 색 스와치. 2톤(base/stripe)은 45° 줄무늬로 그린다.
 * 캔버스 배선과 같은 보정(strokeColor)을 써서 표와 도면의 색이 어긋나지 않게 한다.
 */
function Swatch({ base, stripe }: { base: string; stripe?: string }) {
  const b = strokeColor(base);
  const style = stripe
    ? { background: `repeating-linear-gradient(45deg, ${b} 0 2px, ${strokeColor(stripe)} 2px 5px)` }
    : { background: b };
  return <i className="swatch" style={style} aria-hidden />;
}

export default function App() {
  const view = useHarnessStore((s) => s.activeView);
  const setView = useHarnessStore((s) => s.setView);
  const doc = useHarnessStore((s) => s.doc);
  const selection = useHarnessStore((s) => s.selection);
  const select = useHarnessStore((s) => s.select);
  const remove = useHarnessStore((s) => s.remove);
  const undo = useHarnessStore((s) => s.undo);
  const redo = useHarnessStore((s) => s.redo);
  const rename = useHarnessStore((s) => s.rename);
  const replaceDoc = useHarnessStore((s) => s.replaceDoc);
  const exportJson = useHarnessStore((s) => s.exportJson);
  const importJson = useHarnessStore((s) => s.importJson);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('prop');
  const [menuOpen, setMenuOpen] = useState(false);
  const [runQ, setRunQ] = useState('');

  // Delete/Backspace 로 선택 요소 삭제 (입력 중에는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        remove(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, remove, undo, redo]);

  // 내보내기 메뉴: 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(importJson);
    e.target.value = '';
  }
  function newDoc() {
    if (!confirm('새 문서를 만들면 현재 작업이 사라집니다. 계속할까요?')) return;
    clearSaved();
    replaceDoc(emptyDoc());
  }
  async function exportPdf() {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    const { downloadPdf } = await import('./export/pdf'); // 코드 스플릿
    await downloadPdf(doc, el);
  }
  const runMenu = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  const parts = buildPartList(doc);
  const runs = buildRunList(doc);

  // 와이어 원본을 wireId 로 찾아 색 스와치에 쓴다(RunRow.color 는 표시용 문자열).
  const wireById = useMemo(
    () => new Map(doc.wires.map((w) => [w.id, w])),
    [doc.wires],
  );

  const netCount = useMemo(
    () => new Set(runs.map((r) => r.netCode).filter(Boolean)).size,
    [runs],
  );

  const visibleRuns = useMemo(() => {
    const t = runQ.trim().toLowerCase();
    if (!t) return runs;
    return runs.filter((r) =>
      [r.netCode, r.net, r.from, r.to, r.color, r.gauge].some((v) => v.toLowerCase().includes(t)),
    );
  }, [runQ, runs]);

  return (
    <div className="app">
      <header className="topbar">
        <strong>하네스 설계 툴</strong>
        <input className="doc-name-input" value={doc.name} onChange={(e) => rename(e.target.value)} />
        <div className="view-toggle">
          <button className={view === 'logical' ? 'on' : ''} onClick={() => setView('logical')}>논리 뷰</button>
          <button className={view === 'physical' ? 'on' : ''} onClick={() => setView('physical')}>물리 뷰</button>
        </div>
        <div className="undo-group">
          <button onClick={undo} title="실행취소 (Ctrl+Z)">↶</button>
          <button onClick={redo} title="다시실행 (Ctrl+Shift+Z)">↷</button>
        </div>
        <div className="spacer" />
        <button onClick={newDoc}>새 문서</button>
        <div className="menu-wrap" ref={menuRef}>
          <button aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            내보내기 ▾
          </button>
          {menuOpen && (
            <div className="menu-pop" role="menu">
              <button onClick={runMenu(() => saveBlob(`${doc.name || 'harness'}.json`, exportJson(), 'application/json'))}>
                JSON 저장
              </button>
              <button onClick={runMenu(() => fileRef.current?.click())}>JSON 불러오기</button>
              <hr />
              <button onClick={runMenu(() => saveBlob(`${doc.name}-접속표.csv`, runListToCsv(runs), 'text/csv;charset=utf-8;'))}>
                접속표 CSV
              </button>
              <button onClick={runMenu(() => saveBlob(`${doc.name}-파트리스트.csv`, toCsv(parts), 'text/csv;charset=utf-8;'))}>
                파트리스트 CSV
              </button>
            </div>
          )}
        </div>
        <button className="primary" onClick={exportPdf}>PDF 도면</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
      </header>

      <div className="body">
        <LibraryPanel />
        <main className="canvas-area">
          <HarnessCanvas />
        </main>
        <div className="right">
          <div className="tabs">
            <button className={tab === 'prop' ? 'on' : ''} onClick={() => setTab('prop')}>속성</button>
            <button className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}>접속표 {runs.length}</button>
            <button className={tab === 'parts' ? 'on' : ''} onClick={() => setTab('parts')}>파트 {parts.length}</button>
          </div>

          {tab === 'prop' && <div className="tab-body"><PropertyPanel /></div>}

          {tab === 'runs' && (
            <>
              <div className="side-filter">
                <input
                  placeholder="네트 · 커넥터 검색"
                  value={runQ}
                  onChange={(e) => setRunQ(e.target.value)}
                />
                <button
                  disabled={!runs.length}
                  onClick={() => saveBlob(`${doc.name}-접속표.csv`, runListToCsv(runs), 'text/csv;charset=utf-8;')}
                >
                  CSV
                </button>
              </div>
              <div className="tab-body">
                <table className="runs-table">
                  <thead>
                    <tr>
                      <th className="c-net">NET</th>
                      <th>FROM → TO</th>
                      <th className="c-wire">전선</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRuns.map((r) => {
                      const w = wireById.get(r.wireId);
                      return (
                        <tr
                          key={r.wireId}
                          className={r.wireId === selection ? 'sel' : ''}
                          onClick={() => select(r.wireId)}
                          title="클릭하면 캔버스에서 해당 배선이 강조됩니다"
                        >
                          <td className="net" title={r.net}>{r.netCode}</td>
                          <td>
                            <span className="runs-ep">{r.from}</span>
                            <span className="runs-ep to">→ {r.to}</span>
                          </td>
                          <td>
                            <span className="runs-wire">
                              {w && <Swatch base={w.color.base} stripe={w.color.stripe} />}
                              {r.color}
                            </span>
                            <span className="runs-spec">
                              {r.gauge}{r.lengthMm ? ` · ${r.lengthMm}mm` : ''}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {runs.length === 0 && <p className="muted" style={{ padding: 8 }}>아직 배선이 없습니다</p>}
                {runs.length > 0 && visibleRuns.length === 0 && (
                  <p className="muted" style={{ padding: 8 }}>검색 결과가 없습니다</p>
                )}
              </div>
              <div className="side-status">
                <span>{runs.length}본 · {netCount}네트</span>
                <div className="spacer" />
                <span className="hint">행을 클릭하면 캔버스에서 강조</span>
              </div>
            </>
          )}

          {tab === 'parts' && (
            <>
              <div className="side-filter">
                <span className="muted" style={{ flex: 1, alignSelf: 'center' }}>부품 {parts.length}종</span>
                <button
                  disabled={!parts.length}
                  onClick={() => saveBlob(`${doc.name}-파트리스트.csv`, toCsv(parts), 'text/csv;charset=utf-8;')}
                >
                  CSV
                </button>
              </div>
              <div className="tab-body">
                <table className="parts">
                  <thead>
                    <tr><th>분류</th><th>품목</th><th>수량</th></tr>
                  </thead>
                  <tbody>
                    {parts.map((p, i) => (
                      <tr key={i}>
                        <td className="cat">{p.category}</td>
                        <td>{p.part}{p.detail ? <span className="muted"> · {p.detail}</span> : null}</td>
                        <td className="qty">{p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parts.length === 0 && <p className="muted" style={{ padding: 8 }}>부품이 없습니다</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
