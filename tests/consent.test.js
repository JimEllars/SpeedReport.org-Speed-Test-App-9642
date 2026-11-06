import { describe, it, expect } from 'vitest';
import {
  CONSENT_COPY,
  CONSENT_PURPOSE,
  CONSENT_VERSION,
  buildConsentRecord,
  isConsentCurrent,
} from '../src/content/consent';

describe('consent copy', () => {
  it('names exactly one purpose', () => {
    expect(CONSENT_PURPOSE).toBe('provider_match');
    expect(CONSENT_COPY.purpose).toBe(CONSENT_PURPOSE);
  });

  it('carries a version string, because a stored consent without one is unprovable', () => {
    expect(CONSENT_COPY.version).toBe(CONSENT_VERSION);
    expect(CONSENT_VERSION).toMatch(/^sr-consent-\d{4}-\d{2}-v\d+$/);
  });

  it('states that providing consent is optional', () => {
    expect(CONSENT_COPY.bullets.join(' ')).toContain('optional');
    expect(CONSENT_COPY.bullets.join(' ')).toContain('works the same either way');
  });

  it('names withdrawal twice: a right and a destination', () => {
    expect(CONSENT_COPY.bullets.join(' ')).toMatch(/withdraw/i);
    expect(CONSENT_COPY.withdrawalEmail).toContain('@');
    expect(CONSENT_COPY.withdrawalPath).toMatch(/^\//);
  });

  it('never implies the speed test is conditional on consent', () => {
    const all = [CONSENT_COPY.label, ...CONSENT_COPY.body, ...CONSENT_COPY.bullets].join(' ');
    expect(all).not.toMatch(/you must|required to continue|by continuing/i);
  });

  it('gives decline equal standing to accept', () => {
    expect(CONSENT_COPY.declineLabel.length).toBeGreaterThan(0);
    expect(CONSENT_COPY.acceptLabel.length).toBeGreaterThan(0);
  });
});

describe('isConsentCurrent', () => {
  it('accepts a record on the current version', () => {
    expect(isConsentCurrent({ version: CONSENT_VERSION })).toBe(true);
  });

  it('rejects a stale version — the visitor consented to different words', () => {
    expect(isConsentCurrent({ version: 'sr-consent-2025-01-v1' })).toBe(false);
  });

  it('rejects a missing record', () => {
    expect(isConsentCurrent(null)).toBe(false);
    expect(isConsentCurrent({})).toBe(false);
  });
});

describe('buildConsentRecord', () => {
  it('records version, purpose and timestamp', () => {
    const record = buildConsentRecord({ at: '2026-11-05T12:00:00.000Z' });
    expect(record).toEqual({
      version: CONSENT_VERSION,
      purpose: CONSENT_PURPOSE,
      at: '2026-11-05T12:00:00.000Z',
      sourceIpHash: null,
    });
  });

  it('keeps only a hashed source IP, never a raw one', () => {
    const record = buildConsentRecord({
      at: '2026-11-05T12:00:00.000Z',
      ip: 'sha256:abc123',
    });
    expect(record.sourceIpHash).toBe('sha256:abc123');
    expect(JSON.stringify(record)).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });
});
