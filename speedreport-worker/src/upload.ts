import { json } from './http';

export async function handleUpload(request: Request): Promise<Response> {
  if (!request.body) {
    return json({
      receivedBytes: 0,
      durationMs: 0
    }, 200, request);
  }

  const started = Date.now();
  let receivedBytes = 0;

  try {
    // Read and immediately discard body to avoid memory accumulation
    const reader = request.body.getReader();
    while (true) {
      if (request.signal.aborted) {
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.byteLength;
      }
    }
    reader.releaseLock();
  } catch (err) {
    // ignore
  }

  const durationMs = Math.max(Date.now() - started, 1);
  const response = json({
    receivedBytes,
    durationMs
  }, 200, request);

  response.headers.set('X-Received-Bytes', String(receivedBytes));
  response.headers.set('X-Duration-Ms', String(durationMs));

  return response;
}
