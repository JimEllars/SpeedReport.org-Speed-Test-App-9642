import { json } from './http';

interface CloudflareRequest extends Request {
  cf?: {
    asOrganization?: string;
    asn?: number;
    city?: string;
    region?: string;
    country?: string;
    postalCode?: string;
    latitude?: string;
    longitude?: string;
    colo?: string;
    httpProtocol?: string;
    tlsVersion?: string;
  };
}

export function handleMeta(request: CloudflareRequest): Response {
  if (!request.cf) {
    return json({
      ip: request.headers.get('cf-connecting-ip') || '127.0.0.1',
      isp: 'Local Testing',
      asn: 0,
      city: 'Local',
      region: '',
      country: 'US',
      postalCode: '',
      latitude: '',
      longitude: '',
      colo: 'Local',
      httpProtocol: 'HTTP/1.1',
      tlsVersion: 'unknown'
    }, 200, request);
  }

  return json({
    ip: request.headers.get('cf-connecting-ip') || 'Unknown',
    isp: request.cf?.asOrganization || 'Commercial Broadband',
    asn: request.cf?.asn || 0,
    city: request.cf?.city || 'Local',
    region: request.cf?.region || '',
    country: request.cf?.country || 'US',
    postalCode: request.cf?.postalCode || '',
    latitude: request.cf?.latitude || '',
    longitude: request.cf?.longitude || '',
    colo: request.cf?.colo || 'Nearest',
    httpProtocol: request.cf?.httpProtocol || 'unknown',
    tlsVersion: request.cf?.tlsVersion || 'unknown'
  }, 200, request);
}
