// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createHandler } from '../axim-core/src/handler.js';

const KEY = 'test-key';
const sign = (body, key = KEY) => createHmac('sha256', key).update(body).digest('hex');

async function withServer(fn, overrides = {}) {
  const store = { upsertLead: vi.fn().mockResolvedValue(undefined) };
  const afterIngest = vi.fn().mockResolvedValue(undefined);
  const log = { info: vi.fn(), error: vi.fn() };
  const server = http.createServer(createHandler({ internalKey: KEY, store, afterIngest, log, ...overrides }));
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ url, store, afterIngest });
  } finally {
    server.close();
  }
}

const post = (url, body, sig) =>
  fetch(`${url}/api/v1/leads/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Axim-Signature': sig } : {}) },
    body,
  });

describe('AXiM Core ingestion', () => {
  const body = JSON.stringify({
    payload: { testId: 't1', email: 'A@B.com', metrics: { downloadMbps: 900, latencyMs: 12 } },
    evaluation: { opportunityScore: 70 },
  });

  it('accepts a valid signature and upserts', async () => {
    await withServer(async ({ url, store, afterIngest }) => {
      const res = await post(url, body, sign(body));
      expect(res.status).toBe(200);
      expect(store.upsertLead).toHaveBeenCalledWith(
        expect.objectContaining({ test_id: 't1', email: 'a@b.com', opportunity_score: 70 })
      );
      await vi.waitFor(() => expect(afterIngest).toHaveBeenCalled());
    });
  });

  it('rejects bad or missing signatures with 401', async () => {
    await withServer(async ({ url, store }) => {
      expect((await post(url, body, sign(body, 'wrong'))).status).toBe(401);
      expect((await post(url, body)).status).toBe(401);
      expect((await post(url, body, 'zz')).status).toBe(401);
      expect(store.upsertLead).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid payloads after authentication', async () => {
    await withServer(async ({ url }) => {
      const bad = JSON.stringify({ payload: {} });
      expect((await post(url, bad, sign(bad))).status).toBe(400);
    });
  });

  it('returns 500 on storage failure', async () => {
    await withServer(
      async ({ url }) => {
        expect((await post(url, body, sign(body))).status).toBe(500);
      },
      { store: { upsertLead: vi.fn().mockRejectedValue(new Error('db')) } }
    );
  });
});
