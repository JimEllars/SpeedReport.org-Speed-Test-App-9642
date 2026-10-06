import { json } from './http';

export function handleMeta(request: Request, env?: any): Response {
  const cf = (request as any).cf || {};
  const clientIpSanitized = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const meta = {
    ip: clientIpSanitized,
    clientIp: clientIpSanitized,
    city: cf.city || "Unknown City",
    region: cf.region || "Unknown Region",
    country: cf.country || "US",
    colo: cf.colo || 'DIRECT',
    asn: cf.asn ? `AS${cf.asn}` : null,
    asOrganization: cf.asOrganization || 'Unknown ISP',
    httpProtocol: cf.httpProtocol || 'HTTP/2',
    tlsCipher: cf.tlsCipher || '',
    clientTcpRtt: cf.clientTcpRtt ?? 0,
    timestamp: Date.now()
  };

  return json(meta, 200, request, env);
}
