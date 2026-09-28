import { json } from './http';

export function handleMeta(request: Request): Response {
  const cf = (request as any).cf || {};
  const meta = {
    ip: request.headers.get("cf-connecting-ip") || "127.0.0.1",
    city: cf.city || "Unknown City",
    region: cf.region || "Unknown Region",
    country: cf.country || "US",
    colo: cf.colo || "DFW",
    asn: cf.asn ? `AS${cf.asn}` : "AS0",
    asOrganization: cf.asOrganization || "Private Network",
    clientTcpRtt: cf.clientTcpRtt ?? 0,
    timestamp: Date.now()
  };

  return json(meta, 200, request);
}
