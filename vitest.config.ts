import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: { include: ['test/**/*.test.ts'], exclude: ['**/*.perf.test.ts', '**/node_modules/**'], environment: 'node' }
})
