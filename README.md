# 하네스 설계 툴

와이어 하네스의 **배선도 · 접속표(From-To) · 파트리스트(BOM)** 를 브라우저에서 그리는 무료 웹 툴.
설치도 로그인도 없다. 데이터는 내 브라우저와 내가 저장한 JSON 파일에만 있다(서버 없음).

**▶ 바로 쓰기: https://qpwo5470.github.io/harness-tool/**

*English summary is [below](#english).*

- 커넥터를 놓고 핀과 핀을 끌어 이으면 접속표·파트리스트·압착단자 수량이 함께 채워진다
- 하네스 여러 종을 **세트**로 묶어 발주 수량까지 계산 (예: 장비 1대분 = A×1 + B×2 + C×1)
- PDF 도면(제목블록·부품표·커넥터 핀 번호 부록), 접속표/파트리스트 CSV, ZIP 일괄 내보내기
- JST · Molex · 연호 · RJ45 · USB · 러그 · 페룰 · 단자대 등 시드 부품 300여 종 + 핀맵 에디터로 내 부품 정의
- 설계 검증: 끊어진 배선, 같은 핀 중복, 길이 충돌 등 발주 전에 잡을 실수를 알려 준다
- 명령줄(CLI)·JS API 로도 같은 문서를 만들고 PDF 를 낼 수 있다 — 스크립트·AI 에이전트용

## 30초 시작 (웹)

1. [웹 앱](https://qpwo5470.github.io/harness-tool/)을 연다. 처음 열면 **샘플 하네스**가 들어 있다.
   비어 있는 화면이면 가운데의 **샘플 문서 열기** 를 누른다.
2. 상단 **새 문서** → 왼쪽 라이브러리에서 커넥터를 검색(`XH`, `Micro-Fit`, `RJ45`…)해 캔버스로 끌어 놓는다.
3. 한 커넥터의 핀에서 다른 커넥터의 핀으로 끌어 배선한다. 배선을 누르면 오른쪽 **속성** 탭에서
   색 · 굵기(AWG/mm²) · 길이를 정한다.
4. 오른쪽 **접속표 · 파트 · 검증** 탭을 확인하고, 상단 **도번 · Rev** 를 채운다.
5. **PDF 도면** 을 누르면 A4 도면이 내려받아진다.

## 저장 · 불러오기

- 작업은 브라우저(localStorage)에 **자동 저장**된다. 새로고침해도 남지만, 브라우저 데이터를 지우면 사라진다.
- 오래 보관하거나 남에게 넘길 때는 **내보내기 ▾ → JSON 저장 (세트 전체)**. 그 파일 하나에 세트·하네스·
  직접 만든 부품 정의까지 들어 있어 다른 컴퓨터에서 **JSON 불러오기** 로 그대로 재현된다.
- 옛 버전 파일도 불러올 때 고칠 것만 고치고 무엇을 고쳤는지 알려 준다.

## 출력 — PDF · CSV

| 출력 | 위치 | 내용 |
|---|---|---|
| PDF 도면 | 상단 **PDF 도면** | 현재 하네스 1장 — 배선도 · 부품표 · 제목블록, 필요하면 커넥터 핀 번호 부록 |
| 세트 PDF / ZIP | **내보내기 ▾ → 내보내기 설정…** | 도면 목록 + 하네스별 도면 + 접속표·파트리스트 CSV + 문서 JSON, 여러 파일이면 ZIP 하나 |
| 접속표 CSV | 내보내기 ▾ / 접속표 탭 | 네트 · From · To · 색 · 굵기 · 길이 (현장 제작용) |
| 파트리스트 CSV | 내보내기 ▾ | 커넥터 · 압착단자 · 전선 · 케이블 집계 (발주용) |

CSV 는 UTF-8 이다. 엑셀에서 한글이 깨지면 *데이터 → 텍스트/CSV 가져오기* 로 UTF-8 을 지정해 연다.

## 명령줄(CLI) · JS API

GUI 없이 셸·스크립트·AI 에이전트에서 같은 문서(JSON)를 만들고, 검증하고, PDF/CSV 를 낸다.
파일 하나(`harness.mjs`, Node 18+, 의존성 없음)라 받기만 하면 된다.

```bash
curl -fsSLO https://qpwo5470.github.io/harness-tool/harness.mjs && node harness.mjs help
```

**한글 PDF** 는 글자를 캔버스로 그려 넣어야 해서 `@napi-rs/canvas` 가 필요하다. 없으면 멈추지 않고 설치 안내를 출력한다.

```bash
npm i -g @napi-rs/canvas      # 또는 작업 폴더에서 npm i @napi-rs/canvas
# 다른 곳에 깔려 있으면: HARNESS_CANVAS=/경로/node_modules/@napi-rs/canvas
```

### 명령

```
harness help [명령]
harness lib [검색어] [--json]              부품 검색 — 한 줄: id · 짧은이름 · 핀수 · 성별 · 끝단종류
harness new <doc.json> [--name 이름] [--kit] [--pn 세트품번]
harness apply <doc.json> <script.txt | ->  DSL 적용 후 저장. 출력: 바뀐 개수 + 검증 요약 1줄
harness show <doc.json> [-h 하네스]        요약: 하네스 목록 / 커넥터 표 / 배선 표
harness check <doc.json> [-h 하네스]       검증. 한 줄씩 'E|W|I 코드 메시지'. 오류가 있으면 exit 1
harness pdf <doc.json> [-o out.pdf] [-h 하네스] [--layout onepage|sheets]
harness csv <doc.json> [-o 폴더] [-h 하네스]  접속표 · 파트리스트 CSV (웹과 같은 함수)
harness bom <doc.json> [-h 하네스]         부품표 텍스트
```

- `-h` 는 하네스 이름 · letter · 도번 · 순번(1부터) 중 무엇이든. 세트 문서에서 생략하면 전체.
- 출력은 기본이 짧은 텍스트, `--json` 을 붙이면 JSON.
- 저장소를 받았다면 커밋된 `bin/harness.mjs` 를 `node bin/harness.mjs …` 로 실행해도 같다.

### DSL — 10가닥 하네스 예

한 줄에 한 명령, `#` 은 주석, 공백이 든 값은 따옴표.

```text
# demo.txt
harness "센서 케이블 A" no=HW-01 rev=A qty=1     # 하네스 추가/선택 (이후 명령의 대상)
note "10P 스트레이트 1:1. 길이 1600mm."
conn J1 "JST-XH 10P"                             # 부품: id / 짧은이름 / 이름 (모호하면 에러 + 후보)
conn J2 "JST-XH 10P"
wire J1.1-10 J2.1-10 colors=red,black,white,green,yellow,blue,orange,purple,gray,brown awg24 len=1600
```

```bash
node harness.mjs lib xh                 # 부품 이름·id 확인
node harness.mjs new demo.json --name "센서 케이블"
node harness.mjs apply demo.json demo.txt
node harness.mjs check demo.json
node harness.mjs pdf demo.json -o demo.pdf
node harness.mjs csv demo.json -o out/
```

그 밖의 DSL 명령:

```text
set pn=KIT-01 name="장비 1대분" rev=A       # 세트 속성 (--kit 문서)
purchased                                  # 현재 하네스를 구매품으로 표시
conn J3 lib-mf3-43025-10p rot=0 unused=3,4,5 sleeve   # 라이브러리 id 로 지정, 안 쓰는 핀, 슬리브
conn J4 "JST-XH 4P" at=400,120             # 위치 직접 지정 (기본은 선언 순서대로 좌/우 자동 배치)
splice SP1 3                               # 3방향 스플라이스
device D1 "24V PSU" terminals=+24V,GND     # 장치 블록과 단자
wire D1.+24V J1.1 red awg20
wire J1.2 J2.2 white awg22 len=800 stripe=black label=TX signal=TX
del wire J1.1 J2.1 | del conn J1 | del harness "이름"
```

색 이름은 웹과 같은 영문(`red`, `black`, `white` …), 굵기는 `awg22` 또는 `sq0.5`.
CLI 로 만든 JSON 은 웹 앱에서 **JSON 불러오기** 로 그대로 열린다(반대도 같다).

### JS API

번들은 ESM 으로 import 된다. CLI 는 이 함수들 위의 얇은 껍질이다.

```js
import { loadDoc, applyScript, summarize, validateDoc, pdfBytes, csvFiles, searchLib } from './harness.mjs';
```

### Claude 스킬

AI 에이전트(Claude)가 이 CLI 를 적은 토큰으로 쓰도록 정리한 스킬이
[`docs/claude-skill/harness-tool/SKILL.md`](docs/claude-skill/harness-tool/SKILL.md) 에 있다.

## 데이터 원칙 — 모르면 비워 둔다

도면은 그대로 발주서가 된다. 그래서 이 툴은 **그럴듯한 값을 지어내지 않는다.**

- **품번을 만들지 않는다.** 시드 부품에는 데이터시트 원문 값만 넣었다. 확인하지 못한 제조사·품번은
  `미상` 또는 `미정` 으로 비워 두고, PDF·파트리스트에도 그대로 `미상` 이 찍힌다.
  (러그처럼 국내 유통이 규격 호칭으로 통하는 부품은 호칭만 넣고 제조사 품번은 `미정`.)
- **핀 배열을 추측하지 않는다.** 실물·원본 도면으로 확인하지 못한 배열은 비워 두고, 커넥터 핀 번호는
  제조사 도면 캡처(부록)로 확인하게 한다. 성별(암/수)도 자료가 갈리면 비운다 — 틀린 값보다 빈 값이 낫다.
- **자동으로 고치지 않는다.** 끊어진 참조 · 중복 id · 길이 충돌은 검증 탭에 알리기만 한다. 어느 쪽이
  맞는지는 사람만 안다.
- 부품을 직접 정의할 때도 같은 원칙을 권한다: 모르는 칸은 비우고 비고에 근거를 적는다.

> 이 툴의 시드 데이터와 검증은 도움일 뿐이다. 발주 전에는 반드시 제조사 데이터시트로 확인할 것.

## 개발

React 18 + TypeScript(strict) + React Flow(@xyflow/react) + Zustand + jsPDF. 백엔드 없음, GitHub Pages 정적 배포.
Node 22 권장(CI 기준. Node 20 에서는 jsdom 이 로드되지 않아 DOM 테스트가 죽는다).

```bash
git clone https://github.com/qpwo5470/harness-tool.git
cd harness-tool
npm ci --include=dev   # 셸에 NODE_ENV=production 이 걸려 있으면 --include=dev 없이는 tsc 가 안 깔린다
npm run dev            # 개발 서버
```

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입체크 + 프로덕션 빌드(`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | 타입만 검사 (`tsc -b --noEmit`) |
| `npm test` | 유닛 + DOM 렌더 테스트 (vitest) |
| `npm run build:standalone` | 파일 하나짜리 HTML 빌드 (`verify:standalone` 로 점검) |
| `./미리보기.sh` | 빌드 후 http://localhost:4173 에서 열기 |

- `dist/index.html` 을 파일 더블클릭으로 열면 안 된다(ES 모듈 CORS). 위 스크립트나 `npm run dev` 로 연다.
- 배포: `main` 에 push 하면 GitHub Actions 가 typecheck → test → build → Pages → HTTP 200 스모크까지 한다.
  포크해서 쓸 때는 *Settings → Pages → Source* 를 `GitHub Actions` 로 바꾼다(`./deploy.sh <repo-url>` 가 첫 push 를 돕는다).
  `vite.config.ts` 의 `base: './'` 라 `/<repo>/` 경로에서도 동작한다.

### 구조

| 경로 | 내용 |
|---|---|
| `src/types/` | 공유 타입(문서 스키마). 바꾸면 `schemaVersion` ↑ |
| `src/store/` | Zustand 스토어 · 넷리스트(union-find) · 검증 · 불러오기 정규화 · 실행취소 |
| `src/canvas/` | 배선 캔버스 (React Flow, 배선 경로 직접 계산 — 화면과 PDF 가 같은 함수) |
| `src/physical/` | 물리 뷰(구간 · 전장) |
| `src/library/` | 시드 부품 · 분류(`taxonomy.ts` 단일 출처) · 핀맵 에디터 · 내 부품 |
| `src/panels/`, `src/set/`, `src/ui/` | 속성 · 파트 · 검증 패널, 세트 개요, 공용 UI |
| `src/export/` | PDF(벡터) · CSV · ZIP · 내보내기 대화상자 |
| `src/fixtures/` | 샘플 · 시험용 문서 |
| `public/datasheets/` | PDF 부록에 싣는 커넥터 핀 번호 캡처 |

깊은 설계 판단과 환경 함정은 **[docs/인수인계.md](docs/인수인계.md)**, 브라우저에서 손으로 확인할 항목은
**[docs/검증-체크리스트.md](docs/검증-체크리스트.md)** 에 있다.

> ⚠️ **시험이 통과한다고 도면이 맞는 것은 아니다.** 지금까지 잡은 결함의 절반은 시험이 전부 통과하는
> 상태에서 화면·산출물만 틀린 부류였다(PDF 가 화면과 다른 그림, 세트 27개 중 1개만 내려받아짐 등).
> 코드를 고쳤으면 체크리스트를 실제로 눌러 보고 도면·PDF·CSV 를 눈으로 확인하라.

## 라이선스

[MIT](LICENSE) © 2026 진상혁 (qpwo5470)

`public/datasheets/` 의 핀 번호 그림은 각 제조사 자료에서 옮긴 것으로, 그 권리는 각 제조사에 있다.

---

## English

**Harness Design Tool** — a free, browser-only editor for wire-harness drawings: wiring diagram,
from-to (connection) list and parts list / BOM. No install, no account, no server; your work stays in
your browser (autosave) and in JSON files you export. The UI is in Korean.

- **Open:** https://qpwo5470.github.io/harness-tool/ (a sample harness is loaded on first visit;
  on an empty canvas click *샘플 문서 열기* = "open sample").
- **Draw:** drag a connector from the left library onto the canvas, drag pin-to-pin to add wires,
  set color / gauge / length in the right-hand *속성* (properties) tab.
- **Save/load:** *내보내기 ▾ → JSON 저장* saves the whole set (including custom parts); *JSON 불러오기* loads it.
- **Output:** *PDF 도면* (A4 drawing with title block and BOM), from-to and parts-list CSV (UTF-8),
  or a ZIP bundle for a whole set via *내보내기 설정…*.
- **CLI / JS API** (Node 18+, single file):
  `curl -fsSLO https://qpwo5470.github.io/harness-tool/harness.mjs && node harness.mjs help`.
  Commands: `lib`, `new`, `apply` (line-based DSL, see the example above), `show`, `check`, `pdf`, `csv`, `bom`.
  Korean text in PDFs needs `npm i -g @napi-rs/canvas`.
- **Data honesty:** the tool never invents part numbers or pin layouts; unknown values stay `미상`
  ("unknown") and show up as such on the drawing. Always verify against the manufacturer's datasheet before ordering.
- **License:** MIT.
