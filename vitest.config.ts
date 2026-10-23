import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = {
  setupFiles: [resolve(__dirname, 'src/renderer/test/setup.ts')],
  globals: true,
  restoreMocks: true,
  // Both environments run at once, so a cold first render or real password hashing can pass 5 s under load.
  testTimeout: 15_000,
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
