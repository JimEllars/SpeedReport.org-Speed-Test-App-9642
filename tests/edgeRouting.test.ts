// @vitest-environment node
// Guards the *deployment* contract behind the edge screening, not just the
// handler. `tests/worker.test.ts` calls `worker.fetch()` directly, so it passes
// even when production routes a hostile path straight to the asset layer and
// `isBlockedRequest()` never runs - which is what was happening: `/api/*`
// returned 403 while `/wp-admin/` and `/xmlrpc.php` returned a 200 index.html.
//
// `run_worker_first` is the only thing that puts the Worker in front of the
// asset router, so every blocked path shape must appear inside it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const configPath = fileURLToPath(new URL('../speedreport-worker/wrangler.jsonc', import.meta.url));
const config = readFileSync(configPath, 'utf8');

// The file is JSONC: strip // comments so the patterns can be read without
// pulling in a JSONC parser for one assertion.
const withoutComments = config
  .split('\n')
  .map((line) => line.replace(/^(\s*)\/\/.*$/, '$1'))
  .join('\n');

function readRunWorkerFirst(): string[] {
  const match = withoutComments.match(/"run_worker_first"\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Workers asset routing treats `*` as "any number of characters".
function matchesRoute(path: string, pattern: string): boolean {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`).test(path);
}

const runWorkerFirst = readRunWorkerFirst();

// One representative path per screening rule in `isBlockedRequest`. Keep this in
// step with the matrix in tests/worker.test.ts.
const hostilePaths = [
  '/wp-admin/',
  '/wp-admin/admin-ajax.php',
  '/wp-login.php',
  '/wp-content/plugins/shell.php',
  '/wp-includes/blah.php',
  '/xmlrpc.php',
  '/cgi-bin/status',
  '/index.php',
  '/api/meta',
  '/api/ping',
  '/api/upload',
  '/health',
];

describe('edge screening routing', () => {
  it('declares a run_worker_first list', () => {
    expect(runWorkerFirst.length).toBeGreaterThan(0);
  });

  it.each(hostilePaths)('routes %s through the Worker so the 403 screen can run', (path) => {
    const covered = runWorkerFirst.some((pattern) => matchesRoute(path, pattern));
    expect(covered, `no run_worker_first pattern covers ${path}; it will be served by the asset layer`).toBe(true);
  });

  it('does not route ordinary static asset requests through the Worker', () => {
    // Asset paths are the bulk of traffic; keeping them on the asset router is
    // the reason this is a pattern list rather than `run_worker_first: true`.
    for (const asset of ['/', '/assets/index-CLM-iS62.js', '/favicon.ico', '/manifest.json']) {
      const covered = runWorkerFirst.some((pattern) => matchesRoute(asset, pattern));
      expect(covered, `${asset} should stay on the asset router`).toBe(false);
    }
  });

  it('leaves the query-string-only vector documented rather than silently uncovered', () => {
    // `/?-d+allow_url_include=on` is screened by isBlockedRequest, but a route
    // pattern constrains the path only, so `/` cannot be routed without pushing
    // every asset request through the Worker. The residual is recorded in
    // wrangler.jsonc and Continued Development Plan.md.
    expect(config).toContain('run_worker_first: true');
    expect(config).toContain('Continued Development Plan.md');
  });
});
