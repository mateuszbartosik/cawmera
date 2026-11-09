import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'bench'),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out-bench'),
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: { input: resolve(__dirname, 'bench/export.html') }
  }
})
