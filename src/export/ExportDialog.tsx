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
import { letterAt } from '../store/kit';
import { buildPartList, buildRunList } from './exporters';
import './export.css';

export type ExportPlan = {
  scope: { kind: 'harness'; harnessId: string } | { kind: 'set' };
  items: { pdf: boolean; runsCsv: boolean; partsCsv: boolean; bomCsv: boolean; json: boolean };
  /** 전선 여유율(%) — 0 | 5 | 10 | 직접 입력 */
  marginPct: number;
  unit: 'mm' | 'inch';
  paper: 'A3' | 'A4';
  /** 켜진 CSV 열 */
  csvCols: string[];
  /** 나올 파일 목록 (파생) */
  files: { name: string; kind: string }[];
};

type ItemKey = keyof ExportPlan['items'];

const ITEM_DEFS: { key: ItemKey; name: string; ext: string; desc: string }[] = [
  { key: 'pdf', name: '도면 PDF', ext: '.pdf', desc: '논리 + 물리 · 제목블록 포함' },
  { key: 'runsCsv', name: '접속표 CSV', ext: '.csv', desc: 'FROM/TO · 색 · 게이지 · 길이' },
  { key: 'partsCsv', name: '파트리스트 CSV', ext: '.csv', desc: '하우징 · 터미널 · 전선 · 보호재' },
  { key: 'bomCsv', name: '하네스 BOM CSV', ext: '.csv', desc: '세트 구성 · 종별 수량' },
  { key: 'json', name: '문서 JSON', ext: '.json', desc: '부품 스냅샷 포함 · 다시 열기용' },
];

const CSV_COLS = ['네트', '와이어', 'FROM', 'TO', '신호', '색', '게이지', '길이', '단자', '비고'];
/** 접속표 기본 열 — 신호·단자·비고는 비워 둔다(대개 안 쓴다) */
const DEFAULT_COLS = ['네트', '와이어', 'FROM', 'TO', '색', '게이지', '길이'];

const MARGIN_PRESETS = [0, 5, 10];
type MarginSel = 0 | 5 | 10 | 'custom';

/** 도면 한 종당 나오는 PDF 매수 (논리 + 물리) */
const PDF_PAGES_PER_HARNESS = 2;

/** 파일명에 못 쓰는 문자를 다듬는다 — 품번에 공백·슬래시가 섞여 들어온다 */
function safe(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
}

