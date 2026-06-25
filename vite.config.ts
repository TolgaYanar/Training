/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['vitest/**/*.test.{ts,tsx}'],
    setupFiles: ['vitest-canvas-mock', './vitest/setup.ts'],
    server: { deps: { inline: ['vitest-canvas-mock'] } },
  },
})
