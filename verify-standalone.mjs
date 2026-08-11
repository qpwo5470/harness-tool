import { readFileSync } from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('standalone/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///C:/harness/index.html',
  virtualConsole: vc,
  beforeParse(w) {
    w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    w.DOMMatrixReadOnly = class { constructor(){ this.m22 = 1; } };
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){},
      addEventListener(){}, removeEventListener(){} });
  },
});

await new Promise((r) => setTimeout(r, 2500));
const doc = dom.window.document;
const root = doc.getElementById('root');

console.log('=== file:// 환경 실행 검증 ===');
console.log('앱 마운트:', root && root.children.length > 0 ? '✅ 성공' : '❌ 실패');

// 실제 UI 요소로 확인 (스크립트 텍스트 오탐 방지)
const q = (sel) => doc.querySelectorAll(sel).length;
const btnTexts = [...doc.querySelectorAll('button')].map((b) => b.textContent.trim());

console.log('');
console.log('렌더된 UI 구조:');
console.log('  상단바      :', q('.topbar') ? '✅' : '❌');
console.log('  라이브러리  :', q('.lib') ? '✅' : '❌');
console.log('  캔버스      :', q('.canvas-area') ? '✅' : '❌');
console.log('  우측 탭     :', q('.tabs') ? '✅' : '❌');
console.log('  부품 버튼   :', q('.lib-item'), '개');
console.log('');
console.log('주요 버튼:', btnTexts.filter((t) => t && t.length < 15).slice(0, 12).join(' / '));

const realErrors = errors.filter((e) => !e.includes('getContext'));
console.log('');
console.log(realErrors.length ? '⚠ 에러:\n  ' + realErrors.slice(0,3).join('\n  ').slice(0,300)
                               : '✅ 실행 에러 없음 (canvas 미구현 경고는 jsdom 한계로 무시)');
