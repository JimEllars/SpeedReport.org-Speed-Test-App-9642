import { cors, telemetryHeaders } from './http';

const CHUNK_SIZE = 64 * 1024;
const DEFAULT_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;

export function handleDownload(request: Request, url: URL): Response {
  const requested = Number(url.searchParams.get('bytes')) || DEFAULT_BYTES;
  const target = Math.min(Math.max(requested, CHUNK_SIZE), MAX_BYTES);
  const chunk = new Uint8Array(CHUNK_SIZE);
  let sent = 0;

  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= target) {
        controller.close();
        return;
      }
      const remaining = target - sent;
      const output = remaining >= CHUNK_SIZE ? chunk : chunk.slice(0, remaining);
      controller.enqueue(output);
      sent += output.byteLength;
    }
  });

  return new Response(stream, {
    headers: {
      ...cors,
      ...telemetryHeaders(request),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(target),
      'Content-Encoding': 'identity'
    }
  });
}
