import { describe, it, expect } from 'vitest';
import {
  classifyProvider,
  lookupCoverage,
  COVERAGE,
  PROVIDER_TIERS,
  SEED_FOOTPRINTS,
} from '../src/utils/providerCatalog';

describe('classifyProvider', () => {
  it('identifies cable from carrier names, not from speed', () => {
    const result = classifyProvider({ isp: 'Comcast Cable Communications', measured: { downloadMbps: 900, uploadMbps: 35 } });
    expect(result.tier).toBe(PROVIDER_TIERS.CABLE);
    expect(result.basis).toBe('name');
    expect(result.asymmetryRatio).toBeLessThan(0.1);
  });

  it('treats Xfinity and Spectrum as cable', () => {
    expect(classifyProvider({ isp: 'Xfinity' }).tier).toBe(PROVIDER_TIERS.CABLE);
    expect(classifyProvider({ isp: 'Spectrum' }).tier).toBe(PROVIDER_TIERS.CABLE);
  });

  it('does not let fast throughput override a named legacy tier', () => {
    // 940/35 cable is still cable: the asymmetry is the commercial argument.
    const result = classifyProvider({ isp: 'Cox Communications', measured: { downloadMbps: 940, uploadMbps: 35 } });
    expect(result.tier).toBe(PROVIDER_TIERS.CABLE);
  });

  it('identifies fiber by name and marks symmetrical throughput', () => {
    const result = classifyProvider({ isp: 'AT&T Fiber', measured: { downloadMbps: 940, uploadMbps: 930 } });
    expect(result.tier).toBe(PROVIDER_TIERS.FIBER);
    expect(result.symmetrical).toBe(true);
  });

  it('falls back to measurement when the name is unrecognised', () => {
    const result = classifyProvider({ isp: 'Regional Broadband Co', measured: { downloadMbps: 800, uploadMbps: 790 } });
    expect(result.tier).toBe(PROVIDER_TIERS.FIBER);
    expect(result.basis).toBe('measurement');
  });

  it('returns UNKNOWN rather than guessing when neither name nor speed discriminate', () => {
    const result = classifyProvider({ isp: 'Regional Broadband Co', measured: { downloadMbps: 120, uploadMbps: 12 } });
    expect(result.tier).toBe(PROVIDER_TIERS.UNKNOWN);
    expect(result.basis).toBe('none');
  });

  it('classifies satellite and satellite-adjacent names', () => {
    expect(classifyProvider({ isp: 'HughesNet' }).tier).toBe(PROVIDER_TIERS.SATELLITE);
    expect(classifyProvider({ isp: 'Starlink' }).tier).toBe(PROVIDER_TIERS.SATELLITE);
  });

  it('classifies municipal networks ahead of generic fiber markers', () => {
    expect(classifyProvider({ isp: 'City of Chattanooga EPB' }).tier).toBe(PROVIDER_TIERS.MUNI);
  });

  it('survives an empty or missing ISP with no measurement', () => {
    expect(classifyProvider({}).tier).toBe(PROVIDER_TIERS.UNKNOWN);
    expect(classifyProvider().tier).toBe(PROVIDER_TIERS.UNKNOWN);
  });
});

describe('lookupCoverage', () => {
  it('never reports covered without a feed, even inside a seed-footprint state', () => {
    const result = lookupCoverage({
      postalCode: '75001',
      programId: 'kinetic',
      serviceability: { __stateByZip: { 75001: 'TX' } },
    });
    expect(SEED_FOOTPRINTS.kinetic.states).toContain('TX');
    expect(result.status).toBe(COVERAGE.UNKNOWN);
    expect(result.source).toBe('seed-state');
  });

  it('reports covered only from an explicit feed entry', () => {
    const result = lookupCoverage({
      postalCode: '75001',
      programId: 'kinetic',
      serviceability: { 75001: { kinetic: COVERAGE.COVERED } },
    });
    expect(result.status).toBe(COVERAGE.COVERED);
    expect(result.source).toBe('feed');
  });

  it('honours a negative feed entry', () => {
    const result = lookupCoverage({
      postalCode: '75001',
      programId: 'kinetic',
      serviceability: { 75001: { kinetic: COVERAGE.KNOWN_ABSENT } },
    });
    expect(result.status).toBe(COVERAGE.KNOWN_ABSENT);
  });

  it('flags a malformed ZIP as unresolved instead of treating it as absent', () => {
    expect(lookupCoverage({ postalCode: '75', programId: 'kinetic' }).status).toBe(COVERAGE.UNRESOLVED_ZIP);
    expect(lookupCoverage({ postalCode: 'ABCDE', programId: 'kinetic' }).status).toBe(COVERAGE.UNRESOLVED_ZIP);
    expect(lookupCoverage({}).status).toBe(COVERAGE.UNRESOLVED_ZIP);
  });

  it('stays unknown for a state outside any footprint', () => {
    const result = lookupCoverage({
      postalCode: '99501',
      programId: 'kinetic',
      serviceability: { __stateByZip: { 99501: 'AK' } },
    });
    expect(result.status).toBe(COVERAGE.UNKNOWN);
    expect(result.source).toBe('none');
  });
});
