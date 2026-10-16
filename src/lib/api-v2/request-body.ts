import { AppError } from '@/lib/errors';

export const V2_MAX_BODY_BYTES = 1_048_576;
export const V2_MAX_JSON_DEPTH = 32;

/** Bound streamed bodies too: Content-Length is advisory and may be absent. */
export async function readV2JsonBody(req: Request): Promise<unknown> {
  const length = req.headers.get('content-length');
  if (length && Number(length) > V2_MAX_BODY_BYTES) {
    throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
  }
  const reader = req.body?.getReader();
  if (!reader) throw new AppError({ code: 'INVALID_JSON' });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > V2_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AppError({ code: 'INVALID_JSON' });
  }
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.depth > V2_MAX_JSON_DEPTH) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'JSON nesting exceeds 32 levels.',
      });
    }
    if (entry.value && typeof entry.value === 'object') {
      for (const nested of Object.values(entry.value)) {
        pending.push({ value: nested, depth: entry.depth + 1 });
      }
    }
  }
  return value;
}
