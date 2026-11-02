import { getCorsHeaders, errorJson } from "./http";

export interface TelemetryPayload {
  event?: string;
  testId?: string;
  sessionId?: string;
  timestamp?: string;
  clientIp?: string;
  isp?: string;
  asn?: number;
  city?: string;
  region?: string;
  country?: string;
  colo?: string;
  metrics?: {
    downloadMbps?: number;
    uploadMbps?: number;
    latencyMs?: number;
    jitterMs?: number;
    bufferbloatDeltaMs?: number;
    bufferbloatGrade?: string;
    packetLossPct?: number;
  };
  downloadMbps?: number;
  uploadMbps?: number;
  latencyMs?: number;
  jitterMs?: number;
  packetLoss?: number;
  clientMeta?: {
    userAgent?: string;
    isp?: string;
    colocation?: string;
    bufferbloatGrade?: string;
    hardwareConcurrency?: string | number;
    deviceMemory?: string | number;
    connection?: any;
    screen?: string;
  };
  leadInfo?: {
    email?: string;
    postalCode?: string;
    requestedFiberCheck?: boolean;
  };
}

export interface FiberProspectEvaluation {
  isFiberProspect: boolean;
  ispTier: "FIBER" | "CABLE" | "DSL" | "SATELLITE" | "WIRELESS" | "UNKNOWN";
  opportunityScore: number;
  reason: string[];
}

export function evaluateFiberProspect(payload: any): FiberProspectEvaluation {
  const downloadMbps = payload.metrics?.downloadMbps ?? payload.downloadMbps ?? 0;
  const uploadMbps = payload.metrics?.uploadMbps ?? payload.uploadMbps ?? 0;
  const latencyMs = payload.metrics?.latencyMs ?? payload.latencyMs ?? 0;
  const bufferbloatGrade = payload.metrics?.bufferbloatGrade ?? payload.clientMeta?.bufferbloatGrade ?? "unknown";

  const ispLower = (payload.isp || payload.clientMeta?.isp || "").toLowerCase();
  const reasons: string[] = [];
  let score = 10;

  // Detect legacy ISP technologies
  let ispTier: FiberProspectEvaluation["ispTier"] = "UNKNOWN";
  if (ispLower.includes("fiber") || (downloadMbps > 500 && uploadMbps > 400)) {
    ispTier = "FIBER";
  } else if (ispLower.includes("spectrum") || ispLower.includes("comcast") || ispLower.includes("xfinity") || ispLower.includes("cox")) {
    ispTier = "CABLE";
  } else if (ispLower.includes("starlink") || ispLower.includes("hughes") || ispLower.includes("viasat")) {
    ispTier = "SATELLITE";
  } else if (ispLower.includes("dsl") || ispLower.includes("centurylink") || ispLower.includes("frontier")) {
    ispTier = "DSL";
  }

  // Score calculation based on speed deficit & asymmetry
  if (ispTier !== "FIBER") {
    score += 30;
    reasons.push("Non-fiber provider detected");
  }

  // Asymmetric speed ratio (typical of cable/DSL)
  if (downloadMbps > 100 && uploadMbps < downloadMbps * 0.2) {
    score += 25;
    reasons.push(`Severely asymmetric upload (${uploadMbps.toFixed(1)} Mbps vs ${downloadMbps.toFixed(1)} Mbps down)`);
  }

  // High bufferbloat or latency
  if (["C", "D", "F"].includes(bufferbloatGrade)) {
    score += 20;
    reasons.push(`High bufferbloat under load (Grade ${bufferbloatGrade})`);
  }

  if (latencyMs > 45) {
    score += 15;
    reasons.push(`High baseline latency (${latencyMs.toFixed(1)}ms)`);
  }

  const isFiberProspect = score >= 50;

  return {
    isFiberProspect,
    ispTier,
    opportunityScore: Math.min(score, 100),
    reason: reasons
  };
}

const DLQ_PREFIX = "dlq:lead:";
const DLQ_TTL_SECONDS = 86_400; // 24h, per Core ingress contract
const DLQ_REPLAY_LIMIT = 10;
const CORE_TIMEOUT_MS = 5_000;

