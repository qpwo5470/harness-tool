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
import { GENDER_LABEL, GENDER_LONG } from './gender';
import { PartSymbol } from './PartSymbol';
import {
  FAMILIES, SERIES_ORDERED, seriesOf, seriesLabel, roleOf, compareInSeries, searchTagsOf,
  displayName,
} from './taxonomy';
import { planPartSync, partSyncMessage } from './partSync';
import { showToast, undoSteps } from '../ui/Toast';
import type { PartLibraryItem, PartGender, Device } from '../types';

/**
 * 신규 설계 비권장(Not Recommended For New Design).
 * 발주 판단에 걸리는 값이라 목록에서 바로 보여야 한다.
 */
function isNrnd(p: PartLibraryItem): boolean {
  return /not recommended/i.test(
    `${p.spec?.['상태'] ?? ''} ${p.spec?.['비고'] ?? ''}`,
  );
}

/**
 * 어느 시리즈에도 안 걸린 시드 부품이 담기는 자리.
 *
 * **왜 필요한가:** 목록은 시리즈별로 각자 거른다. 그래서 `taxonomy.SERIES` 에
 * 규칙을 안 넣으면 그 부품은 라이브러리에 **아예 뜨지 않는다** — 시드에 넣고 시험까지
 * 통과했는데 화면에서 찾을 수 없다. 실제로 JST 97종을 넣고 그 일이 났다.
 * 빠뜨린 것을 조용히 숨기는 대신 여기로 모아 눈에 띄게 한다(시험도 이 칸이 비어
 * 있기를 요구한다 — 비어 있지 않으면 SERIES 에 규칙을 더하라는 뜻이다).
 */
export const UNGROUPED_LABEL = '분류 미지정';

/* --------------------------------------------------------------- 가로 필터 */

/**
 * 시리즈로 나눈 목록을 **가로질러** 거르는 축.
 *
 * 분류는 시리즈 하나로 못 박았지만(§taxonomy), 실무에서는 "지금 필요한 건 보드측"
 * 처럼 역할로 훑고 싶을 때가 있다. 그걸 그룹으로 또 만들면 축이 다시 섞이므로,
 * 그룹은 그대로 두고 **필터**로 얹는다. 두 축이 겹치지 않는다.
 */
const ROLE_FILTERS = [
  { key: 'wire', label: '전선측' },
  { key: 'board', label: '보드측' },
  { key: 'terminal', label: '단자' },
] as const;

