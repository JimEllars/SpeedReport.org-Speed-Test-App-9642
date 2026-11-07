import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to the cheap environment. jsdom costs ~29s of module loading per
    // test file on a loaded host, and vitest's pool start timeout is a hardcoded
    // 60s in 5.0.3 - with every file paying that cost, a worker intermittently
    // failed to start at all and its file was silently not run
    // ("Failed to start forks worker", 95/95 tests reported while
    // tests/speedGauge.test.jsx never executed).
    //
    // Files that genuinely need a DOM opt in with a docblock on their first
    // line, so the cost is paid only where the assertions need it:
    //   // @vitest-environment jsdom
    // Currently that is speedGauge, useSpeedTest, useSpeedTestStall,
    // telemetry (localStorage/sendBeacon) and vault (localStorage).
    environment: 'node',
    // React resolves its production bundle at require time when
    // process.env.NODE_ENV is 'production', and @testing-library's act() throws
    // in that build. Inheriting a production NODE_ENV from the operator's shell
    // therefore turned every hook/component test red for reasons unrelated to
    // the code. Pin it so `npm test` is deterministic in any environment.
    env: { NODE_ENV: 'test' }
  },
})
