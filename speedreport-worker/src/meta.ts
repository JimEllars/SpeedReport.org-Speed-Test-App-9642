import { json } from './http';

interface CloudflareRequest extends Request {
  cf?: {
    asOrganization?: string;
    asn?: number;
    city?: string;
    region?: string;
    country?: string;
    colo?: string;
  };
}

export function handleMeta(request: CloudflareRequest): Response {
  return json({
    ip: request.headers.get('cf-connecting-ip') || 'Unknown',
    isp: request.cf?.asOrganization || 'Commercial Broadband',
    asn: request.cf?.asn || 0,
    city: request.cf?.city || 'Local',
    region: request.cf?.region || '',
    country: request.cf?.country || 'US',
    colo: request.cf?.colo || 'Nearest'
  });
}