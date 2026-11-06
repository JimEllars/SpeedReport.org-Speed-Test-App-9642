/**
 * Lead engine — turns a completed test into an actionable, *honest* commercial
 * decision: is there a sellable upgrade here, how warm is it, and which single
 * offer should be shown?
 *
 * Design constraints, in priority order:
 *
 *   1. Never claim coverage we cannot prove. Coverage comes from
 *      `lookupCoverage()`; this module refuses to route on anything but
 *      `covered`. An unverified ZIP yields a `resolve_coverage` next step, not a
 *      deal card.
 *   2. Never show a competitor's offer to someone already on that provider's
 *      fiber. Selling AT&T Fiber to an AT&T Fiber subscriber is how a program
 *      voids a sale and, repeated, terminates a dealer.
 *   3. Never degrade the neutral instrument. The speed test stays free, ad-free
 *      and unbranded; monetisation is a card *after* the reading, and it is
 *      silent when there is nothing truthful to say.
 *
 * Everything here is pure. No network, no storage, no clock reads beyond the
 * report it is handed — which is what makes it testable and what keeps the
 * routing decision auditable later in the Core ledger.
 */

import {
  COVERAGE,
  PROVIDER_TIERS,
  classifyProvider,
  lookupCoverage,
} from './providerCatalog';

export const DEAL_TYPES = Object.freeze({
  FIBER_UPGRADE: 'fiber_upgrade',
  CABLE_RESCUE: 'cable_rescue',
  SECURITY_ADDON: 'security_addon',
  DIAGNOSTIC: 'diagnostic',
  RESOLVE_COVERAGE: 'resolve_coverage',
});

/**
 * Audience is inferred, never asked. SpeedReport is a universal speed test: the
 * page must not ask a home user whether they are "a business", and the lead
 * engine must not gate a legitimate household lead behind a commercial tier.
 *
 * `COMMERCIAL` is a *scoring hint*, not a segment: it raises the urgency of an
 * upgrade because an SLA-bearing contract, remote staff and support expectations
 * make a degraded link costlier. The default is `UNIVERSAL`, and both audiences
 * route through exactly the same coverage and payable gates.
 */
export const AUDIENCES = Object.freeze({
  UNIVERSAL: 'universal',
  COMMERCIAL: 'commercial',
});

/**
 * Contact quality tiers, highest first. This is the only place a lead's
 * economic value is expressed, because a name + email + verified address is
 * routable and an email alone is not.
 */
export const QUALITY_TIERS = Object.freeze({
  ROUTABLE: 'routable',       // name + email + serviceable ZIP, consent on record
  CONTACTABLE: 'contactable', // email + ZIP, no name, or coverage unverified
  ANONYMOUS: 'anonymous',     // usage signal only; no contact path
});

// Signal thresholds. Kept as named constants so a partner's qualifying rules
// can be argued against them explicitly rather than buried in branches.
export const SIGNAL_THRESHOLDS = Object.freeze({
  BUFFERBLOAT_BAD: ['C', 'D', 'F'],
  LATENCY_SLOW_MS: 45,
  UNDERPERFORM_RATIO: 0.6, // measured < 60% of what the visitor says they pay for
  ASYMMETRY_SEVERE: 0.2,   // upload < 20% of download on a >100 Mbps link
  STALE_FIBER_TIER: 300,   // below this on a "fiber" provider is a real gap
});

const SCORE_WEIGHTS = Object.freeze({
  legacyTransport: 30,
  severeAsymmetry: 25,
  badBufferbloat: 20,
  slowLatency: 15,
  underperformingPlan: 25,
  commercialAudience: 10,
  fiberGap: 10,
});

/**
 * Map raw metrics/meta into the score shape the rest of the engine uses, keeping
 * each contributing reason so the card copy and the Core ledger can justify the
 * number rather than assert it.
 */
