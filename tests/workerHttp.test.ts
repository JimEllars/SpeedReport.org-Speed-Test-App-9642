// @vitest-environment node
// Worker-level HTTP contract tests: CORS consistency across the success and
// error paths, plus the operational health surface.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../speedreport-worker/src/index';

const STAGING_ORIGIN = 'https://staging.speedreport.org';

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('asset', { status: 200 })) },
    TELEMETRY: { writeDataPoint: vi.fn() },
    PROSPECT_STORE: { get: vi.fn(), put: vi.fn(), list: vi.fn() },
    SERVICEABILITY: { get: vi.fn(), put: vi.fn(), list: vi.fn() },
    ALLOWED_ORIGINS: STAGING_ORIGIN,
    AXIM_CORE_URL: 'https://core.internal.invalid',
    AXIM_INTERNAL_KEY: 'test-internal-key',
    ...overrides,
  } as any;
}

const ctx = { waitUntil: vi.fn() } as any;

describe('CORS consistency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mirrors a configured origin on successful responses', async () => {
    const req = new Request('https://speedreport.org/api/ping', {
      headers: { Origin: STAGING_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv(), ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STAGING_ORIGIN);
  });

  it('mirrors a configured origin on error responses too', async () => {
    // Invalid lead payload -> errorJson(400). The error helper used to build its
    // CORS headers without env, so ALLOWED_ORIGINS was ignored and the browser
    // discarded the error body for every origin except the hardcoded default.
    const req = new Request('https://speedreport.org/api/lead', {
      method: 'POST',
      body: JSON.stringify({ wrong: 'shape' }),
      headers: { Origin: STAGING_ORIGIN, 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, makeEnv(), ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STAGING_ORIGIN);
  });

  it('falls back to the canonical origin for unknown callers', async () => {
    const req = new Request('https://speedreport.org/api/lead', {
      method: 'POST',
      body: JSON.stringify({ wrong: 'shape' }),
      headers: { Origin: 'https://not-ours.example', 'Content-Type': 'application/json' },
    });

    const res = await worker.fetch(req, makeEnv(), ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://speedreport.org');
  });
});

describe('health surface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the DLQ and rate limiter as active when the KV binding exists', async () => {
    const res = await worker.fetch(new Request('https://speedreport.org/health'), makeEnv(), ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.degraded).toBe(false);
    expect(body.dependencies.prospectStore).toBe('bound');
    expect(body.dependencies.leadForwarding).toBe('configured');
    expect(body.dependencies.serviceability).toBe('bound');
  });

  it('never leaks the Core endpoint or key through health', async () => {
    const res = await worker.fetch(new Request('https://speedreport.org/health'), makeEnv(), ctx);
    const raw = await res.text();

    expect(raw).not.toContain('core.internal.invalid');
    expect(raw).not.toContain('test-internal-key');
  });

  it('reports the degradation when PROSPECT_STORE is unbound', async () => {
    // The DLQ and the per-IP lead rate limiter both no-op without the binding.
    // That used to be visible only in Worker logs.
    const env = makeEnv({ PROSPECT_STORE: undefined });
    const res = await worker.fetch(new Request('https://speedreport.org/health'), env, ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dependencies.prospectStore).toBe('unbound');
    expect(body.degraded).toBe(true);
  });

  it('flags missing lead forwarding configuration as degraded', async () => {
    const env = makeEnv({ AXIM_CORE_URL: undefined });
    const res = await worker.fetch(new Request('https://speedreport.org/health'), env, ctx);
    const body = await res.json();

    expect(body.dependencies.leadForwarding).toBe('unconfigured');
    expect(body.degraded).toBe(true);
  });
});
