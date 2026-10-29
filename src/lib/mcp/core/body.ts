import { McpBoundaryError, requireMcp } from './errors';

/** Bound bytes and total read time, including chunked/slow request bodies. */
export async function readBoundedMcpText(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  requireMcp(reader, 'MCP_EMPTY_BODY');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpBoundaryError('MCP_BODY_TIMEOUT', 408)), 5000);
  });
  try {
    for (;;) {
      requireMcp(!request.signal.aborted, 'MCP_CANCELLED', 408);
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      requireMcp(size <= maxBytes, 'MCP_BODY_TOO_LARGE', 413);
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel();
    reader.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new McpBoundaryError('MCP_INVALID_ENCODING');
  }
}
