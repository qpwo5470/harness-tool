import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 셸에 NODE_ENV=production 이 걸려 있으면 vite 가 React 프로덕션 빌드를 물어오고,
// testing-library 의 act() 가 "not supported in production builds" 로 전부 실패한다.
// 플러그인 생성(react()) 전에 test 로 고정한다.
process.env.NODE_ENV = 'test';

export default defineConfig({
  plugins: [react()],
  test: {
    // 기본은 node, DOM이 필요한 테스트는 파일 상단 주석으로 jsdom 지정
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/**/*.dom.test.tsx', 'jsdom']],
  },
});
