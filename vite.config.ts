import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [react(), dts()],
  root: resolve(__dirname, './app'),
  envDir: __dirname,
  build: {
    outDir: resolve(__dirname, './dist'),
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'use-cap',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format}.js`
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        assetFileNames: 'index.[ext]'
      }
    }
  }
});
