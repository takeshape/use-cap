import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      rollupTypes: true,
      tsconfigPath: resolve(__dirname, 'tsconfig.lib.json')
    })
  ],
  envDir: __dirname,
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: mode === 'development' ? ['@cap.js/wasm'] : []
  },
  base: './',
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist'),
    lib: {
      entry: resolve(__dirname, 'lib/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        assetFileNames: 'index.[ext]'
      }
    }
  },
  test: {
    environment: 'jsdom'
  }
}));
