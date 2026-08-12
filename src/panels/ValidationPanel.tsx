/**
 * 검증 탭 — 발주 전에 도면만 보고 잡을 수 있는 실수를 전부 세워 놓는 화면.
 *
 * 화면이 하는 일은 하나다: **어디를 고쳐야 하는지 짚어 준다.**
 * 그래서 모든 행은 누를 수 있고, 누르면 그 커넥터·배선이 선택된다.
 * 판정은 전부 `validateHarness()`(순수 함수)가 하고 여기서는 아무것도 세지 않는다.
 *
 * 색 규칙: UI 강조는 스틸(--accent) 하나뿐이다. 빨강은 캔버스의 전선 색이라
 * error 에도 쓰지 않는다 — 심각도는 좌측 바의 굵기·농도와 배지로 구분한다.
 */
import type { Issue, IssueLevel } from '../store/validate';
import './validation.css';

const GROUPS: { level: IssueLevel; label: string; note: string }[] = [
  { level: 'error', label: '오류', note: '고치기 전에는 발주하지 않는다' },
  { level: 'warn', label: '확인', note: '의도한 것인지 확인' },
  { level: 'info', label: '참고', note: '틀리진 않았다' },
];

export function ValidationPanel(props: {
  issues: Issue[];
  onGoTo: (targetId?: string) => void;
}): JSX.Element {
  const { issues, onGoTo } = props;

  const groups = GROUPS.map((g) => ({
    ...g,
    rows: issues.filter((i) => i.level === g.level),
  })).filter((g) => g.rows.length > 0);

  const errors = issues.filter((i) => i.level === 'error').length;

  return (
    <div className="vl">
      {groups.length === 0 ? (
        <div className="vl-empty">
          <span className="vl-empty-mark" aria-hidden>✓</span>
          <p className="vl-empty-title">확인된 문제가 없습니다</p>
          <p className="vl-empty-sub">
            핀 범위 · 터미널 · 길이 · 규격 색 · 중복 배선 · 게이지까지 전부 통과했습니다.
          </p>
        </div>
      ) : (
        <div className="vl-list">
          {groups.map((g) => (
            <section className="vl-group" key={g.level}>
              <div className="vl-group-head">
                <span className="vl-group-label">{g.label}</span>
                <span className={`vl-badge num lv-${g.level}`}>{g.rows.length}</span>
                <span className="vl-grow" />
                <span className="vl-group-rule">{g.note}</span>
              </div>
              {g.rows.map((it, i) => (
                <button
                  type="button"
                  key={`${it.id}-${it.targetId ?? 'x'}-${i}`}
                  className={`vl-row lv-${it.level}`}
                  onClick={() => onGoTo(it.targetId)}
                >
                  <span className="vl-row-main">
                    <span className="vl-row-top">
                      <span className="vl-title">{it.title}</span>
                      <span className="vl-where num">{it.where}</span>
                    </span>
                    <span className="vl-detail">{it.detail}</span>
                  </span>
                  <span className="vl-chev" aria-hidden>›</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      <div className="vl-status num" role="status">
        <span>
          {issues.length === 0
            ? '검사 항목 11종 · 지적 없음'
            : `지적 ${issues.length}건 · 발주를 막는 오류 ${errors}건`}
        </span>
        <span className="vl-grow" />
        <span className="vl-basis">현재 하네스 기준</span>
      </div>
    </div>
  );
}
