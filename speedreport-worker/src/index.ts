interface Env {
  ASSETS: { fetch: typeof fetch };
  TELEMETRY?: any;
}
import { handleDownload } from './download';
import { cors, json, telemetryHeaders } from './http';
import { handleMeta } from './meta';
import { handleUpload } from './upload';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ status: 'healthy', timestamp: Date.now() }, 200, request);
    }

    if (url.pathname === '/api/meta' && request.method === 'GET') {
      return handleMeta(request);
    }

    if (url.pathname === '/api/ping' && request.method === 'GET') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          ...telemetryHeaders(request),
          'Content-Length': '0'
        }
      });
    }

    if (url.pathname === '/api/download' && request.method === 'GET') {
      return handleDownload(request, url);
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      return handleUpload(request);
    }

    if (url.pathname === '/api/telemetry' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const dataPoint = {
          blobs: [
            body.bufferbloatGrade || 'unknown',
            body.colo || 'unknown',
            String(body.asn || 'unknown')
          ],
          doubles: [
            body.downloadMbps || 0,
            body.uploadMbps || 0,
            body.idlePingMs || 0,
            body.jitterMs || 0,
            body.loadedPingMs || 0
          ],
          indexes: [body.colo || 'unknown']
        };

        if (env.TELEMETRY) {
          // Write non-PII test metrics to Cloudflare Analytics Engine
          env.TELEMETRY.writeDataPoint(dataPoint);
        } else {
          console.log('Telemetry fallback:', dataPoint);
        }
      } catch (err) {
        // Safe to ignore, ensuring edge telemetry ingestion non-blocking
      }
      return new Response(null, {
        status: 202,
        headers: {
          ...cors,
          'Content-Length': '0'
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
