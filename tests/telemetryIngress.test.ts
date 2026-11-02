// @vitest-environment node
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleLeadSubmission, handleTelemetry } from '../speedreport-worker/src/telemetry';

const CORE_URL = 'https://core.axiom-internal.test';
const INTERNAL_KEY = 'test-internal-key';

interface FakeKv {
  store: Map<string, string>;
  putOptions: Array<{ key: string; options: any }>;
  get: any;
  put: any;
  delete: any;
  list: any;
}

function createKv(seed: Record<string, string> = {}): FakeKv {
  const store = new Map<string, string>(Object.entries(seed));
  const putOptions: Array<{ key: string; options: any }> = [];

  return {
    store,
    putOptions,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, options?: any) => {
      store.set(key, value);
      putOptions.push({ key, options });
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async (options: { prefix?: string; limit?: number } = {}) => {
      const prefix = options.prefix ?? '';
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, options.limit ?? 1000)
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    }),
  };
}

function createEnv(kv: FakeKv) {
  return {
    AXIM_CORE_URL: CORE_URL,
    AXIM_INTERNAL_KEY: INTERNAL_KEY,
    PROSPECT_STORE: kv,
    TELEMETRY: { writeDataPoint: vi.fn() },
  };
}

function createCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  };
}

const routedPayload = (testId: string) => ({
  testId,
  sessionId: testId,
  event: 'test_completed',
  downloadMbps: 50,
  uploadMbps: 5,
  latencyMs: 60,
  jitterMs: 8,
  packetLoss: 0,
  isp: 'Spectrum Cable',
  // An explicit email always routes to Core regardless of prospect score.
  leadInfo: { email: 'ops@example.com' },
});

describe('Core telemetry ingress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('signs dispatches with a hex HMAC-SHA256 over the raw body bytes', async () => {
    const kv = createKv();
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(routedPayload('SR-HMAC-1')),
    });

    const response = await handleTelemetry(request, env, ctx);
    expect(response.status).toBe(202);

    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CORE_URL}/api/v1/leads/telemetry`);

    const rawBody = init.body as string;
    const expected = createHmac('sha256', INTERNAL_KEY).update(rawBody).digest('hex');

    expect(init.headers['X-Axim-Signature']).toBe(expected);
    expect(init.headers['X-Axim-Signature']).toMatch(/^[0-9a-f]{64}$/);

    const timestamp = Number(init.headers['X-Axim-Timestamp']);
    expect(Number.isFinite(timestamp)).toBe(true);
    // Core enforces a <5 minute clock-skew window.
    expect(Math.abs(Date.now() - timestamp)).toBeLessThan(5 * 60 * 1000);

    // A successful dispatch must not touch the DLQ.
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('buffers a failed dispatch in PROSPECT_STORE with a 24h TTL', async () => {
    const kv = createKv();
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('core unreachable')));

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(routedPayload('SR-DLQ-1')),
    });

    await handleTelemetry(request, env, ctx);
    await Promise.all(pending);

    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.putOptions[0].key).toBe('dlq:lead:SR-DLQ-1');
    expect(kv.putOptions[0].options).toEqual({ expirationTtl: 86400 });

    const stored = JSON.parse(kv.store.get('dlq:lead:SR-DLQ-1') as string);
    expect(stored.reason).toBe('core unreachable');
    expect(typeof stored.rawBody).toBe('string');
    expect(JSON.parse(stored.rawBody).payload.testId).toBe('SR-DLQ-1');
  });

  it('buffers when Core answers with a non-2xx status', async () => {
    const kv = createKv();
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(routedPayload('SR-DLQ-2')),
    });

    await handleTelemetry(request, env, ctx);
    await Promise.all(pending);

    expect(kv.store.has('dlq:lead:SR-DLQ-2')).toBe(true);
    expect(JSON.parse(kv.store.get('dlq:lead:SR-DLQ-2') as string).reason).toBe('http_503');
  });

  it('replays buffered dispatches on a later request and clears them', async () => {
    const seeded = JSON.stringify({
      rawBody: JSON.stringify({ payload: { testId: 'SR-OLD' }, evaluation: {} }),
      reason: 'core unreachable',
      bufferedAt: new Date().toISOString(),
    });

    const kv = createKv({ 'dlq:lead:SR-OLD': seeded });
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      // A payload that does not itself route to Core keeps the replay isolated.
      body: JSON.stringify({
        testId: 'SR-NEW',
        downloadMbps: 900,
        uploadMbps: 900,
        latencyMs: 4,
        jitterMs: 1,
        packetLoss: 0,
        isp: 'Fiber Co',
      }),
    });

    await handleTelemetry(request, env, ctx);
    await Promise.all(pending);

    expect(kv.delete).toHaveBeenCalledWith('dlq:lead:SR-OLD');
    expect(kv.store.has('dlq:lead:SR-OLD')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops unparseable DLQ entries instead of retrying them forever', async () => {
    const kv = createKv({ 'dlq:lead:SR-CORRUPT': 'not-json' });
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      body: JSON.stringify({ testId: 'SR-X', downloadMbps: 900, uploadMbps: 900, latencyMs: 3, jitterMs: 1, packetLoss: 0 }),
    });

    await handleTelemetry(request, env, ctx);
    await Promise.all(pending);

    expect(kv.store.has('dlq:lead:SR-CORRUPT')).toBe(false);
  });

  it('buffers manual lead submissions when Core is unreachable', async () => {
    const kv = createKv();
    const env = createEnv(kv);
    const { ctx, pending } = createCtx();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('core unreachable')));

    const request = new Request('https://speedreport.org/api/lead', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({
        testId: 'SR-LEAD-1',
        email: 'buyer@example.com',
        metrics: { downloadMbps: 120, uploadMbps: 12, latencyMs: 25 },
      }),
    });

    const response = await handleLeadSubmission(request, env, ctx);
    expect(response.status).toBe(200);

    await Promise.all(pending);

    expect(kv.store.has('dlq:lead:SR-LEAD-1')).toBe(true);
  });

  it('logs a loud error when PROSPECT_STORE is unbound rather than silently dropping', async () => {
    const env = { AXIM_CORE_URL: CORE_URL, AXIM_INTERNAL_KEY: INTERNAL_KEY } as any;
    const { ctx, pending } = createCtx();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('core unreachable')));

    const request = new Request('https://speedreport.org/api/telemetry', {
      method: 'POST',
      body: JSON.stringify(routedPayload('SR-UNBOUND')),
    });

    await handleTelemetry(request, env, ctx);
    await Promise.all(pending);

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('telemetry.dlq_unbound');
  });
});