export function scoreOpportunity({ metrics = {}, meta = {}, audience = AUDIENCES.UNIVERSAL, subscribedPlan } = {}) {
  const measured = {
    downloadMbps: Number(metrics.download) || 0,
    uploadMbps: Number(metrics.upload) || 0,
    latencyMs: Number(metrics.ping) || 0,
    bufferbloatGrade: metrics.bufferbloat ?? 'unknown',
  };

  const provider = classifyProvider({
    isp: meta.isp,
    asOrganization: meta.asOrganization,
    measured,
  });

  const reasons = [];
  let score = 10;

  const legacyTier =
    provider.tier !== PROVIDER_TIERS.FIBER && provider.tier !== PROVIDER_TIERS.MUNI;
  if (legacyTier) {
    score += SCORE_WEIGHTS.legacyTransport;
    reasons.push(`${provider.tier.toLowerCase()} transport (${meta.isp || 'unidentified ISP'})`);
  }

  if (
    measured.downloadMbps > 100 &&
    measured.uploadMbps < measured.downloadMbps * SIGNAL_THRESHOLDS.ASYMMETRY_SEVERE
  ) {
    score += SCORE_WEIGHTS.severeAsymmetry;
    reasons.push(
      `asymmetric upload, ${measured.uploadMbps.toFixed(1)} up vs ${measured.downloadMbps.toFixed(1)} down`,
    );
  }

  if (SIGNAL_THRESHOLDS.BUFFERBLOAT_BAD.includes(measured.bufferbloatGrade)) {
    score += SCORE_WEIGHTS.badBufferbloat;
    reasons.push(`bufferbloat grade ${measured.bufferbloatGrade}`);
  }

  if (measured.latencyMs > SIGNAL_THRESHOLDS.LATENCY_SLOW_MS) {
    score += SCORE_WEIGHTS.slowLatency;
    reasons.push(`idle latency ${measured.latencyMs.toFixed(1)} ms`);
  }

  const plan = parsePlan(subscribedPlan);
  if (plan && measured.downloadMbps > 0) {
    const ratio = measured.downloadMbps / plan.download;
    if (ratio < SIGNAL_THRESHOLDS.UNDERPERFORM_RATIO) {
      score += SCORE_WEIGHTS.underperformingPlan;
      reasons.push(
        `delivering ${Math.round(ratio * 100)}% of the paid ${plan.download} Mbps plan`,
      );
    }
  }

  // A commercial hint makes the same degradation costlier. It weights the score
  // and nothing else: a household on the same cable plant scores lower and is
  // routed through identical gates.
  if (audience === AUDIENCES.COMMERCIAL) {
    score += SCORE_WEIGHTS.commercialAudience;
    reasons.push('business-critical usage implicated');
  }

  const fiberButSlow =
    (provider.tier === PROVIDER_TIERS.FIBER || provider.tier === PROVIDER_TIERS.MUNI) &&
    measured.downloadMbps > 0 &&
    measured.downloadMbps < SIGNAL_THRESHOLDS.STALE_FIBER_TIER;
  if (fiberButSlow) {
    score += SCORE_WEIGHTS.fiberGap;
    reasons.push(`fiber link delivering only ${measured.downloadMbps.toFixed(0)} Mbps`);
  }

  return {
    score: Math.min(score, 100),
    reasons,
    provider,
    measured,
    audience,
    onFiber: provider.tier === PROVIDER_TIERS.FIBER || provider.tier === PROVIDER_TIERS.MUNI,
  };
}

/**
 * "300/300", "500", "1000/50" → { download, upload }. Anything unparseable
 * returns null so a typo never silently becomes a 0 Mbps plan comparison.
 */
export function parsePlan(subscribedPlan) {
  if (typeof subscribedPlan === 'number' && Number.isFinite(subscribedPlan) && subscribedPlan > 0) {
    return { download: subscribedPlan, upload: subscribedPlan };
  }
  if (typeof subscribedPlan !== 'string') return null;

  const match = subscribedPlan.trim().match(/^(\d{1,5})(?:\s*\/\s*(\d{1,5}))?$/);
  if (!match) return null;

  const download = Number(match[1]);
  const upload = match[2] ? Number(match[2]) : download;
  if (!download || !upload) return null;

  return { download, upload };
}

export function qualityTier({ email, name, postalCode, consent } = {}) {
  const hasEmail = typeof email === 'string' && /^\S+@\S+\.\S+$/.test(email.trim());
  const hasName = typeof name === 'string' && name.trim().length > 1;
  const hasZip = /^\d{5}$/.test(String(postalCode ?? '').trim());
  const hasConsent = consent === true;

  if (hasEmail && hasZip && hasName && hasConsent) return QUALITY_TIERS.ROUTABLE;
  if (hasEmail) return QUALITY_TIERS.CONTACTABLE;
  return QUALITY_TIERS.ANONYMOUS;
}

