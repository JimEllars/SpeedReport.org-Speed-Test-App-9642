/**
 * Provider catalog — the routing brain for SpeedReport's lead engine.
 *
 * Two independent questions are answered here, and conflating them is the bug
 * that poisons lead quality:
 *
 *   1. `classifyProvider()` — what technology is *already* on the wire at the
 *      visitor's address, inferred from the ISP they tested on. This is an
 *      inference from a name plus measured speed, so it is an estimate.
 *
 *   2. `lookupCoverage()` — whether a sellable program (today: via DSI Systems)
 *      is *known* to serve the visitor's ZIP. Until a real serviceability feed
 *      is wired in, this answers `unknown`, never `covered`.
 *
 * A lead is only ever routed to a program when 2 returns `covered`. An
 * unverified ZIP is not a lead worth paying for by anyone, and routing it is how
 * a dealer program starts issuing chargebacks.
 *
 * WHITE-LABEL RULE: no AXiM branding, no AXiM URLs, no partner commission
 * figures may leak into anything a visitor sees. This module is internal
 * routing logic; its output is consumed by deal cards that carry a partner
 * brand or no brand at all. See AXiM-CONNECTED-STRATEGY.md.
 */

/**
 * Seed footprint by state. NOT a serviceability feed: Kinetic (Uniti) is
 * publicly stated as an 18-state fiber build, and these are the states where
 * AXiM has seen or expects an address-level match. Every entry starts
 * unverified on purpose — a state match is a hypothesis, not an offer.
 */
export const SEED_FOOTPRINTS = {
  kinetic: {
    programId: 'kinetic',
    brand: 'Kinetic',
    verified: false,
    states: [
      'AL', 'AR', 'FL', 'GA', 'IA', 'IN', 'KS', 'KY', 'LA',
      'MO', 'MS', 'NC', 'NE', 'NY', 'OH', 'OK', 'PA', 'TX',
    ],
  },
};

/**
 * Programs a visitor can be offered, in display order. `maxServices` is the
 * number of distinct services a single order can carry — the basis of DSI's
 * "up to $1,500 when bundled" claim, so it drives the bundle nudge.
 */
export const PROGRAMS = {
  kinetic: {
    id: 'kinetic',
    brand: 'Kinetic',
    services: ['internet', 'voice', 'secure'],
    maxServices: 3,
    transport: 'fiber',
    exclusiveWith: ['att-fiber'],
  },
  'att-fiber': {
    id: 'att-fiber',
    brand: 'AT&T Fiber',
    services: ['internet', 'wireless', 'video'],
    maxServices: 3,
    transport: 'fiber',
    exclusiveWith: ['kinetic'],
  },
  cable_upgrade: {
    id: 'cable_upgrade',
    brand: null, // partner-agnostic deal card; resolved at routing time
    services: ['internet'],
    maxServices: 1,
    transport: 'cable',
    exclusiveWith: [],
  },
  home_security: {
    id: 'home_security',
    brand: 'Vivint',
    services: ['security'],
    maxServices: 1,
    transport: 'add-on',
    exclusiveWith: [],
  },
};

/**
 * Name fragments that identify a provider's technology, checked in order.
 * Deliberately lowercase substrings — carrier naming is inconsistent
 * ("AT&T Internet" vs "AT&T Fiber", "Comcast Cable" vs "Xfinity").
 */
const FIBER_MARKERS = ['fiber', 'fios', 'kinetic fiber', 'att fiber', 'frontier fiber'];
const CABLE_MARKERS = [
  'comcast', 'xfinity', 'spectrum', 'charter', 'cox', 'cable', 'optimum',
  'altice', 'mediacom', 'armsrong', 'armstrong', 'wow', 'breezeline', 'astound',
];
const DSL_MARKERS = ['dsl', 'centurylink', 'frontier', 'windstream', 'at&t internet', 'att internet'];
const SATELLITE_MARKERS = ['starlink', 'hughes', 'hughesnet', 'viasat', 'dish', 'wildblue'];
const FIXED_WIRELESS_MARKERS = ['t-mobile', 'tmobile', 'verizon 5g', 'us cellular', 'cellular', 'fixed wireless', 'towerstream'];
const MUNI_MARKERS = ['municipal', 'city of', 'community broadband', 'gigafy', 'utopia'];

export const PROVIDER_TIERS = Object.freeze({
  FIBER: 'FIBER',
  CABLE: 'CABLE',
  DSL: 'DSL',
  SATELLITE: 'SATELLITE',
  FIXED_WIRELESS: 'FIXED_WIRELESS',
  MUNI: 'MUNI',
  UNKNOWN: 'UNKNOWN',
});

