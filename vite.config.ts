import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
})
