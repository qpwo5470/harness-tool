import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' → GitHub Pages 프로젝트 사이트(/reponame/)에서도 상대경로로 동작
export default defineConfig({
  plugins: [react()],
  base: './',
});
