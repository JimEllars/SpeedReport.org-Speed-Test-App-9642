import { json } from './http';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function handleUpload(request: Request): Promise<Response> {
  if (!request.body) {
    return json({ error: 'An upload payload is required' }, 400, request);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return json({ error: 'Upload payload exceeds the 8 MiB limit' }, 413, request);
  }

  const started = Date.now();
  let receivedBytes = 0;
  const reader = request.body.getReader();

  try {
    while (true) {
      if (request.signal.aborted) {
        return json({ error: 'Upload was cancelled' }, 499, request);
      }

      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_UPLOAD_BYTES) {
        return json({ error: 'Upload payload exceeds the 8 MiB limit' }, 413, request);
      }
    }
  } catch (error) {
    console.error('Unable to read upload payload', error);
    return json({ error: 'Unable to read upload payload' }, 400, request);
  } finally {
    reader.releaseLock();
  }

  const durationMs = Math.max(Date.now() - started, 1);
  const response = json({
    receivedBytes,
    durationMs
  }, 200, request);

  response.headers.set('X-Received-Bytes', String(receivedBytes));
  response.headers.set('X-Duration-Ms', String(durationMs));

  // Use existing server timing header if present from json helper, or add upload duration
  const existingTiming = response.headers.get('Server-Timing') || '';
  const prefix = existingTiming ? `${existingTiming}, ` : '';
  response.headers.set('Server-Timing', `${prefix}upload;dur=${durationMs}`);

  return response;
}
