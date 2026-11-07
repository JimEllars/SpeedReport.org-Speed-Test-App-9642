import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
// jest-dom matchers are not registered globally in this project (no setupFiles),
// so opt in here rather than writing assertions that only pass in one runner.
import '@testing-library/jest-dom/vitest';
import FailureBanner from '../src/components/FailureBanner';

// @testing-library/react only auto-cleans when the test globals are enabled, and
// this suite imports explicitly. Without this, every case renders into a shared
// body and getByRole finds the previous case's banner too.
afterEach(cleanup);

describe('FailureBanner', () => {
  it('renders nothing when there is no failure and no message', () => {
    const { container } = render(<FailureBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prefers the stalled phase over a generic failure reason', () => {
    // The real-world shape: useSpeedTest sets stalledPhase when a phase measured
    // nothing, and also sets a generic `failure.reason` of "Partial completion".
    // Reading failure first produced "The test could not complete" over a report
    // that contained a perfectly good download figure.
    render(
      <FailureBanner
        failure={{ phase: null, reason: 'Partial completion' }}
        stalledPhase="download"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The download phase stalled.');
    expect(screen.getByRole('alert')).toHaveTextContent('Every other phase completed');
    expect(screen.getByRole('alert').textContent).not.toMatch(/could not complete/i);
  });

  it('uses the partial style so it reads as a caveat, not a fault', () => {
    render(<FailureBanner stalledPhase="upload" />);
    expect(screen.getByRole('alert').className).toContain('error-banner--partial');
  });

  it('falls back to classifying the raw message when no failure object is present', () => {
    render(<FailureBanner message="Failed to fetch" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your browser blocked the connection.');
    expect(alert.textContent).not.toMatch(/deploy/i);
    expect(alert.className).not.toContain('--partial');
  });

  it('surfaces the HTTP status for a server-side rejection', () => {
    render(<FailureBanner failure={{ reason: new Error('Upload endpoint rejected payload (HTTP 501)') }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('501');
  });

  it('never renders deploy advice in a production build', () => {
    render(<FailureBanner message="Failed to fetch" />);
    const text = screen.getByRole('alert').textContent;
    expect(text).not.toMatch(/VITE_API_BASE/);
    expect(text).not.toMatch(/included Worker/i);
  });
});
