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

export async function handleTelemetry(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const correlationId = request.headers.get("CF-Ray") || crypto.randomUUID();

  try {
    const body: unknown = await request.json();
    let payloads: any[] = Array.isArray(body) ? body : (body && typeof body === "object" ? [body] : []);

    if (payloads.length === 0) {
      return errorJson("Invalid telemetry payload", "invalid_payload", 400, request);
    }

    ctx.waitUntil(
      (async () => {
        try {
          for (const payload of payloads) {
            if (!payload || typeof payload !== "object") continue;

            const prospectEval = evaluateFiberProspect(payload);
            console.log(JSON.stringify({ event: "telemetry.prospect_evaluation", eval: prospectEval, testId: payload.testId || payload.sessionId }));

            const shouldForwardLead = prospectEval.opportunityScore >= 50 || Boolean(payload.leadInfo?.email);

            if (shouldForwardLead && env.AXIM_CORE_URL && env.AXIM_INTERNAL_KEY) {
              const url = `${env.AXIM_CORE_URL}/api/v1/leads/telemetry`;
              fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Axim-Signature": env.AXIM_INTERNAL_KEY
                },
                body: JSON.stringify({ payload, evaluation: prospectEval })
              }).catch(err => {
                console.error("Failed to forward lead to AXIM Core", err);
              });
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
        ...getCorsHeaders(request),
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
        ...getCorsHeaders(request),
        "Content-Type": "application/json"
      }
    });
  }
}
