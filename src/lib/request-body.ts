export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('REQUEST_BODY_TOO_LARGE');
    this.name = 'RequestBodyTooLargeError';
  }
}

/**
 * Read a request body while enforcing a real byte ceiling as the stream is consumed. Content-Length is only
 * an early rejection hint; chunked requests and clients that omit it are still bounded by the counter.
 */
async function readBodyBytesWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) {
    throw new SyntaxError('Request body is required');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('request body limit exceeded');
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Parse a JSON request body under a streaming byte ceiling. */
export async function readJsonBodyWithLimit(request: Request, maxBytes: number): Promise<unknown> {
  const body = await readBodyBytesWithLimit(request, maxBytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  return JSON.parse(text) as unknown;
}

/** Read a UTF-8 text request body (YAML, CSV, plain text) under a streaming byte ceiling. */
export async function readTextBodyWithLimit(request: Request, maxBytes: number): Promise<string> {
  const body = await readBodyBytesWithLimit(request, maxBytes);
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}
