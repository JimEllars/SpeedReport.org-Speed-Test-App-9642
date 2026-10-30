import { verifySignature, normalizeLead, onLeadIngested } from './handler.js';

const MAX_BODY_BYTES = 256 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function upsertLead(env, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?on_conflict=test_id`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`supabase ${res.status}`);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/health') return json(200, { ok: true });
    if (pathname !== '/api/v1/leads/telemetry') return json(404, { error: 'not_found' });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'invalid_body' });

    if (!verifySignature(raw, request.headers.get('x-axim-signature'), env.AXIM_INTERNAL_KEY)) {
      return json(401, { error: 'unauthorized' });
    }

    let envelope;
    try {
      envelope = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(400, { error: 'invalid_json' });
    }
    const lead = normalizeLead(envelope);
    if (!lead) return json(400, { error: 'invalid_payload' });

    try {
      await upsertLead(env, lead);
    } catch (e) {
      console.error('lead upsert failed', e);
      return json(500, { error: 'storage_error' });
    }

    ctx.waitUntil(onLeadIngested(lead).catch((e) => console.error('post-ingest failed', e)));
    return json(200, { success: true, testId: lead.test_id });
  },
};
