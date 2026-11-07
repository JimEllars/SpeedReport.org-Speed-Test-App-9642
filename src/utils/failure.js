/**
 * Failure attribution — turning "something broke" into a message that is true.
 *
 * The app has exactly one error banner, and it used to say the same thing for
 * every failure:
 *
 *   "Edge engine unavailable. <error> Deploy the included Worker or configure
 *    VITE_API_BASE."
 *
 * In production that advice is nonsense. A visitor already on the deployed
 * Worker cannot deploy anything, and a *partial* failure (a stall during upload)
 * is not an unavailable engine. Worse, `useSpeedTest` labels every phase
 * rejection "Edge engine unavailable", so a privacy blocker, an offline moment
 * and a genuinely broken edge all read identically.
 *
 * This module classifies a failure into one of a small set of causes, each with
 * copy a visitor can act on. The deploy hint is only shown when the instruction
 * is actually true — see `isLocalDevelopment()`.
 */

export const FAILURE_CAUSE = Object.freeze({
  /** The browser refused the request before it left — extension, VPN, DNS filter, CSP. */
  BLOCKED: 'blocked',
  /** The device is offline, or its network dropped the connection. */
  OFFLINE: 'offline',
  /** The edge answered, but with an error status. */
  SERVER: 'server',
  /** The request reached the edge but stopped producing throughput. */
  STALLED: 'stalled',
  /** A phase ran out of its time budget on a slow or saturated link. */
  TIMEOUT: 'timeout',
  /** Nothing matched; keep the raw reason visible. */
  UNKNOWN: 'unknown',
});

const COPY = Object.freeze({
  [FAILURE_CAUSE.BLOCKED]: {
    title: 'Your browser blocked the connection.',
    body:
      'A privacy extension, VPN, DNS filter or browser setting stopped the test ' +
      'before it reached our servers. Try a private window with extensions ' +
      'disabled, or a different network.',
  },
  [FAILURE_CAUSE.OFFLINE]: {
    title: 'This device appears to be offline.',
    body: 'Reconnect and start the test again — nothing was measured.',
  },
  [FAILURE_CAUSE.SERVER]: {
    title: 'Our test servers returned an error.',
    body:
      'Your connection reached us, so this is on our side, not yours. ' +
      'Try again in a moment.',
  },
  [FAILURE_CAUSE.STALLED]: {
    title: 'The test stalled part-way through.',
    body:
      'Throughput stopped advancing during this phase, so the number may ' +
      'understate what your connection can do. Usually a brief network dip, a ' +
      'Wi-Fi hiccup, or a saturated link at the moment of testing.',
  },
  [FAILURE_CAUSE.TIMEOUT]: {
    title: 'That phase ran out of time.',
    body:
      'Your link is either slow or congested right now. The phases that did ' +
      'complete are shown below.',
  },
  [FAILURE_CAUSE.UNKNOWN]: {
    title: 'The test could not complete.',
    body: 'Start it again — if it keeps happening, the detail below will help us fix it.',
  },
});

/**
 * True only in a Vite dev build or when an explicit API base is configured, so
 * deploy advice can never reach a visitor in production.
 */
export function isLocalDevelopment() {
  try {
    // `MODE` is 'development' only for a real dev server. `DEV` is true under
    // Vite's *test* mode as well, which would have shown deploy advice in tests
    // and masked a regression that shipped it to visitors.
    if (import.meta?.env?.MODE === 'development') return true;
    if (import.meta?.env?.VITE_API_BASE) return true;
  } catch {
    /* import.meta unavailable in some environments */
  }
  return false;
}

function messageOf(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message ?? error);
}

/** Classify a raw error thrown by a fetch/XHR phase. */
export function classifyFailure(error) {
  const message = messageOf(error).toLowerCase();
  if (!message) return FAILURE_CAUSE.UNKNOWN;

  // An unwanted XHR abort reads as "network error" in Firefox and "failed to
  // fetch" in Chromium. Both mean the request was cut before the edge answered,
  // which is what a blocker or a dropped network looks like from here.
  if (
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('blocked') ||
    message.includes('err_blocked')
  ) {
    // A browser that already knows it is offline gives a better answer than we
    // can infer from the message alone.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return FAILURE_CAUSE.OFFLINE;
    }
    return FAILURE_CAUSE.BLOCKED;
  }

  if (message.includes('offline') || message.includes('internet connection')) {
    return FAILURE_CAUSE.OFFLINE;
  }

  if (
    message.includes('phase timeout') ||
    message.includes('timed out') ||
    message.includes('timeout')
  ) {
    return FAILURE_CAUSE.TIMEOUT;
  }

  if (message.includes('stall')) return FAILURE_CAUSE.STALLED;

  if (
    message.includes('http ') ||
    message.includes('unavailable') ||
    message.includes('rejected') ||
    message.includes('status')
  ) {
    return FAILURE_CAUSE.SERVER;
  }

  return FAILURE_CAUSE.UNKNOWN;
}

/**
 * Build the banner model the UI renders.
 *
 * `detail` is only surfaced when it adds information the cause copy does not
 * already convey (an HTTP status, an unrecognised message), so a visitor is never
 * asked to interpret a stack trace and never shown a bare TypeError.
 */
export function describeFailure(error) {
  const cause = classifyFailure(error);
  const copy = COPY[cause] ?? COPY[FAILURE_CAUSE.UNKNOWN];
  const raw = messageOf(error);
  const showDetail = cause === FAILURE_CAUSE.SERVER || cause === FAILURE_CAUSE.UNKNOWN;

  return {
    cause,
    title: copy.title,
    body: copy.body,
    detail: showDetail && raw ? raw : null,
    showDeployHint: isLocalDevelopment(),
  };
}

/**
 * A partial result is not a failure. When one phase measured and another did
 * not, the report is still worth reading and still worth sharing, so the copy
 * has to say that rather than alarm the reader.
 */
export function describePartial(stalledPhase, error) {
  const phaseName =
    stalledPhase === 'upload' ? 'upload' : stalledPhase === 'download' ? 'download' : null;

  if (!phaseName) {
    return { ...describeFailure(error), showDeployHint: false };
  }

  return {
    cause: FAILURE_CAUSE.STALLED,
    title: `The ${phaseName} phase stalled.`,
    body:
      `Every other phase completed, so the results below are real. ` +
      `The ${phaseName} figure may understate your connection's capacity.`,
    detail: null,
    showDeployHint: false,
  };
}
