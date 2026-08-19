/**
 * 앱 셸 (리드 · 통합).
 * 라이브러리 / 캔버스 / 우측 탭(속성·접속표·파트리스트) + 문서 액션.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHarnessStore } from './store/harnessStore';
import { useHoverStore } from './store/hoverStore';
import {
  emptyDoc, clearSaved, parseDocument, setStorageProblemHandler,
  readSuperseded, clearSuperseded,
} from './store/persistence';
import { mergeDocumentParts } from './library/customParts';
import { HarnessCanvas } from './canvas/HarnessCanvas';
import { strokeColor } from './canvas/docToFlow';
import { LibraryPanel } from './library/LibraryPanel';
import { PropertyPanel } from './panels/PropertyPanel';
import { PartsPanel, type PartsScope } from './panels/PartsPanel';
import { SetOverview } from './set/SetOverview';
import { PhysicalView } from './physical/PhysicalView';
import { ExportDialog, type ExportPlan } from './export/ExportDialog';
import { ToastHost, showToast } from './ui/Toast';
import { EmptyCanvas } from './ui/EmptyCanvas';
import { ValidationPanel } from './panels/ValidationPanel';
import { validateHarness } from './store/validate';
import { letterAt, orderText } from './store/kit';
import { buildPartList, toCsv, buildRunList, runListToCsv } from './export/exporters';
import { buildExportEntries, packForDownload } from './export/bundle';
import { zipFileName } from './export/exportPlan';
import './App.css';

type Tab = 'prop' | 'runs' | 'parts' | 'check';
/** 상단 하네스 탭: 세트 개요 또는 하네스 id */
type HarnessTab = 'set' | string;

/**
 * 파일 하나를 내려받는다.
 *
 * 두 가지를 예전 코드와 다르게 한다.
 *  - 앵커를 문서에 붙였다 뗀다: Firefox 는 문서에 없는 <a> 의 click() 을 무시한다.
 *  - URL 회수를 다음 틱으로 미룬다: 수 MB 짜리 ZIP 은 click() 이 돌아온 뒤에도
 *    브라우저가 읽고 있어, 곧바로 revoke 하면 빈 파일이 떨어지거나 취소된다.
 */
