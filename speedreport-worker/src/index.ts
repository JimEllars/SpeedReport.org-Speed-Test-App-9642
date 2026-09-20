import { handleDownload } from './download';
import { cors, json } from './http';
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

    if (url.pathname === '/api/meta' && request.method === 'GET') {
      return handleMeta(request);
    }

    if (url.pathname === '/api/ping' && request.method === 'GET') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Content-Length': '0'
        }
      });
    }

    if (url.pathname === '/api/download' && request.method === 'GET') {
      return handleDownload(url);
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      return handleUpload(request);
    }

    return json({ error: 'Not found' }, 404);
  }
};