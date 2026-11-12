import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/** Production renderer gets a strict CSP. Dev needs Vite's inline preamble, so the meta is added at build time only. */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: mediastream: cawmera-media:",
    "connect-src 'self' blob: data: cawmera-media:"
  ].join('; ')
  return {
    name: 'cawmera-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`
      )
  }
}

const alias = {
  '@': resolve(__dirname, 'src/renderer/src'),
  '@shared': resolve(__dirname, 'src/shared')
}

export default defineConfig({
  main: { resolve: { alias }, build: { externalizeDeps: { exclude: ['yazl', 'yauzl'] } } },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts')
        }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // The on-screen countdown during a delayed capture.
          overlay: resolve(__dirname, 'src/renderer/overlay.html')
        }
      }
    }
  }
})
