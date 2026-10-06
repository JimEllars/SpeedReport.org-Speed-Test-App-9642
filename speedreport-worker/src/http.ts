export const defaultCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Id, X-SpeedReport-Client, Cache-Control, x-test-run-id, x-timestamp',
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

export function getCorsHeaders(request?: Request, env?: any): Record<string, string> {
  const origin = request?.headers.get('Origin');
  let allowedOrigin = '*';

  if (origin) {
    const defaultAllowed = ['https://speedreport.org', 'http://localhost:5173'];
    const envAllowed = env?.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s: string) => s.trim()) : [];
    const allAllowed = [...defaultAllowed, ...envAllowed];

    if (allAllowed.includes(origin) || origin.endsWith('.pages.dev')) {
      allowedOrigin = origin;
    } else {
      allowedOrigin = defaultAllowed[0]; // Strict fallback instead of mirroring
    }
  }

  return {
    ...defaultCorsHeaders,
    'Access-Control-Allow-Origin': allowedOrigin
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

export function json(data: unknown, status = 200, request?: Request, env?: any): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(request, env),
      ...(request ? telemetryHeaders(request) : {}),
      'Content-Type': 'application/json'
    }
  });
}

export function errorJson(
  message: string,
  code: string,
  status = 400,
  request?: Request,
  env?: any
): Response {
  return new Response(
    JSON.stringify({
      error: true,
      message,
      code,
      timestamp: new Date().toISOString()
    }),
    {
      status,
      headers: {
        ...getCorsHeaders(request),
        ...(request ? telemetryHeaders(request) : {}),
        "Content-Type": "application/json"
      }
    }
  );
}
