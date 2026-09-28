import { getCorsHeaders, errorJson } from "./http";

export interface TelemetryPayload {
  sessionId?: string;
  timestamp?: string;
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
  };
}

// Ensure the old format is still supported if needed, but validate new fields.
export async function handleTelemetry(request: Request, env: any): Promise<Response> {
  try {
    const body: unknown = await request.json();

    let payloads: any[] = [];
    if (Array.isArray(body)) {
      payloads = body;
    } else if (body && typeof body === "object") {
      payloads = [body];
    } else {
      return errorJson("Invalid telemetry payload", "invalid_payload", 400, request);
    }

    let processedCount = 0;

    for (const payload of payloads) {
      if (!payload || typeof payload !== "object") {
        continue;
      }

      // Validate fields according to new format
      let sessionId = payload.sessionId;
      let timestamp = payload.timestamp ?? payload.clientTimestamp;

      // We can accept the old format which might be flat, or the new structured format.
      let pingMs = payload.latencyMs ?? payload.metrics?.pingMs ?? payload.idlePingMs ?? 0;
      let downloadMbps = payload.downloadMbps ?? payload.metrics?.downloadMbps ?? 0;
      let uploadMbps = payload.uploadMbps ?? payload.metrics?.uploadMbps ?? 0;
      let jitterMs = payload.jitterMs ?? payload.metrics?.jitterMs ?? 0;
      let packetLoss = payload.packetLoss ?? payload.metrics?.packetLossPct ?? 0;

      let userAgent = payload.clientMeta?.userAgent ?? payload.clientMetadata?.userAgent ?? payload.client?.userAgent ?? "unknown";
      let isp = payload.clientMeta?.isp ?? payload.clientMetadata?.isp ?? payload.asn ?? "unknown"; // Fallback to ASN
      let colocation = payload.clientMeta?.colocation ?? payload.clientMetadata?.colocation ?? payload.colo ?? "unknown";

      let bufferbloatGrade = payload.clientMeta?.bufferbloatGrade ?? payload.bufferbloatGrade ?? "unknown";

      if (sessionId && typeof sessionId !== "string") {
        continue;
      }

      if (timestamp && typeof timestamp !== "string") {
        continue;
      }

      if (typeof downloadMbps !== "number" || typeof uploadMbps !== "number" || typeof pingMs !== "number" || typeof jitterMs !== "number" || typeof packetLoss !== "number") {
          continue;
      }

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
      processedCount++;
    }

    const rayId = request.headers.get("CF-Ray") || "unknown";

    return new Response(JSON.stringify({ success: true, recorded: true, batchSize: processedCount, rayId }), {
      status: 200,
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
