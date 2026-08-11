# 운영 모델 — 2레인 멀티에이전트

두 레인이 병렬로 돈다. 하나는 **배포·검증**, 하나는 **지속 개발**.

```
                 feat/* 브랜치            main 브랜치
                 ───────────              ───────────
 레인 2 (Build) ──●──●──●── PR ──▶  [CI 게이트]  ──merge──▶ ●  ──▶ [자동 배포]
   지속 개발        commit           typecheck                       │
                                     test                            ▼
                                     build                   [배포 스모크 200]
                                        ▲                            │
 레인 1 (Ship & Test) ──────────────────┴──── PR 검토·머지·릴리스 관리 ─┘
   구현된 데까지 배포·테스트
```

## 레인 1 — Ship & Test (구현된 지점 배포·검증)

- **소유 브랜치:** `main` (항상 배포 가능한 상태)
- **트리거:** `main`에 머지 → `.github/workflows/deploy.yml`
  1. `typecheck → test → build`
  2. GitHub Pages 배포
  3. **배포 스모크**: 실제 URL이 HTTP 200 뜨는지 재시도 확인
- **책임:** `main` 그린 유지, PR 검토·머지, 릴리스 태깅, 라이브 URL 테스트
- **원칙:** 레인 1은 새 기능을 만들지 않는다. **들어오는 것을 게이트**한다.

## 레인 2 — Build (지속 개발)

- **작업 브랜치:** `feat/<트랙>-<내용>` (예: `feat/canvas-pin-handles`)
- **트리거:** PR 생성/푸시 → `.github/workflows/ci.yml`
  - `typecheck → test → build` (배포는 안 함)
- **책임:** Wave 1 실작업. 폴더 소유권대로 자기 디렉토리만 수정.
- **흐름:** 브랜치 → 커밋 → PR → CI 그린 → (레인 1이 머지) → 자동 배포

## 브랜치 = 충돌 없는 병렬

| 트랙 | 브랜치 예시 | 폴더 |
|---|---|---|
| Agent A | `feat/canvas-pin-handles` | `src/canvas/` |
| Agent B | `feat/library-seed` | `src/library/` |
| Agent C | `feat/panels-wire-edit` | `src/panels/` |
| Agent D | `feat/export-pdf` | `src/export/` |

각 트랙이 서로 다른 폴더 + 다른 브랜치 → PR이 겹치지 않는다.
공유 계약(`src/types`, `src/store`)은 동결이라 PR에서 건드리면 레인 1이 잡아낸다.

## 최초 1회 세팅 (레포에서)

```bash
git init && git add -A && git commit -m "Wave 0: foundation"
git branch -M main
git remote add origin <레포 URL>
git push -u origin main
```

그다음 GitHub에서: **Settings → Pages → Source = GitHub Actions**.
→ 이 시점에 레인 1이 살아나고 라이브 URL이 생긴다.

## 지속 개발 사이클 (레인 2)

```bash
git switch -c feat/canvas-pin-handles
# src/canvas/ 만 수정
git commit -am "canvas: 핀 핸들 렌더"
git push -u origin feat/canvas-pin-handles
# → PR 열기 → CI 그린 → 머지 → 자동 배포 → 스모크
```

## 로컬에서 지금 바로 테스트

```bash
npm install
npm run dev      # 구현된 데까지 브라우저에서 확인
npm test         # 계약 로직 테스트
```