interface DispatchResult {
  ok: boolean;
  status: number;
  reason?: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * HMAC-SHA256 over the exact raw body bytes we are about to transmit, hex
 * encoded. Core recomputes this over the received bytes, so the signed string
 * and the transmitted string must be the same serialization.
 */
async function signBody(secret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  return toHex(signature);
}

function coreTelemetryUrl(env: any): string | null {
  if (!env.AXIM_CORE_URL || !env.AXIM_INTERNAL_KEY) return null;
  return `${env.AXIM_CORE_URL}/api/v1/leads/telemetry`;
}

/**
 * Signed dispatch to Core. Returns a result instead of throwing so callers can
 * decide whether the payload belongs in the dead-letter queue.
 */
async function dispatchToCore(env: any, rawBody: string): Promise<DispatchResult> {
  const url = coreTelemetryUrl(env);
  if (!url) return { ok: false, status: 0, reason: "core_not_configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORE_TIMEOUT_MS);

  try {
    const signature = await signBody(env.AXIM_INTERNAL_KEY, rawBody);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Axim-Signature": signature,
        "X-Axim-Timestamp": Date.now().toString(),
      },
      body: rawBody,
      signal: controller.signal,
    });

    if (response.ok) return { ok: true, status: response.status };
    return { ok: false, status: response.status, reason: `http_${response.status}` };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Park an undeliverable lead dispatch in PROSPECT_STORE. Keyed per test so a
 * retried test overwrites rather than duplicates; the 86400s TTL keeps the
 * namespace bounded even if Core stays unreachable.
 */
async function bufferFailedDispatch(
  env: any,
  testId: string,
  rawBody: string,
  reason: string,
): Promise<void> {
  if (!env.PROSPECT_STORE) {
    // Surfaces a misconfigured binding instead of silently dropping leads.
    console.error(
      JSON.stringify({ event: "telemetry.dlq_unbound", testId, reason }),
    );
    return;
  }

  const key = `${DLQ_PREFIX}${testId}`;
  try {
    await env.PROSPECT_STORE.put(
      key,
      JSON.stringify({ rawBody, reason, bufferedAt: new Date().toISOString() }),
      { expirationTtl: DLQ_TTL_SECONDS },
    );
    console.warn(JSON.stringify({ event: "telemetry.dlq_buffered", key, reason }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "telemetry.dlq_write_failed",
        key,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Best-effort drain of buffered dispatches. Runs on the request path (inside
 * waitUntil) so a recovered Core connection clears the backlog without a
 * separate cron. Stops at the first failure to avoid hammering a struggling
 * Core; the TTL expires anything that never gets through.
 */
async function replayDlq(env: any): Promise<void> {
  if (!env.PROSPECT_STORE || typeof env.PROSPECT_STORE.list !== "function") return;
  if (!coreTelemetryUrl(env)) return;

  try {
    const listing = await env.PROSPECT_STORE.list({
      prefix: DLQ_PREFIX,
      limit: DLQ_REPLAY_LIMIT,
    });

    for (const entry of listing?.keys ?? []) {
      const key = typeof entry === "string" ? entry : entry?.name;
      if (!key) continue;

      const stored = await env.PROSPECT_STORE.get(key);
      if (!stored) continue;

      let rawBody: string | null = null;
      try {
        rawBody = JSON.parse(stored)?.rawBody ?? null;
      } catch {
        rawBody = null;
      }

      if (!rawBody) {
        // Unparseable entry can never succeed; drop it rather than retrying forever.
        await env.PROSPECT_STORE.delete(key);
        continue;
      }

      const result = await dispatchToCore(env, rawBody);
      if (!result.ok) break;

      await env.PROSPECT_STORE.delete(key);
      console.log(JSON.stringify({ event: "telemetry.dlq_replayed", key }));
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "telemetry.dlq_replay_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function handleTelemetry(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const correlationId = request.headers.get("CF-Ray") || crypto.randomUUID();

  try {
    const body: unknown = await request.json();
    let payloads: any[] = Array.isArray(body) ? body : (body && typeof body === "object" ? [body] : []);

    if (payloads.length === 0) {
      return errorJson("Invalid telemetry payload", "invalid_payload", 400, request, env);
    }

    ctx.waitUntil(
      (async () => {
        try {
          // Drain anything parked by an earlier failed dispatch before adding more.
          await replayDlq(env);

          for (const payload of payloads) {
            if (!payload || typeof payload !== "object") continue;

            const prospectEval = evaluateFiberProspect(payload);
            console.log(JSON.stringify({ event: "telemetry.prospect_evaluation", eval: prospectEval, testId: payload.testId || payload.sessionId }));

            const shouldForwardLead = prospectEval.opportunityScore >= 50 || Boolean(payload.leadInfo?.email);

            if (shouldForwardLead) {
              const testId = String(payload.testId ?? payload.sessionId ?? crypto.randomUUID());
              const rawBody = JSON.stringify({ payload, evaluation: prospectEval });
              const result = await dispatchToCore(env, rawBody);

              if (!result.ok) {
                await bufferFailedDispatch(env, testId, rawBody, result.reason ?? "dispatch_failed");
              }
            }

            let sessionId = payload.sessionId ?? payload.testId;
            let timestamp = payload.timestamp ?? payload.clientTimestamp;

            let pingMs = payload.latencyMs ?? payload.metrics?.latencyMs ?? payload.idlePingMs ?? 0;
            let downloadMbps = payload.downloadMbps ?? payload.metrics?.downloadMbps ?? 0;
            let uploadMbps = payload.uploadMbps ?? payload.metrics?.uploadMbps ?? 0;
            let jitterMs = payload.jitterMs ?? payload.metrics?.jitterMs ?? 0;
            let packetLoss = payload.packetLoss ?? payload.metrics?.packetLossPct ?? 0;

            let userAgent = payload.clientMeta?.userAgent ?? payload.clientMetadata?.userAgent ?? payload.client?.userAgent ?? "unknown";
            let isp = payload.isp ?? payload.clientMeta?.isp ?? payload.clientMetadata?.isp ?? payload.asn ?? "unknown";
            let colocation = payload.colo ?? payload.clientMeta?.colocation ?? payload.clientMetadata?.colocation ?? "unknown";

            let bufferbloatGrade = payload.metrics?.bufferbloatGrade ?? payload.clientMeta?.bufferbloatGrade ?? payload.bufferbloatGrade ?? "unknown";

            if (sessionId && typeof sessionId !== "string") continue;
            if (timestamp && typeof timestamp !== "string") continue;
            if (typeof downloadMbps !== "number" || typeof uploadMbps !== "number" || typeof pingMs !== "number" || typeof jitterMs !== "number" || typeof packetLoss !== "number") continue;

            if (env.TELEMETRY && env.TELEMETRY.writeDataPoint) {
              env.TELEMETRY.writeDataPoint({
                blobs: [
                  String(bufferbloatGrade),
                  String(colocation),
                  String(isp),
                  String(sessionId ?? "unknown"),
                  String(userAgent)
                ],
                doubles: [
                  Number(downloadMbps) || 0,
                  Number(uploadMbps) || 0,
                  Number(pingMs) || 0,
                  Number(jitterMs) || 0,
                  Number(packetLoss) || 0,
                ],
                indexes: [String(colocation)],
              });
            } else {
              console.log(JSON.stringify({ event: "telemetry.log", payload }));
            }
          }
        } catch (error) {
          console.error(JSON.stringify({ event: "telemetry.write_failed", error: error instanceof Error ? error.message : String(error), payloads }));
        }
      })()
    );

    return new Response(JSON.stringify({ success: true, received: true, id: correlationId }), {
      status: 202,
      headers: {
        ...getCorsHeaders(request, env),
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "telemetry.invalid_payload",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response(JSON.stringify({ error: true, message: "Invalid payload" }), {
      status: 400,
      headers: {
        ...getCorsHeaders(request, env),
        "Content-Type": "application/json"
      }
    });
  }
}


export interface LeadPayload {
  testId: string;
  email?: string;
  postalCode?: string;
  metrics: {
    downloadMbps: number;
    uploadMbps: number;
    latencyMs: number;
    jitterMs?: number;
    bufferbloatGrade?: string;
  };
  isp?: string;
  colo?: string;
}

export async function handleLeadSubmission(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";

  try {
    const body: unknown = await request.json();
    const payload = body as LeadPayload;

    if (!payload.testId || !payload.metrics) {
      return errorJson("Invalid lead payload", "invalid_payload", 400, request, env);
    }

    if (env.PROSPECT_STORE) {
      const key = `rate_limit:lead:${clientIp}`;
      const current = await env.PROSPECT_STORE.get(key);
      const count = current ? parseInt(current, 10) : 0;
      if (count >= 30) {
        return errorJson("Rate limit exceeded", "rate_limit", 429, request, env);
      }
      await env.PROSPECT_STORE.put(key, (count + 1).toString(), { expirationTtl: 1800 });
    } else {
      // Without the binding the limiter is a no-op; make that visible instead of
      // quietly accepting unlimited lead submissions.
      console.error(JSON.stringify({ event: "lead.rate_limit_unbound", clientIp }));
    }

    const leadId = crypto.randomUUID();

    ctx.waitUntil((async () => {
      try {
        const rawBody = JSON.stringify({ payload, leadId, type: "manual_lead" });
        const result = await dispatchToCore(env, rawBody);

        if (!result.ok) {
          await bufferFailedDispatch(
            env,
            String(payload.testId),
            rawBody,
            result.reason ?? "dispatch_failed",
          );
        }
      } catch (err) {
        console.error("Failed to forward lead to core", err);
      }
    })());

    return new Response(JSON.stringify({ success: true, leadId }), {
      status: 200,
      headers: {
        ...getCorsHeaders(request, env),
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return errorJson("Invalid payload", "invalid_payload", 400, request, env);
  }
}
