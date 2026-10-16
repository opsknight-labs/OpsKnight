/** Wire contract shared with the server; markers count toward the decoded byte limit. */
/** Includes JSON escaping for the maximum typed preview, error and both evidence snapshots. */
export const MAX_AGENT_RESULT_BODY_BYTES = 1024 * 1024;
export const MAX_DECODED_OUTPUT_BYTES = 10 * 1024 * 1024;
export const OUTPUT_TRUNCATION_MARKER = '\n[output truncated]';
export function sliceUtf8Safe(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  let low = 0;
  let high = Math.min(str.length, maxBytes);
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    let sliceEnd = mid;
    if (sliceEnd > 0 && sliceEnd < str.length) {
      const code = str.charCodeAt(sliceEnd - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        sliceEnd -= 1;
      }
    }
    const bytes = Buffer.byteLength(str.slice(0, sliceEnd), 'utf8');
    if (bytes <= maxBytes) {
      best = Math.max(best, sliceEnd);
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return str.slice(0, best);
}

export function boundOutput(text: string, maxBytes = MAX_DECODED_OUTPUT_BYTES) {
  const limit = Math.max(0, Math.min(maxBytes, MAX_DECODED_OUTPUT_BYTES));
  const truncated = Buffer.byteLength(text, 'utf8') > limit;
  return {
    text: truncated
      ? sliceUtf8Safe(text, Math.max(0, limit - Buffer.byteLength(OUTPUT_TRUNCATION_MARKER))) +
        sliceUtf8Safe(OUTPUT_TRUNCATION_MARKER, limit)
      : text,
    truncated,
  };
}
