import { describe, it, expect } from 'vitest';
import {
  AUDIENCES,
  DEAL_TYPES,
  QUALITY_TIERS,
  buildLeadIntent,
  parsePlan,
  qualityTier,
  scoreOpportunity,
  selectOffer,
  toTelemetryFields,
} from '../src/utils/leadEngine';
import { COVERAGE, PROVIDER_TIERS } from '../src/utils/providerCatalog';

const cableReport = {
  id: 'SR-TEST-CABLE',
  timestamp: '2026-11-05T12:00:00.000Z',
  metrics: {
    download: 850,
    upload: 22,
    ping: 34,
    jitter: 3,
    loss: 0,
    bufferbloat: 'B',
  },
  meta: { isp: 'Comcast Cable Communications', asOrganization: 'Comcast', postalCode: '' },
};

const fiberReport = {
  id: 'SR-TEST-FIBER',
  timestamp: '2026-11-05T12:00:00.000Z',
  metrics: { download: 940, upload: 930, ping: 8, jitter: 1, loss: 0, bufferbloat: 'A' },
  meta: { isp: 'AT&T Fiber', asOrganization: 'AT&T Services', postalCode: '' },
};

const coveredFeed = { 75001: { kinetic: COVERAGE.COVERED } };

describe('parsePlan', () => {
  it('parses download/upload pairs, single numbers, and rejects junk', () => {
    expect(parsePlan('500/500')).toEqual({ download: 500, upload: 500 });
    expect(parsePlan('1000 / 50')).toEqual({ download: 1000, upload: 50 });
    expect(parsePlan('300')).toEqual({ download: 300, upload: 300 });
    expect(parsePlan(400)).toEqual({ download: 400, upload: 400 });
    expect(parsePlan('fast')).toBeNull();
    expect(parsePlan('0')).toBeNull();
    expect(parsePlan(undefined)).toBeNull();
  });
});

describe('scoreOpportunity', () => {
  it('scores a legacy cable link above a healthy fiber link', () => {
    const cable = scoreOpportunity({ metrics: cableReport.metrics, meta: cableReport.meta });
    const fiber = scoreOpportunity({ metrics: fiberReport.metrics, meta: fiberReport.meta });

    expect(cable.score).toBeGreaterThan(fiber.score);
    expect(cable.onFiber).toBe(false);
    expect(fiber.onFiber).toBe(true);
  });

  it('records a reason for every point it awards', () => {
    const result = scoreOpportunity({
      metrics: { download: 900, upload: 20, ping: 80, bufferbloat: 'F' },
      meta: { isp: 'Spectrum' },
      subscribedPlan: '1000/50',
    });
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasons.join(' ')).toContain('asymmetric upload');
  });

  it('caps the score at 100 and never drops below the base 10', () => {
    const overloaded = scoreOpportunity({
      metrics: { download: 5, upload: 0.5, ping: 300, bufferbloat: 'F' },
      meta: { isp: 'HughesNet' },
      audience: AUDIENCES.BUSINESS,
      subscribedPlan: '100/10',
    });
    expect(overloaded.score).toBeLessThanOrEqual(100);
    expect(overloaded.score).toBeGreaterThan(80);

    const clean = scoreOpportunity({ metrics: fiberReport.metrics, meta: fiberReport.meta });
    expect(clean.score).toBeGreaterThanOrEqual(10);
  });

  it('flags underperformance against the plan the visitor says they pay for', () => {
    const result = scoreOpportunity({
      metrics: { download: 120, upload: 12, ping: 20, bufferbloat: 'A' },
      meta: { isp: 'Comcast' },
      subscribedPlan: '1000/50',
    });
    expect(result.reasons.join(' ')).toMatch(/of the paid 1000 Mbps plan/);
  });

  it('treats a degraded fiber link as a diagnostic opportunity, not a fiber gap claim', () => {
    const result = scoreOpportunity({
      metrics: { download: 150, upload: 140, ping: 12, bufferbloat: 'A' },
      meta: { isp: 'Frontier Fiber' },
    });
    expect(result.onFiber).toBe(true);
    expect(result.reasons.join(' ')).toContain('fiber link delivering only 150 Mbps');
  });
});

describe('qualityTier', () => {
  it('requires name, email, ZIP and consent for routable', () => {
    expect(qualityTier({ email: 'a@b.com', name: 'Ops Lead', postalCode: '75001', consent: true }))
      .toBe(QUALITY_TIERS.ROUTABLE);
  });

  it('downgrades when consent is missing', () => {
    expect(qualityTier({ email: 'a@b.com', name: 'Ops Lead', postalCode: '75001' }))
      .toBe(QUALITY_TIERS.CONTACTABLE);
  });

  it('downgrades when the name is missing', () => {
    expect(qualityTier({ email: 'a@b.com', name: '', postalCode: '75001', consent: true }))
      .toBe(QUALITY_TIERS.CONTACTABLE);
  });

  it('is anonymous without a valid email', () => {
    expect(qualityTier({ email: 'nope', name: 'Ops', postalCode: '75001', consent: true }))
      .toBe(QUALITY_TIERS.ANONYMOUS);
    expect(qualityTier({})).toBe(QUALITY_TIERS.ANONYMOUS);
  });
});

