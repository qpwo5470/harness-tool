/**
 * 내보내기 대화상자 — Claude Design 2차 리디자인 §6.
 *
 * 고르는 것은 셋뿐이다 — **무엇을**(도면·접속표·파트·문서), **어느 범위로**
 * (하네스 하나 / 세트 전체), **어떤 단위로**(여유율·치수 단위·용지·CSV 열).
 * 고른 결과는 곧바로 우측 "나올 파일" 목록이 되어, 누르기 전에 무엇이
 * 떨어질지 보인다.
 *
 * **원칙(README §6 원문).** 화면 숫자와 발주 숫자가 달라지지 않도록 여유율은
 * 이 대화상자에서 한 번만 정한다. 캔버스·접속표·파트 탭은 언제나 도면 길이
 * 그대로다.
 *
 * 이 컴포넌트는 파일을 저장하지 않는다. 고른 것을 ExportPlan 으로 만들어
 * onExport 로 넘길 뿐이다 — 실제 저장은 호출 측(App)이 맡는다.
 * 스타일은 export.css 에만 있고 색은 tokens.css 변수만 쓴다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { HarnessDocument, KitDocument } from '../types';
import {
  buildPartList, buildRunList, RUN_CSV_COLUMNS, RUN_CSV_DEFAULT_COLS,
} from './exporters';
import { clampMarginPct, MAX_MARGIN_PCT } from './units';
import {
  harnessLetter, planExportFiles, revTag as revTagOf, targetsOf,
  type ExportFile, type ExportItems, type ExportScope,
} from './exportPlan';
import './export.css';

export type ExportPlan = {
  scope: ExportScope;
  items: ExportItems;
  /** 전선 여유율(%) — 0 | 5 | 10 | 직접 입력 */
  marginPct: number;
  unit: 'mm' | 'inch';
  paper: 'A3' | 'A4';
  /** 켜진 CSV 열 */
  csvCols: string[];
  /**
   * 나올 파일 목록.
   *
   * 화면에 보여 준 **그 목록 그대로** 넘어간다. 저장하는 쪽이 이름을 다시
   * 만들지 않으므로 미리보기와 실제 파일명이 갈라질 수 없다 — 예전에는 갈라져서
   * 미리보기엔 `_RevA` 가 있고 실제 파일엔 없었다.
   */
  files: ExportFile[];
};

type ItemKey = keyof ExportPlan['items'];

const ITEM_DEFS: { key: ItemKey; name: string; ext: string; desc: string }[] = [
  { key: 'pdf', name: '도면 PDF', ext: '.pdf', desc: '논리 + 물리 · 제목블록 포함' },
  { key: 'runsCsv', name: '접속표 CSV', ext: '.csv', desc: 'FROM/TO · 색 · 게이지 · 길이' },
  { key: 'partsCsv', name: '파트리스트 CSV', ext: '.csv', desc: '하우징 · 터미널 · 전선 · 보호재' },
  { key: 'bomCsv', name: '하네스 BOM CSV', ext: '.csv', desc: '세트 구성 · 종별 수량' },
  { key: 'json', name: '문서 JSON', ext: '.json', desc: '부품 스냅샷 포함 · 다시 열기용' },
];

/**
 * 고를 수 있는 CSV 열 — **목록도 순서도 exporters.ts 가 정한다.**
 * 예전에는 여기에 문자열 배열이 따로 있었고 CSV 는 고정 7열을 찍었다. 칩을
 * 눌러도 파일이 안 바뀌던 이유다. 이제 칩에 보이는 열은 반드시 CSV 가 아는 열이다.
 */
const CSV_COLS = RUN_CSV_COLUMNS.map((c) => c.label);
const DEFAULT_COLS = RUN_CSV_DEFAULT_COLS;

const MARGIN_PRESETS = [0, 5, 10];
type MarginSel = 0 | 5 | 10 | 'custom';

/**
 * 도면 한 종이 차지하는 면 수 — 배선도 · 접속표 · 파트리스트 셋이 최소치다
 * (export/pdf.ts 의 addHarness). 표가 길면 더 늘어나므로 '이상' 으로 적는다.
 * 예전 값 2 는 어느 면도 세지 않은 숫자였다.
 */
