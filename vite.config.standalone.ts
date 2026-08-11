/**
 * 단일 HTML 파일 빌드 (더블클릭으로 바로 열리는 미리보기용).
 * - 모든 JS/CSS 인라인
 * - type="module" 대신 클래식 IIFE → file:// 에서도 CORS 없이 실행
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'standalone',
    target: 'es2019',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',          // 클래식 스크립트
        inlineDynamicImports: true,
      },
    },
  },
});
