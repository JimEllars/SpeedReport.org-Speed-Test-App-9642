// @vitest-environment node
// Serviceability contract tests. The load-bearing property is fail-closed: with
// no feed configured, no ZIP is ever reported `covered`, because a `covered`
// answer is what makes the site show a deal card and what makes a lead payable.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../speedreport-worker/src/index';
import {
  COVERAGE_STATUS,
  DEFAULT_PROGRAMS,
  resolveServiceability,
} from '../speedreport-worker/src/serviceability';

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('asset', { status: 200 })) },
    TELEMETRY: { writeDataPoint: vi.fn() },
    PROSPECT_STORE: { get: vi.fn(), put: vi.fn(), list: vi.fn() },
    ALLOWED_ORIGINS: 'https://staging.speedreport.org',
    AXIM_CORE_URL: 'https://core.internal.invalid',
    AXIM_INTERNAL_KEY: 'test-internal-key',
    ...overrides,
  } as any;
}

const ctx = { waitUntil: vi.fn() } as any;

function kvWith(entries: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => entries[key] ?? null),
    put: vi.fn(),
    list: vi.fn(),
  };
}

describe('resolveServiceability', () => {
  it('answers unknown for every program when no feed is bound', async () => {
    const result = await resolveServiceability('75001', [...DEFAULT_PROGRAMS], undefined);

    expect(result.source).toBe('none');
    expect(result.programs).toHaveLength(DEFAULT_PROGRAMS.length);
    for (const program of result.programs) {
      expect(program.status).toBe(COVERAGE_STATUS.UNKNOWN);
      expect(program.status).not.toBe(COVERAGE_STATUS.COVERED);
    }
  });

  it('reports covered only from an explicit feed entry', async () => {
    const store = kvWith({ 'svc:75001': { kinetic: 'covered' } });
    const result = await resolveServiceability('75001', ['kinetic', 'att-fiber'], store as any);

    expect(result.source).toBe('feed');
    expect(result.programs).toEqual([
      { programId: 'kinetic', status: 'covered', source: 'feed' },
      { programId: 'att-fiber', status: 'unknown', source: 'none' },
    ]);
  });

  it('honours a negative feed entry without treating it as unknown', async () => {
    const store = kvWith({ 'svc:75001': { kinetic: 'known_absent' } });
    const result = await resolveServiceability('75001', ['kinetic'], store as any);
    expect(result.programs[0].status).toBe(COVERAGE_STATUS.KNOWN_ABSENT);
  });

  it('does not trust an unrecognised status value from the feed', async () => {
    const store = kvWith({ 'svc:75001': { kinetic: 'probably' } });
    const result = await resolveServiceability('75001', ['kinetic'], store as any);
    expect(result.programs[0].status).toBe(COVERAGE_STATUS.UNKNOWN);
    expect(result.programs[0].source).toBe('none');
  });

  it('degrades to unknown when the KV read throws', async () => {
    const store = { get: vi.fn().mockRejectedValue(new Error('kv down')) } as any;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await resolveServiceability('75001', ['kinetic'], store);

    expect(result.programs[0].status).toBe(COVERAGE_STATUS.UNKNOWN);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('flags a malformed ZIP as unresolved rather than absent', async () => {
    const result = await resolveServiceability('7500', ['kinetic'], undefined);
    expect(result.programs[0].status).toBe(COVERAGE_STATUS.UNRESOLVED_ZIP);
  });
});

describe('GET /api/serviceability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns coverage for a well-formed ZIP', async () => {
    const env = makeEnv({ SERVICEABILITY: kvWith({ 'svc:75001': { kinetic: 'covered' } }) });
    const res = await worker.fetch(
      new Request('https://speedreport.org/api/serviceability?zip=75001&programs=kinetic'),
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zip).toBe('75001');
    expect(body.source).toBe('feed');
    expect(body.programs).toEqual([
      { programId: 'kinetic', status: 'covered', source: 'feed' },
    ]);
  });

  it('defaults to the supported program list', async () => {
    const res = await worker.fetch(
      new Request('https://speedreport.org/api/serviceability?zip=75001'),
      makeEnv(),
      ctx,
    );
    const body = await res.json();
    expect(body.programs.map((p: any) => p.programId)).toEqual([...DEFAULT_PROGRAMS]);
  });

  it('rejects a missing ZIP', async () => {
    const res = await worker.fetch(
      new Request('https://speedreport.org/api/serviceability'),
      makeEnv(),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('missing_zip');
  });

  it('rejects a ZIP that is not five digits', async () => {
    // An absent parameter is a missing_zip; a present but malformed one is invalid_zip.
    for (const [zip, code] of [
      ['7500', 'invalid_zip'],
      ['ABCDE', 'invalid_zip'],
      ['75001-1234', 'invalid_zip'],
      ['', 'missing_zip'],
    ]) {
      const res = await worker.fetch(
        new Request(`https://speedreport.org/api/serviceability?zip=${encodeURIComponent(zip)}`),
        makeEnv({ SERVICEABILITY: kvWith({}) }),
        ctx,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
  });

  it('rejects a program id outside the allowlist', async () => {
    const store = kvWith({});
    const res = await worker.fetch(
      new Request('https://speedreport.org/api/serviceability?zip=75001&programs=secret-program'),
      makeEnv({ SERVICEABILITY: store }),
      ctx,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('unknown_program');
    // The allowlist must reject before any KV read happens.
    expect(store.get).not.toHaveBeenCalled();
  });

  it('screens traversal-shaped program ids at the edge before routing', async () => {
    // Belt and braces: the path screen 403s this shape before the handler would
    // ever get to filter it, so it can never become a KV key.
    const store = kvWith({});
    const res = await worker.fetch(
      new Request('https://speedreport.org/api/serviceability?zip=75001&programs=../../secrets'),
      makeEnv({ SERVICEABILITY: store }),
      ctx,
    );

    expect(res.status).toBe(403);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('never echoes the ZIP into a storage write or a log line', async () => {
    const store = kvWith({});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await worker.fetch(
      new Request('https://speedreport.org/api/serviceability?zip=75001&programs=kinetic'),
      makeEnv({ SERVICEABILITY: store }),
      ctx,
    );

    expect(store.put).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('75001');
    expect(JSON.stringify(error.mock.calls)).not.toContain('75001');
    log.mockRestore();
    error.mockRestore();
  });
});

describe('health surface: serviceability binding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the coverage feed state and counts an unbound feed as degraded', async () => {
    const res = await worker.fetch(new Request('https://speedreport.org/health'), makeEnv(), ctx);
    const body = await res.json();

    expect(body.dependencies.serviceability).toBe('unbound');
    expect(body.degraded).toBe(true);
  });

  it('reports a healthy stack when every binding is present', async () => {
    const env = makeEnv({ SERVICEABILITY: kvWith({}) });
    const res = await worker.fetch(new Request('https://speedreport.org/health'), env, ctx);
    const body = await res.json();

    expect(body.dependencies.serviceability).toBe('bound');
    expect(body.degraded).toBe(false);
  });
});
