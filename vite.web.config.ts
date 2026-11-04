import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Browser build of the same renderer: one self-contained HTML file.
 * Without the Electron bridge it falls back to web APIs (getDisplayMedia, downloads, async clipboard).
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true },
  server: { port: 5181, strictPort: true }
})
