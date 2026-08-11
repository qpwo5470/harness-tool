/**
 * 단일 HTML 빌드 후처리 (문자열 인덱스 기반 — 정규식으로 본문을 훼손하지 않음).
 * 1) type="module" 제거 → file:// 에서 CORS 없이 실행
 * 2) 스크립트를 </body> 직전으로 이동 → #root 존재 후 실행
 */
import { readFileSync, writeFileSync } from 'fs';

const p = 'standalone/index.html';
let html = readFileSync(p, 'utf8');

// --- 1) 여는 태그를 찾아 module 속성 제거 ---
const openStart = html.indexOf('<script');
if (openStart < 0) throw new Error('script 태그를 찾지 못했습니다');
const openEnd = html.indexOf('>', openStart) + 1;   // 여는 태그의 끝
const openTag = html.slice(openStart, openEnd);

// --- 2) 그에 대응하는 닫는 태그 위치 (마지막 </script>) ---
const closeStart = html.lastIndexOf('</script>');
if (closeStart < 0 || closeStart < openEnd) throw new Error('</script>를 찾지 못했습니다');
const closeEnd = closeStart + '</script>'.length;

const body = html.slice(openEnd, closeStart);        // JS 본문 (그대로 보존)
const block = `<script>${body}</script>`;

// --- 3) 원래 자리에서 제거하고 </body> 앞에 삽입 ---
const before = html.slice(0, openStart);
const after = html.slice(closeEnd);
let out = before + after;

const bodyClose = out.lastIndexOf('</body>');
if (bodyClose < 0) throw new Error('</body>를 찾지 못했습니다');
out = out.slice(0, bodyClose) + block + '\n  ' + out.slice(bodyClose);

writeFileSync(p, out);

// --- 검증 ---
// head/body 구조상 실제 태그만 확인 (JS 문자열 안의 리터럴은 제외).
// 삽입한 블록이 정확히 </body> 앞에 1개 존재하는지로 판정한다.
const tagOk = out.includes('<script>') && out.trimEnd().endsWith('</html>')
  && out.indexOf('</script>\n  </body>') > 0;
const rootIdx = out.indexOf('<div id="root">');
const scriptIdx = out.indexOf('<script');

console.log(`✅ 단일 파일: ${p} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`   원래 태그      : ${openTag.slice(0, 60)}`);
console.log(`   태그 구조      : ${tagOk ? '정상 ✅' : '확인 필요 ❌'}`);
console.log(`   module 제거    : ${!/type="module"/.test(out) ? '✅' : '❌'}`);
console.log(`   실행 위치      : ${scriptIdx > rootIdx ? 'root 뒤 ✅' : 'root 앞 ❌'}`);
console.log(`   JS 본문 보존   : ${body.length.toLocaleString()} 자`);
