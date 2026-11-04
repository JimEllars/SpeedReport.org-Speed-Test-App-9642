import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // React resolves its production bundle at require time when
    // process.env.NODE_ENV is 'production', and @testing-library's act() throws
    // in that build. Inheriting a production NODE_ENV from the operator's shell
    // therefore turned every hook/component test red for reasons unrelated to
    // the code. Pin it so `npm test` is deterministic in any environment.
    env: { NODE_ENV: 'test' }
  },
})
