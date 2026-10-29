import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 256 * 1024;

export function verifySignature(rawBody, signature, key) {
  if (!key || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', key).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Accepts both Worker envelopes: { payload, evaluation } and { payload, leadId, type }.
export function normalizeLead(envelope) {
  const p = envelope?.payload;
  if (!p || typeof p !== 'object') return null;
  const testId = p.testId ?? p.sessionId;
  if (!testId) return null;

  const m = p.metrics ?? {};
  const metrics = {
    latencyMs: num(m.latencyMs ?? p.latencyMs ?? p.idlePingMs),
    downloadMbps: num(m.downloadMbps ?? p.downloadMbps),
    uploadMbps: num(m.uploadMbps ?? p.uploadMbps),
    jitterMs: num(m.jitterMs ?? p.jitterMs),
    packetLossPct: num(m.packetLossPct ?? p.packetLoss),
    bufferbloatGrade: m.bufferbloatGrade ?? p.bufferbloatGrade ?? null,
  };
  const evaluation = envelope.evaluation ?? {};
  const email = (p.email ?? p.leadInfo?.email ?? '').toString().trim().toLowerCase() || null;

  return {
    test_id: String(testId),
    lead_type: envelope.type ?? 'telemetry',
    email,
    zip_code: p.postalCode ?? p.leadInfo?.zip ?? p.leadInfo?.postalCode ?? null,
    isp: p.isp ?? p.clientMeta?.isp ?? null,
    colo: p.colo ?? null,
    metrics,
    sla_status: p.sla ?? p.slaStatus ?? {},
    prospect_eval: evaluation,
    opportunity_score: num(evaluation.opportunityScore),
    raw_payload: p,
  };
}

// Phase 2 stub: predictive lead scoring will be invoked here.
export async function onLeadIngested(lead, log = console) {
  log.info(JSON.stringify({ event: 'lead.ingested', testId: lead.test_id, leadType: lead.lead_type }));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// store.upsertLead(row) => Promise<void>; throws on failure.
export function createHandler({ internalKey, store, log = console, afterIngest = onLeadIngested }) {
  return async function handler(req, res) {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true });
    if (url !== '/api/v1/leads/telemetry') return send(res, 404, { error: 'not_found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return send(res, e.status || 400, { error: 'invalid_body' });
    }

    if (!verifySignature(raw, req.headers['x-axim-signature'], internalKey)) {
      return send(res, 401, { error: 'unauthorized' });
    }

    let envelope;
    try {
      envelope = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, { error: 'invalid_json' });
    }
    const lead = normalizeLead(envelope);
    if (!lead) return send(res, 400, { error: 'invalid_payload' });

    try {
      await store.upsertLead(lead);
    } catch (e) {
      log.error('lead upsert failed', e);
      return send(res, 500, { error: 'storage_error' });
    }

    setImmediate(() => {
      Promise.resolve(afterIngest(lead, log)).catch((e) => log.error('post-ingest handler failed', e));
    });
    return send(res, 200, { success: true, testId: lead.test_id });
  };
}
