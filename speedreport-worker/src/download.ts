import { getCorsHeaders, telemetryHeaders } from './http';

const CHUNK_SIZE = 64 * 1024;
const DEFAULT_BYTES = 25 * 1024 * 1024;
const MAX_BYTES = 100 * 1024 * 1024;

const STATIC_CHUNK = new Uint8Array(CHUNK_SIZE);
let isChunkInitialized = false;

function initializeChunk() {
  if (!isChunkInitialized) {
    crypto.getRandomValues(STATIC_CHUNK);
    isChunkInitialized = true;
  }
}

export function handleDownload(request: Request, url: URL): Response {
  initializeChunk();
  const requested = Number(url.searchParams.get('bytes')) || DEFAULT_BYTES;
  const target = Math.min(Math.max(requested, CHUNK_SIZE), MAX_BYTES);
  let sent = 0;

  const stream = new ReadableStream({
    cancel() {
      // Abort controller handled in pull already but we can provide explicit cancel
    },
    pull(controller) {
      if (request.signal.aborted) {
        controller.close();
        return;
      }
      if (sent >= target) {
        controller.close();
        return;
      }
      const remaining = target - sent;
      const size = Math.min(remaining, CHUNK_SIZE);
      const chunk = size === CHUNK_SIZE ? STATIC_CHUNK : STATIC_CHUNK.subarray(0, size);
      controller.enqueue(chunk);
      sent += size;
    }
  });

  return new Response(stream, {
    headers: {
      ...getCorsHeaders(request),
      ...telemetryHeaders(request),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(target),
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    }
  });
}
