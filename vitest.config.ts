import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = {
  setupFiles: [resolve(__dirname, 'src/renderer/test/setup.ts')],
  globals: true,
  restoreMocks: true,
}

export default defineConfig({
  plugins: [react()],
  test: {
    // Main-process code runs in Node, so its tests do too; Vite will not load node:sqlite in a browser environment.
    projects: [
      { extends: true, test: { ...shared, name: 'node', environment: 'node', include: ['src/main/**/*.test.{ts,tsx}'] } },
      { extends: true, test: { ...shared, name: 'jsdom', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], exclude: ['src/main/**'] } },
    ],
  },
})