const GENDER_FILTERS: { key: PartGender; label: string }[] = [
  { key: 'receptacle', label: '암' },
  { key: 'plug', label: '수' },
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
  const syncUsedPart = useHarnessStore((s) => s.syncUsedPart);
  const updateConnector = useHarnessStore((s) => s.updateConnector);
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
    () => Object.fromEntries(SERIES_ORDERED.map((s) => [s.key, !s.openByDefault])),
  );
  /** 가로 필터 — 역할·성별. null 이면 안 거른다. */
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<PartGender | null>(null);
  /** 가져오기 결과 안내 — alert 대신 패널 안에 남겨 건너뛴 행을 읽을 수 있게 */
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (label: string) =>
    setCollapsed((c) => ({ ...c, [label]: !c[label] }));

  const allParts = useMemo(() => [...custom, ...SEED_PARTS], [custom]);
  const searching = q.trim().length > 0;
  /** 필터가 걸려 있으면 접힘을 무시한다 — 검색과 같은 이유(결과가 숨으면 무의미) */
  const narrowing = searching || roleFilter !== null || genderFilter !== null;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    let out = allParts;
    if (t) {
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(t) ||
          (p.mpn ?? '').toLowerCase().includes(t) ||
          (p.manufacturer ?? '').toLowerCase().includes(t) ||
          // 시리즈·제조사·용도 태그로도 잡힌다 — "MDB", "자판기", "Micro-Fit" 같은 말이
          // 부품 이름에는 없지만 사람 머릿속에는 먼저 떠오르는 이름이라서.
          searchTagsOf(p).some((tag) => tag.toLowerCase().includes(t)) ||
          (p.pinLayout ?? []).some((s) => (s.signal ?? '').toLowerCase().includes(t)),
      );
    }
    if (roleFilter) out = out.filter((p) => roleOf(p).key === roleFilter);
    if (genderFilter) out = out.filter((p) => p.gender === genderFilter);
    return out;
  }, [q, allParts, roleFilter, genderFilter]);

  const addPart = (item: PartLibraryItem) => {
    if (item.category === 'terminal') return; // 단자는 캔버스에 놓지 않음
    const at = { x: 120 + Math.random() * 200, y: 120 + Math.random() * 160 };
    const conn = instantiate(item, at);
    // 순서가 중요하다: 히스토리를 쌓는 addConnector 가 **먼저**여야 그 스냅샷에
    // 부품이 아직 없어, ⌘Z 한 번이 커넥터와 부품 스냅샷을 함께 되돌린다.
    // 반대로 부르면 부품이 스냅샷 안에 들어가 usedParts 에 영영 남는다.
    addConnector(conn);
    addUsedPart(item);
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

  /**
   * 핀맵 에디터 저장 — 라이브러리와 **현재 도면**에 함께 반영한다.
   *
   * 예전에는 `addUsedPart` 하나로 끝냈는데, 그 액션은 계약상 같은 id 를 무시한다.
   * 그래서 이미 도면에 놓인 부품을 고쳐도 도면은 옛 정의 그대로였다(이름도 핀 수도).
   * 지금은 planPartSync 로 무엇이 달라지는지 계산해 커넥터 핀까지 맞추고,
   * 바뀐 내용을 토스트로 알린다 — 되돌릴 길(⌘Z)도 같이 남긴다.
   */
  const handleSave = (part: PartLibraryItem) => {
    setCustom(upsertCustomPart(part));

    const plan = planPartSync(useHarnessStore.getState().doc, part);
    if (plan.usedPartChanged) syncUsedPart?.(part);
    else addUsedPart(part); // 처음 쓰는 부품은 스냅샷으로 추가
    for (const c of plan.connectors) updateConnector(c.connectorId, { pins: c.pins });

    const msg = partSyncMessage(part, plan);
    if (msg) showToast(msg, plan.steps ? undoSteps(plan.steps) : undefined);

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
      const { parts: incoming, warnings, skipped = 0 } = parsePartsFile(txt, f.name);
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

      /*
       * 이미 라이브러리에 있는 MPN 이 또 들어오는 경우 — 같은 CSV 를 두 번 넣으면
       * id 가 매번 새로 발급돼 부품이 통째로 두 벌이 된다. 합치지는 않는다(진짜
       * 다른 부품일 수 있다). 대신 조용히 두 벌이 되지는 않게 알린다.
       */
      const known = new Set(
        custom.map((p) => (p.mpn ?? '').trim().toLowerCase()).filter(Boolean),
      );
      const dupMpn = incoming
        .map((p) => (p.mpn ?? '').trim())
        .filter((m) => m && known.has(m.toLowerCase()));

      saveCustomParts(merged);
      setCustom(merged);

      // "건너뛴 행" 과 "고쳐 읽은 값" 은 다른 이야기다 — 섞어서 세면 안내가 거짓말이 된다.
      const adjusted = Math.max(0, warnings.length - skipped);
      const head = [
        `부품 ${incoming.length}종을 등록했습니다.`,
        skipped ? `건너뛴 행 ${skipped}건` : '',
        adjusted ? `확인할 값 ${adjusted}건` : '',
        dupMpn.length ? `이미 있는 MPN ${dupMpn.length}건(${dupMpn.slice(0, 3).join(', ')})` : '',
      ].filter(Boolean).join(' · ');

      setImportNote({
        ok: skipped === 0,
        text: warnings.length ? `${head}\n${warnings.slice(0, 5).join('\n')}` : head,
      });
      // 패널 밖(캔버스)을 보고 있어도 결과가 눈에 들어와야 한다
      showToast(head);
    });
    e.target.value = '';
  };

  const renderItem = (p: PartLibraryItem) => {
    // 단자는 캔버스에 놓지 않는다 — 클릭과 마찬가지로 드래그도 막는다.
    const droppable = p.category !== 'terminal';
    const role = roleOf(p);
    const nrnd = isNrnd(p);
    /*
     * 성별 표기는 세 갈래다. 셋을 한 배지로 뭉개면 안 된다 —
     *   암/수/보드  결합 상대가 정해진 값. 틀리면 현장에서 못 쓴다
     *   —(neutral)  스플라이스·단자처럼 성별이라는 개념이 없는 부품
     *   미지정      아직 확인 안 된 값. 위 둘과 달리 **경고**다
     * 예전에는 마지막 둘을 똑같이 "배지 없음" 으로 그려서, 확인이 끝난 부품인지
     * 아직 안 본 부품인지 화면에서 구분이 안 됐다.
     */
    const unknownGender = p.gender === undefined && p.category !== 'splice' && p.category !== 'terminal';
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
          title={[
            p.name,
            p.mpn && `MPN ${p.mpn}`,
            `역할: ${role.long}`,
            p.gender ? `성별: ${GENDER_LABEL[p.gender]}(${GENDER_LONG[p.gender]})` : '성별: 미지정 — 발주 전 확인 필요',
            p.pinCount ? `핀 수: ${p.pinCount}P` : null,
            ...Object.entries(p.spec ?? {}).map(([k, v]) => `${k}: ${v}`),
          ]
            .filter(Boolean)
            .join('\n')}
          disabled={p.category === 'terminal'}
        >
          {/* 형상 기호 — 역할·성별·핀 배열을 글자보다 먼저 읽게 한다 */}
          <PartSymbol part={p} />
          {/* 성별 칸은 기호 바로 옆 **고정 위치**다. 이름 길이에 따라 자리가 밀리면
              (예전처럼 오른쪽 정렬) 눈이 매 행마다 다른 x 를 훑어야 한다. */}
          <span className={`gender-cell g-${p.gender ?? (unknownGender ? 'unknown' : 'none')}`} aria-hidden>
            {p.gender === 'receptacle' ? '암'
              : p.gender === 'plug' ? '수'
              : p.gender === 'header' ? '보드'
              : unknownGender ? '?' : '·'}
          </span>
          {/* 이름은 반드시 요소로 감싼다 — 텍스트 노드에는 ellipsis 가 걸리지 않아
              긴 이름이 한 행 안에서 줄바꿈되며 겹친다 */}
          <span className="lib-item-name">{displayName(p)}</span>
          {p.pinCount ? <span className="pin-badge">{p.pinCount}P</span> : null}
          {nrnd ? (
            <span className="nrnd-badge" title="Not Recommended For New Design — 신규 설계 비권장">
              NRND
            </span>
          ) : null}
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
        placeholder="이름·MPN·시리즈·신호 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {/* 가로 필터 — 시리즈 그룹은 그대로 두고 역할·성별로 가로질러 거른다 */}
      <div className="lib-filters" role="group" aria-label="역할·성별 필터">
        {ROLE_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`lib-chip${roleFilter === f.key ? ' on' : ''}`}
            aria-pressed={roleFilter === f.key}
            onClick={() => setRoleFilter((v) => (v === f.key ? null : f.key))}
          >
            {f.label}
          </button>
        ))}
        <span className="lib-filter-sep" aria-hidden />
        {GENDER_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`lib-chip${genderFilter === f.key ? ' on' : ''}`}
            aria-pressed={genderFilter === f.key}
            title={GENDER_LONG[f.key]}
            onClick={() => setGenderFilter((v) => (v === f.key ? null : f.key))}
          >
            {f.label}
          </button>
        ))}
        {(roleFilter || genderFilter) && (
          <button
            className="lib-chip clear"
            onClick={() => { setRoleFilter(null); setGenderFilter(null); }}
          >
            해제
          </button>
        )}
      </div>

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

      {/*
        계열(4칸) → 시리즈. 두 단계 모두 축이 하나뿐이라 "이건 어디 있지" 가
        생기지 않는다. 계열 머리글은 접히지 않는다 — 목차 역할이라 늘 보여야 한다.
      */}
      {FAMILIES.map((fam) => {
        const rows = SERIES_ORDERED.filter((s) => s.family === fam.key)
          .map((s) => ({
            s,
            items: filtered
              .filter((p) => !isCustomPart(p.id) && s.match(p.id))
              .sort(compareInSeries),
          }))
          .filter((r) => r.items.length);
        if (!rows.length) return null;
        const total = rows.reduce((n, r) => n + r.items.length, 0);
        return (
          <div key={fam.key} className="lib-fam">
            <div className="lib-fam-title" title={fam.hint}>
              <span className="name">{fam.label}</span>
              <span className="count">{total}</span>
            </div>
            {rows.map(({ s, items }) => {
              // 검색·필터 중에는 접힘을 무시한다 — 결과가 숨으면 검색이 무의미하다.
              const open = narrowing || !collapsed[s.key];
              return (
                <div key={s.key} className="lib-cat">
                  <button
                    className="lib-cat-title"
                    onClick={() => toggle(s.key)}
                    aria-expanded={open}
                    title={open ? '접기' : '펼치기'}
                  >
                    <span className="caret">{open ? '▾' : '▸'}</span>
                    <span className="name">{seriesLabel(s)}</span>
                    <span className="count">{items.length}</span>
                  </button>
                  {open && items.map(renderItem)}
                </div>
              );
            })}
          </div>
        );
      })}

      {/*
        어느 시리즈에도 안 걸린 시드 부품 — 보통은 비어 있다.
        비어 있지 않다면 taxonomy.SERIES 에 규칙을 빠뜨린 것이다(UNGROUPED_LABEL 주석 참고).
        숨기면 "시드에 넣었는데 화면에 없다" 가 되므로 눈에 띄게 내놓는다.
      */}
      {(() => {
        const rest = filtered.filter((p) => !isCustomPart(p.id) && !seriesOf(p));
        if (!rest.length) return null;
        const open = narrowing || !collapsed[UNGROUPED_LABEL];
        return (
          <div className="lib-cat">
            <button
              className="lib-cat-title"
              onClick={() => toggle(UNGROUPED_LABEL)}
              aria-expanded={open}
              title={open ? '접기' : '펼치기'}
            >
              <span className="caret">{open ? '▾' : '▸'}</span>
              <span className="name">{UNGROUPED_LABEL}</span>
              <span className="count">{rest.length}</span>
            </button>
            {open && rest.map(renderItem)}
          </div>
        );
      })()}

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
