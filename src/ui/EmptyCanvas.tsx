/**
 * 빈 캔버스 온보딩 (Claude Design 2차 §5).
 *
 * 좌우 패널은 **자리를 지킨다** — 라이브러리에는 부품이 실제로 보이고,
 * 접속표는 헤더만 남는다. 사라지면 "이 앱이 무엇을 하는 앱인지"가 같이 사라진다.
 * 캔버스 중앙에만 다음 한 동작을 둔다.
 */
import './empty.css';

export function EmptyCanvas({
  onFocusLibrary,
  onNewPart,
  onImport,
}: {
  onFocusLibrary: () => void;
  onNewPart: () => void;
  onImport: () => void;
}) {
  return (
    <div className="ec-wrap">
      {/* 도면 프레임을 점선으로 — 아직 도면이 아니라는 표시 */}
      <div className="ec-frame" aria-hidden />
      <div className="ec-block">
        {/* 고스트 하우징 2개 + 연결선: 이 앱이 무엇을 그리는지 한 장으로 */}
        <svg className="ec-ghost" viewBox="0 0 260 72" aria-hidden>
          <g fill="none" stroke="var(--line)" strokeWidth="1.5">
            <rect x="8" y="14" width="66" height="44" />
            <rect x="186" y="22" width="66" height="28" />
          </g>
          <g fill="none" stroke="var(--line-mid)" strokeWidth="1">
            <rect x="14" y="20" width="16" height="16" />
            <rect x="34" y="20" width="16" height="16" />
            <rect x="54" y="20" width="16" height="16" />
            <rect x="14" y="38" width="16" height="16" />
            <rect x="34" y="38" width="16" height="16" />
            <rect x="54" y="38" width="16" height="16" />
            <rect x="192" y="28" width="16" height="16" />
            <rect x="212" y="28" width="16" height="16" />
          </g>
          {/* 직교 배선 */}
          <path
            d="M74 30 H130 V36 H186"
            fill="none"
            stroke="var(--line-mid)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>

        <h2>아직 커넥터가 없습니다</h2>
        <p>
          왼쪽 라이브러리에서 커넥터를 캔버스에 놓고,<br />
          핀과 핀을 이으면 접속표와 파트리스트가 함께 채워집니다.
        </p>

        <div className="ec-actions">
          <button className="ec-primary" onClick={onFocusLibrary}>
            라이브러리에서 커넥터 놓기
          </button>
          <div className="ec-sub">
            <button onClick={onNewPart}>새 부품 정의</button>
            <button onClick={onImport}>JSON 불러오기</button>
          </div>
        </div>

        <p className="ec-hint">
          먼저 도번과 이름을 정해 두면 도면 제목블록에 바로 반영됩니다
        </p>
      </div>
    </div>
  );
}
