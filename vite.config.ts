import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**'],
    },
  },
})
