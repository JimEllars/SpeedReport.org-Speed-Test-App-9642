import { describeFailure, describePartial, FAILURE_CAUSE } from '../utils/failure';

/**
 * FailureBanner — the single place a visitor is told something went wrong.
 *
 * Two rules it exists to enforce:
 *
 *  1. **Never blame the visitor for our problem, or us for theirs.** Copy comes
 *     from utils/failure.js, which classifies the cause first.
 *  2. **A partial result is not an error.** If the download measured and the
 *     upload stalled, the numbers are real and the report is worth keeping; the
 *     banner says so and does not use the word "unavailable".
 *
 * The deploy hint ("configure VITE_API_BASE") is shown only when it is true.
 */
export default function FailureBanner({ failure, stalledPhase, message }) {
  // stalledPhase alone is enough: a phase that measured nothing is a reportable
  // outcome even when no explicit failure object was produced.
  if (!failure && !message && !stalledPhase) return null;

  // `stalledPhase` is authoritative: useSpeedTest sets it whenever a phase
  // measured nothing, including the case where no stall was detected and the
  // phase simply produced no throughput. Checking `failure` first would let a
  // partial result fall through to "The test could not complete".
  const model = stalledPhase
    ? describePartial(stalledPhase, failure?.reason)
    : failure?.reason
      ? describeFailure(failure.reason)
      : describeFailure(message);

  const isPartial = model.cause === FAILURE_CAUSE.STALLED;

  return (
    <div
      className={`error-banner ${isPartial ? 'error-banner--partial' : ''}`}
      role="alert"
    >
      <strong>{model.title}</strong> {model.body}
      {model.detail && <span className="error-banner__detail"> ({model.detail})</span>}
      {model.showDeployHint && (
        <span className="error-banner__devhint">
          {' '}
          Local development only: run the packaged Worker or set{' '}
          <code>VITE_API_BASE</code>.
        </span>
      )}
    </div>
  );
}
