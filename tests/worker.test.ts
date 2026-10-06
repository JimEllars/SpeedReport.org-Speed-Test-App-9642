import { describe, expect, it, vi } from 'vitest';
import worker from '../speedreport-worker/src/index';

const mockEnv = {
  ASSETS: { fetch: vi.fn() },
  PROSPECT_STORE: {
    get: vi.fn(),
    put: vi.fn()
  },
  ALLOWED_ORIGINS: 'https://speedreport.org'
};

const mockCtx = {
  waitUntil: vi.fn()
};

describe('Cloudflare Worker', () => {
  it('handles /api/meta correctly', async () => {
    const req = new Request('http://localhost/api/meta', {
      headers: new Headers({
        'cf-connecting-ip': '1.2.3.4',
        'Origin': 'https://speedreport.org'
      })
    });

    // Simulate CF object on request
    Object.defineProperty(req, 'cf', {
      value: {
        city: 'New York',
        country: 'US',
        colo: 'EWR',
        asn: 12345
      }
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ip).toBe('1.2.3.4');
    expect(body.city).toBe('New York');
    expect(body.colo).toBe('EWR');
    expect(body.asn).toBe('AS12345');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://speedreport.org');
  });

  it('handles /api/lead correctly', async () => {
    const payload = {
      testId: '1234',
      metrics: {
        downloadMbps: 100,
        uploadMbps: 50,
        latencyMs: 10
      }
    };

    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: new Headers({
        'cf-connecting-ip': '1.2.3.4'
      })
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leadId).toBeDefined();
  });

  it('rejects invalid /api/lead payload', async () => {
    const req = new Request('http://localhost/api/lead', {
      method: 'POST',
      body: JSON.stringify({ wrong: 'data' })
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(400);
  });

  it('handles /api/ping with proper headers', async () => {
    const req = new Request('http://localhost/api/ping');
    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(204);
  });
});