export function ExportDialog(props: {
  kit: KitDocument;
  activeHarnessId: string;
  onCancel: () => void;
  onExport: (plan: ExportPlan) => void;
}): JSX.Element {
  const { kit, activeHarnessId, onCancel, onExport } = props;

  const letterOf = (h: HarnessDocument): string =>
    h.letter ?? letterAt(Math.max(0, kit.harnesses.findIndex((x) => x.id === h.id)));

  // 열릴 때의 활성 하네스가 기본 범위다. 세트에 없는 id 면 첫 하네스로 내린다.
  const initialId =
    kit.harnesses.find((h) => h.id === activeHarnessId)?.id ?? kit.harnesses[0]?.id ?? '';

  const [scope, setScope] = useState<ExportPlan['scope']>({
    kind: 'harness',
    harnessId: initialId,
  });
  const [items, setItems] = useState<ExportPlan['items']>({
    pdf: true, runsCsv: true, partsCsv: true, bomCsv: false, json: false,
  });
  const [marginSel, setMarginSel] = useState<MarginSel>(5);
  const [customPct, setCustomPct] = useState(7);
  const [unit, setUnit] = useState<ExportPlan['unit']>('mm');
  const [paper, setPaper] = useState<ExportPlan['paper']>('A3');
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);

  // Esc 로 닫는다 (스크림 클릭도 같은 동작)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const marginPct = marginSel === 'custom' ? customPct : marginSel;

  /** 이번 범위가 실제로 가리키는 하네스들 */
  const targets: HarnessDocument[] = useMemo(() => {
    if (scope.kind === 'set') return kit.harnesses;
    const h = kit.harnesses.find((x) => x.id === scope.harnessId);
    return h ? [h] : [];
  }, [kit, scope]);

  /** 건수는 전부 실제 데이터에서 센다 — 화면 숫자와 파일 숫자가 갈라지면 안 된다 */
  const counts = useMemo(() => {
    const runs = targets.reduce((n, h) => n + buildRunList(h).length, 0);
    const parts = targets.reduce((n, h) => n + buildPartList(h).length, 0);
    return {
      pdf: `${targets.length * PDF_PAGES_PER_HARNESS}매`,
      runsCsv: `${runs}행`,
      partsCsv: `${parts}행`,
      bomCsv: `${kit.set.items.length}행`,
      json: '1개',
    } as Record<ItemKey, string>;
  }, [targets, kit.set.items.length]);

  /** 파일명 규칙 `[세트]_[하네스]_[종류]_[Rev]` */
  const setTag = safe(kit.set.pn) || 'SET';
  const revRaw = (kit.set.rev ?? '').trim().replace(/^rev\.?\s*/i, '');
  const revTag = revRaw ? `Rev${safe(revRaw)}` : '';
  const fileName = (parts: string[], ext: string) =>
    [setTag, ...parts, revTag].filter(Boolean).join('_') + ext;

  // fileName · letterOf 는 아래 값들에서만 만들어지므로 의존성은 이 넷이면 족하다.
  const files = useMemo(() => {
    const out: { name: string; kind: string }[] = [];
    for (const h of targets) {
      const L = letterOf(h);
      if (items.pdf) out.push({ kind: 'PDF', name: fileName([L, '도면'], '.pdf') });
      if (items.runsCsv) out.push({ kind: 'CSV', name: fileName([L, '접속표'], '.csv') });
      if (items.partsCsv) out.push({ kind: 'CSV', name: fileName([L, '파트리스트'], '.csv') });
    }
    // BOM 과 문서 JSON 은 세트 하나에 한 장이다 — 하네스별로 늘어나지 않는다.
    if (items.bomCsv) out.push({ kind: 'CSV', name: fileName(['하네스BOM'], '.csv') });
    if (items.json) out.push({ kind: 'JSON', name: fileName(['문서'], '.json') });
    return out;
  }, [targets, items, setTag, revTag]);

  const zipNote =
    files.length > 3 ? '파일이 3개를 넘으면 ZIP 하나로 묶인다.' : '파일을 개별로 내려받는다.';
  const marginNote =
    marginPct === 0 ? '도면 길이 그대로' : `길이에 ${marginPct}% 더해 내보낸다`;
  const summary =
    scope.kind === 'set'
      ? `세트 전체 · 하네스 ${kit.harnesses.length}종 기준`
      : `하네스 ${targets[0] ? letterOf(targets[0]) : '—'} 1종 기준`;

  const setLabel = `세트 전체 (${kit.harnesses.map(letterOf).join('+')})`;

  const toggleItem = (k: ItemKey) => setItems((s) => ({ ...s, [k]: !s[k] }));
  const toggleCol = (c: string) =>
    setCols((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const submit = () =>
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

  return (
    <div className="ex-scrim" data-testid="ex-scrim" onClick={onCancel}>
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
                      max={100}
                      aria-label="여유율 직접 입력"
                      value={customPct}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCustomPct(Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
                      }}
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

        <footer className="ex-foot">
          <span className="ex-summary">{summary}</span>
          <span className="ex-spacer" />
          <button type="button" className="ex-btn" onClick={onCancel}>취소</button>
          <button
            type="button"
            className="ex-btn primary"
            disabled={files.length === 0}
            onClick={submit}
          >
            내보내기
          </button>
        </footer>
      </div>
    </div>
  );
}
