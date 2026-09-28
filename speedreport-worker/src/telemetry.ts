import { getCorsHeaders, errorJson } from "./http";

export interface TelemetryPayload {
  sessionId?: string;
  clientTimestamp?: string;
  metrics?: {
    pingMs?: number;
    downloadMbps?: number;
    uploadMbps?: number;
    jitterMs?: number;
    packetLossPct?: number;
  };
  clientMetadata?: {
    userAgent?: string;
    isp?: string;
    colocation?: string;
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
      let clientTimestamp = payload.clientTimestamp;

      // We can accept the old format which might be flat, or the new structured format.
      let pingMs = payload.metrics?.pingMs ?? payload.idlePingMs ?? 0;
      let downloadMbps = payload.metrics?.downloadMbps ?? payload.downloadMbps ?? 0;
      let uploadMbps = payload.metrics?.uploadMbps ?? payload.uploadMbps ?? 0;
      let jitterMs = payload.metrics?.jitterMs ?? payload.jitterMs ?? 0;
      let packetLossPct = payload.metrics?.packetLossPct ?? payload.packetLossPct ?? 0;

      let userAgent = payload.clientMetadata?.userAgent ?? payload.client?.userAgent ?? "unknown";
      let isp = payload.clientMetadata?.isp ?? payload.asn ?? "unknown"; // Fallback to ASN
      let colocation = payload.clientMetadata?.colocation ?? payload.colo ?? "unknown";

      let bufferbloatGrade = payload.bufferbloatGrade ?? "unknown";

      if (sessionId && typeof sessionId !== "string") {
        continue;
      }

      if (clientTimestamp && typeof clientTimestamp !== "string") {
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
          Number(packetLossPct) || 0,
        ],
        indexes: [String(colocation)],
      });
      processedCount++;
    }

    let recordedAt = new Date().toISOString();

    return new Response(JSON.stringify({ success: true, recordedAt, processedCount }), {
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
    // Don't throw 500 status codes for malformed entries
    return new Response(JSON.stringify({ success: true, ignored: true }), {
      status: 202,
      headers: {
        ...getCorsHeaders(request),
        "Content-Type": "application/json"
      }
    });
  }
}
