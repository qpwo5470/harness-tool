/**
 * 앱 셸 (리드 · 통합).
 * 라이브러리 / 캔버스 / 우측 탭(속성·접속표·파트리스트) + 문서 액션.
 */
import { useEffect, useRef, useState } from 'react';
import { useHarnessStore } from './store/harnessStore';
import { emptyDoc, clearSaved } from './store/persistence';
import { HarnessCanvas } from './canvas/HarnessCanvas';
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
  const [tab, setTab] = useState<Tab>('prop');

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

  const parts = buildPartList(doc);
  const runs = buildRunList(doc);

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
        <button onClick={() => saveBlob(`${doc.name || 'harness'}.json`, exportJson(), 'application/json')}>JSON</button>
        <button onClick={() => fileRef.current?.click()}>불러오기</button>
        <button onClick={() => saveBlob(`${doc.name}-접속표.csv`, runListToCsv(runs), 'text/csv;charset=utf-8;')}>접속표 CSV</button>
        <button onClick={() => saveBlob(`${doc.name}-파트리스트.csv`, toCsv(parts), 'text/csv;charset=utf-8;')}>파트 CSV</button>
        <button className="primary" onClick={exportPdf}>PDF</button>
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

          {tab === 'prop' && <PropertyPanel />}

          {tab === 'runs' && (
            <aside className="panel">
              <table className="parts runs">
                <thead>
                  <tr><th>NET</th><th>FROM → TO</th><th>색/게이지</th></tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.wireId}
                      className={r.wireId === selection ? 'sel' : ''}
                      onClick={() => select(r.wireId)}
                      style={{ cursor: 'pointer' }}
                      title="클릭하면 캔버스에서 해당 배선이 강조됩니다"
                    >
                      <td className="cat">{r.net}</td>
                      <td>{r.from}<br /><span className="muted">→ {r.to}</span></td>
                      <td className="qty">{r.color}<br /><span className="muted">{r.gauge}{r.lengthMm ? ` · ${r.lengthMm}mm` : ''}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {runs.length === 0 && <p className="muted">아직 배선이 없습니다</p>}
            </aside>
          )}

          {tab === 'parts' && (
            <aside className="panel">
              <table className="parts">
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
              {parts.length === 0 && <p className="muted">부품이 없습니다</p>}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
