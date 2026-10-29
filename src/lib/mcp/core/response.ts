import { requireMcp } from './errors';

/** The transport envelope and text fallback count toward the actual wire budget. */
export async function boundMcpResponse(response: Response, maxBytes: number) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireMcp(size <= maxBytes, 'MCP_RESULT_BUDGET_EXCEEDED', 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
