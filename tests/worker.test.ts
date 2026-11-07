// @vitest-environment node
// No DOM involved: pure formatting/aggregation logic. Kept on the node
// environment so the file does not pay jsdom's ~29s startup (vitest.config.js).
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

describe('Edge cyber defence', () => {
  // Note: WHATWG `new URL()` resolves dot-segments itself, so a plain `/../../etc/passwd`
  // or a single-encoded `/%2e%2e/` arrives already normalised to `/etc/passwd` and can
  // never reach a protected path. The vectors below are the ones that survive parsing
  // and therefore actually need screening at the edge.
  const blocked = [
    ['PHP CGI dash argument', 'http://localhost/?-d+allow_url_include%3don'],
    ['auto_prepend_file injection', 'http://localhost/?x=1&auto_prepend_file=php://input'],
    ['auto_append_file injection', 'http://localhost/index?auto_append_file=evil'],
    ['allow_url_include flag', 'http://localhost/api/ping?allow_url_include=1'],
    ['disable_functions override', 'http://localhost/api/ping?disable_functions=exec'],
    ['safe_mode override', 'http://localhost/api/ping?safe_mode=off'],
    ['double-encoded traversal', 'http://localhost/%252e%252e/%252e%252e/etc/passwd'],
    ['traversal in query', 'http://localhost/api/meta?file=../../etc/passwd'],
    ['php probe', 'http://localhost/wp-content/shell.php'],
    ['wp-admin probe', 'http://localhost/wp-admin/'],
    ['wp-login probe', 'http://localhost/wp-login.php'],
    ['xmlrpc probe', 'http://localhost/xmlrpc.php'],
    ['cgi-bin probe', 'http://localhost/cgi-bin/status'],
  ] as const;

  it.each(blocked)('blocks %s with 403', async (_label, url) => {
    const res = await worker.fetch(new Request(url), mockEnv, mockCtx);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden');
  });

  it('still serves legitimate API and asset traffic', async () => {
    const health = await worker.fetch(new Request('http://localhost/health'), mockEnv, mockCtx);
    expect(health.status).toBe(200);

    const ping = await worker.fetch(new Request('http://localhost/api/ping'), mockEnv, mockCtx);
    expect(ping.status).toBe(204);

    mockEnv.ASSETS.fetch.mockResolvedValue(new Response('asset', { status: 200 }));
    const asset = await worker.fetch(new Request('http://localhost/assets/index-BqLcMYbE.js'), mockEnv, mockCtx);
    expect(asset.status).toBe(200);
  });
});