function saveBytes(name: string, data: string | Uint8Array<ArrayBuffer>, mime: string): boolean {
  // 내려받기가 실제로 일어났는지 부르는 쪽이 알아야 할 때가 있다 —
  // 되찾기(밀려난 저장본)는 내려받은 뒤에야 원본을 지울 수 있다.
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function saveBlob(name: string, text: string, mime: string): boolean {
  return saveBytes(name, text, mime);
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
  const setDocMeta = useHarnessStore((s) => s.setDocMeta);
  const replaceDoc = useHarnessStore((s) => s.replaceDoc);
  const exportJson = useHarnessStore((s) => s.exportJson);
  const replaceKit = useHarnessStore((s) => s.replaceKit);
  const kit = useHarnessStore((s) => s.kit);
  const activeHarnessId = useHarnessStore((s) => s.activeHarnessId);
  const setActiveHarness = useHarnessStore((s) => s.setActiveHarness);
  const updateSet = useHarnessStore((s) => s.updateSet);
  const setPerSet = useHarnessStore((s) => s.setPerSet);
  const addHarness = useHarnessStore((s) => s.addHarness);
  const removeHarness = useHarnessStore((s) => s.removeHarness);
  // 선택 액션이라 계약상 없을 수 있다 — 없으면 물리 뷰 길이 칸은 읽기 전용이 된다
  const setSegmentLength = useHarnessStore((s) => s.setSegmentLength);

  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * 같은 파일 입력을 두 곳이 쓴다.
   * 세트 개요의 'JSON 가져오기' 는 "이 세트에 하네스 추가" 밑에 있는데도
   * 세트를 통째로 갈아치웠다 — 하네스 두 종을 만들어 둔 사용자가 세 번째를
   * 가져오면 앞의 둘이 사라졌다. 어느 버튼이 열었는지 기억해 두고 갈라 처리한다.
   */
  const importMode = useRef<'replace' | 'append'>('replace');
  const pickFile = (mode: 'replace' | 'append') => {
    importMode.current = mode;
    fileRef.current?.click();
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('prop');
  const [menuOpen, setMenuOpen] = useState(false);
  const [runQ, setRunQ] = useState('');
  const [hTab, setHTab] = useState<HarnessTab>(activeHarnessId);
  const [partsScope, setPartsScope] = useState<PartsScope>({ kind: 'harness', harnessId: activeHarnessId });
  const [exportOpen, setExportOpen] = useState(false);
  /** 내보내는 중이면 진행 상황 — 대화상자를 잠그고 몇/몇을 보여 준다 */
  const [exportBusy, setExportBusy] = useState<{ done: number; total: number } | null>(null);
  /**
   * 라이브러리 패널은 커스텀 부품을 마운트 때 한 번만 읽는다.
   * 불러오기가 문서에 딸려 온 부품을 저장소에 넣어도 패널은 모르므로,
   * 새로 들어온 게 있을 때만 키를 바꿔 다시 읽게 한다.
   */
  const [libRev, setLibRev] = useState(0);
  // 캔버스 ↔ 접속표 동기 강조
  const hoverWire = useHoverStore((s) => s.wireId);
  const setHover = useHoverStore((s) => s.setHover);

  /**
   * 실행취소·다시실행 실행부.
   *
   * ⌘Z 는 보고 있는 화면과 무관하게 활성 하네스를 되돌린다. 세트 개요를 보고
   * 있으면 캔버스가 화면에 없으므로 **무엇이 사라졌는지 아무 데도 나타나지
   * 않는다** — 도면이 조용히 바뀐 채로 발주로 넘어갈 수 있다.
   * 화면을 갈아끼우지는 않는다(사용자가 보던 자리를 빼앗는 셈이라). 대신
   * 도면이 바뀌었으면 어느 하네스가 바뀌었는지 토스트로 밝힌다.
   */
  const runUndo = (fn: () => void, isRedo: boolean) => {
    const before = useHarnessStore.getState().doc;
    fn();
    const after = useHarnessStore.getState().doc;
    if (hTab !== 'set' || after === before) return;
    showToast(`${after.name} 도면을 ${isRedo ? '다시 실행했습니다' : '되돌렸습니다'} — 이 화면에는 보이지 않습니다`);
  };

  // Delete/Backspace 로 선택 요소 삭제 (입력 중에는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        runUndo(e.shiftKey ? redo : undo, e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        runUndo(redo, true);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        remove(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // hTab 이 바뀌면 핸들러를 다시 건다 — 세트 개요에서는 되돌린 사실을 알려야 한다
  }, [selection, remove, undo, redo, hTab]);

  /**
   * 다른 탭에 밀려난 저장본 되찾기.
   *
   * 앱 안으로 불러들이지 않고 파일로 내린다 — 불러들이면 이번엔 **이 탭의**
   * 작업이 화면에서 사라지고, 그건 고치려던 사고와 같은 사고다.
   * 내려받은 뒤 자리를 비워, 다음에 밀려나는 판본이 이것과 섞이지 않게 한다.
   */
  function downloadSuperseded() {
    const raw = readSuperseded();
    if (!raw) {
      showToast('보관해 둔 저장본이 이미 없습니다');
      return;
    }
    // 내려받지 못했으면 지우지 않는다 — 지우면 그때야말로 되찾을 길이 없다
    if (saveBlob('밀려난-자동저장.json', raw, 'application/json')) clearSuperseded();
  }

  /**
   * 자동저장 사고 알림.
   * 저장 용량 초과와 "저장된 작업을 못 읽음"은 조용히 넘기면 **작업을 잃는** 사고다.
   * 용량이 찬 뒤로는 저장이 멈춘 채 화면만 멀쩡하고, 못 읽은 자동저장은 다음 저장에
   * 덮어써진다. persistence 는 UI 를 모르므로(순환 import) 여기서 토스트에 잇는다.
   */
  useEffect(() => {
    setStorageProblemHandler((p) => {
      if (p.kind === 'superseded') {
        showToast(
          p.rescued
            ? '다른 탭에서 저장한 내용을 이 탭 작업이 밀어냈습니다 — 밀려난 저장본은 보관해 두었습니다'
            : '다른 탭에서 저장한 내용이 있어 이 탭의 자동저장을 멈췄습니다 — JSON 으로 저장해 두세요',
          undefined,
          12000,
          // 되찾을 길을 그 자리에서 준다. 파일로 내려주는 이유는 지금 편집 중인
          // 세트를 건드리지 않기 때문이다 — 되찾다가 이쪽을 잃으면 같은 사고다.
          p.rescued ? { label: '밀려난 저장본 내려받기', run: downloadSuperseded } : undefined,
        );
        return;
      }
      showToast(
        p.kind === 'quota'
          ? '브라우저 저장 공간이 가득 차 자동저장이 멈췄습니다 — JSON 으로 저장해 두세요'
          : `직전 자동저장을 열지 못했습니다 (${p.reason}) — 원본은 지우지 않고 보관했습니다`,
        undefined,
        10000,
      );
    });
    return () => setStorageProblemHandler(null);
  }, []);

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

  /**
   * JSON 불러오기.
   *
   * 예전에는 `f.text().then(importJson)` 이었다. JSON 이 아닌 파일·빈 파일은
   * Promise 안에서 예외가 터진 채 **아무 일도 일어나지 않았고**, 커넥터 목록이
   * 없는 문서는 오류 없이 통과해 다음 렌더에서 화면이 백지가 됐다.
   * 이제 못 읽으면 이유를 띄우고 현재 작업은 건드리지 않는다.
   */
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text()
      .then((text) => {
        const r = parseDocument(text);
        if (!r.ok) {
          showToast(`불러오지 못했습니다 — ${r.reason}`);
          return;
        }
        const append = importMode.current === 'append';
        if (append) for (const h of r.kit.harnesses) addHarness('blank', h);
        else replaceKit(r.kit);

        // 문서에 딸려 온 내 부품을 라이브러리에도 넣는다 — 남의 기기에서 열었을 때
        // 도면은 재현되지만 같은 커넥터를 하나 더 놓을 수 없던 문제.
        const added = mergeDocumentParts(r.kit.harnesses.flatMap((h) => h.usedParts));
        if (added.length) setLibRev((n) => n + 1);

        const errors = r.kit.harnesses
          .reduce((n, h) => n + validateHarness(h).filter((i) => i.level === 'error').length, 0);
        const notes = [
          append
            ? `하네스 ${r.kit.harnesses.length}종을 세트에 추가했습니다`
            : `${r.kit.harnesses.length}종을 불러왔습니다`,
          added.length ? `내 부품 ${added.length}종 추가` : '',
          // 정규화에서 고친 것은 사용자가 알아야 한다 — 조용히 넘기면 다음에 놀란다
          r.warnings.length ? r.warnings[0] : '',
          r.warnings.length > 1 ? `외 ${r.warnings.length - 1}건` : '',
          errors ? `검증 오류 ${errors}건 — 검증 탭을 확인하세요` : '',
        ].filter(Boolean);
        showToast(notes.join(' · '));
      })
      .catch(() => showToast('파일을 읽지 못했습니다'));
    e.target.value = '';
  }
  function newDoc() {
    if (!confirm('새 문서를 만들면 현재 작업이 사라집니다. 계속할까요?')) return;
    clearSaved();
    replaceDoc(emptyDoc());
  }
  async function exportPdf() {
    // 더 이상 화면 스냅샷을 찍지 않는다 — 문서에서 벡터로 직접 그린다.
    const { downloadPdf } = await import('./export/pdf'); // 코드 스플릿
    await downloadPdf(doc);
  }
  const runMenu = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  /** 하네스 탭 전환 — 세트 개요는 편집 대상이 아니므로 활성 하네스는 유지한다 */
  const goHarness = (id: string) => {
    setHTab(id);
    if (id !== 'set') {
      setActiveHarness(id);
      setPartsScope({ kind: 'harness', harnessId: id });
    }
  };
  /** 발주 전 확인 항목 클릭 → 그 하네스로 이동 + 대상 선택 */
  const goToBlocker = (harnessId: string, targetId?: string) => {
    goHarness(harnessId);
    setTab('prop');
    if (targetId) select(targetId);
  };
  const copyOrderText = () => {
    void navigator.clipboard?.writeText(orderText(kit));
  };
  /**
   * 내보내기 실행. ExportDialog 는 계획만 세우고 저장은 여기서 한다.
   *
   * 예전에는 파일마다 <a download> 를 눌렀다 — 브라우저가 두 번째부터 막아
   * 세트 27개 중 1개만 떨어지고 **오류도 나지 않았다**. 이제 계획된 파일을
   * 전부 바이트로 만든 뒤 하나로 접어(둘 이상이면 ZIP) 한 번만 내려받는다.
   * 이름도 다시 만들지 않고 대화상자가 보여 준 목록(plan.files)을 그대로 쓴다.
   */
  const runExport = async (plan: ExportPlan) => {
    if (plan.files.length === 0) return;
    setExportBusy({ done: 0, total: plan.files.length });
    try {
      const entries = await buildExportEntries(kit, plan, {
        docJson: exportJson,
        onProgress: (done, total) => setExportBusy({ done, total }),
      });
      const one = packForDownload(entries, zipFileName(kit));
      saveBytes(one.name, one.data, one.mime);
      setExportOpen(false);
      showToast(
        entries.length > 1
          ? `${entries.length}개 파일을 ${one.name} 하나로 내려받았습니다`
          : `${one.name} 을(를) 내려받았습니다`,
      );
    } catch (e) {
      // 조용히 넘어가면 발주처에 반쪽짜리 묶음이 나간다. 무엇이 왜 실패했는지 말한다.
      showToast(
        `내보내지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        undefined,
        10000,
      );
    } finally {
      setExportBusy(null);
    }
  };

  const parts = buildPartList(doc);
  const runs = buildRunList(doc);

  /**
   * 빈 문서 — 커넥터도 장치도 없으면 캔버스 대신 온보딩을 띄운다.
   * 좌우 패널은 자리를 지킨다(§5): 사라지면 이 앱이 무엇을 하는 앱인지도 같이 사라진다.
   */
  const isEmpty = doc.connectors.length === 0 && doc.devices.length === 0;
  /** 배선이 없으면 내보낼 것이 없다 */
  const nothingToExport = runs.length === 0;

  // 설계 검증 — 발주 전에 도면 단계에서 잡을 수 있는 실수
  const issues = useMemo(() => validateHarness(doc), [doc]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

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
        {/* 도번·Rev — 제목블록과 PDF 에 그대로 나간다.
            빈 상태 안내가 "먼저 도번과 이름을 정해 두라"고 하는데
            정작 입력할 곳이 없어서 제목블록이 늘 '—' 였다. */}
        <input
          className="doc-meta-input num"
          placeholder="도번"
          title="도면 번호 — 제목블록과 PDF 에 표시됩니다"
          value={doc.drawingNo ?? ''}
          onChange={(e) => setDocMeta({ drawingNo: e.target.value || undefined })}
        />
        <input
          className="doc-meta-input num rev"
          placeholder="Rev"
          title="리비전"
          value={doc.rev ?? ''}
          onChange={(e) => setDocMeta({ rev: e.target.value || undefined })}
        />
        <div className="view-toggle">
          <button className={view === 'logical' ? 'on' : ''} onClick={() => setView('logical')}>논리 뷰</button>
          {/* 배선이 없으면 제조 도면에 그릴 것이 없다 */}
          <button
            className={view === 'physical' ? 'on' : ''}
            disabled={nothingToExport}
            title={nothingToExport ? '배선이 있어야 제조 도면이 나옵니다' : undefined}
            onClick={() => setView('physical')}
          >
            물리 뷰
          </button>
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
              <button onClick={runMenu(() => setExportOpen(true))}>내보내기 설정…</button>
              <hr />
              <button onClick={runMenu(() => saveBlob(`${doc.name || 'harness'}.json`, exportJson(), 'application/json'))}>
                JSON 저장 (세트 전체)
              </button>
              <button onClick={runMenu(() => pickFile('replace'))}>JSON 불러오기</button>
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
        <button className="primary" disabled={nothingToExport} onClick={exportPdf}>PDF 도면</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
      </header>

      {/* 하네스 탭 스트립 — 세트 개요 + 하네스 여러 종.
          캔버스·접속표·파트·속성은 선택된 하네스 하나만 다룬다.
          전체를 합산해 보여주는 곳은 '세트 개요' 하나뿐이다. */}
      <nav className="htabs" aria-label="하네스">
        <button
          className={hTab === 'set' ? 'on' : ''}
          onClick={() => setHTab('set')}
        >
          세트 개요 <b className="num">{kit.harnesses.length}종</b>
        </button>
        {kit.harnesses.map((h, i) => (
          <button
            key={h.id}
            className={hTab === h.id ? 'on' : ''}
            onClick={() => goHarness(h.id)}
          >
            <i className="htab-letter num">{h.letter ?? letterAt(i)}</i>
            {h.name}
            <b className="num">×{kit.set.items.find((x) => x.harnessId === h.id)?.perSet ?? 1}</b>
          </button>
        ))}
        <button className="htab-add" onClick={() => addHarness('blank')} title="빈 하네스 추가">
          + 하네스
        </button>
      </nav>

      {hTab === 'set' ? (
        <SetOverview
          kit={kit}
          activeHarnessId={activeHarnessId}
          onSelectHarness={goHarness}
          onChangePerSet={setPerSet}
          onChangeOrderQty={(q) => updateSet({ orderQty: Math.max(1, q) })}
          onChangeSet={updateSet}
          onAddHarness={(mode) => {
            if (mode === 'import') pickFile('append');   // '이 세트에 하네스 추가' 밑의 버튼이다
            else addHarness(mode);
          }}
          onRemoveHarness={removeHarness}
          onGoToBlocker={goToBlocker}
          onCopyOrderText={copyOrderText}
          onExportSetPdf={() => setExportOpen(true)}
        />
      ) : view === 'physical' ? (
      /* 물리 뷰 = 제조 도면. 구간·치수·자재를 다루므로 우측 패널을 자체적으로 갖는다. */
      <div className="body body-phys">
        <LibraryPanel key={libRev} />
        <PhysicalView
          doc={doc}
          selection={selection}
          onSelect={select}
          onSegmentLength={setSegmentLength}
        />
      </div>
      ) : (
      <div className="body">
        <LibraryPanel key={libRev} />
        <main className="canvas-area">
          {/* 빈 상태에서도 캔버스는 살아 있어야 한다 —
              온보딩이 "끌어다 놓으라"고 안내하는데 정작 드롭을 못 받으면 거짓말이 된다.
              캔버스를 그대로 두고 그 위에 온보딩을 얹는다(드롭은 통과시킨다). */}
          <HarnessCanvas />
          {isEmpty && (
            <EmptyCanvas
              onFocusLibrary={() => {
                (document.querySelector('.lib-search') as HTMLInputElement | null)?.focus();
              }}
              onNewPart={() => {
                (document.querySelector('.lib-new') as HTMLButtonElement | null)?.click();
              }}
              onImport={() => pickFile('replace')}
            />
          )}
        </main>
        <div className="right">
          <div className="tabs">
            <button className={tab === 'prop' ? 'on' : ''} onClick={() => setTab('prop')}>속성</button>
            <button className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}>접속표 {runs.length}</button>
            <button className={tab === 'parts' ? 'on' : ''} onClick={() => setTab('parts')}>파트 {parts.length}</button>
            <button
              className={`${tab === 'check' ? 'on' : ''}${errorCount ? ' has-error' : ''}`}
              onClick={() => setTab('check')}
              title="설계 검증 — 발주 전에 잡을 수 있는 실수"
            >
              검증 {issues.length}
            </button>
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
                          className={[
                            r.wireId === selection ? 'sel' : '',
                            r.wireId === hoverWire ? 'hot' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => select(r.wireId)}
                          onMouseEnter={() => setHover(r.wireId, 'table')}
                          onMouseLeave={() => setHover(null)}
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
                <span className="hint">
                  {hoverWire ? '강조 중 — 도면과 동기' : '행에 올리면 도면에서 강조'}
                </span>
              </div>
            </>
          )}

          {tab === 'check' && (
            <div className="tab-body">
              <ValidationPanel
                issues={issues}
                onGoTo={(id) => {
                  if (id) select(id);
                  setTab('prop');
                }}
              />
            </div>
          )}

          {tab === 'parts' && (
            <PartsPanel
              kit={kit}
              activeHarnessId={activeHarnessId}
              scope={partsScope}
              onChangeScope={setPartsScope}
              onGoToBlocker={goToBlocker}
              onChangeOrderQty={(q) => updateSet({ orderQty: Math.max(1, q) })}
              onChangePerSet={setPerSet}
              onOpenHarness={goHarness}
            />
          )}
        </div>
      </div>
      )}

      {exportOpen && (
        <ExportDialog
          kit={kit}
          activeHarnessId={activeHarnessId}
          onCancel={() => setExportOpen(false)}
          onExport={runExport}
          busy={exportBusy}
        />
      )}
      {/* 파괴적 동작(삭제·일괄 지정)의 실행취소 안내. 확인 대화상자를 대신한다. */}
      <ToastHost />
    </div>
  );
}
