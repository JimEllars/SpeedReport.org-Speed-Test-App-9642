import { json } from './http';

export function handleMeta(request: Request): Response {
  const cf = request.cf;

  if (!cf) {
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
    isp: cf.asOrganization || 'Commercial Broadband',
    asn: cf.asn || 0,
    city: cf.city || 'Local',
    region: cf.region || '',
    country: cf.country || 'US',
    postalCode: cf.postalCode || '',
    latitude: cf.latitude || '',
    longitude: cf.longitude || '',
    colo: cf.colo || 'Nearest',
    httpProtocol: cf.httpProtocol || 'unknown',
    tlsVersion: cf.tlsVersion || 'unknown'
  }, 200, request);
}
