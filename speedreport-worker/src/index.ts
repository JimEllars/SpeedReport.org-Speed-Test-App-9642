import { handleDownload } from './download';
import { cors, json, telemetryHeaders } from './http';
import { handleMeta } from './meta';
import { handleUpload } from './upload';

export default {
  async fetch(request: Request): Promise<Response> {
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

    return json({ error: 'Not found' }, 404, request);
  }
};