describe('selectOffer', () => {
  const opportunityFor = (metrics, meta) => scoreOpportunity({ metrics, meta });

  it('offers a fiber upgrade when coverage is verified', () => {
    const offer = selectOffer({
      opportunity: opportunityFor(cableReport.metrics, cableReport.meta),
      coverage: [{ zip: '75001', programId: 'kinetic', status: COVERAGE.COVERED, source: 'feed' }],
    });
    expect(offer.type).toBe(DEAL_TYPES.FIBER_UPGRADE);
    expect(offer.programId).toBe('kinetic');
  });

  it('asks for a ZIP instead of inventing an offer when coverage is unknown', () => {
    const offer = selectOffer({
      opportunity: opportunityFor(cableReport.metrics, cableReport.meta),
      coverage: [{ zip: '75001', programId: 'kinetic', status: COVERAGE.UNKNOWN, source: 'none' }],
    });
    expect(offer.type).toBe(DEAL_TYPES.RESOLVE_COVERAGE);
    expect(offer.programId).toBeNull();
  });

  it('never pitches fiber to a subscriber already on fiber', () => {
    const offer = selectOffer({
      opportunity: opportunityFor(fiberReport.metrics, fiberReport.meta),
      coverage: [{ zip: '75001', programId: 'kinetic', status: COVERAGE.COVERED, source: 'feed' }],
    });
    expect(offer.type).toBe(DEAL_TYPES.SECURITY_ADDON);
    expect(offer.type).not.toBe(DEAL_TYPES.FIBER_UPGRADE);
  });

  it('sells the diagnostic to a fiber customer with no add-on coverage', () => {
    const offer = selectOffer({
      opportunity: opportunityFor(fiberReport.metrics, fiberReport.meta),
      coverage: [{ zip: '75001', programId: 'kinetic', status: COVERAGE.UNKNOWN, source: 'none' }],
    });
    expect(offer.type).toBe(DEAL_TYPES.DIAGNOSTIC);
  });

  it('routes cable customers with no fiber program to a cable-rescue card', () => {
    const offer = selectOffer({
      opportunity: opportunityFor(cableReport.metrics, cableReport.meta),
      coverage: [],
    });
    expect(offer.type).toBe(DEAL_TYPES.CABLE_RESCUE);
  });
});

describe('buildLeadIntent', () => {
  it('returns null without metrics', () => {
    expect(buildLeadIntent({})).toBeNull();
    expect(buildLeadIntent({ report: { id: 'x' } })).toBeNull();
  });

  it('marks a lead payable only when routable contact meets verified coverage', () => {
    const intent = buildLeadIntent({
      report: cableReport,
      contact: { email: 'it@acme.test', name: 'Acme IT', postalCode: '75001', consent: true },
      serviceability: coveredFeed,
    });

    expect(intent.offer.type).toBe(DEAL_TYPES.FIBER_UPGRADE);
    expect(intent.quality).toBe(QUALITY_TIERS.ROUTABLE);
    expect(intent.payable).toBe(true);
  });

  it('refuses to mark an unverified-ZIP lead payable', () => {
    const intent = buildLeadIntent({
      report: cableReport,
      contact: { email: 'it@acme.test', name: 'Acme IT', postalCode: '99501', consent: true },
    });
    expect(intent.payable).toBe(false);
    expect(intent.offer.type).toBe(DEAL_TYPES.RESOLVE_COVERAGE);
  });

  it('refuses to mark a consentless lead payable', () => {
    const intent = buildLeadIntent({
      report: cableReport,
      contact: { email: 'it@acme.test', name: 'Acme IT', postalCode: '75001' },
      serviceability: coveredFeed,
    });
    expect(intent.quality).toBe(QUALITY_TIERS.CONTACTABLE);
    expect(intent.payable).toBe(false);
  });

  it('accepts the ZIP detected by the edge when the contact does not supply one', () => {
    const intent = buildLeadIntent({
      report: { ...cableReport, meta: { ...cableReport.meta, postalCode: '75001' } },
      contact: { email: 'it@acme.test', name: 'Acme IT', consent: true },
      serviceability: coveredFeed,
    });
    expect(intent.coverage[0].zip).toBe('75001');
    expect(intent.payable).toBe(true);
  });

  it('carries the reasons that justify its score', () => {
    const intent = buildLeadIntent({ report: cableReport, contact: {} });
    expect(intent.opportunity.reasons.length).toBeGreaterThan(0);
    expect(intent.opportunity.providerTier).toBe(PROVIDER_TIERS.CABLE);
  });
});

describe('toTelemetryFields', () => {
  it('emits decision fields and no personal data', () => {
    const intent = buildLeadIntent({
      report: cableReport,
      contact: { email: 'it@acme.test', name: 'Acme IT', postalCode: '75001', consent: true },
      serviceability: coveredFeed,
    });
    const fields = toTelemetryFields(intent);

    const serialised = JSON.stringify(fields);
    expect(serialised).not.toContain('it@acme.test');
    expect(serialised).not.toContain('Acme IT');
    expect(serialised).not.toContain('75001');

    expect(fields).toMatchObject({
      offer_type: DEAL_TYPES.FIBER_UPGRADE,
      offer_program: 'kinetic',
      payable: true,
      quality_tier: QUALITY_TIERS.ROUTABLE,
      provider_tier: PROVIDER_TIERS.CABLE,
    });
  });

  it('returns null for a missing intent', () => {
    expect(toTelemetryFields(null)).toBeNull();
  });
});