/**
 * Choose exactly one offer.
 *
 * Order of precedence is deliberate: a proven-sellable upgrade beats an add-on,
 * an add-on beats a diagnostic, and a diagnostic beats asking for a ZIP. Only one
 * card is ever returned so the page never reads as a storefront.
 */
export function selectOffer({ opportunity, coverage }) {
  const { onFiber, provider, score } = opportunity;

  // Already on fiber: the only honest offers are add-ons and paid diagnostics.
  if (onFiber) {
    const coveredZip = coverage.some((entry) => entry.status === COVERAGE.COVERED);
    if (coveredZip) {
      return {
        type: DEAL_TYPES.SECURITY_ADDON,
        programId: 'home_security',
        rationale: 'already on fiber; bundle add-on is the only upgrade path',
      };
    }
    return {
      type: DEAL_TYPES.DIAGNOSTIC,
      programId: null,
      rationale: 'fiber link measured below expectation; sell the verification dossier',
    };
  }

  const covered = coverage.find((entry) => entry.status === COVERAGE.COVERED);
  if (covered) {
    return {
      type: DEAL_TYPES.FIBER_UPGRADE,
      programId: covered.programId,
      rationale: `verified ${covered.programId} coverage for ${covered.zip}`,
    };
  }

  if (coverage.length > 0) {
    return {
      type: DEAL_TYPES.RESOLVE_COVERAGE,
      programId: null,
      rationale: 'no verified program for this address yet; collect ZIP to resolve',
      score,
    };
  }

  if (provider.tier === PROVIDER_TIERS.CABLE) {
    return {
      type: DEAL_TYPES.CABLE_RESCUE,
      programId: null,
      rationale: 'cable transport with no verified fiber program at this ZIP',
    };
  }

  return {
    type: DEAL_TYPES.RESOLVE_COVERAGE,
    programId: null,
    rationale: 'no routable program; ZIP required',
  };
}

/**
 * The single entry point the UI consumes.
 *
 * Returns a lead-intent object. `payable` is true only for a `ROUTABLE` contact
 * on a `covered` program — the exact predicate a partner or master agent would
 * be asked to pay against, kept in one place so the billing claim and the UI can
 * never disagree.
 */
export function buildLeadIntent({
  report,
  contact = {},
  audience = AUDIENCES.UNIVERSAL,
  subscribedPlan,
  serviceability = null,
} = {}) {
  if (!report?.metrics) return null;

  const opportunity = scoreOpportunity({
    metrics: report.metrics,
    meta: report.meta ?? {},
    audience,
    subscribedPlan,
  });

  const postalCode = String(contact.postalCode ?? report.meta?.postalCode ?? '').trim();
  const programIdsToCheck = ['kinetic', 'att-fiber'];
  const coverage = programIdsToCheck.map((programId) =>
    lookupCoverage({ postalCode, programId, serviceability }),
  );

  const offer = selectOffer({ opportunity, coverage });
  const quality = qualityTier({ ...contact, postalCode });

  return {
    testId: report.id,
    timestamp: report.timestamp,
    audience,
    quality,
    payable: quality === QUALITY_TIERS.ROUTABLE && offer.type === DEAL_TYPES.FIBER_UPGRADE,
    offer,
    opportunity: {
      score: opportunity.score,
      reasons: opportunity.reasons,
      providerTier: opportunity.provider.tier,
      providerBasis: opportunity.provider.basis,
      onFiber: opportunity.onFiber,
    },
    coverage,
    measured: opportunity.measured,
  };
}

/**
 * Privacy-safe summary for telemetry. Deliberately excludes email, name, ZIP
 * and the delivered IP: Analytics Engine is a logging surface, not a CRM, and a
 * ZIP is address-adjacent. Only the derived decision and its drivers ship.
 */
export function toTelemetryFields(intent) {
  if (!intent) return null;
  return {
    offer_type: intent.offer.type,
    offer_program: intent.offer.programId ?? 'none',
    quality_tier: intent.quality,
    payable: intent.payable,
    opportunity_score: intent.opportunity.score,
    provider_tier: intent.opportunity.providerTier,
    provider_basis: intent.opportunity.providerBasis,
    coverage_status: intent.coverage.map((entry) => entry.status).join(','),
    audience: intent.audience,
  };
}
