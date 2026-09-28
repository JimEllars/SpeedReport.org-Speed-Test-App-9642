import { getCorsHeaders } from "./http";

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
    if (!body || typeof body !== "object") {
      return new Response("Invalid telemetry payload", { status: 400 });
    }

    const payload = body as any;

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
      return new Response("Invalid sessionId", { status: 400 });
    }

    if (clientTimestamp && typeof clientTimestamp !== "string") {
      return new Response("Invalid clientTimestamp", { status: 400 });
    }

    // Extract timestamp if valid ISO string
    let recordedAt = new Date().toISOString();

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

    return new Response(JSON.stringify({ success: true, recordedAt }), {
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
    return new Response("Invalid telemetry payload", { status: 400 });
  }
}
