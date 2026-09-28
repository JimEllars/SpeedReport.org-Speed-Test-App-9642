
export const defaultCorsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
  'Access-Control-Expose-Headers': 'Server-Timing, cf-ray, cf-colo, cf-proto, X-Received-Bytes, X-Duration-Ms',
  'Access-Control-Max-Age': '86400',
  'Timing-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Encoding': 'identity',
  'X-Accel-Buffering': 'no'
};

export function getCorsHeaders(request?: Request): Record<string, string> {
  let origin = '*';
  if (request) {
    const reqOrigin = request.headers.get('Origin');
    if (reqOrigin) {
      origin = reqOrigin;
    }
  }

  return {
    ...defaultCorsHeaders,
    'Access-Control-Allow-Origin': origin,
  };
}

interface RequestCfProperties {
  colo?: string;
  httpProtocol?: string;
}

type RequestWithCf = Request & {
  cf?: RequestCfProperties;
};

export function telemetryHeaders(request: Request): Record<string, string> {
  const cfRay = request.headers.get('cf-ray') || '';
  const { cf } = request as RequestWithCf;
  const colo = cf?.colo || '';
  const httpProtocol = cf?.httpProtocol || '';

  const headers: Record<string, string> = {
    'Server-Timing': `edge;dur=0;desc="${colo}"`
  };

  if (cfRay) headers['cf-ray'] = cfRay;
  if (colo) headers['cf-colo'] = colo;
  if (httpProtocol) headers['cf-proto'] = httpProtocol;

  return headers;
}

export function json(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(request),
      ...(request ? telemetryHeaders(request) : {}),
      'Content-Type': 'application/json'
    }
  });
}