const PDF_PAGES_PER_HARNESS = 3;

export function ExportDialog(props: {
  kit: KitDocument;
  activeHarnessId: string;
  onCancel: () => void;
  onExport: (plan: ExportPlan) => void;
  /** 내보내는 중이면 진행 상황. 있는 동안 대화상자는 잠긴다. */
  busy?: { done: number; total: number } | null;
}): JSX.Element {
  const { kit, activeHarnessId, onCancel, onExport, busy } = props;

  const letterOf = (h: HarnessDocument): string => harnessLetter(kit, h);

  // 열릴 때의 활성 하네스가 기본 범위다. 세트에 없는 id 면 첫 하네스로 내린다.
  const initialId =
    kit.harnesses.find((h) => h.id === activeHarnessId)?.id ?? kit.harnesses[0]?.id ?? '';

  const [scope, setScope] = useState<ExportScope>({
    kind: 'harness',
    harnessId: initialId,
  });
  const [items, setItems] = useState<ExportItems>({
    pdf: true, runsCsv: true, partsCsv: true, bomCsv: false, json: false,
  });
  const [marginSel, setMarginSel] = useState<MarginSel>(5);
  const [customPct, setCustomPct] = useState(7);
  const [unit, setUnit] = useState<ExportPlan['unit']>('mm');
  const [paper, setPaper] = useState<ExportPlan['paper']>('A3');
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);

  // Esc 로 닫는다 (스크림 클릭도 같은 동작). 내보내는 중에는 닫히지 않는다 —
  // 진행 중에 창이 사라지면 다 됐는지 아닌지 알 길이 없다.
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const marginPct = marginSel === 'custom' ? customPct : marginSel;

  /** 이번 범위가 실제로 가리키는 하네스들 */
  const targets: HarnessDocument[] = useMemo(() => targetsOf(kit, scope), [kit, scope]);

  /** 건수는 전부 실제 데이터에서 센다 — 화면 숫자와 파일 숫자가 갈라지면 안 된다 */
  const counts = useMemo(() => {
    const runs = targets.reduce((n, h) => n + buildRunList(h).length, 0);
    const parts = targets.reduce((n, h) => n + buildPartList(h).length, 0);
    return {
      pdf: `${targets.length * PDF_PAGES_PER_HARNESS}매 이상`,
      runsCsv: `${runs}행`,
      partsCsv: `${parts}행`,
      bomCsv: `${kit.set.items.length}행`,
      json: '1개',
    } as Record<ItemKey, string>;
  }, [targets, kit.set.items.length]);

  /**
   * 파일명 규칙 `[세트]_[하네스]_[종류]_[Rev]`.
   * 이름을 만드는 곳은 exportPlan.ts 하나뿐이다 — 여기서 다시 조립하면
   * 저장하는 쪽과 또 갈라진다(실제로 갈라져서 `_RevA` 가 사라진 적이 있다).
   */
  const revRaw = (kit.set.rev ?? '').trim().replace(/^rev\.?\s*/i, '');
  const revTag = revTagOf(kit);
  const files = useMemo(() => planExportFiles(kit, scope, items), [kit, scope, items]);

  // 브라우저는 사용자가 누르지 않은 연속 다운로드를 막는다. 둘 이상이면 봉투 하나다.
  const zipNote =
    files.length > 1 ? '파일이 2개 이상이면 ZIP 하나로 묶인다.' : '파일 하나는 그대로 내려받는다.';
  // 여유율이 **파트리스트에만** 붙는다는 사실을 문구로도 못 박는다 — 예전 문구는
  // "길이에 N% 더해 내보낸다" 라서 접속표·도면까지 늘어나는 것처럼 읽혔다.
  const marginNote =
    marginPct === 0
      ? '도면 길이 그대로'
      : `파트리스트 발주 길이에만 ${marginPct}% 더한다`;
  /**
   * 접속표를 내보내기로 해 놓고 열을 하나도 고르지 않은 상태.
   * 그대로 두면 머리글도 없는 빈 CSV 가 나가 "배선이 없는 하네스" 로 읽힌다.
   * 조용히 최소 열을 끼워 넣지 않고 **내보내기를 막는다** — 무엇이 빠졌는지는
   * 고른 사람만 안다.
   */
  const noCols = items.runsCsv && cols.length === 0;
  const summary =
    scope.kind === 'set'
      ? `세트 전체 · 하네스 ${kit.harnesses.length}종 기준`
      : `하네스 ${targets[0] ? letterOf(targets[0]) : '—'} 1종 기준`;

  const setLabel = `세트 전체 (${kit.harnesses.map(letterOf).join('+')})`;

  const toggleItem = (k: ItemKey) => setItems((s) => ({ ...s, [k]: !s[k] }));
  const toggleCol = (c: string) =>
    setCols((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const submit = () => {
    if (noCols) return;
    onExport({
      scope,
      items,
      marginPct,
      unit,
      paper,
      // 화면에 보인 순서 그대로 넘긴다 — CSV 열 순서가 곧 파일 열 순서다.
      csvCols: CSV_COLS.filter((c) => cols.includes(c)),
      files,
    });
  };

  return (
    <div className="ex-scrim" data-testid="ex-scrim" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="ex"
        role="dialog"
        aria-modal="true"
        aria-label="내보내기"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ex-head">
          <span className="ex-title">내보내기</span>
          <span className="ex-head-sub num">
            {kit.set.pn || '품번 미지정'}
            {revTag ? ` · Rev.${revRaw}` : ''}
          </span>
        </header>

        <div className="ex-body">
          {/* ---------------- 좌: 고르는 것 셋 ---------------- */}
          <div className="ex-left">
            <section className="ex-sec">
              <div className="ex-sec-head">
                <span className="label-caps">범위</span>
                <span className="ex-rule" />
              </div>
              <div className="ex-scopes">
                {kit.harnesses.map((h) => {
                  const on = scope.kind === 'harness' && scope.harnessId === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={`ex-scope${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setScope({ kind: 'harness', harnessId: h.id })}
                    >
                      {`하네스 ${letterOf(h)}`}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`ex-scope${scope.kind === 'set' ? ' on' : ''}`}
                  aria-pressed={scope.kind === 'set'}
                  onClick={() => setScope({ kind: 'set' })}
                >
                  {setLabel}
                </button>
              </div>
            </section>

            <section className="ex-sec">
              <div className="ex-sec-head">
                <span className="label-caps">무엇을</span>
                <span className="ex-rule" />
              </div>
              <div className="ex-items">
                {ITEM_DEFS.map((d) => {
                  const on = items[d.key];
                  return (
                    <div
                      key={d.key}
                      className={`ex-item${on ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={on}
                      aria-label={d.name}
                      tabIndex={0}
                      onClick={() => toggleItem(d.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleItem(d.key);
                        }
                      }}
                    >
                      <span className="ex-box" aria-hidden="true">{on ? '✓' : ''}</span>
                      <span className="ex-item-main">
                        <span className="ex-item-name">
                          {d.name} <span className="ex-ext num">{d.ext}</span>
                        </span>
                        <span className="ex-item-desc">{d.desc}</span>
                      </span>
                      <span className="ex-item-count num">{counts[d.key]}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="ex-sec">
              <div className="ex-sec-head">
                <span className="label-caps">옵션</span>
                <span className="ex-rule" />
              </div>

              <div className="ex-row">
                <span className="ex-row-label">전선 여유율</span>
                <div className="ex-seg" role="group" aria-label="전선 여유율">
                  {MARGIN_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`ex-seg-btn num${marginSel === m ? ' on' : ''}`}
                      aria-pressed={marginSel === m}
                      onClick={() => setMarginSel(m as MarginSel)}
                    >
                      {`${m}%`}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`ex-seg-btn${marginSel === 'custom' ? ' on' : ''}`}
                    aria-pressed={marginSel === 'custom'}
                    onClick={() => setMarginSel('custom')}
                  >
                    직접
                  </button>
                </div>
                {marginSel === 'custom' && (
                  <span className="ex-custom">
                    <input
                      className="ex-num num"
                      type="number"
                      min={0}
                      max={MAX_MARGIN_PCT}
                      aria-label="여유율 직접 입력"
                      value={customPct}
                      // 범위 검사는 units.ts 한 곳에서 한다 — 비숫자(빈 칸·문자)는 0,
                      // 음수와 100% 초과는 잘린다. 음수 여유율은 도면보다 짧은
                      // 전선을 주문하라는 뜻이 되고, 100% 초과는 여유가 아니라 오타다.
                      onChange={(e) => setCustomPct(clampMarginPct(e.target.value))}
                    />
                    <span className="ex-unit">%</span>
                  </span>
                )}
                <span className="ex-note">{marginNote}</span>
              </div>

              <p className="ex-principle">
                화면 숫자와 발주 숫자가 달라지지 않도록 여유율은 이 대화상자에서 한 번만 정한다.
                캔버스·접속표·파트 탭은 언제나 도면 길이 그대로다.
              </p>

              <div className="ex-row">
                <span className="ex-row-label">치수 단위</span>
                <div className="ex-seg" role="group" aria-label="치수 단위">
                  {(['mm', 'inch'] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={`ex-seg-btn num${unit === u ? ' on' : ''}`}
                      aria-pressed={unit === u}
                      onClick={() => setUnit(u)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
                <span className="ex-row-label ex-row-label-2">용지</span>
                <div className="ex-seg" role="group" aria-label="용지">
                  {(['A3', 'A4'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`ex-seg-btn ex-seg-sm num${paper === p ? ' on' : ''}`}
                      aria-pressed={paper === p}
                      onClick={() => setPaper(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ex-row ex-row-top">
                <span className="ex-row-label ex-row-label-pad">CSV 열</span>
                <div className="ex-chips">
                  {CSV_COLS.map((c) => {
                    const on = cols.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`ex-chip${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleCol(c)}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              {noCols && (
                <p className="ex-warn" role="alert">
                  접속표 CSV 에 넣을 열을 하나도 고르지 않았다. 한 개 이상 골라야 내보낼 수 있다.
                </p>
              )}
            </section>
          </div>

          {/* ---------------- 우: 나올 파일 ---------------- */}
          <div className="ex-right">
            <div className="ex-sec-head ex-files-head">
              <span className="label-caps">나올 파일</span>
              <span className="ex-spacer" />
              <span className="ex-file-count num">{`${files.length}개`}</span>
            </div>
            {files.length > 0 ? (
              <ul className="ex-files" aria-label="나올 파일">
                {files.map((f) => (
                  <li className="ex-file" key={f.name}>
                    <span className="ex-file-kind num">{f.kind}</span>
                    <span className="ex-file-name num">{f.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ex-files ex-files-empty">고른 항목이 없어 나올 파일이 없다.</div>
            )}
            <div className="ex-zip">{zipNote}</div>
            <div className="ex-spacer" />
            <div className="ex-rule-note">
              파일명 규칙 <span className="num">[세트]_[하네스]_[종류]_[Rev]</span>
            </div>
          </div>
        </div>

        {/* 9종 도면은 한글이 래스터라 수 초가 걸린다. 그동안 무엇이 되고 있는지
            보여 주고 버튼을 잠근다 — 두 번 누르면 같은 묶음이 두 번 만들어진다. */}
        <footer className="ex-foot">
          <span className="ex-summary">
            {busy ? `내보내는 중… ${busy.done}/${busy.total}` : summary}
          </span>
          <span className="ex-spacer" />
          <button type="button" className="ex-btn" disabled={!!busy} onClick={onCancel}>취소</button>
          <button
            type="button"
            className="ex-btn primary"
            disabled={files.length === 0 || noCols || !!busy}
            onClick={submit}
          >
            {busy ? '내보내는 중…' : '내보내기'}
          </button>
        </footer>
      </div>
    </div>
  );
}
