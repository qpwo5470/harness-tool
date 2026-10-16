---
name: harness-tool
description: 와이어 하네스 도면을 만들거나 고칠 때 사용 — 하네스 도면, 배선도, 접속표(From-To), 파트리스트/BOM, 커넥터 핀 결선, 하네스 세트 발주 수량, 하네스 PDF/CSV 출력. "하네스 그려줘", "접속표 만들어", "이 커넥터끼리 1:1 배선", "harness drawing", "wire harness BOM" 같은 요청에 트리거. 하네스툴 CLI(harness.mjs)를 적은 토큰으로 쓰는 법과 품번을 지어내지 않는 규칙을 담는다.
---

# 하네스툴 CLI 로 하네스 설계하기

웹 앱(https://qpwo5470.github.io/harness-tool/)과 같은 문서(JSON)를 셸에서 만든다.
결과 JSON 은 사용자가 웹 앱의 **JSON 불러오기** 로 그대로 열 수 있다.

## 1. CLI 준비 — 한 번 받고 재사용

```bash
H=~/.cache/harness-tool/harness.mjs
[ -f "$H" ] || { mkdir -p ~/.cache/harness-tool && curl -fsSL -o "$H" https://qpwo5470.github.io/harness-tool/harness.mjs; }
node "$H" help            # 처음 한 번만. 세부는 node "$H" help <명령>
```

- Node 18+ 필요, 의존성 없음. 매 작업마다 다시 받지 말 것.
- 한글 PDF 는 `@napi-rs/canvas` 필요. `pdf` 가 설치 안내를 출력하면 `npm i -g @napi-rs/canvas`
  (또는 `HARNESS_CANVAS=<경로>`)로 해결하고 다시 실행.

## 2. 작업 순서

1. **부품 찾기** — `node "$H" lib <검색어>` (예: `xh 10`, `micro-fit`, `rj45`, `링 러그`).
   한 줄 = `id · 짧은이름 · 핀수 · 성별 · 끝단종류`. 결과의 id 나 짧은이름을 DSL 에 그대로 쓴다.
2. **문서 만들기** — `node "$H" new doc.json --name "이름"` (여러 하네스를 묶는 세트면 `--kit --pn 세트품번`).
3. **DSL 스크립트 작성** — 필요한 명령을 한 파일(또는 heredoc)에 모은다.
4. **적용** — `node "$H" apply doc.json script.txt` (또는 `- <<'EOF' … EOF`).
   출력은 바뀐 개수 + 검증 요약 1줄. 이것만 보고 다음으로 간다.
5. **검증** — `node "$H" check doc.json`. `E` 줄이 있으면 고친 DSL 을 다시 apply. exit 1 = 오류 있음.
6. **확인이 필요할 때만** — `node "$H" show doc.json [-h A]` (커넥터 표 / 배선 표).
7. **출력** — `node "$H" pdf doc.json -o out.pdf`, `node "$H" csv doc.json -o out/`, `node "$H" bom doc.json`.

## 3. DSL 요약

한 줄 한 명령, `#` 주석, 공백 든 값은 따옴표.

```text
set pn=KIT-01 name="장비 1대분" rev=A          # 세트 속성 (--kit 문서)
harness "센서 케이블 A" no=HW-01 rev=A qty=1    # 하네스 추가/선택 → 이후 명령의 대상
note "10P 스트레이트 1:1."                      # 비고
purchased                                       # 구매품 표시
conn J1 "JST-XH 10P"                            # id / 짧은이름 / 이름. 모호하면 에러+후보
conn J2 lib-mf3-43025-10p rot=0 unused=3,4,5 sleeve
splice SP1 3
device D1 "24V PSU" terminals=+24V,GND
wire J1.1 J2.1 red awg22 len=1600 stripe=white label=TX signal=TX
wire J1.1-10 J2.1-10 colors=red,black,white,green,yellow,blue,orange,purple,gray,brown awg24 len=1600
wire D1.+24V J1.1 red awg20
term J1 "SXH-001T-P0.6"                         # 단자 지정 (J1.1-3 처럼 핀 범위도, - 는 해제)
layout                                          # 현재 하네스 자동 배치 다시
del wire J1.1 J2.1 | del conn J1 | del harness "이름"
```

- ref 는 앱 규칙대로 커넥터 J1·J2…, 스플라이스 SP1…, 장치 D1… 를 **선언 순서대로** 쓴다(W1 같은 임의 ref 불가).
  납처리 전선단·배럴잭도 커넥터라 J 번호다.
- 같은 스크립트를 다시 apply 하면 **덮어쓴다**(같은 이름 하네스·같은 ref·같은 두 핀 배선은 수정).
- 한 줄이라도 틀리면 **아무것도 저장하지 않고** 줄 번호와 함께 오류를 낸다. `--dry-run` 으로 미리 확인.
- 단자는 하우징 스펙이 맞는 컨택트를 하나로 정해 줄 때만 자동 지정되고 `note:` 줄로 알린다.

- 위치는 자동 배치(선언 순서대로 좌/우 열). 필요할 때만 `at=x,y`.
- 색은 영문(red, black, white, green, yellow, blue, orange, brown, purple, gray, pink…).
  굵기 `awg22` 또는 `sq0.5`. 길이는 mm.

## 4. 토큰 아끼는 규칙

- **문서 JSON 을 절대 cat/Read 하지 말 것.** 수백~수천 줄이다. 상태는 `show` / `check` 로 본다.
- `show` 는 하네스 하나로 좁힌다(`-h A`, `-h HW-01`, `-h 2`). 세트 전체 show 는 정말 필요할 때만.
- `--json` 은 결과를 **프로그램으로 파싱할 때만**. 사람이 읽을 거면 기본 텍스트가 짧다.
- **DSL 은 모아서 한 번에 apply.** 줄마다 apply 하지 말 것.
- **범위 축약을 쓴다** — `wire J1.1-10 J2.1-10 colors=…` 한 줄이 10줄을 대신한다.
- `lib` 검색어는 구체적으로(`xh 10p` > `jst`). 결과가 많으면 검색어를 좁혀 다시.
- apply 출력의 검증 요약이 깨끗하면 `check` 전문을 다시 볼 필요 없다.
- 성공한 명령의 출력을 사용자에게 다시 붙여 넣지 말고 요점만 전한다.

## 5. 데이터 정직 규칙 (반드시)

도면은 그대로 발주서가 된다.

- **품번(MPN)·제조사를 지어내지 않는다.** `lib` 에 있는 부품을 쓰고, 없으면 사용자에게 묻는다.
  모르는 값은 `미상` 으로 둔다. "아마 이것" 으로 채우지 않는다.
- **핀 배열·핀 번호·신호 배정을 추측하지 않는다.** 사용자가 준 자료(데이터시트, 기존 도면, 표)에
  있는 것만 쓴다. 근거가 없으면 묻거나 비고에 "확인 필요" 를 남긴다.
- 전선 색·길이·굵기도 사용자가 정하지 않았으면 임의 값임을 밝힌다(비고나 답변에).
- `check` 의 경고를 숨기거나 억지로 없애지 않는다. 남은 경고는 사용자에게 그대로 알린다.
- 라이브러리에 없는 부품이 필요하면: 웹 앱의 핀맵 에디터로 정의하도록 안내하거나, 사용자가 준
  사양을 그대로 옮긴다. 데이터시트를 본 척하지 않는다.

## 6. PDF 확인 — 한 쪽만, 낮은 해상도로

PDF 전체를 읽지 말고 필요한 면 하나만 이미지로 본다.

```bash
pdfinfo out.pdf | grep Pages                         # 쪽수
pdftoppm -f 1 -l 1 -r 60 -png out.pdf /tmp/hz-p      # 1쪽만 60dpi → /tmp/hz-p-1.png
```

- 글자를 읽어야 하면 해당 영역만 `-r 100` 정도로. 150dpi 이상은 거의 필요 없다.
- 한글 글자는 이미지로 들어가 `pdftotext` 로는 안 보인다(영문·숫자만 나온다). 내용 확인은 `show`·`check` 로.
- 한글이 네모(□)로 나오면 `@napi-rs/canvas` 가 없는 것 — 위 1절 참고.

## 7. 사용자에게 넘길 때

- 만든 파일 경로(doc.json · PDF · CSV)와 `check` 결과(오류/경고 개수, 남은 경고 요지)를 짧게.
- `미상` 으로 남긴 항목과 확인이 필요한 가정을 목록으로.
- "웹 앱에서 열려면: https://qpwo5470.github.io/harness-tool/ → 내보내기 ▾ → JSON 불러오기".