function firstMatch(haystack, markers) {
  return markers.find((marker) => haystack.includes(marker)) || null;
}

/**
 * Infer the technology a visitor is currently on.
 *
 * `measured` is optional and used only as a corroborating signal: a link that
 * measures >500 down and >400 up is symmetrical fiber regardless of what the
 * ISP name says. Speed is never allowed to *override* a named tier — a cable
 * provider delivering 900/35 is still cable, and that asymmetry is the entire
 * commercial argument.
 */
export function classifyProvider({ isp, asOrganization, measured } = {}) {
  const raw = `${isp ?? ''} ${asOrganization ?? ''}`.trim().toLowerCase();
  const matchedOn = raw
    ? (firstMatch(raw, MUNI_MARKERS) ? 'muni'
      : firstMatch(raw, FIBER_MARKERS) ? 'fiber'
      : firstMatch(raw, CABLE_MARKERS) ? 'cable'
      : firstMatch(raw, SATELLITE_MARKERS) ? 'satellite'
      : firstMatch(raw, DSL_MARKERS) ? 'dsl'
      : firstMatch(raw, FIXED_WIRELESS_MARKERS) ? 'fixed-wireless'
      : null)
    : null;

  const download = Number(measured?.downloadMbps);
  const upload = Number(measured?.uploadMbps);
  const hasMeasurement = Number.isFinite(download) && Number.isFinite(upload) && download > 0;
  const symmetricalFiber = hasMeasurement && download > 500 && upload > 400;

  const tierByMarker = {
    muni: PROVIDER_TIERS.MUNI,
    fiber: PROVIDER_TIERS.FIBER,
    cable: PROVIDER_TIERS.CABLE,
    satellite: PROVIDER_TIERS.SATELLITE,
    dsl: PROVIDER_TIERS.DSL,
    'fixed-wireless': PROVIDER_TIERS.FIXED_WIRELESS,
  };

  if (matchedOn) {
    return {
      tier: tierByMarker[matchedOn],
      basis: 'name',
      marker: matchedOn,
      symmetrical: symmetricalFiber,
      asymmetryRatio: hasMeasurement && download > 0 ? upload / download : null,
    };
  }

  return {
    tier: symmetricalFiber ? PROVIDER_TIERS.FIBER : PROVIDER_TIERS.UNKNOWN,
    basis: symmetricalFiber ? 'measurement' : 'none',
    marker: symmetricalFiber ? 'symmetrical-throughput' : null,
    symmetrical: symmetricalFiber,
    asymmetryRatio: hasMeasurement && download > 0 ? upload / download : null,
  };
}

const COVERAGE = Object.freeze({
  COVERED: 'covered',
  KNOWN_ABSENT: 'known_absent',
  UNKNOWN: 'unknown',
  UNRESOLVED_ZIP: 'unresolved_zip',
});

export { COVERAGE };

/**
 * Resolve a program's coverage for a ZIP.
 *
 * `serviceability` is the seam the platform operator fills with a real feed:
 *   { [zip]: { [programId]: 'covered' | 'known_absent' } }
 *
 * Absent a feed entry, coverage is `unknown` — never `covered`. This default is
 * the load-bearing safety property of the whole engine: with no feed configured,
 * SpeedReport degrades to a zero-payout utility rather than shipping unverified
 * leads into a program that charges back for them.
 */
export function lookupCoverage({ postalCode, programId, serviceability = null } = {}) {
  const zip = String(postalCode ?? '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return { zip, status: COVERAGE.UNRESOLVED_ZIP, programId, source: 'none' };
  }

  const programFootprint = serviceability?.[zip]?.[programId];
  if (programFootprint === COVERAGE.COVERED || programFootprint === COVERAGE.KNOWN_ABSENT) {
    return { zip, status: programFootprint, programId, source: 'feed' };
  }

  const seed = Object.values(SEED_FOOTPRINTS).find((entry) => entry.programId === programId);
  const state = stateFromZip(zip, serviceability?.__stateByZip);
  if (seed?.states?.includes(state)) {
    return { zip, status: COVERAGE.UNKNOWN, programId, source: 'seed-state', state };
  }

  return { zip, status: COVERAGE.UNKNOWN, programId, source: 'none', state };
}

/**
 * A ZIP-to-state table is required for any real footprint check and is far too
 * large to embed here. Until a feed supplies `__stateByZip`, the state is
 * unknown and coverage stays unknown — see lookupCoverage.
 */
function stateFromZip(zip, stateByZip) {
  if (!stateByZip) return null;
  return stateByZip[zip] ?? null;
}
