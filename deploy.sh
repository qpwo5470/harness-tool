#!/usr/bin/env bash
# 하네스 설계 툴 — GitHub Pages 최초 배포 스크립트
# 사용법:  ./deploy.sh <github-레포-URL>
# 예시:    ./deploy.sh https://github.com/내계정/harness-tool.git
set -e

REPO="$1"
if [ -z "$REPO" ]; then
  echo "사용법: ./deploy.sh <github-레포-URL>"
  echo "예시:   ./deploy.sh https://github.com/내계정/harness-tool.git"
  exit 1
fi

echo "▶ 의존성 설치"
# 셸에 NODE_ENV=production 이 걸려 있으면 devDependencies(tsc/vitest/vite)가 통째로 빠진다.
npm install --include=dev

echo "▶ 검증 (타입체크 → 테스트 → 빌드)"
npm run typecheck
npm test
npm run build

echo "▶ git 초기화 및 push"
if [ ! -d .git ]; then
  git init
  git branch -M main
fi
git add -A
git commit -m "하네스 설계 툴: 초기 배포" || echo "(커밋할 변경 없음)"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git push -u origin main

echo ""
echo "✅ push 완료"
echo ""
echo "다음 한 단계만 수동으로 해주세요:"
echo "  GitHub 레포 → Settings → Pages → Source 를 'GitHub Actions' 로 변경"
echo ""
echo "그러면 Actions 탭에서 배포가 자동으로 돌고, 끝나면 URL이 나옵니다."
