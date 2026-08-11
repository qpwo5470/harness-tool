#!/usr/bin/env bash
# 빌드된 결과물을 로컬에서 바로 보기 (배포 없이)
set -e
cd "$(dirname "$0")"
[ -d dist ] || { echo "▶ 빌드 중..."; npm install && npm run build; }
echo ""
echo "  http://localhost:4173  ← 브라우저에서 열어주세요"
echo "  (종료: Ctrl+C)"
echo ""
cd dist && python3 -m http.server 4173
