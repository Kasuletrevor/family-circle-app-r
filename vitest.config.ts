import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(__dirname, 'src/renderer/test/setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    restoreMocks: true,
  },
})
