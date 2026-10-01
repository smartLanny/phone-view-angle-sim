import { defineConfig } from 'vite';

// npm run dev           独立开发页（index.html → src/dev.ts）
// npm run build:web     打包成普通脚本，输出到现有网页目录（WEB_DIR，默认 ../web）
export default defineConfig(({ mode }) => mode === 'web'
  ? {
    build: {
      target: 'es2020',
      outDir: process.env.WEB_DIR || '../web',
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      lib: { entry: 'src/embed.ts', formats: ['iife'], name: 'Scene3DBundle', fileName: () => 'scene3d.js' },
    },
  }
  : {
    base: './',
    server: { port: 5199, host: '127.0.0.1' },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  });
