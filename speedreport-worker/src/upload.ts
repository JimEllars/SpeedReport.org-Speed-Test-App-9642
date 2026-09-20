import { json } from './http';

export async function handleUpload(request: Request): Promise<Response> {
  if (!request.body) {
    return json({
      receivedBytes: 0,
      durationMs: 0
    }, 200, request);
  }

  const started = Date.now();
  const reader = request.body.getReader();
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return json({
    receivedBytes,
    durationMs: Math.max(Date.now() - started, 1)
  }, 200, request);
}
